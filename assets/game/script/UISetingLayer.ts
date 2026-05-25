import { _decorator, Component, EventMouse, Node, tween, UIOpacity, Vec3 } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
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

        this.playOpenAnimation();
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
        const targetNode = event.target;
        if (targetNode.getChildByName("dakai_1").active) {
            targetNode.getChildByName("dakai_1").active = false;
            targetNode.getChildByName("guanbi_1").active = true;
        } else {
            targetNode.getChildByName("dakai_1").active = true;
            targetNode.getChildByName("guanbi_1").active = false;
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


