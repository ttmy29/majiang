import { sys } from 'cc';

export enum StorageKey {
    Music = 'mahjong_match_music',
    Audio = 'mahjong_match_audio',
    Vibrate = 'mahjong_match_vibrate',
    CurrentLevel = 'mahjong_match_current_level',
    LevelSnapshot = 'mahjong_match_level_snapshot',
    ActivityLevel = 'mahjong_match_activity_level',
    ActivityBoardId = 'mahjong_match_activity_board_id',
    ActivitySnapshot = 'mahjong_match_activity_snapshot',
    ActivityRetryCount = 'mahjong_match_activity_retry_count',
    IronTipsShown = 'mahjong_match_iron_tips_shown',
    UndoCount = 'mahjong_match_undo_count',
    SwitchCount = 'mahjong_match_switch_count',
    UnlockCount = 'mahjong_match_unlock_count',
    FavoriteRewardDate = 'mahjong_match_favorite_reward_date',
    GlobalAdCount = 'mahjong_match_global_ad_count',
    LevelRetryCount = 'mahjong_match_level_retry_count',
    LeafConut = 'mahjong_match_leafConut',
    SignFirstSeenDate = 'mahjong_match_sign_first_seen_date',
    SignLastDate = 'mahjong_match_sign_last_date',
    SignStreak = 'mahjong_match_sign_streak',
    SignMonthDays = 'mahjong_match_sign_month_days',
    SignRewardClaims = 'mahjong_match_sign_reward_claims',
    WinSignShownDate = 'mahjong_match_win_sign_shown_date',
    // —— 连胜值难度分档 ——
    // 当前连胜值（int，>=0）。失败清零、每天清零、干净通关 +1
    WinStreak = 'mahjong_match_win_streak',
    // 上次记录的本地日期 YYYY-MM-DD，用于「每天清零」跨天检测
    WinStreakDate = 'mahjong_match_win_streak_date',
    // 当前关已分配的难度状态 JSON {level, tier, failed}：重进/重开保持盘面一致 + 支撑 failed 标记
    LevelDiffState = 'mahjong_match_level_diff_state',
    // 玩家已玩过的关卡 id 集合（JSON 数组），云端同步，用于避免重复盘面
    PlayedLevels = 'mahjong_match_played_levels',
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
