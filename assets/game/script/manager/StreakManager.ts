import { StorageKey, StorageManager } from './StorageManager';
import { ArchiveManager } from './ArchiveManager';
import { Constants } from '../config/Constants';
import { getAvailableBoardIds, LevelTier } from '../config/LevelJsonLoader';

// 一次开局的方案：要用哪个难度档(tier) + 要加载哪个盘面(boardId)。
export interface LevelStartPlan {
    tier: LevelTier;
    boardId: number;
}

// 当前关已分配的方案 + 是否失败过。用于重进/重开保持同一盘面(快照可命中)、支撑 failed 标记。
interface LevelDiffState {
    level: number;     // 进度关号(nowLevel)
    tier: LevelTier;
    boardId: number;   // 实际加载的盘面 id（难度池模式下与关号解耦）
    failed: boolean;
}

function isLevelTier(value: unknown): value is LevelTier {
    return value === 'base' || value === 'easy' || value === 'normal' || value === 'hard';
}

/**
 * 连胜值难度分档 + 难度池出题（单例静态类）。
 *
 * 规则（见需求 / Constants.WinStreak）：
 *  - 前 StartLevel-1 关：固定基础盘面(base)，盘面 id = 关号，不进池不去重。
 *  - StartLevel(11) 关起：按连胜值摇难度档(简单/普通/困难)；
 *    · 难度池开启：从 [StartLevel..PoolMaxLevel] 里随机抽一个「没玩过」的盘面，关号仅作进度计数；
 *      全部玩过后重置循环。盘面去重按盘面号(跨难度)。
 *    · 失败重开：按已清零的连胜重摇难度档，并从该档重新抽一个实际存在的盘面。
 *  - 失败(进入 fail 状态) → 连胜清零 + 本关标记 failed(之后复活/重开通关也不 +1)。
 *  - 每天清零(客户端本地日期)。通关(含复活后) → 记该盘面为已玩；干净通关(未失败) → 连胜 +1。
 *
 * 持久化走 StorageManager(localStorage)，并通过 ArchiveManager 同步云端（含已玩盘面 id 集合）。
 */
export class StreakManager {
    // —— 连胜值 ——
    static getStreak(): number {
        const raw = StorageManager.instance.getItem(StorageKey.WinStreak);
        if (raw === null) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    static setStreak(value: number): void {
        StorageManager.instance.setItem(StorageKey.WinStreak, Math.max(0, Math.floor(value)));
    }

    // —— 本地日期 YYYY-MM-DD ——
    private static todayStr(): string {
        const d = new Date();
        const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // 跨天则连胜清零并把日期推进到今天。每次进关(resolveLevelPlanForStart)前自动调用，幂等。
    static applyDailyResetIfNeeded(): void {
        const today = this.todayStr();
        const last = StorageManager.instance.getItem(StorageKey.WinStreakDate);
        if (last === today) return;
        this.setStreak(0);
        StorageManager.instance.setItem(StorageKey.WinStreakDate, today);
        ArchiveManager.instance.scheduleUpload();
    }

    // —— 当前关方案 {level, tier, boardId, failed} ——
    private static loadDiffState(): LevelDiffState | null {
        const raw = StorageManager.instance.getItem(StorageKey.LevelDiffState);
        if (!raw) return null;
        try {
            const obj = JSON.parse(raw) as Partial<LevelDiffState>;
            if (!obj || typeof obj.level !== 'number' || !isLevelTier(obj.tier)) return null;
            const boardId = typeof obj.boardId === 'number' ? obj.boardId : obj.level;
            return { level: obj.level, tier: obj.tier, boardId, failed: !!obj.failed };
        } catch (e) {
            console.warn('StreakManager: diff state parse failed', e);
            return null;
        }
    }

    private static saveDiffState(state: LevelDiffState): void {
        StorageManager.instance.setItem(StorageKey.LevelDiffState, JSON.stringify(state));
    }

    // 按连胜值摇一个难度档（简单/普通/困难）
    static rollTier(streak: number): Exclude<LevelTier, 'base'> {
        const cfg = Constants.WinStreak;
        const dist = streak < cfg.Tier2Min ? cfg.Distribution.tier1
            : streak < cfg.Tier3Min ? cfg.Distribution.tier2
                : cfg.Distribution.tier3;

        const r = Math.random();
        if (r < dist.easy) return 'easy';
        if (r < dist.easy + dist.normal) return 'normal';
        return 'hard';
    }

    // 从难度池里随机抽一个「没玩过」的盘面号；全玩过则重置循环。
    private static async pickPoolBoardId(tier: Exclude<LevelTier, 'base'>): Promise<number> {
        const cfg = Constants.WinStreak;
        const ids = (await getAvailableBoardIds(tier))
            .filter((id) => id >= cfg.StartLevel && id <= cfg.PoolMaxLevel);
        if (ids.length === 0) return cfg.StartLevel;

        const played = new Set(this.getPlayedBoardIds());
        let unplayed = ids.filter((id) => !played.has(id));
        if (unplayed.length === 0) {
            // 池已全部玩过 → 重置循环（允许再次出现）
            this.resetPlayedBoardIds();
            unplayed = ids.slice();
        }
        return unplayed[Math.floor(Math.random() * unplayed.length)];
    }

    /**
     * 进关时决定开局方案 {tier, boardId}：
     *  - level < StartLevel → 基础盘面：{tier:'base', boardId:level}。
     *  - 同关重进(非强制重摇) → 复用已存方案（重开 App 盘面不变，快照可命中）。
     *  - 失败重开(forceReroll) → 按已清零的连胜重摇难度档，并从新档重新抽盘面。
     *  - 进新关 → 难度池抽一个没玩过的盘面(或关闭池时用关号) + 按连胜摇难度档。
     */
    static async resolveLevelPlanForStart(level: number, opts?: { forceReroll?: boolean }): Promise<LevelStartPlan> {
        this.applyDailyResetIfNeeded();

        if (level < Constants.WinStreak.StartLevel) {
            const plan: LevelStartPlan = { tier: 'base', boardId: level };
            this.saveDiffState({ level, tier: plan.tier, boardId: plan.boardId, failed: false });
            return plan;
        }

        const forceReroll = !!opts?.forceReroll;
        const saved = this.loadDiffState();
        const sameLevel = !!saved && saved.level === level;

        // 同一关重进、非强制重摇：已保存方案仍可用时原样复用（盘面一致，快照命中）
        if (sameLevel && !forceReroll && saved!.tier !== 'base') {
            const availableIds = await getAvailableBoardIds(saved!.tier);
            if (availableIds.indexOf(saved!.boardId) >= 0) {
                return { tier: saved!.tier, boardId: saved!.boardId };
            }
        }
        // 失败重开/新关都会按当前连胜摇档，并从该档实际存在的高级盘面池里抽取。
        const tier = this.rollTier(this.getStreak());
        const boardId = Constants.WinStreak.UseDifficultyPool ? await this.pickPoolBoardId(tier) : level;
        const failed = sameLevel ? saved!.failed : false;
        this.saveDiffState({ level, tier, boardId, failed });
        ArchiveManager.instance.scheduleUpload();
        return { tier, boardId };
    }

    // 进入失败状态：连胜清零 + 标记本关 failed（之后复活/重开通关也不 +1）。不动已玩集合（未通关不算玩过）。
    static markFailed(level: number): void {
        this.setStreak(0);
        if (level >= Constants.WinStreak.StartLevel) {
            const saved = this.loadDiffState();
            if (saved && saved.level === level) {
                if (!saved.failed) {
                    saved.failed = true;
                    this.saveDiffState(saved);
                }
            } else {
                // 防御：正常流程下 resolveLevelPlanForStart 已落库
                this.saveDiffState({ level, tier: saved?.tier ?? 'normal', boardId: saved?.boardId ?? level, failed: true });
            }
        }
        ArchiveManager.instance.scheduleUpload();
    }

    // 通关结算：记该盘面为已玩(去重，含失败后复活通关)；干净通关(本关未失败)且 level>=StartLevel → 连胜 +1
    static commitClear(level: number): void {
        const saved = this.loadDiffState();
        if (level >= Constants.WinStreak.StartLevel) {
            const boardId = (saved && saved.level === level) ? saved.boardId : level;
            this.markBoardPlayed(boardId);
        }
        if (level < Constants.WinStreak.StartLevel) return;
        if (saved && saved.level === level && saved.failed) return; // 本关失败过，不 +1
        this.setStreak(this.getStreak() + 1);
        ArchiveManager.instance.scheduleUpload();
    }

    // —— 已玩盘面 id 集合（云端同步，用于难度池去重）——
    static getPlayedBoardIds(): number[] {
        const raw = StorageManager.instance.getItem(StorageKey.PlayedLevels);
        if (!raw) return [];
        try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number' && Number.isFinite(n)) : [];
        } catch (e) {
            console.warn('StreakManager: played levels parse failed', e);
            return [];
        }
    }

    static hasPlayedBoard(id: number): boolean {
        return this.getPlayedBoardIds().indexOf(id) >= 0;
    }

    static markBoardPlayed(id: number): void {
        if (id <= 0) return;
        const played = this.getPlayedBoardIds();
        if (played.indexOf(id) >= 0) return;
        played.push(id);
        StorageManager.instance.setItem(StorageKey.PlayedLevels, JSON.stringify(played));
        ArchiveManager.instance.scheduleUpload();
    }

    private static resetPlayedBoardIds(): void {
        StorageManager.instance.setItem(StorageKey.PlayedLevels, JSON.stringify([]));
        ArchiveManager.instance.scheduleUpload();
    }
}
