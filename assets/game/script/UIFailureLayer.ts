import { _decorator, Component, director, Label, Node, tween, UIOpacity, Vec3 } from 'cc';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { SDKManager } from './manager/SDKManager';
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

    isMax: boolean = false;
    soltNode: Node = null!;
    start() {
        tween(this.node)
            .delay(0.5)
            .call(() => {
                AudioManager.instance.playOneShotDuckingBgm(AudioClipNames.game_lose);
            })
            .start();
        //显示牌
        if (this.isMax) {
            let idx = 1;
            const tiles = this.soltNode.children.filter((item) => item.getChildByName("bg"));
            tiles.forEach((item) => {
                if (!item.active) return;
                // iconNode2 只有 item1~item6 六个占位,而底部 slot 可能因历史挂起的牌多于 6 张。
                // 占位取不到时直接跳过,避免 setPosition(undefined) 崩溃。
                const slot = this.iconNode2.getChildByName(`item${idx}`);
                if (!slot) return;
                item.setPosition(slot.getPosition());
                item.parent = this.iconNode2;
                item.setScale(Constants.MahjongBoard.SlotScale + 0.06, Constants.MahjongBoard.SlotScale + 0.06, 1);
                idx += 1;
            });
        }

    }

    init(isMax: boolean = false, soltNode: Node = null) {
        this.isMax = isMax;
        // opentype 非空 = 槽位全部已解锁，提示玩家清空底部 slot 继续
        // opentype 为空 = 还有未解锁槽位，沿用 prefab 默认文案("继续游戏并解锁一个新盒子?")
        if (isMax && this.tipsLabel) {
            //this.tipsLabel.string = "没有更多空间了，清理后备栏的麻将来继续游戏";
            this.iconNode1.active = false;
            this.iconNode2.active = true;
            this.soltNode = soltNode;
            //console.log(soltNode);
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

    private returnTilesToSlotNode() {
        if (!this.soltNode || !this.iconNode2) return;
        const tiles = this.iconNode2.children.filter((item) => item.getChildByName("bg"));
        tiles.forEach((item) => {
            item.parent = this.soltNode;
            item.active = false;
        });
    }

    private playCloseAnimation() {
        if (!this.node) return;

        this.returnTilesToSlotNode();

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
        // 关失败弹窗回主菜单 = 放弃本局 → 清掉中途快照,下次从这关 fresh 开始
        ProgressManager.clearSnapshot();
        LayerManager.instance.showStartLayer();
    }

    onButtonRestartClick() {
        AudioManager.instance.playClick();
        director.emit(Constants.eventNames.EventFailureRestart);
        this.playCloseAnimation();
    }

    onButtonContinueClick() {
        AudioManager.instance.playClick();

        // 看视频广告
        SDKManager.instance.showVideoAd(() => {
            director.emit(Constants.eventNames.EventFailureContinue, this.isMax);
            this.playCloseAnimation();
        }, () => {
            LayerManager.instance.showToast("视频播放未完成！");
        }, 'continue');
    }
}
