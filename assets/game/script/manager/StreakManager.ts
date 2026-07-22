import { StorageKey, StorageManager } from './StorageManager';
import { ArchiveManager } from './ArchiveManager';
import { Constants } from '../config/Constants';
import { getAvailableBoardIds, LevelTier } from '../config/LevelJsonLoader';
import { ProgressManager } from './ProgressManager';

export interface LevelStartPlan {
    tier: LevelTier;
    boardId: number;
}

interface LevelDiffState {
    level: number;
    tier: LevelTier;
    boardId: number;
    /** 仅为兼容已有存档保留，不再影响复活后的胜利结算。 */
    failed: boolean;
}

export type WinStreakRewardType = 'switch' | 'leaf' | 'undo' | 'unlock';

export interface WinStreakRewardConfig {
    threshold: number;
    type: WinStreakRewardType;
    amount: number;
    /** 1 铜、2 银、3/4 红。原资源中的 4 也映射到红宝箱。 */
    boxType: 1 | 2 | 3 | 4;
}

export interface WinStreakViewState {
    /** 排行榜与动态难度使用的真实连续胜场。 */
    streak: number;
    /** 当前 72 小时奖励轨道进度。 */
    progress: number;
    /** 已到达的最近奖励节点，未到首节点时为 0。 */
    checkpoint: number;
    previousThreshold: number;
    nextThreshold: number;
    nextReward: WinStreakRewardConfig;
    remainingSeconds: number;
    completed: boolean;
    cycleStartedAt: number;
}

export interface WinStreakSettlement {
    before: WinStreakViewState;
    after: WinStreakViewState;
    displayFrom: number;
    displayTo: number;
    displayProgressBefore: number;
    displayProgressAfter: number;
    displayReward: WinStreakRewardConfig;
    claimableRewards: WinStreakRewardConfig[];
}

interface StoredWinStreakRewardState {
    version: 1;
    startTime: number;
    progress: number;
    claimedThresholds: number[];
}

const REWARD_STATE_VERSION = 1 as const;
const REWARD_CYCLE_SECONDS = 72 * 60 * 60;
const MAIN_LEVEL_START = 1;

const REWARD_CONFIGS: ReadonlyArray<Readonly<WinStreakRewardConfig>> = [
    { threshold: 3, type: 'switch', amount: 1, boxType: 1 },
    { threshold: 6, type: 'undo', amount: 1, boxType: 1 },
    { threshold: 10, type: 'undo', amount: 2, boxType: 2 },
    { threshold: 13, type: 'undo', amount: 2, boxType: 2 },
    { threshold: 16, type: 'switch', amount: 1, boxType: 2 },
    { threshold: 20, type: 'switch', amount: 2, boxType: 2 },
    { threshold: 25, type: 'unlock', amount: 1, boxType: 3 },
    { threshold: 28, type: 'switch', amount: 1, boxType: 1 },
    { threshold: 32, type: 'switch', amount: 2, boxType: 2 },
    { threshold: 35, type: 'switch', amount: 2, boxType: 2 },
    { threshold: 40, type: 'switch', amount: 2, boxType: 2 },
    { threshold: 45, type: 'unlock', amount: 2, boxType: 4 },
];

function isLevelTier(value: unknown): value is LevelTier {
    return value === 'base' || value === 'easy' || value === 'normal' || value === 'hard';
}

function cloneReward(config: Readonly<WinStreakRewardConfig>): WinStreakRewardConfig {
    return { ...config };
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** 真实连胜、72 小时奖励轨道和动态难度盘面分配。 */
export class StreakManager {
    static getStreak(): number {
        const raw = StorageManager.instance.getItem(StorageKey.WinStreak);
        if (raw === null) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    }

    static setStreak(value: number): void {
        StorageManager.instance.setItem(StorageKey.WinStreak, Math.max(0, Math.floor(value)));
    }

    /** 旧版本入口保留，真实连续胜场不再按自然日清零。 */
    static applyDailyResetIfNeeded(): void {
        // WinStreakDate 故意保留在存档中，避免升级时破坏已有云存档。
    }

    static getRewardConfigs(): WinStreakRewardConfig[] {
        return REWARD_CONFIGS.map(cloneReward);
    }

    static getRewardAt(threshold: number): WinStreakRewardConfig | null {
        const config = REWARD_CONFIGS.find((item) => item.threshold === threshold);
        return config ? cloneReward(config) : null;
    }

    static getClaimableRewards(nowUnixSeconds = this.nowUnixSeconds()): WinStreakRewardConfig[] {
        return this.getClaimableRewardsForState(this.loadRewardState(nowUnixSeconds));
    }

    static getRewardName(type: WinStreakRewardType): string {
        switch (type) {
            case 'switch': return '换牌';
            case 'leaf': return '叶子';
            case 'undo': return '撤回';
            case 'unlock': return '解锁';
        }
    }

    static getRewardDescription(config: WinStreakRewardConfig): string {
        return `${this.getRewardName(config.type)} ×${config.amount}`;
    }

    static formatRemainingTime(seconds: number): string {
        const safe = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(safe / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        const secs = safe % 60;
        const pad = (value: number) => value < 10 ? `0${value}` : `${value}`;
        return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
    }

    /**
     * 获取奖励轨道视图。可选 nowUnixSeconds 便于精确验证 0/-1 秒边界。
     * 只有剩余时间严格小于 0 才开启新周期；恰好 0 秒仍属于旧周期。
     */
    static getRewardViewState(nowUnixSeconds = this.nowUnixSeconds()): WinStreakViewState {
        const stored = this.loadRewardState(nowUnixSeconds);
        return this.createRewardViewState(stored, nowUnixSeconds);
    }

    private static createRewardViewState(
        stored: StoredWinStreakRewardState,
        nowUnixSeconds: number,
    ): WinStreakViewState {
        const remaining = stored.startTime + REWARD_CYCLE_SECONDS - nowUnixSeconds;
        const progress = stored.progress;
        const checkpoint = this.getCheckpoint(progress);
        const next = REWARD_CONFIGS.find((item) => item.threshold > progress)
            ?? REWARD_CONFIGS[REWARD_CONFIGS.length - 1];

        return {
            streak: this.getStreak(),
            progress,
            checkpoint,
            previousThreshold: checkpoint,
            nextThreshold: next.threshold,
            nextReward: cloneReward(next),
            remainingSeconds: Math.max(0, Math.floor(remaining)),
            completed: progress >= REWARD_CONFIGS[REWARD_CONFIGS.length - 1].threshold,
            cycleStartedAt: stored.startTime,
        };
    }

    /** 主线通关结算；活动关和引导关返回 null 且不修改任何连胜状态。 */
    static commitClear(level: number): WinStreakSettlement | null {
        const saved = this.loadDiffState();
        if (level >= Constants.WinStreak.StartLevel) {
            const boardId = (saved && saved.level === level) ? saved.boardId : level;
            this.markBoardPlayed(boardId);
        }
        if (level < MAIN_LEVEL_START) return null;

        const now = this.nowUnixSeconds();
        const storedBefore = this.loadRewardState(now);
        const before = this.createRewardViewState(storedBefore, now);
        this.setStreak(this.getStreak() + 1);

        const maxProgress = REWARD_CONFIGS[REWARD_CONFIGS.length - 1].threshold;
        const nextProgress = Math.min(maxProgress, before.progress + 1);
        const rewardState: StoredWinStreakRewardState = {
            version: REWARD_STATE_VERSION,
            startTime: before.cycleStartedAt,
            progress: nextProgress,
            claimedThresholds: storedBefore.claimedThresholds.slice(),
        };
        this.saveRewardState(rewardState);

        const claimableRewards = this.getClaimableRewardsForState(rewardState);

        const after = this.createRewardViewState(rewardState, now);
        const reachedReward = claimableRewards[0] ?? null;
        const displayReward = reachedReward ?? after.nextReward;
        const displayTo = displayReward.threshold;
        const previousConfig = [...REWARD_CONFIGS]
            .reverse()
            .find((item) => item.threshold < displayTo);
        const displayFrom = previousConfig?.threshold ?? 0;
        const span = Math.max(1, displayTo - displayFrom);

        ArchiveManager.instance.scheduleUpload();
        return {
            before,
            after,
            displayFrom,
            displayTo,
            displayProgressBefore: clamp01((before.progress - displayFrom) / span),
            displayProgressAfter: clamp01((after.progress - displayFrom) / span),
            displayReward: cloneReward(displayReward),
            claimableRewards: claimableRewards.map(cloneReward),
        };
    }

    /**
     * 领取已经达到、但尚未发放的连胜奖励。按奖励节点持久化去重，可安全重复调用。
     */
    static claimRewards(rewards: ReadonlyArray<WinStreakRewardConfig>): WinStreakRewardConfig[] {
        if (!rewards.length) return [];

        const now = this.nowUnixSeconds();
        const state = this.loadRewardState(now);
        const claimedThresholds = new Set(state.claimedThresholds);
        const claimedRewards: WinStreakRewardConfig[] = [];

        for (const requested of rewards) {
            const reward = REWARD_CONFIGS.find((item) => item.threshold === requested.threshold);
            if (!reward || reward.threshold > state.progress || claimedThresholds.has(reward.threshold)) continue;

            this.grantReward(reward);
            claimedThresholds.add(reward.threshold);
            claimedRewards.push(cloneReward(reward));
        }

        if (claimedRewards.length > 0) {
            state.claimedThresholds = Array.from(claimedThresholds).sort((a, b) => a - b);
            this.saveRewardState(state);
            ArchiveManager.instance.scheduleUpload();
        }

        return claimedRewards;
    }

    /**
     * 玩家主动放弃当前主线时断连。奖励进度退回最近检查点，完成 45 胜后不再回退。
     */
    static commitLoss(level: number): void {
        if (level < MAIN_LEVEL_START) return;

        const now = this.nowUnixSeconds();
        const view = this.getRewardViewState(now);
        this.setStreak(0);
        if (!view.completed) {
            this.saveRewardState({
                version: REWARD_STATE_VERSION,
                startTime: view.cycleStartedAt,
                progress: view.checkpoint,
                claimedThresholds: this.loadRewardState(now).claimedThresholds,
            });
        }

        const saved = this.loadDiffState();
        if (saved && saved.level === level && saved.failed) {
            saved.failed = false;
            this.saveDiffState(saved);
        }
        ArchiveManager.instance.scheduleUpload();
    }

    /** @deprecated 使用 commitLoss；仅为旧调用兼容。 */
    static markFailed(level: number): void {
        this.commitLoss(level);
    }

    private static nowUnixSeconds(): number {
        return Math.floor(Date.now() / 1000);
    }

    private static getCheckpoint(progress: number): number {
        let checkpoint = 0;
        for (const config of REWARD_CONFIGS) {
            if (config.threshold > progress) break;
            checkpoint = config.threshold;
        }
        return checkpoint;
    }

    private static getClaimableRewardsForState(state: StoredWinStreakRewardState): WinStreakRewardConfig[] {
        const claimedThresholds = new Set(state.claimedThresholds);
        return REWARD_CONFIGS
            .filter((item) => item.threshold <= state.progress && !claimedThresholds.has(item.threshold))
            .map(cloneReward);
    }

    private static loadRewardState(nowUnixSeconds: number): StoredWinStreakRewardState {
        const raw = StorageManager.instance.getItem(StorageKey.WinStreakRewardState);
        let state: StoredWinStreakRewardState | null = null;
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<StoredWinStreakRewardState>;
                if (parsed.version === REWARD_STATE_VERSION
                    && typeof parsed.startTime === 'number' && Number.isFinite(parsed.startTime)
                    && typeof parsed.progress === 'number' && Number.isFinite(parsed.progress)) {
                    const progress = Math.max(0, Math.min(45, Math.floor(parsed.progress)));
                    const hasClaimedThresholds = Array.isArray(parsed.claimedThresholds);
                    // 旧存档中的节点奖励已在通关时直接发放；迁移时视为全部已领取，防止重复补发。
                    const claimedThresholds = hasClaimedThresholds
                        ? parsed.claimedThresholds!
                            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
                            .map((value) => Math.floor(value))
                            .filter((value) => value <= progress && !!REWARD_CONFIGS.find((item) => item.threshold === value))
                        : REWARD_CONFIGS.filter((item) => item.threshold <= progress).map((item) => item.threshold);
                    state = {
                        version: REWARD_STATE_VERSION,
                        startTime: Math.floor(parsed.startTime),
                        progress,
                        claimedThresholds: Array.from(new Set(claimedThresholds)).sort((a, b) => a - b),
                    };
                    if (!hasClaimedThresholds) this.saveRewardState(state);
                }
            } catch (e) {
                console.warn('StreakManager: reward state parse failed', e);
            }
        }

        const expired = !!state && state.startTime + REWARD_CYCLE_SECONDS - nowUnixSeconds < 0;
        const hasPendingReward = !!state && this.getClaimableRewardsForState(state).length > 0;
        // 已达到但尚未领取的节点先保留，领取后下次刷新再开启新周期，避免结算界面停留时奖励过期丢失。
        if (!state || (expired && !hasPendingReward)) {
            state = {
                version: REWARD_STATE_VERSION,
                startTime: nowUnixSeconds,
                progress: 0,
                claimedThresholds: [],
            };
            this.saveRewardState(state);
        }
        return state;
    }

    private static saveRewardState(state: StoredWinStreakRewardState): void {
        StorageManager.instance.setItem(StorageKey.WinStreakRewardState, JSON.stringify(state));
        ArchiveManager.instance.scheduleUpload();
    }

    private static grantReward(reward: WinStreakRewardConfig): void {
        switch (reward.type) {
            case 'switch':
                ProgressManager.saveSwitchCount(ProgressManager.loadSwitchCount() + reward.amount);
                break;
            case 'leaf':
                ProgressManager.addLeafConut(reward.amount);
                break;
            case 'undo':
                ProgressManager.saveUndoCount(ProgressManager.loadUndoCount() + reward.amount);
                break;
            case 'unlock':
                ProgressManager.saveUnlockCount(ProgressManager.loadUnlockCount() + reward.amount);
                break;
        }
    }

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

    private static async getOrderedNormalBoardIds(): Promise<number[]> {
        return (await getAvailableBoardIds('normal'))
            .filter((id) => id >= Constants.WinStreak.StartLevel);
    }

    private static async pickRandomContinuationBoardId(ids: ReadonlyArray<number>): Promise<number> {
        if (ids.length === 0) return Constants.WinStreak.StartLevel;

        const played = new Set(this.getPlayedBoardIds());
        let unplayed = ids.filter((id) => !played.has(id));
        if (unplayed.length === 0) {
            this.resetPlayedBoardIds();
            unplayed = ids.slice();
        }
        return unplayed[Math.floor(Math.random() * unplayed.length)];
    }

    private static async resolveAvailableTier(
        boardId: number,
        preferredTier: Exclude<LevelTier, 'base'>,
    ): Promise<Exclude<LevelTier, 'base'>> {
        const fallbackOrder: Array<Exclude<LevelTier, 'base'>> = [preferredTier, 'normal', 'easy', 'hard'];
        for (const tier of fallbackOrder) {
            const ids = await getAvailableBoardIds(tier);
            if (ids.indexOf(boardId) >= 0) return tier;
        }
        return 'normal';
    }

    static async resolveLevelPlanForStart(level: number, opts?: { forceReroll?: boolean }): Promise<LevelStartPlan> {
        const forceReroll = !!opts?.forceReroll;
        const saved = this.loadDiffState();
        const sameLevel = !!saved && saved.level === level;

        const baseBoardIds = await getAvailableBoardIds('base');
        if (level < Constants.WinStreak.StartLevel || baseBoardIds.indexOf(level) >= 0) {
            const plan: LevelStartPlan = { tier: 'base', boardId: level };
            this.saveDiffState({ level, tier: plan.tier, boardId: plan.boardId, failed: false });
            return plan;
        }

        // level_hard（normal 档）是主线基准；按资源排序映射进度，可自然跳过缺号文件。
        const orderedBoardIds = await this.getOrderedNormalBoardIds();
        const boardIndex = level - Constants.WinStreak.StartLevel;
        const sequentialBoardId = boardIndex >= 0 && boardIndex < orderedBoardIds.length
            ? orderedBoardIds[boardIndex]
            : null;

        const savedBoardIsExpected = sameLevel && saved!.tier !== 'base' && (
            sequentialBoardId !== null
                ? saved!.boardId === sequentialBoardId
                : orderedBoardIds.indexOf(saved!.boardId) >= 0
        );
        const failureCount = ProgressManager.loadLevelRetryCount(level);
        const easyBoardIds = failureCount >= Constants.WinStreak.EasyAfterFailures
            ? await getAvailableBoardIds('easy')
            : [];
        const savedBoardShouldUseEasy = savedBoardIsExpected
            && easyBoardIds.indexOf(saved!.boardId) >= 0;

        if (sameLevel && !forceReroll && saved!.tier !== 'base') {
            const availableIds = await getAvailableBoardIds(saved!.tier);
            const alreadyUsesRequiredTier = !savedBoardShouldUseEasy || saved!.tier === 'easy';
            if (savedBoardIsExpected && alreadyUsesRequiredTier && availableIds.indexOf(saved!.boardId) >= 0) {
                return { tier: saved!.tier, boardId: saved!.boardId };
            }
        }

        const boardId = sequentialBoardId
            ?? (savedBoardShouldUseEasy ? saved!.boardId : await this.pickRandomContinuationBoardId(orderedBoardIds));
        const forceEasy = easyBoardIds.indexOf(boardId) >= 0;
        const tier = forceEasy
            ? 'easy'
            : await this.resolveAvailableTier(boardId, this.rollTier(this.getStreak()));
        this.saveDiffState({ level, tier, boardId, failed: false });
        ArchiveManager.instance.scheduleUpload();
        return { tier, boardId };
    }

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
