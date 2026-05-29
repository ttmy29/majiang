import { _decorator, assetManager, Component, director, Label, Node, ProgressBar, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('loading')
export class loading extends Component {

    //进度条
    @property(ProgressBar)
    progressBar: ProgressBar = null!;
    //进度文本
    @property(Label)
    progressLabel: Label = null!;

    private loadStartTime: number = 0;

    onLoad() {
        this.progressBar.progress = 0;
    }

    start() {
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
}


