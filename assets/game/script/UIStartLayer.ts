import { _decorator, Component, Node, UITransform, Vec3, view } from 'cc';
import { ensureLevelJson, resolveLevelLoadOptions, warmupForwardWindow } from './config/LevelJsonLoader';
import { AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';

const { ccclass, property } = _decorator;

@ccclass('UIStartLayer')
export class UIStartLayer extends Component {

    @property(Node)
    bgNode: Node = null!;

    private enteringGame = false;

    protected onLoad(): void {
        // Adapt the start screen background to the current viewport.
        const visibleSize = view.getVisibleSize();
        const designSize = this.bgNode.getComponent(UITransform).contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));
    }

    protected onEnable(): void {
        this.enteringGame = false;
        this.refreshWarmupWindow();
    }

    start() {
        this.refreshWarmupWindow();
        this.scheduleOnce(() => {
            window.dnSDK?.track?.('LOAD_FINISH', {});
        }, 0);
    }

    update(deltaTime: number) {

    }

    // 点击开始游戏
    async onClickStartButton() {
        AudioManager.instance.playClick();
        if (this.enteringGame) return;

        this.enteringGame = true;
        try {
            const level = ProgressManager.loadLevel();
            const opts = resolveLevelLoadOptions(level);
            const json = await ensureLevelJson(level, opts);
            if (!json) {
                console.warn(`UIStartLayer: no level JSON ready for level ${level}`);
                return;
            }
            LayerManager.instance.showGameLayer();
        } finally {
            this.enteringGame = false;
        }
    }

    onClickSetButton() {
        AudioManager.instance.playClick();
        // LayerManager.instance.showUI("win");
        // return;
        LayerManager.instance.showUI("setting");
    }

    private refreshWarmupWindow() {
        const level = ProgressManager.loadLevel();
        void warmupForwardWindow(level, 10);
    }
}
