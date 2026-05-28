import { _decorator, Component, EventMouse, Node, tween, UIOpacity, Vec3 } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
import { StorageKey, StorageManager } from './manager/StorageManager';
import { Utils } from './util/Utils';
const { ccclass, property } = _decorator;

@ccclass('UISetingLayer')
export class UISetingLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;

    opentype: number = 0;

    start() {

    }

    init(opentype: number) {
        console.log('UISetingLayer.init', opentype);
        this.opentype = opentype;

        // opentype === 1 时才显示 viewNode 下的 button 节点
        const buttonNode = this.viewNode?.getChildByName('Game_frame')?.getChildByName('button');
        if (buttonNode) {
            buttonNode.active = opentype === 1;
        }

        this.applySavedSettings();
        this.playOpenAnimation();
    }

    private applySavedSettings() {
        const audioSet = this.viewNode?.getChildByName('Game_frame')?.getChildByName('audioSet');
        if (!audioSet) return;

        this.applySwitchState(audioSet.getChildByName('music'), StorageKey.Music);
        this.applySwitchState(audioSet.getChildByName('audio'), StorageKey.Audio);
        this.applySwitchState(audioSet.getChildByName('vibrate'), StorageKey.Vibrate);
    }

    private applySwitchState(switchNode: Node | null, key: StorageKey) {
        if (!switchNode) return;
        const isOn = StorageManager.instance.getBoolean(key, true);
        const dakai = switchNode.getChildByName('dakai_1');
        const guanbi = switchNode.getChildByName('guanbi_1');
        if (dakai) dakai.active = isOn;
        if (guanbi) guanbi.active = !isOn;
    }
    private playOpenAnimation() {
        if (!this.node) return;

        const maskOpacity = this.maskNode
            ? (this.maskNode.getComponent(UIOpacity) ?? this.maskNode.addComponent(UIOpacity))
            : null;
        if (maskOpacity) maskOpacity.opacity = 0;

        const target = this.viewNode ?? this.node;

        target.setScale(new Vec3(0.3, 0.3, 1));

        // 【修改】：手动分成两段。
        // 前 0.35 秒舒缓地放大到 1.05（略微超出）
        // 后 0.15 秒轻轻地收缩回 1
        tween(target)
            .to(0.35, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineOut' })
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .start();

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.5, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }
    }

    private playCloseAnimation() {
        if (!this.node) return;

        const target = this.viewNode ?? this.node;
        const maskOpacity = this.maskNode ? this.maskNode.getComponent(UIOpacity) : null;

        // 压缩到 0.18 秒，直接缩回 0.3
        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                this.node.destroy();
            })
            .start();

        // 遮罩同步在 0.18 秒内快速淡出，不拖泥带水
        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }
    update(deltaTime: number) {

    }
    protected onLoad(): void {

    }

    protected onDestroy(): void {

    }

    protected onEnable(): void {

    }

    onButtonSwichtClick(event: EventMouse, data: string) {
        AudioManager.instance.playClick();
        const targetNode = event.target as Node;
        const willOpen = !targetNode.getChildByName("dakai_1").active;
        targetNode.getChildByName("dakai_1").active = willOpen;
        targetNode.getChildByName("guanbi_1").active = !willOpen;

        switch (targetNode.name) {
            case 'music':
                AudioManager.instance.setMusicEnabled(willOpen);
                break;
            case 'audio':
                AudioManager.instance.setEffectEnabled(willOpen);
                break;
            case 'vibrate':
                Utils.setVibrateEnabled(willOpen);
                break;
        }
    }

    onButonCloseClick() {
        AudioManager.instance.playClick();
        this.playCloseAnimation();
    }

    onButtonQuitClick() {
        AudioManager.instance.playClick();
        this.onButonCloseClick();
        LayerManager.instance.showStartLayer();
    }

}


