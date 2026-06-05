import { sys } from 'cc';

export enum StorageKey {
    Music = 'mahjong_match_music',
    Audio = 'mahjong_match_audio',
    Vibrate = 'mahjong_match_vibrate',
    CurrentLevel = 'mahjong_match_current_level',
    LevelSnapshot = 'mahjong_match_level_snapshot',
    Level15TipsShown = 'mahjong_match_level15_tips_shown',
    UndoCount = 'mahjong_match_undo_count',
    SwitchCount = 'mahjong_match_switch_count',
}

export class StorageManager {
    private static _instance: StorageManager;
    public static get instance() {
        if (this._instance) {
            return this._instance;
        }
        this._instance = new StorageManager();
        return this._instance;
    }

    setItem(key: string, value: string | number | boolean): void {
        sys.localStorage.setItem(key, String(value));
    }

    getItem(key: string): string | null {
        let local = sys.localStorage.getItem(key);
        if (local == '') {
            return null;
        }
        return local;
    }

    setBoolean(key: string, value: boolean): void {
        sys.localStorage.setItem(key, value ? 'true' : 'false');
    }

    getBoolean(key: string, defaultValue = true): boolean {
        const value = sys.localStorage.getItem(key);
        return (value === null || value === '') ? defaultValue : value === 'true';
    }

    removeItem(key: string): void {
        sys.localStorage.removeItem(key);
    }

    clear(): void {
        sys.localStorage.clear();
    }
}
