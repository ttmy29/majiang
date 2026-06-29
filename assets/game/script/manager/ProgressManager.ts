import { StorageKey, StorageManager } from './StorageManager';

export interface TileKey {
    layer: number;
    row: number;
    col: number;
}

export interface TileSnap extends TileKey {
    type: string;
    collected: boolean;
    removed: boolean;
    location: 'board' | 'slot' | 'target' | 'discarded';
}

export interface BoxSnap {
    type: string;
    progress: number;
    unlocked: boolean;
    required: number;
    tileKeys: TileKey[];
}

export interface ProgressSnapshot {
    version: 1;
    level: number;
    taskQueue: string[];
    tiles: TileSnap[];
    slotKeys: TileKey[];
    discardedKeys: TileKey[];
    actionHistoryKeys: TileKey[];
    ironLockedKeys?: TileKey[];
    boxes: BoxSnap[];
    remainTime: number;
    elapsedTime: number;
}

const SNAPSHOT_VERSION = 1;
const ACTIVITY_FIRST_BOARD = 1;
const ACTIVITY_FALLBACK_BOARD = 150;

export class ProgressManager {
    static loadLevel(): number {
        const raw = StorageManager.instance.getItem(StorageKey.CurrentLevel);
        if (raw === null) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    static saveLevel(level: number): void {
        StorageManager.instance.setItem(StorageKey.CurrentLevel, level);
    }

    static loadActivityLevel(): number {
        const raw = StorageManager.instance.getItem(StorageKey.ActivityLevel);
        if (raw === null) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    static saveActivityLevel(level: number): void {
        StorageManager.instance.setItem(StorageKey.ActivityLevel, Math.max(0, Math.floor(level)));
    }

    static loadActivityBoardId(level: number): number {
        const normalizedLevel = Math.max(0, Math.floor(level));
        const boardId = Math.min(ACTIVITY_FALLBACK_BOARD, ACTIVITY_FIRST_BOARD + normalizedLevel);
        const raw = StorageManager.instance.getItem(StorageKey.ActivityBoardId);
        if (raw) {
            try {
                const obj = JSON.parse(raw) as { level?: number; boardId?: number };
                if (obj && obj.level === normalizedLevel && obj.boardId !== boardId) {
                    this.clearActivitySnapshot();
                }
            } catch (e) {
                console.warn('ProgressManager: activity board parse failed', e);
            }
        }

        this.saveActivityBoardId(normalizedLevel, boardId);
        return boardId;
    }

    static saveActivityBoardId(level: number, boardId: number): void {
        StorageManager.instance.setItem(StorageKey.ActivityBoardId, JSON.stringify({
            level: Math.max(0, Math.floor(level)),
            boardId: Math.max(0, Math.floor(boardId)),
        }));
    }

    // —— 道具(撤回/换牌)剩余次数,永久保存,首次默认 1 ——
    static loadUndoCount(): number {
        return this.loadCount(StorageKey.UndoCount);
    }

    static saveUndoCount(count: number): void {
        this.saveCount(StorageKey.UndoCount, count);
    }

    static loadSwitchCount(): number {
        return this.loadCount(StorageKey.SwitchCount);
    }

    static saveSwitchCount(count: number): void {
        this.saveCount(StorageKey.SwitchCount, count);
    }

    private static loadCount(key: StorageKey): number {
        const raw = StorageManager.instance.getItem(key);
        if (raw === null) return 1; // key 从未写过 => 首次默认 1
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 1;
    }

    private static saveCount(key: StorageKey, count: number): void {
        StorageManager.instance.setItem(key, Math.max(0, Math.floor(count)));
    }

    // —— 全局累计看广告次数（跨关，持久化，只增，默认 0）——
    static loadGlobalAdCount(): number {
        const raw = StorageManager.instance.getItem(StorageKey.GlobalAdCount);
        if (raw === null) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    static addGlobalAdCount(delta = 1): number {
        const next = this.loadGlobalAdCount() + Math.max(0, Math.floor(delta));
        StorageManager.instance.setItem(StorageKey.GlobalAdCount, next);
        return next;
    }

    // —— 本关重拾(重开)次数。游戏无选关、关号只增，只存「当前这一关」一条 {level,count}；
    //    传入 level 与已存 level 不一致时自动归零重计，无需额外清理 ——
    static loadLevelRetryCount(level: number): number {
        const raw = StorageManager.instance.getItem(StorageKey.LevelRetryCount);
        if (!raw) return 0;
        try {
            const obj = JSON.parse(raw) as { level?: number; count?: number };
            if (!obj || obj.level !== level) return 0;
            const v = obj.count;
            return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : 0;
        } catch (e) {
            console.warn('ProgressManager: retry count parse failed', e);
            return 0;
        }
    }

    static addLevelRetryCount(level: number, delta = 1): number {
        const next = this.loadLevelRetryCount(level) + Math.max(0, Math.floor(delta));
        StorageManager.instance.setItem(StorageKey.LevelRetryCount, JSON.stringify({ level, count: next }));
        return next;
    }

    static loadActivityRetryCount(level: number): number {
        const raw = StorageManager.instance.getItem(StorageKey.ActivityRetryCount);
        if (!raw) return 0;
        try {
            const obj = JSON.parse(raw) as { level?: number; count?: number };
            if (!obj || obj.level !== level) return 0;
            const v = obj.count;
            return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : 0;
        } catch (e) {
            console.warn('ProgressManager: activity retry count parse failed', e);
            return 0;
        }
    }

    static addActivityRetryCount(level: number, delta = 1): number {
        const next = this.loadActivityRetryCount(level) + Math.max(0, Math.floor(delta));
        StorageManager.instance.setItem(StorageKey.ActivityRetryCount, JSON.stringify({ level, count: next }));
        return next;
    }

    static loadSnapshot(): ProgressSnapshot | null {
        const raw = StorageManager.instance.getItem(StorageKey.LevelSnapshot);



        // return {
        //     "version": 1,
        //     "level": 5,
        //     "taskQueue": [
        //         "4001",
        //         "3001",
        //         "5001",
        //         "2001",
        //         "4005",
        //         "4006",
        //         "2008"
        //     ],
        //     "tiles": [
        //         {
        //             "layer": 0,
        //             "row": 14,
        //             "col": 2,
        //             "type": "2008",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 14,
        //             "col": 4,
        //             "type": "3001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 14,
        //             "col": 6,
        //             "type": "4001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 14,
        //             "col": 8,
        //             "type": "3001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 12,
        //             "col": 0,
        //             "type": "2001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 12,
        //             "col": 10,
        //             "type": "4006",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 10,
        //             "col": 0,
        //             "type": "5001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 10,
        //             "col": 10,
        //             "type": "5003",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 8,
        //             "col": 2,
        //             "type": "5001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 8,
        //             "col": 4,
        //             "type": "2003",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 8,
        //             "col": 6,
        //             "type": "4005",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 8,
        //             "col": 8,
        //             "type": "2008",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 6,
        //             "col": 2,
        //             "type": "2001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 6,
        //             "col": 4,
        //             "type": "4005",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 6,
        //             "col": 6,
        //             "type": "4001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 6,
        //             "col": 8,
        //             "type": "3004",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 4,
        //             "col": 0,
        //             "type": "1002",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 4,
        //             "col": 10,
        //             "type": "4006",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 2,
        //             "col": 0,
        //             "type": "2001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 2,
        //             "col": 10,
        //             "type": "5003",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 0,
        //             "col": 2,
        //             "type": "1002",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 0,
        //             "col": 4,
        //             "type": "2008",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 0,
        //             "col": 6,
        //             "type": "3001",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 0,
        //             "row": 0,
        //             "col": 8,
        //             "type": "4005",
        //             "collected": false,
        //             "removed": false,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 1,
        //             "type": "4006",
        //             "collected": true,
        //             "removed": false,
        //             "location": "slot"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 3,
        //             "type": "4007",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 5,
        //             "type": "4001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 7,
        //             "type": "3001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 9,
        //             "type": "2008",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 11,
        //             "col": 1,
        //             "type": "4005",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 11,
        //             "col": 9,
        //             "type": "4001",
        //             "collected": true,
        //             "removed": false,
        //             "location": "slot"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 9,
        //             "col": 1,
        //             "type": "4001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 9,
        //             "col": 9,
        //             "type": "2003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 2,
        //             "type": "5001",
        //             "collected": true,
        //             "removed": false,
        //             "location": "slot"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 4,
        //             "type": "4006",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 6,
        //             "type": "2001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 8,
        //             "type": "2003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 5,
        //             "col": 1,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 5,
        //             "col": 9,
        //             "type": "3004",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 3,
        //             "col": 1,
        //             "type": "1002",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 3,
        //             "col": 9,
        //             "type": "4005",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 1,
        //             "col": 1,
        //             "type": "3001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 1,
        //             "col": 3,
        //             "type": "4006",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 1,
        //             "col": 5,
        //             "type": "2001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 1,
        //             "col": 7,
        //             "type": "1002",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 1,
        //             "row": 1,
        //             "col": 9,
        //             "type": "3004",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 13,
        //             "col": 2,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 13,
        //             "col": 4,
        //             "type": "6001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 13,
        //             "col": 6,
        //             "type": "2003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 13,
        //             "col": 8,
        //             "type": "3004",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 12,
        //             "col": 0,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 12,
        //             "col": 10,
        //             "type": "2003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 10,
        //             "col": 0,
        //             "type": "5003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "target"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 10,
        //             "col": 10,
        //             "type": "4005",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 9,
        //             "col": 2,
        //             "type": "1002",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 9,
        //             "col": 8,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 7,
        //             "col": 2,
        //             "type": "2008",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 7,
        //             "col": 4,
        //             "type": "2008",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 7,
        //             "col": 6,
        //             "type": "1002",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 7,
        //             "col": 8,
        //             "type": "3004",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 5,
        //             "col": 2,
        //             "type": "3004",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 5,
        //             "col": 8,
        //             "type": "6001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 4,
        //             "col": 0,
        //             "type": "2003",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 4,
        //             "col": 10,
        //             "type": "4001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 2,
        //             "col": 0,
        //             "type": "2001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 2,
        //             "col": 10,
        //             "type": "4007",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 1,
        //             "col": 2,
        //             "type": "3001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 1,
        //             "col": 4,
        //             "type": "4006",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 1,
        //             "col": 6,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 2,
        //             "row": 1,
        //             "col": 8,
        //             "type": "4007",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 3,
        //             "row": 7,
        //             "col": 4,
        //             "type": "1001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         },
        //         {
        //             "layer": 3,
        //             "row": 7,
        //             "col": 6,
        //             "type": "6001",
        //             "collected": true,
        //             "removed": true,
        //             "location": "board"
        //         }
        //     ],
        //     "slotKeys": [
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 2
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 1
        //         },
        //         {
        //             "layer": 1,
        //             "row": 11,
        //             "col": 9
        //         }
        //     ],
        //     "discardedKeys": [],
        //     "actionHistoryKeys": [
        //         {
        //             "layer": 1,
        //             "row": 7,
        //             "col": 2
        //         },
        //         {
        //             "layer": 1,
        //             "row": 13,
        //             "col": 1
        //         },
        //         {
        //             "layer": 1,
        //             "row": 11,
        //             "col": 9
        //         }
        //     ],
        //     "ironLockedKeys": [],
        //     "boxes": [
        //         {
        //             "type": "2003",
        //             "progress": 2,
        //             "unlocked": true,
        //             "required": 3,
        //             "tileKeys": [
        //                 {
        //                     "layer": 1,
        //                     "row": 7,
        //                     "col": 8
        //                 },
        //                 {
        //                     "layer": 1,
        //                     "row": 9,
        //                     "col": 9
        //                 }
        //             ]
        //         },
        //         {
        //             "type": "3004",
        //             "progress": 2,
        //             "unlocked": true,
        //             "required": 3,
        //             "tileKeys": [
        //                 {
        //                     "layer": 1,
        //                     "row": 5,
        //                     "col": 9
        //                 },
        //                 {
        //                     "layer": 1,
        //                     "row": 1,
        //                     "col": 9
        //                 }
        //             ]
        //         },
        //         {
        //             "type": "1002",
        //             "progress": 1,
        //             "unlocked": true,
        //             "required": 3,
        //             "tileKeys": [
        //                 {
        //                     "layer": 1,
        //                     "row": 3,
        //                     "col": 1
        //                 }
        //             ]
        //         },
        //         {
        //             "type": "5003",
        //             "progress": 1,
        //             "unlocked": true,
        //             "required": 3,
        //             "tileKeys": [
        //                 {
        //                     "layer": 2,
        //                     "row": 10,
        //                     "col": 0
        //                 }
        //             ]
        //         }
        //     ],
        //     "remainTime": 300,
        //     "elapsedTime": 39.82610000000095
        // }

        if (!raw) return null;
        try {
            const data = JSON.parse(raw) as ProgressSnapshot;
            if (!data || data.version !== SNAPSHOT_VERSION) return null;
            if (!Array.isArray(data.tiles) || !Array.isArray(data.boxes)) return null;
            return data;
        } catch (e) {
            console.warn('ProgressManager: snapshot parse failed', e);
            return null;
        }
    }

    static saveSnapshot(snap: ProgressSnapshot): void {
        try {
            StorageManager.instance.setItem(StorageKey.LevelSnapshot, JSON.stringify(snap));
        } catch (e) {
            console.warn('ProgressManager: snapshot save failed', e);
        }
    }

    static clearSnapshot(): void {
        StorageManager.instance.removeItem(StorageKey.LevelSnapshot);
    }

    static loadActivitySnapshot(): ProgressSnapshot | null {
        const raw = StorageManager.instance.getItem(StorageKey.ActivitySnapshot);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw) as ProgressSnapshot;
            if (!data || data.version !== SNAPSHOT_VERSION) return null;
            if (!Array.isArray(data.tiles) || !Array.isArray(data.boxes)) return null;
            return data;
        } catch (e) {
            console.warn('ProgressManager: activity snapshot parse failed', e);
            return null;
        }
    }

    static saveActivitySnapshot(snap: ProgressSnapshot): void {
        try {
            StorageManager.instance.setItem(StorageKey.ActivitySnapshot, JSON.stringify(snap));
        } catch (e) {
            console.warn('ProgressManager: activity snapshot save failed', e);
        }
    }

    static clearActivitySnapshot(): void {
        StorageManager.instance.removeItem(StorageKey.ActivitySnapshot);
    }
}
