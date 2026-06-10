import { _decorator, assetManager, Component, director, Label, Node, ProgressBar, SpriteFrame, sys, UITransform, Vec3, view } from 'cc';
import { SDKEvent, SDKManager } from './SDKManager';
import { HttpManager } from './HttpManager';

const { ccclass, property } = _decorator;
declare global {
    interface Window {
        dnSDK: any; // 如果有具体类型定义，建议替换 any 为具体接口
    }
}

@ccclass('loading')
export class loading extends Component {

    //进度条
    @property(ProgressBar)
    progressBar: ProgressBar = null!;
    //进度文本
    @property(Label)
    progressLabel: Label = null!;
    @property(Node)
    bgNode: Node = null!;
    @property(Label)
    tispLabel1:Label = null!;
    @property(Label)
    tispLabel2:Label = null!;

    // 提示名言列表:tispLabel1 显示正文,tispLabel2 显示作者。
    // 首次进入游戏固定显示第 0 条,其余每次从剩下的里随机取一条。
    private static readonly TIPS: ReadonlyArray<{ text: string; author: string }> = [
        { text: '辛勤的蜜蜂永没有时间悲哀。', author: '——布莱克' },
        { text: '业精于勤,荒于嬉;行成于思,毁于随。', author: '——韩愈' },
        { text: '宝剑锋从磨砺出,梅花香自苦寒来。', author: '——《警世贤文》' },
        { text: '世上无难事,只怕有心人。', author: '——谚语' },
        { text: '千里之行,始于足下。', author: '——老子' },
        { text: '不积跬步,无以至千里。', author: '——荀子' },
        { text: '逝者如斯夫,不舍昼夜。', author: '——孔子' },
        { text: '天才就是百分之一的灵感加百分之九十九的汗水。', author: '——爱迪生' },
    ];
    // 标记首次进入游戏,持久化到本地(沿用本项目 mahjong_match_ 前缀)
    private static readonly TIP_SEEN_KEY = 'mahjong_match_tip_seen';

    private loadStartTime: number = 0;

    // —— 云存档拉取 → 进游戏 的协调 ——
    // 场景就绪后最多再等存档这么久(秒)，兜底慢网/挂起，保证一定进游戏
    private static readonly ARCHIVE_MAX_WAIT = 3;
    // 登录→取md5→下载存档→写回本地；永不 reject(无数据/网络/非微信都吞掉)
    private archiveReady: Promise<void> = Promise.resolve();
    // 是否已进入游戏：进入后拒绝迟到的存档写入，避免串档
    private gameEntered: boolean = false;
    // 进游戏回调(存档就绪或超时都走它)，存成员便于 unschedule
    private enterCb: (() => void) | null = null;

    onLoad() {
        this.progressBar.progress = 0;
        //适配
        const visibleSize = view.getVisibleSize();
        const designSize = this.bgNode.getComponent(UITransform).contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));

        this.initSDK();

        // 显示一条提示名言
        this.showTip();

        // 进游戏前先登录拉取云存档(异步，不阻塞资源加载)；最终在 enterGameWhenReady 里汇合
        this.archiveReady = this.prepareArchive();
    }

    /**
     * 显示提示名言:首次进入固定显示第 0 条,之后每次从剩下的里随机取一条。
     */
    private showTip(): void {
        const tips = loading.TIPS;
        if (tips.length === 0) return;

        let index = 0;
        const seen = sys.localStorage.getItem(loading.TIP_SEEN_KEY);
        if (seen) {
            // 非首次:从第 1 条开始随机(剩下的)
            if (tips.length > 1) {
                index = 1 + Math.floor(Math.random() * (tips.length - 1));
            }
        } else {
            // 首次:固定第 0 条并打标记
            sys.localStorage.setItem(loading.TIP_SEEN_KEY, '1');
        }

        const tip = tips[index];
        this.tispLabel1.string = tip.text;
        this.tispLabel2.string = tip.author;
    }

    /**
     * 登录 → 取 md5 → 下载云端存档 → 写回本地。
     * 永不 reject：无数据 / 网络错误 / 非微信环境都吞掉，继续用本地数据进游戏。
     */
    private prepareArchive(): Promise<void> {
        return HttpManager.instance.loginAndFetchMd5()
            .then(() => HttpManager.instance.downloadArchive())
            .then((data) => {
                // 已经进游戏了就别再写本地，避免游戏读完存档后又被覆盖(串档)
                if (this.gameEntered) return;
                this.applyArchive(data);
            })
            .catch(() => { /* 无数据 / 网络错误 / 非微信：忽略，用本地数据 */ });
    }

    /**
     * 把下载到的扁平存档 { key: value } 写回 localStorage(云端优先覆盖本地)。
     * 只覆盖云端存在的 key，不删除本地多出来的 key。
     */
    private applyArchive(data: any): void {
        if (!data || typeof data !== 'object') return;
        try {
            Object.keys(data).forEach((key) => {
                // 只认本项目的存档 key(全部以 mahjong_match_ 开头)，
                // 顺带挡掉后端在空结果时可能返回的 code/message 等包装字段
                if (key.indexOf('mahjong_match_') !== 0) return;
                const value = data[key];
                if (value === null || value === undefined) return;
                sys.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            });
        } catch (e) {
            console.warn('applyArchive failed', e);
        }
    }

    /**
     * 场景已加载完成后调用：存档就绪(成功/失败/无)即进游戏，最多再等 ARCHIVE_MAX_WAIT 秒兜底。
     */
    private enterGameWhenReady(scene: any): void {
        const enter = () => {
            if (this.gameEntered) return;
            this.gameEntered = true;
            if (this.enterCb) this.unschedule(this.enterCb);
            director.runScene(scene);
        };
        this.enterCb = enter;
        this.archiveReady.then(enter);
        this.scheduleOnce(enter, loading.ARCHIVE_MAX_WAIT);
    }

    start() {
        window.dnSDK?.onAppStart?.();

        this.loadStartTime = Date.now();

        //console.time("时间");
        // 1. 先加载 game bundle 及场景资源
        assetManager.loadBundle("game", (err, bundle) => {
            if (err) {
                console.error(err);
                return;
            }

            this.loadMahjongFrames(bundle, () => {
                bundle.preloadScene("game", (finished, total) => {
                    const progress = finished / total;
                    this.progressBar.progress = progress;
                    this.progressLabel.string = `${Math.floor(progress * 100)}%`;
                }, (err) => {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    // 2. game 加载完成后,再加载 audio 和 bgm
                    this.loadAudioBundles(() => {
                        bundle.loadScene("game", (err, scene) => {
                            if (err) {
                                console.error(err);
                                return;
                            }

                            //console.timeEnd("时间");
                            // 场景已就绪：等云存档拉取完成(或超时兜底)再进游戏
                            this.enterGameWhenReady(scene);
                        });
                    });
                });
            });
        });
    }

    // 依次加载 audio 与 bgm bundle,全部完成后回调
    private loadAudioBundles(done: () => void) {
        assetManager.loadBundle("audio", (err) => {
            if (err) {
                console.error(err);
            }
            assetManager.loadBundle("bgm", (err) => {
                if (err) {
                    console.error(err);
                }
                done();
            });
        });
    }

    private loadMahjongFrames(bundle: any, done: () => void) {
        bundle.loadDir("resources/mahjong", SpriteFrame, (err: Error | null) => {
            done();
        });
    }

    update(deltaTime: number) {

    }

    /**
    * 初始化 SDK
    */
    private initSDK() {
        SDKManager.instance.init({
            apiUrl: 'https://shufen.shenzhenyuren.com/v1',
            appId: 'yrRaAGjYBpxS98Mf1s3c',
            secret: 'ZOZxZroOf3JSQ1bgrwluQqEKdEiXI1Lz',
            timeout: 10000,
            enableLog: false  // 生产环境建议设为 false
        });
        SDKManager.instance.wxLogin((userId) => {
            //console.log('wxLogin success:', userId);
            SDKManager.instance.report({ event: SDKEvent.login, isNowSend: true });
            //window.dnSDK?.setOpenId(SDKManager.instance.getOpenid())
        }, (err) => {
            //console.log('wxLogin failed:', err);
        })
    }
}


