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
    boxes: BoxSnap[];
    remainTime: number;
    elapsedTime: number;
}

const SNAPSHOT_VERSION = 1;

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

    static loadSnapshot(): ProgressSnapshot | null {
        const raw = StorageManager.instance.getItem(StorageKey.LevelSnapshot);
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
}
