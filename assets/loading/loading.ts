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

    onLoad() {
        this.progressBar.progress = 0;
    }

    start() {
        //console.time("时间");
        assetManager.loadBundle("game", (err, bundle) => {
            if (err) { console.error(err); return; }
            this.loadMahjongFrames(bundle, () => {
            bundle.preloadScene("game", (finished, total) => {
                const progress = finished / total;
                this.progressBar.progress = progress;
                this.progressLabel.string = `${Math.floor(progress * 100)}%`;
            }, (err) => {
                if (err) { console.error(err); return; }
                bundle.loadScene("game", (err, scene) => {
                    if (err) { console.error(err); return; }
                    //console.timeEnd("时间");
                    director.runScene(scene);
                });
            });
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


