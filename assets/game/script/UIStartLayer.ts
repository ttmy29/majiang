import { _decorator, Component, Node, UITransform, Vec3, view } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

@ccclass('UIStartLayer')
export class UIStartLayer extends Component {

    @property(Node)
    bgNode: Node = null!;

    protected onLoad(): void {
        //适配
        const visibleSize = view.getVisibleSize();
        const designSize = this.bgNode.getComponent(UITransform).contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));
    }
    start() {
        this.scheduleOnce(() => {
            window.dnSDK?.track?.('LOAD_FINISH', {});
        }, 0);
    }

    update(deltaTime: number) {

    }

    // 点击开始游戏
    onClickStartButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showGameLayer();
    }

    onClickSetButton() {
        AudioManager.instance.playClick();
        // LayerManager.instance.showUI("win");
        // return;
        LayerManager.instance.showUI("setting");
    }
}


