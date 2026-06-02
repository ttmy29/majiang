import { _decorator, assetManager, Component, director, Label, Node, ProgressBar, SpriteFrame, sys, UITransform, Vec3, view } from 'cc';
import { SDKEvent, SDKManager } from './SDKManager';

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

    private loadStartTime: number = 0;

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
                            director.runScene(scene);
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
            enableLog: true  // 生产环境建议设为 false
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


