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
    CoverTipsShown = 'mahjong_match_cover_tips_shown',
    RopeTipsShown = 'mahjong_match_rope_tips_shown',
    UndoCount = 'mahjong_match_undo_count',
    SwitchCount = 'mahjong_match_switch_count',
    UnlockCount = 'mahjong_match_unlock_count',
    FavoriteRewardDate = 'mahjong_match_favorite_reward_date',
    ExperimentSharePropDaily = 'mahjong_match_experiment_share_prop_daily',
    GlobalAdCount = 'mahjong_match_global_ad_count',
    LevelRetryCount = 'mahjong_match_level_retry_count',
    LeafConut = 'mahjong_match_leafConut',
    SignFirstSeenDate = 'mahjong_match_sign_first_seen_date',
    SignLastDate = 'mahjong_match_sign_last_date',
    SignStreak = 'mahjong_match_sign_streak',
    SignMonthDays = 'mahjong_match_sign_month_days',
    SignRewardClaims = 'mahjong_match_sign_reward_claims',
    WinSignShownDate = 'mahjong_match_win_sign_shown_date',
    // 独立的 7 天登录签到；不要与上面的“每日首胜签到”Sign* 数据混用。
    DailySignLastDate = 'mahjong_match_daily_sign_last_date',
    DailySignStreak = 'mahjong_match_daily_sign_streak',
    DailySignShownDate = 'mahjong_match_daily_sign_home_shown_date',
    // 首次通过第二关后，是否已请求过微信系统订阅消息。
    SystemSubscribePrompted = 'mahjong_match_system_subscribe_prompted',
    // —— 连胜值难度分档 ——
    // 当前真实连续胜场（int，>=0），用于排行榜和动态难度。
    WinStreak = 'mahjong_match_win_streak',
    // 旧版每日清零日期，废弃但保留以兼容已有存档。
    WinStreakDate = 'mahjong_match_win_streak_date',
    /** 独立的 72 小时连胜奖励轨道；与排行榜连续胜场分开保存。 */
    WinStreakRewardState = 'mahjong_match_win_streak_reward_state',
    /** 每天首次手动打开连胜界面时，是否已经播放过从起点滚到当前进度的引导。 */
    WinStreakManualIntroShownDate = 'mahjong_match_win_streak_manual_intro_shown_date',
    /** 结算排行榜的当前段位、段位内进度和排名。 */
    SettlementRankState = 'mahjong_match_settlement_rank_state',
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
