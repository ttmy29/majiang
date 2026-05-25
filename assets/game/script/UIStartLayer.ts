import { _decorator, Component, Node } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

@ccclass('UIStartLayer')
export class UIStartLayer extends Component {
    start() {

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
        LayerManager.instance.showUI("setting");
    }
}


