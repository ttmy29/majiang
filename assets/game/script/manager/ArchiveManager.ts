import { sys } from 'cc';
import { StorageKey } from './StorageManager';
import { HttpManager } from '../../../loading/HttpManager';

/**
 * 云存档同步管理器（单例）
 *
 * 职责：把本地 localStorage 里的整份存档（关卡 / 设置 / 道具次数 / 局内快照等）
 * 序列化成扁平 `{ key: 原始字符串 }`，通过 HttpManager.uploadArchive 推到云端。
 *
 * 下载/写回在启动阶段由 loading.ts 直接操作 sys.localStorage 完成（main 包不依赖本类）。
 *
 * 上传做防抖合并：高频的局内快照保存会被合并成一次请求；未登录拿到 md5 时整体跳过。
 */
export class ArchiveManager {
    /**
     * 开关：是否在“局内每步快照保存”时也上传。
     *  - true（默认）：所有保存点都同步，含局内快照（高频，已防抖合并）→ 跨设备可恢复到局内进度
     *  - false：仅关键节点（关卡推进 / 设置 / 道具次数 / 切后台）同步，跳过局内每步快照
     * 改这一行即可切换。
     */
    public static SYNC_IN_LEVEL_SNAPSHOT: boolean = true;

    /** 防抖间隔(ms)：合并一段时间内的多次保存，避免刷请求 */
    private static readonly DEBOUNCE_MS = 2000;

    /** 纳入云存档的本地 key（与 StorageKey 对齐） */
    private static readonly KEYS: string[] = [
        StorageKey.Music,
        StorageKey.Audio,
        StorageKey.Vibrate,
        StorageKey.CurrentLevel,
        StorageKey.LevelSnapshot,
        StorageKey.ActivityLevel,
        StorageKey.ActivityBoardId,
        StorageKey.ActivitySnapshot,
        StorageKey.ActivityRetryCount,
        StorageKey.IronTipsShown,
        StorageKey.UndoCount,
        StorageKey.SwitchCount,
        StorageKey.GlobalAdCount,
        StorageKey.LevelRetryCount,
        StorageKey.WinStreak,
        StorageKey.WinStreakDate,
        StorageKey.LevelDiffState,
        StorageKey.PlayedLevels,
    ];

    private static _instance: ArchiveManager;
    public static get instance(): ArchiveManager {
        if (!this._instance) {
            this._instance = new ArchiveManager();
        }
        return this._instance;
    }

    private _timer: any = null;
    private _uploading: boolean = false;
    private _pendingWhileUploading: boolean = false;

    /** 把本地存档序列化成扁平 { key: 原始字符串 }，只收已存在的 key */
    public serialize(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const key of ArchiveManager.KEYS) {
            const value = sys.localStorage.getItem(key);
            if (value !== null && value !== '') {
                out[key] = value;
            }
        }
        return out;
    }

    /** 关键节点保存后调用：防抖触发上传 */
    public scheduleUpload(): void {
        if (!HttpManager.instance.hasMd5) return; // 还没登录拿到 md5，跳过
        if (this._timer !== null) return;          // 已有待发请求，合并
        this._timer = setTimeout(() => {
            this._timer = null;
            this.flushNow();
        }, ArchiveManager.DEBOUNCE_MS);
    }

    /** 局内快照保存后调用：仅当开关打开时才触发上传 */
    public scheduleUploadForSnapshot(): void {
        if (!ArchiveManager.SYNC_IN_LEVEL_SNAPSHOT) return;
        this.scheduleUpload();
    }

    /** 立即上传（切后台兜底）；仍受 hasMd5 限制 */
    public flushNow(): void {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        if (!HttpManager.instance.hasMd5) return;
        if (this._uploading) {
            // 正在上传，先记一笔，收尾后补发一次最新数据
            this._pendingWhileUploading = true;
            return;
        }
        const data = this.serialize();
        if (Object.keys(data).length === 0) return;

        this._uploading = true;
        HttpManager.instance.uploadArchive(data)
            .catch(() => { /* 上传失败忽略，下次保存再传 */ })
            .then(() => {
                this._uploading = false;
                if (this._pendingWhileUploading) {
                    this._pendingWhileUploading = false;
                    this.scheduleUpload();
                }
            });
    }
}
