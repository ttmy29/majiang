import { _decorator, Component, director, Label, Node, tween, UIOpacity, Vec3 } from 'cc';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { LayerManager } from './manager/LayerManager';
const { ccclass, property } = _decorator;

@ccclass('UIFailureLayer')
export class UIFailureLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;

    @property(Label)
    tipsLabel: Label = null!;
    @property(Node)
    iconNode1: Node = null!;
    @property(Node)
    iconNode2: Node = null!;
    
    isMax :boolean = false;
    start() {
        tween(this.node)
            .delay(0.5)
            .call(() => {
                AudioManager.instance.playOneShot(AudioClipNames.game_lose);
            })
            .start();

    }

    init(isMax:boolean  = false,soltNode :Node = null) {
        this.isMax = isMax;
        // opentype 非空 = 槽位全部已解锁，提示玩家清空底部 slot 继续
        // opentype 为空 = 还有未解锁槽位，沿用 prefab 默认文案("继续游戏并解锁一个新盒子?")
        if (isMax && this.tipsLabel) {
            this.tipsLabel.string = "没有更多空间了，清理后备栏的麻将来继续游戏";
            this.iconNode1.active = false;
            this.iconNode2.active = true;


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

        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                this.node.destroy();
            })
            .start();

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

    onButonCloseClick() {
        AudioManager.instance.playClick();
        this.playCloseAnimation();
        LayerManager.instance.showStartLayer();
    }

    onButtonRestartClick() {
        AudioManager.instance.playClick();
        director.emit(Constants.eventNames.EventFailureRestart);
        this.playCloseAnimation();
    }

    onButtonContinueClick() {
        AudioManager.instance.playClick();
        director.emit(Constants.eventNames.EventFailureContinue, this.isMax);
        this.playCloseAnimation();
    }
}
