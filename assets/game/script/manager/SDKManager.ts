import { _decorator, game, sys } from 'cc';

const { ccclass } = _decorator;

/**
 * 事件类型枚举
 */
export const SDKEvent = {
    /** 登录事件 */
    login: "login",
    /** 新增注册 */
    signup: "signup",
    /** 自定义事件 */
    custom: "custom",
    /** 视频广告事件 type: 1拉取 2拉取成功 3播放成功 */
    video: "video",
    /** 道具产销 type: 1生成 2消费 */
    prop: "prop",
    /** 新手引导 type: 1进入 2完成 */
    guide: "guide",
    /** 关卡数据 type: 1进入 2失败 3成功 */
    level: "level",
    /** 游戏加载 type: 1进入加载 2加载成功 */
    load: "load",
    /** 在线时长 */
    onlineTime: "onlineTime",
}

/**
 * SDK配置接口
 */
export interface SDKConfig {
    apiUrl: string;
    appId: string;
    secret: string;
    timeout?: number;
    enableLog?: boolean;
}

@ccclass('SDKManager')
export class SDKManager {
    private static _instance: SDKManager;

    // 配置信息
    private static appId: string = "";
    private static secret: string = "";
    private static apiUrl: string = "";
    private static timeout: number = 10000;
    private static enableLog: boolean = true;
    private static isOpen: boolean = true;

    // 运行时数据
    private static loadStartTime: number = null;
    private static sendDataList: any[] = [];
    private static sendTimer: any = null;
    private static uuidStr: string = null;
    private static openid: string = null;
    private static platform: number = 1; // 1:android 2:ios 3:other
    private static source: number = 1;
    private static node: number = 1;


    public static rewardedVideoAd: any = null
    public static adsVideoId: string = ""
    public callBack: Function = null
    public fcallBack: Function = null
    private currentVideoKey: string = "default"  // 当前播放的视频广告标识
    private isVideoShowing: boolean = false
    private isVideoPlaying: boolean = false
    private videoSettled: boolean = false
    private videoShowReported: boolean = false
    public static get instance(): SDKManager {
        if (!this._instance) {
            this._instance = new SDKManager();
        }
        return this._instance;
    }

    private constructor() { }

    /**
     * 初始化SDK
     */
    public init(config: SDKConfig): void {
        SDKManager.appId = config.appId;
        SDKManager.secret = config.secret;
        SDKManager.apiUrl = config.apiUrl;
        SDKManager.timeout = config.timeout || 10000;
        SDKManager.enableLog = config.enableLog !== false;

        this.detectPlatform();
        this.log('SDKManager initialized:', config);

        // 启动在线时长上报（每30秒上报一次）
        this.startOnlineTimeReport();
        SDKManager.adsVideoId = "adunit-938e509f0347335b";

        return;
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            SDKManager.rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: SDKManager.adsVideoId })

            // 监听广告加载错误
            SDKManager.rewardedVideoAd.onError((err) => {
                this.log('Video ad error:', err);
                if (SDKManager._instance.isVideoPlaying) {
                    SDKManager._instance.handleVideoAdFail();
                }
            });

            // 监听广告关闭
            SDKManager.rewardedVideoAd.onClose((res) => {
                if (res && res.isEnded || res === undefined) {
                    SDKManager._instance.handleVideoAdSuccess();
                    return;
                }
                SDKManager._instance.handleVideoAdFail();
            })
        }
    }

    /**
     * 获取用户ID
     */
    public getOpenid(): string {
        return SDKManager.openid;
    }

    /**
     * 微信登录
     * 调用 wx.login 获取 code，并用 code 向后台换取 userId
     * @param callback 登录成功回调，返回 userId
     * @param fcallback 登录失败回调，返回错误信息
     */
    public wxLogin(callback?: (userId: string) => void, fcallback?: (err: any) => void): void {
        if (sys.platform !== sys.Platform.WECHAT_GAME) {
            this.log('wxLogin only available on WeChat platform');
            fcallback && fcallback('not wechat platform');
            return;
        }

        wx.login({
            success: (res: any) => {
                if (res.code) {
                    //this.loginWithCode(res.code, callback, fcallback);
                    this.loginGetOpenid(res.code, callback, fcallback);
                } else {
                    this.log('wx.login failed:', res.errMsg);
                    fcallback && fcallback(res.errMsg);
                }
            },
            fail: (err: any) => {
                this.log('wx.login failed:', err);
                fcallback && fcallback(err);
            }
        });
    }

    private loginGetOpenid(code: string, callback?: (userId: string) => void, fcallback?: (err: any) => void): void {
        if (!SDKManager.isOpen) return;

        let param: any = {
            token: code,
            appid: SDKManager.appId,
        };


        const url = "https://shufen.shenzhenyuren.com/channel/getUserInfo";
        let body = '';
        for (let item in param) {
            if (body) body += '&';
            body += item + '=' + param[item];
        }

        const xhr = new XMLHttpRequest();
        xhr.timeout = SDKManager.timeout;
        xhr.onreadystatechange = () => {
            if (xhr.readyState !== 4) return;

            if (xhr.status >= 200 && xhr.status < 400) {
                this.log('Login response:', xhr.responseText);
                try {
                    const res = JSON.parse(xhr.responseText);
                    // 后台返回的 userId 字段（如字段名不同请按实际调整）
                    const userId = res && res.data ? res.data.openid : (res ? res.openid : null);
                    if (userId) {
                        SDKManager.openid = userId;
                        callback && callback(userId);
                    } else {
                        this.log('Login failed:', xhr.responseText);
                        fcallback && fcallback(res);
                    }
                } catch (e) {
                    this.log('Login parse error:', e);
                    fcallback && fcallback(e);
                }
            } else {
                this.log('Login request failed:', xhr.status);
                fcallback && fcallback(xhr.status);
            }
        };

        xhr.open('POST', url, true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.send(body);

        this.log('Login request sent:', url, body);
    }

    /**
     * 上报事件
     */
    public report(data: any, isNowSend: boolean = false): void {
        if (!SDKManager.isOpen) return;
        if (!data || !data.event) {
            this.log('Error: event is required');
            return;
        }

        // 处理特殊事件
        if (data.event === SDKEvent.load) {
            this.handleLoadEvent(data, isNowSend);
        } else if (data.event === SDKEvent.login) {
            this.handleLoginEvent(data, isNowSend);
        } else if (data.event === SDKEvent.level) {
            let param: any = {
                event: "",
                len: data.level,
            };
            if(data.type == 1){
                param.event = "lv_start";
                this.send(param, isNowSend);
            }else if(data.type == 2){
                param.event = "lv_success";
                this.send(param, isNowSend);
                setTimeout(()=>{
                    param.event = `lv_time_` + data.level;
                    param.len = data.time;
                    this.send(param, isNowSend);
                }, 1000);
            }

        } else {
            this.send(data, isNowSend);
        }
    }

    /**
     * 发送队列中的所有事件
     */
    public sendAll(): void {
        if (SDKManager.sendTimer) {
            clearTimeout(SDKManager.sendTimer);
            SDKManager.sendTimer = null;
        }

        if (SDKManager.sendDataList.length > 0) {
            SDKManager.sendDataList.forEach(element => {
                this.send(element, true);
            });
            SDKManager.sendDataList = [];
        }
    }

    /**
     * 处理加载事件
     */
    private handleLoadEvent(data: any, isNowSend: boolean): void {
        if (data.type === 1) {
            // 进入加载
            SDKManager.uuidStr = this.generateUUID();
            if (SDKManager.uuidStr) {
                SDKManager.loadStartTime = Date.now();
                data.userId = SDKManager.uuidStr;
                data.len = 0;
                this.send(data, isNowSend);
            }
        } else if (data.type === 2) {
            // 加载成功
            if (SDKManager.uuidStr) {
                if (SDKManager.loadStartTime) {
                    data.len = Math.floor((Date.now() - SDKManager.loadStartTime) / 1000);
                } else {
                    data.len = 0;
                }
                data.userId = SDKManager.uuidStr;
                this.send(data, isNowSend);
            }
        }
    }

    /**
     * 处理登录事件
     */
    private handleLoginEvent(data: any, isNowSend: boolean): void {
        // if (data.userId) {
        //     SDKManager.openid = data.userId;
        //     this.send(data, isNowSend);
        // } else {
        //     this.log('Error: userId is required for login event');
        // }
        this.send(data, isNowSend)
    }

    /**
     * 发送事件
     */
    private send(data: any, isNowSend: boolean): void {
        if (!SDKManager.isOpen) return;

        let param: any = {
            appid: SDKManager.appId,
            userId: SDKManager.openid,
            timestamp: Math.floor(Date.now() / 1000),
            platform: SDKManager.platform,
            source: SDKManager.source,
            node: SDKManager.node,
        };

        // 根据事件类型构建URL和参数
        let url = SDKManager.apiUrl;
        if (data.event === SDKEvent.login) {
            url += "/login";
        } else if (data.event === SDKEvent.video) {
            url += "/video";
            param.name = data.cid;
            param.type = parseInt(data.type);
            param.unitId = "video";
        } else if (data.event === SDKEvent.onlineTime) {
            url += "/online_time";
            param.len = data.len;
        } else {
            url += "/custom_event";
            param.event = data.cid || data.event;
        }

        // 合并自定义参数
        Object.keys(data).forEach(key => {
            if (!param[key] && key !== 'event' && key !== 'isNowSend') {
                param[key] = data[key];
            }
        });
        if (isNowSend) {
            // 生成签名
            //const signStr = this.object2String(param, '&') + '&' + SDKManager.secret;
            //param.sign = this.getMD5(signStr);
            param.sign = this.createSign(param, SDKManager.secret);
            this.httpRequest(url, param);
        } else {
            if (SDKManager.sendDataList.length > 0) {
                SDKManager.sendDataList.push(data);
                this.queueToSend();
            } else {
                this.send(data, true);
            }
        }
    }

    /**
     * 队列发送
     */
    private queueToSend(): void {
        if (SDKManager.sendDataList.length > 0) {
            const element = SDKManager.sendDataList.shift();
            this.send(element, true);

            if (SDKManager.sendDataList.length > 0) {
                SDKManager.sendTimer = setTimeout(() => {
                    this.queueToSend();
                }, 50);
            } else {
                SDKManager.sendTimer = null;
            }
        }
    }

    /**
     * HTTP请求
     */
    private httpRequest(url: string, reqData: any): void {
        if (!SDKManager.isOpen) return;

        let param = '';
        for (let item in reqData) {
            if (param) param += '&';
            param += item + '=' + reqData[item];
        }

        const xhr = new XMLHttpRequest();
        xhr.timeout = SDKManager.timeout;

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 400) {
                    this.log('Request success:', xhr.responseText);
                } else {
                    this.log('Request failed:', xhr.status);
                }
            }
        };

        xhr.open('POST', url, true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.send(param);

        this.log('Request sent:', url, param);
    }

    /**
     * 生成UUID并保存到本地
     */
    private generateUUID(): string {
        const saveKey = `mj_rsck_local_uuid_${SDKManager.appId}`;
        const saved = sys.localStorage.getItem(saveKey);

        if (saved && saved.length > 0) {
            return null; // 已经生成过了
        }

        const d = Date.now();
        const dStr = Math.floor(d / 100000) % 1000000;
        const uuid = 'xx-xxx-yxx-xx'.replace(/[xy]/g, (c) => {
            const r = (d + Math.random() * 16) % 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

        const uuidStr = `mj_${SDKManager.appId}_${dStr}_${uuid}`;
        sys.localStorage.setItem(saveKey, uuidStr);
        return uuidStr;
    }

    /**
     * 对象转字符串（用于签名）
     */
    private object2String(obj: any, connStr: string): string {
        const sortedKeys = Object.keys(obj).sort();
        return sortedKeys.map((key) => {
            return `${key}=${obj[key]}`;
        }).join(connStr);
    }

    /**
     * MD5加密
     */
    private getMD5(str: string): string {
        // MD5实现（从ShufenManager复制）
        function rotateLeft(lValue: number, iShiftBits: number): number {
            return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
        }

        function addUnsigned(lX: number, lY: number): number {
            const lX8 = (lX & 0x80000000);
            const lY8 = (lY & 0x80000000);
            const lX4 = (lX & 0x40000000);
            const lY4 = (lY & 0x40000000);
            const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);

            if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            if (lX4 | lY4) {
                if (lResult & 0x40000000) {
                    return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                } else {
                    return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                }
            }
            return (lResult ^ lX8 ^ lY8);
        }

        function F(x: number, y: number, z: number): number {
            return (x & y) | ((~x) & z);
        }

        function G(x: number, y: number, z: number): number {
            return (x & z) | (y & (~z));
        }

        function H(x: number, y: number, z: number): number {
            return (x ^ y ^ z);
        }

        function I(x: number, y: number, z: number): number {
            return (y ^ (x | (~z)));
        }

        function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
            a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
            a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
            a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
            a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
            return addUnsigned(rotateLeft(a, s), b);
        }

        function convertToWordArray(string: string): number[] {
            const lMessageLength = string.length;
            const lNumberOfWords = (((lMessageLength + 8 - ((lMessageLength + 8) % 64)) / 64) + 1) * 16;
            const lWordArray: number[] = new Array(lNumberOfWords - 1);
            let lByteCount = 0;

            while (lByteCount < lMessageLength) {
                const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                const lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = (lWordArray[lWordCount] || 0) | (string.charCodeAt(lByteCount) << lBytePosition);
                lByteCount++;
            }

            const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            const lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] || 0) | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }

        function wordToHex(lValue: number): string {
            let result = '';
            for (let lCount = 0; lCount <= 3; lCount++) {
                const lByte = (lValue >>> (lCount * 8)) & 255;
                const temp = '0' + lByte.toString(16);
                result += temp.substring(temp.length - 2);
            }
            return result;
        }

        function utf8Encode(string: string): string {
            string = string.replace(/\r\n/g, "\n");
            let utftext = "";
            for (let n = 0; n < string.length; n++) {
                const c = string.charCodeAt(n);
                if (c < 128) {
                    utftext += String.fromCharCode(c);
                } else if ((c > 127) && (c < 2048)) {
                    utftext += String.fromCharCode((c >> 6) | 192);
                    utftext += String.fromCharCode((c & 63) | 128);
                } else {
                    utftext += String.fromCharCode((c >> 12) | 224);
                    utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                    utftext += String.fromCharCode((c & 63) | 128);
                }
            }
            return utftext;
        }

        const x = convertToWordArray(utf8Encode(str));
        let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
        const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
        const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
        const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

        for (let k = 0; k < x.length; k += 16) {
            const AA = a, BB = b, CC = c, DD = d;

            a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
            d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
            c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
            b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
            a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
            d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
            c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
            b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
            a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
            d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
            c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
            b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
            a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
            d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
            c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
            b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);

            a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
            d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
            c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
            b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
            a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
            d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
            c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
            b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
            a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
            d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
            c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
            b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
            a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
            d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
            c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
            b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);

            a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
            d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
            c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
            b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
            a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
            d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
            c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
            b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
            a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
            d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
            c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
            b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
            a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
            d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
            c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
            b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);

            a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
            d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
            c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
            b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
            a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
            d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
            c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
            b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
            a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
            d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
            c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
            b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
            a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
            d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
            c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
            b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);

            a = addUnsigned(a, AA);
            b = addUnsigned(b, BB);
            c = addUnsigned(c, CC);
            d = addUnsigned(d, DD);
        }

        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
    }

    /**
     * 检测平台
     */
    private detectPlatform(): void {
        if (typeof window !== 'undefined') {
            const ua = window.navigator.userAgent.toLowerCase();
            if (ua.includes('android')) {
                SDKManager.platform = 1;
            } else if (ua.includes('iphone') || ua.includes('ipad')) {
                SDKManager.platform = 2;
            } else {
                SDKManager.platform = 3;
            }
        }
    }

    /**
     * 启动在线时长上报
     */
    private startOnlineTimeReport(): void {
        return;
        setInterval(() => {
            const time = (Date.now() - (SDKManager.loadStartTime || Date.now())) / 1000;
            if (time % 30 === 0) {
                this.report({ event: SDKEvent.onlineTime, len: 30 });
            }
        }, 30000);
    }

    /**
     * 日志输出
     */
    private log(...args: any[]): void {
        if (SDKManager.enableLog) {
            console.log('[SDKManager]', ...args);
        }
    }

    /**
     * 设置开关
     */
    public setEnabled(enabled: boolean): void {
        SDKManager.isOpen = enabled;
    }



    /**
     * 显示视频广告
     * @param callback 成功回调
     * @param fcallback 失败回调
     * @param videoKey 视频广告标识
     */
    public showVideoAd(callback?: Function, fcallback?: Function, videoKey: string = "default") {
        if (this.isVideoShowing) {
            this.log('Video ad is already showing');
            return;
        }

        // 上报视频广告拉取事件
        this.report({
            event: SDKEvent.video,
            cid: videoKey,
            type: 1  // 1:拉取
        });

        // 微信小游戏
        if (sys.platform === sys.Platform.WECHAT_GAME && SDKManager.rewardedVideoAd !== null) {
            // 保存当前视频广告标识
            this.currentVideoKey = videoKey;
            this.callBack = callback;
            this.fcallBack = fcallback;
            this.isVideoShowing = true;
            this.isVideoPlaying = false;
            this.videoSettled = false;
            this.videoShowReported = false;
            game.pause();

            this.showRewardedVideoAd(videoKey, true);
            return;
        }

        // 测试环境或非微信平台，直接执行成功回调
        this.log('Video ad not available, executing callback directly');
        callback && callback();
    }

    private showRewardedVideoAd(videoKey: string, retryWhenNotReady: boolean): void {
        SDKManager.rewardedVideoAd.show()
            .then(() => {
                this.reportVideoAdShow(videoKey);
            })
            .catch(err => {
                this.log('Video ad show failed:', err);
                if (!retryWhenNotReady) {
                    this.handleVideoAdFail();
                    return;
                }

                SDKManager.rewardedVideoAd.load()
                    .then(() => {
                        if (!this.isVideoShowing || this.videoSettled) return false;
                        return SDKManager.rewardedVideoAd.show().then(() => true);
                    })
                    .then((shown) => {
                        if (!this.isVideoShowing || this.videoSettled) return;
                        if (shown) this.reportVideoAdShow(videoKey);
                    })
                    .catch(loadErr => {
                        this.log('Video ad reload failed:', loadErr);
                        this.handleVideoAdFail();
                    });
            });
    }

    private reportVideoAdShow(videoKey: string): void {
        if (this.videoShowReported) return;
        this.videoShowReported = true;
        this.isVideoPlaying = true;
        // 广告显示成功，上报拉取成功事件
        this.report({
            event: SDKEvent.video,
            cid: videoKey,
            type: 2  // 2:拉取成功
        });
    }

    private handleVideoAdSuccess(): void {
        if (this.videoSettled) return;
        this.videoSettled = true;
        const callback = this.callBack;
        const videoKey = this.currentVideoKey;
        this.clearVideoAdState();
        game.resume();

        // 上报播放成功事件
        this.report({
            event: SDKEvent.video,
            cid: videoKey,
            type: 3  // 3:播放成功
        });

        callback && callback();
    }

    private handleVideoAdFail(): void {
        if (!this.isVideoShowing || this.videoSettled) return;
        this.videoSettled = true;
        const fcallback = this.fcallBack;
        this.clearVideoAdState();
        game.resume();
        fcallback && fcallback();
    }

    private clearVideoAdState(): void {
        this.isVideoShowing = false;
        this.isVideoPlaying = false;
        this.callBack = null;
        this.fcallBack = null;
        this.currentVideoKey = "default";
        this.videoShowReported = false;
    }


    private createSign(param, secret) {
        let str = '';
        let data = Object.keys(param).sort();
        for (let key in data) {
            if (key === 'sign') continue
            str += data[key] + '=' + param[data[key]] + '&';
        }
        str += secret;
        console.log('[SDKManager] createSign', str);
        return this.getMD5(str);
    }
}
