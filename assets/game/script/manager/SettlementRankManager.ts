import { Constants } from '../config/Constants';
import { ArchiveManager } from './ArchiveManager';
import { StorageKey, StorageManager } from './StorageManager';

interface SettlementRankState {
    version: 1;
    tierIndex: number;
    progress: number;
    rank: number;
    generation: number;
    lastCompletedLevel: number;
}

export interface SettlementRankResult {
    tierIndex: number;
    progress: number;
    startRank: number;
    finalRank: number;
    generation: number;
    promoted: boolean;
    advanced: boolean;
}

/**
 * 结算排行榜进度：每个段位 100 名玩家，完成 10 关从第 100 名升到第 1 名。
 * 到达第 1 名后，下一次主线通关进入更高段位并从第 100 名开始新一轮。
 */
export class SettlementRankManager {
    static readonly PLAYER_COUNT = 100;
    static readonly PROGRESS_COUNT = 10;

    static settle(completedLevel: number, advance = true): SettlementRankResult {
        const normalizedLevel = Math.max(1, Math.floor(Number(completedLevel) || 1));
        const state = this.loadState(normalizedLevel);

        if (!advance || normalizedLevel <= state.lastCompletedLevel) {
            return {
                tierIndex: state.tierIndex,
                progress: state.progress,
                startRank: state.rank,
                finalRank: state.rank,
                generation: state.generation,
                promoted: false,
                advanced: false,
            };
        }

        let promoted = false;
        if (state.progress >= this.PROGRESS_COUNT && state.tierIndex < this.getMaxTierIndex()) {
            state.tierIndex += 1;
            state.progress = 0;
            state.rank = this.PLAYER_COUNT;
            state.generation += 1;
            promoted = true;
        }

        const startRank = state.rank;
        if (state.progress < this.PROGRESS_COUNT) {
            state.progress += 1;
            state.rank = this.getRankForProgress(state.progress);
        }
        state.lastCompletedLevel = normalizedLevel;
        this.saveState(state);

        return {
            tierIndex: state.tierIndex,
            progress: state.progress,
            startRank,
            finalRank: state.rank,
            generation: state.generation,
            promoted,
            advanced: true,
        };
    }

    static getRankForProgress(progress: number): number {
        const normalized = Math.max(0, Math.min(this.PROGRESS_COUNT, Math.floor(progress)));
        if (normalized <= 0) return this.PLAYER_COUNT;
        if (normalized >= this.PROGRESS_COUNT) return 1;
        return 101 - normalized * 10;
    }

    static getProgressForRank(rank: number): number {
        const normalized = Math.max(1, Math.min(this.PLAYER_COUNT, Math.floor(rank)));
        return this.PROGRESS_COUNT - Math.floor((normalized - 1) / 10);
    }

    static getTierIndexForLevel(level: number): number {
        const rankCount = Math.min(Constants.rankNames.length, Constants.rankStartLevels.length);
        const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
        for (let index = rankCount - 1; index >= 0; index--) {
            if (normalizedLevel >= Constants.rankStartLevels[index]) return index;
        }
        return 0;
    }

    private static loadState(completedLevel: number): SettlementRankState {
        const raw = StorageManager.instance.getItem(StorageKey.SettlementRankState);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<SettlementRankState>;
                if (parsed?.version === 1) return this.normalizeState(parsed, completedLevel);
            } catch (err) {
                console.warn('[SettlementRankManager] 排行进度存档解析失败，将重新初始化', err);
            }
        }

        return {
            version: 1,
            tierIndex: this.getTierIndexForLevel(completedLevel),
            progress: 0,
            rank: this.PLAYER_COUNT,
            generation: 0,
            lastCompletedLevel: -1,
        };
    }

    private static normalizeState(
        state: Partial<SettlementRankState>,
        completedLevel: number,
    ): SettlementRankState {
        const maxTierIndex = this.getMaxTierIndex();
        const tierIndex = Math.max(
            0,
            Math.min(maxTierIndex, Math.floor(Number(state.tierIndex) || 0)),
        );
        const progress = Math.max(
            0,
            Math.min(this.PROGRESS_COUNT, Math.floor(Number(state.progress) || 0)),
        );
        const generation = Math.max(0, Math.floor(Number(state.generation) || 0));
        const lastCompletedLevel = Number.isFinite(Number(state.lastCompletedLevel))
            ? Math.floor(Number(state.lastCompletedLevel))
            : completedLevel - 1;

        return {
            version: 1,
            tierIndex,
            progress,
            rank: this.getRankForProgress(progress),
            generation,
            lastCompletedLevel,
        };
    }

    private static saveState(state: SettlementRankState): void {
        StorageManager.instance.setItem(StorageKey.SettlementRankState, JSON.stringify(state));
        ArchiveManager.instance.scheduleUpload();
    }

    private static getMaxTierIndex(): number {
        return Math.max(0, Math.min(Constants.rankNames.length, Constants.rankStartLevels.length) - 1);
    }
}
