import { director } from 'cc';
import { Constants } from '../config/Constants';
import { ArchiveManager } from './ArchiveManager';
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
    covered?: boolean;
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
    boardId?: number;
    iqValue?: number;
    iqClearCount?: number;
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

interface SignMonthRecord {
    month: string;
    days: number[];
}

interface SignRewardRecord {
    month: string;
    claimed: number[];
}

const SNAPSHOT_VERSION = 1;
const ACTIVITY_FIRST_BOARD = 1;
const ACTIVITY_MAX_BOARD = 93;
// v2 marks randomized post-cap boards. Legacy records pinned to board 93 must be rerolled.
const ACTIVITY_BOARD_RECORD_VERSION = 2;

interface ActivityBoardRecord {
    version?: number;
    level?: number;
    boardId?: number;
}

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
        const sequentialBoardId = ACTIVITY_FIRST_BOARD + normalizedLevel;
        const raw = StorageManager.instance.getItem(StorageKey.ActivityBoardId);
        let stored: ActivityBoardRecord | null = null;
        if (raw) {
            try {
                stored = JSON.parse(raw) as ActivityBoardRecord;
            } catch (e) {
                console.warn('ProgressManager: activity board parse failed', e);
            }
        }

        if (sequentialBoardId <= ACTIVITY_MAX_BOARD) {
            if (stored?.level === normalizedLevel && stored.boardId !== sequentialBoardId) {
                this.clearActivitySnapshot();
            }
            this.saveActivityBoardId(normalizedLevel, sequentialBoardId);
            return sequentialBoardId;
        }

        const candidateStoredBoardId = stored?.boardId;
        const storedBoardId = typeof candidateStoredBoardId === 'number'
            && Number.isInteger(candidateStoredBoardId)
            && candidateStoredBoardId >= ACTIVITY_FIRST_BOARD
            && candidateStoredBoardId <= ACTIVITY_MAX_BOARD
            ? candidateStoredBoardId
            : null;
        if (stored?.version === ACTIVITY_BOARD_RECORD_VERSION
            && stored.level === normalizedLevel
            && storedBoardId !== null) {
            return storedBoardId;
        }

        if (stored?.level === normalizedLevel) this.clearActivitySnapshot();
        const boardId = this.pickRandomActivityBoardId(storedBoardId);
        this.saveActivityBoardId(normalizedLevel, boardId);
        return boardId;
    }

    static saveActivityBoardId(level: number, boardId: number): void {
        StorageManager.instance.setItem(StorageKey.ActivityBoardId, JSON.stringify({
            version: ACTIVITY_BOARD_RECORD_VERSION,
            level: Math.max(0, Math.floor(level)),
            boardId: Math.max(0, Math.floor(boardId)),
        }));
    }

    private static pickRandomActivityBoardId(excludedBoardId: number | null): number {
        const boardCount = ACTIVITY_MAX_BOARD - ACTIVITY_FIRST_BOARD + 1;
        if (boardCount <= 1) return ACTIVITY_FIRST_BOARD;

        const canExclude = excludedBoardId !== null
            && excludedBoardId >= ACTIVITY_FIRST_BOARD
            && excludedBoardId <= ACTIVITY_MAX_BOARD;
        const candidateCount = canExclude ? boardCount - 1 : boardCount;
        let boardId = ACTIVITY_FIRST_BOARD + Math.floor(Math.random() * candidateCount);
        if (canExclude && excludedBoardId !== null && boardId >= excludedBoardId) boardId += 1;
        return boardId;
    }

    // —— 道具剩余次数,永久保存:撤回/换牌首次默认 1,解锁首次默认 0 ——
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

    static loadUnlockCount(): number {
        return this.loadCount(StorageKey.UnlockCount, 0);
    }

    static saveUnlockCount(count: number): void {
        this.saveCount(StorageKey.UnlockCount, count);
    }

    static loadLeafConut(defaultValue = 0): number {
        const raw = StorageManager.instance.getItem(StorageKey.LeafConut);
        if (raw === null) return this.normalizeLeafConut(defaultValue);
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : this.normalizeLeafConut(defaultValue);
    }

    static saveLeafConut(count: number): void {
        const normalized = this.normalizeLeafConut(count);
        const raw = StorageManager.instance.getItem(StorageKey.LeafConut);
        if (raw === `${normalized}`) return;

        StorageManager.instance.setItem(StorageKey.LeafConut, normalized);
        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventLeafConutUpdate, normalized);
    }

    static addLeafConut(delta = 1): number {
        const next = this.loadLeafConut() + this.normalizeLeafConut(delta);
        this.saveLeafConut(next);
        return next;
    }

    static initSignUserState(now = new Date()): void {
        if (StorageManager.instance.getItem(StorageKey.SignFirstSeenDate)) return;

        const firstSeenDate = this.hasSignUserHistory()
            ? this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
            : this.formatSignDate(now);
        StorageManager.instance.setItem(StorageKey.SignFirstSeenDate, firstSeenDate);
        ArchiveManager.instance.scheduleUpload();
    }

    static isFirstSeenToday(now = new Date()): boolean {
        this.initSignUserState(now);
        return StorageManager.instance.getItem(StorageKey.SignFirstSeenDate) === this.formatSignDate(now);
    }

    static isReturningSignUser(now = new Date()): boolean {
        this.initSignUserState(now);
        const firstSeenDate = StorageManager.instance.getItem(StorageKey.SignFirstSeenDate);
        return !!firstSeenDate && firstSeenDate !== this.formatSignDate(now);
    }

    static shouldShowWinSignToday(now = new Date()): boolean {
        if (!this.isReturningSignUser(now)) return false;
        return StorageManager.instance.getItem(StorageKey.WinSignShownDate) !== this.formatSignDate(now);
    }

    static markWinSignShownToday(now = new Date()): void {
        const today = this.formatSignDate(now);
        if (StorageManager.instance.getItem(StorageKey.WinSignShownDate) === today) return;

        StorageManager.instance.setItem(StorageKey.WinSignShownDate, today);
        ArchiveManager.instance.scheduleUpload();
    }

    static signToday(now = new Date()): boolean {
        const today = this.formatSignDate(now);
        const lastDate = StorageManager.instance.getItem(StorageKey.SignLastDate);
        const { changed: monthChanged, days } = this.addSignMonthDay(now);

        if (lastDate === today) {
            if (monthChanged) {
                ArchiveManager.instance.scheduleUpload();
                director.emit(Constants.eventNames.EventSignInUpdate, {
                    date: today,
                    streak: this.loadSignStreak(now),
                    days,
                });
            }
            return false;
        }

        const yesterday = this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const nextStreak = lastDate === yesterday ? this.loadStoredSignStreak() + 1 : 1;

        StorageManager.instance.setItem(StorageKey.SignLastDate, today);
        StorageManager.instance.setItem(StorageKey.SignStreak, nextStreak);
        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventSignInUpdate, {
            date: today,
            streak: nextStreak,
            days,
        });
        return true;
    }

    static hasSignedToday(now = new Date()): boolean {
        return StorageManager.instance.getItem(StorageKey.SignLastDate) === this.formatSignDate(now);
    }

    // —— 独立 7 天登录签到（与每日首胜签到 Sign* 完全隔离）——
    static hasDailySignedToday(now = new Date()): boolean {
        return StorageManager.instance.getItem(StorageKey.DailySignLastDate) === this.formatSignDate(now);
    }

    static signDailyToday(now = new Date()): boolean {
        const today = this.formatSignDate(now);
        const lastDate = StorageManager.instance.getItem(StorageKey.DailySignLastDate);
        if (lastDate === today) return false;

        const yesterday = this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const nextStreak = lastDate === yesterday ? this.loadStoredDailySignStreak() + 1 : 1;

        StorageManager.instance.setItem(StorageKey.DailySignLastDate, today);
        StorageManager.instance.setItem(StorageKey.DailySignStreak, nextStreak);
        ArchiveManager.instance.scheduleUpload();
        return true;
    }

    static loadDailySignStreak(now = new Date()): number {
        const lastDate = StorageManager.instance.getItem(StorageKey.DailySignLastDate);
        if (!lastDate) return 0;

        const today = this.formatSignDate(now);
        const yesterday = this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        if (lastDate !== today && lastDate !== yesterday) return 0;

        return this.loadStoredDailySignStreak();
    }

    static loadSevenDaySignClaimedCount(now = new Date()): number {
        const streak = this.loadDailySignStreak(now);
        if (streak <= 0) return 0;

        const claimed = streak % 7;
        return this.hasDailySignedToday(now) && claimed === 0 ? 7 : claimed;
    }

    static shouldAutoShowDailySignToday(now = new Date()): boolean {
        if (this.hasDailySignedToday(now)) return false;
        return StorageManager.instance.getItem(StorageKey.DailySignShownDate) !== this.formatSignDate(now);
    }

    static markDailySignShownToday(now = new Date()): void {
        const today = this.formatSignDate(now);
        if (StorageManager.instance.getItem(StorageKey.DailySignShownDate) === today) return;

        StorageManager.instance.setItem(StorageKey.DailySignShownDate, today);
        ArchiveManager.instance.scheduleUpload();
    }

    static hasPromptedSystemSubscription(): boolean {
        return StorageManager.instance.getItem(StorageKey.SystemSubscribePrompted) === '1';
    }

    static markSystemSubscriptionPrompted(): void {
        if (this.hasPromptedSystemSubscription()) return;
        StorageManager.instance.setItem(StorageKey.SystemSubscribePrompted, '1');
        ArchiveManager.instance.scheduleUpload();
    }

    static loadSignStreak(now = new Date()): number {
        const lastDate = StorageManager.instance.getItem(StorageKey.SignLastDate);
        if (!lastDate) return 0;

        const today = this.formatSignDate(now);
        const yesterday = this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        if (lastDate !== today && lastDate !== yesterday) return 0;

        return this.loadStoredSignStreak();
    }

    static loadSignMonthDays(now = new Date()): number[] {
        const month = this.formatSignMonth(now);
        const record = this.loadSignMonthRecord();
        if (!record || record.month !== month) return [];

        return this.normalizeSignDays(record.days, this.getDaysInMonth(now));
    }

    static loadSignMonthCount(now = new Date()): number {
        return this.loadSignMonthDays(now).length;
    }

    static loadMissingSignDaysBeforeToday(now = new Date()): number[] {
        const signedDays = new Set(this.loadSignMonthDays(now));
        const missingDays: number[] = [];
        for (let day = 1; day < now.getDate(); day++) {
            if (!signedDays.has(day)) missingDays.push(day);
        }
        return missingDays;
    }

    static makeUpLatestMissingSignDay(now = new Date()): number | null {
        const missingDays = this.loadMissingSignDaysBeforeToday(now);
        const missingDay = missingDays[missingDays.length - 1];
        if (!missingDay) return null;

        const month = this.formatSignMonth(now);
        const days = this.loadSignMonthDays(now);
        days.push(missingDay);
        days.sort((a, b) => a - b);
        const streak = this.calculateCurrentMonthSignStreak(now, days);
        StorageManager.instance.setItem(StorageKey.SignMonthDays, JSON.stringify({ month, days }));
        StorageManager.instance.setItem(StorageKey.SignStreak, streak);
        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventSignInUpdate, {
            date: this.formatSignDate(new Date(now.getFullYear(), now.getMonth(), missingDay)),
            streak,
            days,
        });
        return missingDay;
    }

    static getSignRewardRequiredDays(index: number, now = new Date()): number {
        const normalizedIndex = this.normalizeSignRewardIndex(index);
        if (normalizedIndex === 5) return this.getDaysInMonth(now);

        const fixedRequiredDays = [3, 7, 10, 20];
        return fixedRequiredDays[normalizedIndex - 1] || normalizedIndex;
    }

    static isSignRewardClaimable(index: number, now = new Date()): boolean {
        const requiredDays = this.getSignRewardRequiredDays(index, now);
        if (requiredDays <= 0) return false;

        return this.loadSignMonthCount(now) >= requiredDays
            && !this.hasClaimedSignReward(index, now);
    }

    static hasClaimableSignReward(now = new Date()): boolean {
        for (let i = 1; i <= 5; i++) {
            if (this.isSignRewardClaimable(i, now)) return true;
        }

        return false;
    }

    static claimSignReward(index: number, now = new Date()): boolean {
        if (!this.isSignRewardClaimable(index, now)) return false;

        const changed = this.claimSignRewardInternal(index, now);
        if (!changed) return false;

        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventSignInUpdate, {
            date: this.formatSignDate(now),
            streak: this.loadSignStreak(now),
            days: this.loadSignMonthDays(now),
        });
        return true;
    }

    static hasClaimedSignReward(index: number, now = new Date()): boolean {
        const normalizedIndex = this.normalizeSignRewardIndex(index);
        if (normalizedIndex <= 0) return false;

        const record = this.loadSignRewardRecord();
        if (!record || record.month !== this.formatSignMonth(now)) return false;

        return this.normalizeSignRewardClaims(record.claimed).indexOf(normalizedIndex) >= 0;
    }

    private static normalizeLeafConut(count: number): number {
        return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }

    private static hasSignUserHistory(): boolean {
        return this.hasPositiveStoredNumber(StorageKey.CurrentLevel)
            || this.hasStoredValue(StorageKey.LevelSnapshot)
            || this.hasPositiveStoredNumber(StorageKey.ActivityLevel)
            || this.hasStoredValue(StorageKey.ActivityBoardId)
            || this.hasStoredValue(StorageKey.ActivitySnapshot)
            || this.hasStoredValue(StorageKey.ActivityRetryCount)
            || this.hasStoredValue(StorageKey.IronTipsShown)
            || this.hasStoredValue(StorageKey.UndoCount)
            || this.hasStoredValue(StorageKey.SwitchCount)
            || this.hasStoredValue(StorageKey.UnlockCount)
            || this.hasStoredValue(StorageKey.FavoriteRewardDate)
            || this.hasPositiveStoredNumber(StorageKey.GlobalAdCount)
            || this.hasStoredValue(StorageKey.LevelRetryCount)
            || this.hasStoredValue(StorageKey.LeafConut)
            || this.hasStoredValue(StorageKey.SignLastDate)
            || this.hasStoredValue(StorageKey.SignStreak)
            || this.hasStoredValue(StorageKey.SignMonthDays)
            || this.hasStoredValue(StorageKey.SignRewardClaims)
            || this.hasStoredValue(StorageKey.WinStreak)
            || this.hasStoredValue(StorageKey.WinStreakDate)
            || this.hasStoredValue(StorageKey.LevelDiffState)
            || this.hasStoredValue(StorageKey.PlayedLevels);
    }

    private static hasStoredValue(key: StorageKey): boolean {
        return StorageManager.instance.getItem(key) !== null;
    }

    private static hasPositiveStoredNumber(key: StorageKey): boolean {
        const raw = StorageManager.instance.getItem(key);
        if (raw === null) return false;

        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value > 0;
    }

    private static addSignMonthDay(now: Date): { changed: boolean; days: number[] } {
        const month = this.formatSignMonth(now);
        const day = now.getDate();
        const daysInMonth = this.getDaysInMonth(now);
        const record = this.loadSignMonthRecord();
        const days = record && record.month === month
            ? this.normalizeSignDays(record.days, daysInMonth)
            : [];

        if (days.indexOf(day) >= 0) return { changed: false, days };

        days.push(day);
        days.sort((a, b) => a - b);
        StorageManager.instance.setItem(StorageKey.SignMonthDays, JSON.stringify({ month, days }));
        return { changed: true, days };
    }

    private static loadSignMonthRecord(): SignMonthRecord | null {
        const raw = StorageManager.instance.getItem(StorageKey.SignMonthDays);
        if (!raw) return null;

        try {
            const obj = JSON.parse(raw) as Partial<SignMonthRecord>;
            if (!obj || typeof obj.month !== 'string' || !Array.isArray(obj.days)) return null;
            return {
                month: obj.month,
                days: obj.days,
            };
        } catch (e) {
            console.warn('ProgressManager: sign month days parse failed', e);
            return null;
        }
    }

    private static claimSignRewardInternal(index: number, now: Date): boolean {
        const normalizedIndex = this.normalizeSignRewardIndex(index);
        if (normalizedIndex <= 0) return false;

        const month = this.formatSignMonth(now);
        const record = this.loadSignRewardRecord();
        const claimed = record && record.month === month
            ? this.normalizeSignRewardClaims(record.claimed)
            : [];

        if (claimed.indexOf(normalizedIndex) >= 0) return false;

        claimed.push(normalizedIndex);
        claimed.sort((a, b) => a - b);
        StorageManager.instance.setItem(StorageKey.SignRewardClaims, JSON.stringify({ month, claimed }));
        return true;
    }

    private static loadSignRewardRecord(): SignRewardRecord | null {
        const raw = StorageManager.instance.getItem(StorageKey.SignRewardClaims);
        if (!raw) return null;

        try {
            const obj = JSON.parse(raw) as Partial<SignRewardRecord>;
            if (!obj || typeof obj.month !== 'string' || !Array.isArray(obj.claimed)) return null;
            return {
                month: obj.month,
                claimed: obj.claimed,
            };
        } catch (e) {
            console.warn('ProgressManager: sign reward claims parse failed', e);
            return null;
        }
    }

    private static normalizeSignRewardIndex(index: number): number {
        const value = Math.floor(Number(index));
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    private static normalizeSignRewardClaims(claimed: number[]): number[] {
        const set = new Set<number>();
        for (const index of claimed) {
            const value = this.normalizeSignRewardIndex(index);
            if (value > 0) set.add(value);
        }
        return Array.from(set).sort((a, b) => a - b);
    }

    private static loadStoredSignStreak(): number {
        const raw = StorageManager.instance.getItem(StorageKey.SignStreak);
        if (!raw) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    private static loadStoredDailySignStreak(): number {
        const raw = StorageManager.instance.getItem(StorageKey.DailySignStreak);
        if (!raw) return 0;
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    private static normalizeSignDays(days: number[], daysInMonth: number): number[] {
        const set = new Set<number>();
        for (const day of days) {
            const value = Math.floor(Number(day));
            if (Number.isFinite(value) && value >= 1 && value <= daysInMonth) {
                set.add(value);
            }
        }
        return Array.from(set).sort((a, b) => a - b);
    }

    private static calculateCurrentMonthSignStreak(now: Date, days: number[]): number {
        const signedDays = new Set(this.normalizeSignDays(days, this.getDaysInMonth(now)));
        let streak = 0;
        for (let day = now.getDate(); day >= 1 && signedDays.has(day); day--) {
            streak++;
        }
        return streak;
    }

    private static formatSignDate(date: Date): string {
        return `${date.getFullYear()}-${this.padDatePart(date.getMonth() + 1)}-${this.padDatePart(date.getDate())}`;
    }

    private static formatSignMonth(date: Date): string {
        return `${date.getFullYear()}-${this.padDatePart(date.getMonth() + 1)}`;
    }

    private static padDatePart(value: number): string {
        return value < 10 ? `0${value}` : `${value}`;
    }

    private static getDaysInMonth(date: Date): number {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    private static loadCount(key: StorageKey, defaultValue = 1): number {
        const raw = StorageManager.instance.getItem(key);
        if (raw === null) return defaultValue; // key 从未写过 => 使用对应首次默认值
        const value = parseInt(raw, 10);
        return Number.isFinite(value) && value >= 0 ? value : defaultValue;
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

    // —— 本关失败次数（沿用旧 Retry API/存档键）。游戏无选关、关号只增，只存「当前这一关」一条 {level,count}；
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
