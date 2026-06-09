import { _decorator, sys } from 'cc';

const { ccclass } = _decorator;

/**
 * 存档接口返回码
 * 参见《存档接口说明.md》
 */
export enum ArchiveCode {
    /** 请求成功 */
    Success = 0,
    /** 请求失败，内部错误 */
    Error = 1,
    /** 余额不足 */
    NoBalance = 2,
    /** 今日用户领取次数已达上限 */
    UserGetMaxCount = 3,
    /** 参数不正确 */
    QueryError = 4,
    /** 查询结果为空 */
    QueryIsEmpty = 5,
    /** 用户OpenID请求失败 */
    OpenIDRequestError = 6,
    /** 发送红包失败 */
    SendHongbaoError = 7,
}

/**
 * HttpManager 配置
 */
export interface HttpConfig {
    /** 基础域名，默认 https://archive.jinkezhexin.top/mahjongmatch */
    baseUrl?: string;
    /** 请求超时(毫秒)，默认 10000 */
    timeout?: number;
    /** 是否输出日志，默认 false */
    enableLog?: boolean;
}

/** 健康检查返回 */
export interface HealthResult {
    status: string;
    now_time: string;
    start_time: string;
    mysql: string;
    redis: string;
    version: string;
    code: number;
    message: string;
    name: string;
}

/** 上传存档返回 */
export interface UploadResult {
    code: number;
    message: string;
    update_time: string;
}

/**
 * 统一的接口错误对象。
 * 所有接口失败时 reject 的都是该类型，便于调用方区分错误来源。
 */
export class HttpError extends Error {
    /** 业务返回码 (ArchiveCode) */
    public code: number;
    /** HTTP 状态码，0 表示超时/网络异常等未拿到响应的情况 */
    public status: number;

    constructor(message: string, code: number = ArchiveCode.Error, status: number = 0) {
        super(message);
        this.name = 'HttpError';
        this.code = code;
        this.status = status;
    }
}

/**
 * 存档接口管理器（单例）
 *
 * 封装《存档接口说明.md》中的 4 个接口：
 *  1. 健康检查        health()
 *  2. 获取用户标识     fetchMd5(code) / loginAndFetchMd5()
 *  3. 上传存档        uploadArchive(data)
 *  4. 下载存档        downloadArchive()
 *
 * 接口均为 Promise 风格（存档流程是“登录 → 取 md5 → 上传/下载”的串行异步操作，
 * 用 Promise 比回调更直观）。
 *
 * 使用示例：
 * ```ts
 * // 登录并换取用户标识 md5（仅微信小游戏环境可用）
 * await HttpManager.instance.loginAndFetchMd5();
 * // 上传存档
 * await HttpManager.instance.uploadArchive({ level: 10, score: 5000 });
 * // 下载存档
 * const data = await HttpManager.instance.downloadArchive();
 * ```
 *
 * 注意：微信小游戏需在小程序后台将域名 archive.jinkezhexin.top
 *      加入 request 合法域名，否则请求会被拦截。
 */
@ccclass('HttpManager')
export class HttpManager {
    /** 用户标识本地缓存键（md5 唯一且不变，缓存后可免重复登录） */
    private static readonly MD5_KEY = 'mahjong_match_archive_md5';

    private static _instance: HttpManager;
    public static get instance(): HttpManager {
        if (!this._instance) {
            this._instance = new HttpManager();
        }
        return this._instance;
    }

    private _baseUrl: string = 'https://archive.jinkezhexin.top/smahjongmatch';
    private _timeout: number = 10000;
    private _enableLog: boolean = false;
    private _md5: string = '';

    private constructor() {
        // 启动时尝试读取已缓存的用户标识
        const cached = sys.localStorage.getItem(HttpManager.MD5_KEY);
        if (cached) this._md5 = cached;
    }

    /**
     * 初始化配置（可选，未调用时使用默认配置）
     */
    public init(config: HttpConfig = {}): void {
        if (config.baseUrl) this._baseUrl = config.baseUrl.replace(/\/+$/, '');
        if (config.timeout) this._timeout = config.timeout;
        if (typeof config.enableLog === 'boolean') this._enableLog = config.enableLog;
        this.log('initialized:', this._baseUrl);
    }

    /** 当前用户标识 md5（为空表示尚未登录） */
    public get md5(): string {
        return this._md5;
    }

    /** 是否已获取用户标识 */
    public get hasMd5(): boolean {
        return !!this._md5;
    }

    /** 手动设置用户标识并缓存到本地 */
    public setMd5(md5: string): void {
        this._md5 = md5 || '';
        if (this._md5) {
            sys.localStorage.setItem(HttpManager.MD5_KEY, this._md5);
        } else {
            sys.localStorage.removeItem(HttpManager.MD5_KEY);
        }
    }

    /** 清除本地缓存的用户标识 */
    public clearMd5(): void {
        this.setMd5('');
    }

    // ============================ 接口 ============================

    /**
     * 1. 健康检查  GET /health
     * 检查服务器及 MySQL、Redis 的健康状况。
     */
    public health(): Promise<HealthResult> {
        return this.request('GET', '/health').then(res => res.data as HealthResult);
    }

    /**
     * 2. 获取用户标识  GET /openid/md5?code=xxx
     * @param code 微信登录授权码（有效期较短，需即时使用）
     * @returns 用户标识 md5（同时缓存到本地）
     */
    public fetchMd5(code: string): Promise<string> {
        if (!code) {
            return Promise.reject(new HttpError('缺少 code 参数', ArchiveCode.QueryError));
        }
        return this.request('GET', '/openid/md5', { query: { code } }).then(res => {
            const data = res.data || {};
            if (data.code === ArchiveCode.Success && data.md5) {
                this.setMd5(data.md5);
                this.log('fetchMd5 success:', data.md5);
                return data.md5 as string;
            }
            const errCode = typeof data.code === 'number' ? data.code : ArchiveCode.Error;
            throw new HttpError(data.message || '获取用户标识失败', errCode, res.status);
        });
    }

    /**
     * 2b. 微信登录并获取用户标识（wx.login → /openid/md5）
     * 仅在微信小游戏环境可用。
     * @returns 用户标识 md5
     */
    public loginAndFetchMd5(): Promise<string> {
        return this.wxLogin().then(code => this.fetchMd5(code));
    }

    /**
     * 3. 上传存档  POST /archive?md5=xxx
     * @param data 任意 JSON 存档数据
     * @param md5  可选，默认使用当前已登录的用户标识
     */
    public uploadArchive(data: any, md5?: string): Promise<UploadResult> {
        const id = md5 || this._md5;
        if (!id) {
            return Promise.reject(new HttpError('缺少 md5 标识，请先调用 loginAndFetchMd5()', ArchiveCode.QueryError));
        }
        return this.request('POST', '/archive', { query: { md5: id }, body: data }).then(res => {
            const result = res.data || {};
            if (result.code === ArchiveCode.Success) {
                this.log('uploadArchive success:', result.update_time);
                return result as UploadResult;
            }
            const code = typeof result.code === 'number' ? result.code : ArchiveCode.Error;
            throw new HttpError(result.message || '上传存档失败', code, res.status);
        });
    }

    /**
     * 4. 下载存档  GET /archive?md5=xxx
     * 成功时直接返回之前上传的完整存档数据（由客户端定义的 JSON）。
     * @param md5 可选，默认使用当前已登录的用户标识
     */
    public downloadArchive(md5?: string): Promise<any> {
        const id = md5 || this._md5;
        if (!id) {
            return Promise.reject(new HttpError('缺少 md5 标识，请先调用 loginAndFetchMd5()', ArchiveCode.QueryError));
        }
        return this.request('GET', '/archive', { query: { md5: id } }).then(res => {
            this.log('downloadArchive success');
            return res.data;
        });
    }

    // ============================ 内部实现 ============================

    /**
     * 调用 wx.login 获取授权 code
     */
    private wxLogin(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (sys.platform !== sys.Platform.WECHAT_GAME) {
                reject(new HttpError('当前非微信平台，无法获取登录 code', ArchiveCode.OpenIDRequestError));
                return;
            }
            wx.login({
                success: (res: any) => {
                    if (res && res.code) {
                        resolve(res.code);
                    } else {
                        reject(new HttpError(res && res.errMsg ? res.errMsg : 'wx.login 未返回 code', ArchiveCode.OpenIDRequestError));
                    }
                },
                fail: (err: any) => {
                    reject(new HttpError(err && err.errMsg ? err.errMsg : 'wx.login 调用失败', ArchiveCode.OpenIDRequestError));
                },
            });
        });
    }

    /**
     * 通用 HTTP 请求（基于 XMLHttpRequest，兼容微信小游戏）。
     * 以 HTTP 状态码判定成功/失败：2xx/3xx 进入 resolve，其余进入 reject。
     * （下载存档成功时返回体即为存档数据本身，其内可能含 code 字段，
     *   故不能仅凭返回体里的 code 判定成败。）
     */
    private request(
        method: 'GET' | 'POST',
        path: string,
        options: { query?: Record<string, string>; body?: any } = {}
    ): Promise<{ status: number; data: any }> {
        return new Promise((resolve, reject) => {
            let url = this._baseUrl + path;
            const query = options.query;
            if (query) {
                const qs = Object.keys(query)
                    .filter(k => query[k] !== undefined && query[k] !== null)
                    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
                    .join('&');
                if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
            }

            const xhr = new XMLHttpRequest();
            xhr.timeout = this._timeout;

            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                // status 为 0 一般是超时/网络错误，交由 ontimeout/onerror 处理
                if (xhr.status === 0) return;

                let data: any = null;
                try {
                    data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                } catch (e) {
                    data = xhr.responseText;
                }

                if (xhr.status >= 200 && xhr.status < 400) {
                    resolve({ status: xhr.status, data });
                } else {
                    const code = data && typeof data.code === 'number' ? data.code : ArchiveCode.Error;
                    const message = (data && data.message) || `请求失败 (HTTP ${xhr.status})`;
                    reject(new HttpError(message, code, xhr.status));
                }
            };
            xhr.ontimeout = () => reject(new HttpError('请求超时', ArchiveCode.Error));
            xhr.onerror = () => reject(new HttpError('网络请求失败', ArchiveCode.Error));

            xhr.open(method, url, true);
            if (options.body !== undefined) {
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify(options.body));
            } else {
                xhr.send();
            }

            this.log(`${method} ${url}`, options.body !== undefined ? options.body : '');
        });
    }

    private log(...args: any[]): void {
        if (this._enableLog) {
            console.log('[HttpManager]', ...args);
        }
    }
}
