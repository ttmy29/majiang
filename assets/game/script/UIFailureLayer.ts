import { _decorator, Component, director, find, instantiate, Label, Node, tween, UIOpacity, Vec3 } from 'cc';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { getCurrentGameMode } from './config/GameMode';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { StreakManager } from './manager/StreakManager';
import { SDKManager } from '../../loading/SDKManager';
import { MahjongItem } from './MahjongItem';

const { ccclass, property } = _decorator;

/** 独立玩法复用原版弹窗时，使用自己的回调，避免触发主线事件。 */
export interface FailureActions {
    onContinue: () => void;
    onRestart: () => void;
    onExit: () => void;
}

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
    private actions: FailureActions | null = null;
    private isClosing = false;
    private continuePending = false;
    start() {
        tween(this.node)
            .delay(0.5)
            .call(() => {
                AudioManager.instance.playOneShotDuckingBgm(AudioClipNames.game_lose);
                find('Canvas/uiLayer/setting')?.destroy();
            })
            .start();
        //显示牌
        // soltNode/iconNode2 任一缺失(prefab 未挂或非 clearSlot 模式)就不摆牌,避免读 null.children 崩溃
        if (this.isMax && this.soltNode && this.iconNode2) {
            let idx = 1;
            const displayedTiles: Node[] = [];
            const tiles = this.soltNode.children
                .filter((item) => item.getChildByName("bg"))
                .sort((left, right) => left.position.x - right.position.x || left.name.localeCompare(right.name));
            tiles.forEach((item) => {
                //if (!item.active) return;
                // iconNode2 只有 item1~item6 六个占位,而底部 slot 可能因历史挂起的牌多于 6 张。
                // 占位取不到时直接跳过,避免 setPosition(undefined) 崩溃。
                const slot = this.iconNode2.getChildByName(`item${idx}`);
                if (!slot) return;
                // 独立玩法只展示牌的副本，不把真实牌从其棋盘/存档管理中移走。
                const displayItem = this.actions ? instantiate(item) : item;
                displayItem.setParent(this.iconNode2);
                displayItem.setPosition(slot.getPosition());
                displayItem.setScale(Constants.MahjongBoard.SlotScale + 0.06, Constants.MahjongBoard.SlotScale + 0.06, 1);
                displayItem.getComponent(MahjongItem)?.setShadowVisible(false);
                if (this.actions) displayItem.getComponent(MahjongItem)?.disableTileTouch();
                displayedTiles.push(displayItem);
                idx += 1;
            });
            displayedTiles
                .sort((left, right) => left.position.x - right.position.x || left.name.localeCompare(right.name))
                .forEach((item) => item.setSiblingIndex(this.iconNode2.children.length - 1));
        }

    }

    init(isMax: boolean = false, soltNode: Node = null, actions?: FailureActions) {
        this.isMax = isMax;
        this.actions = actions || null;
        const restartConfirmNode = this.getRestartConfirmNode();
        if (restartConfirmNode) restartConfirmNode.active = false;
        // opentype 非空 = 槽位全部已解锁，切到"清空底部 slot"模式:隐藏默认图标、显示 slot 占位,
        //   并记下底部 slot 节点供 start() 把牌摆过来。
        // opentype 为空 = 还有未解锁槽位，沿用 prefab 默认文案("继续游戏并解锁一个新盒子?")
        // 注意:soltNode 的记录不能再依赖 tipsLabel——它只是顺手改文案用的,prefab 没挂 tipsLabel 时
        //   原来会整块跳过,导致 soltNode 留空,start() 读 null.children 崩溃。
        if (isMax) {
            //if (this.tipsLabel) this.tipsLabel.string = "没有更多空间了，清理后备栏的麻将来继续游戏";
            if (this.iconNode1) this.iconNode1.active = false;
            if (this.iconNode2) this.iconNode2.active = true;
            this.soltNode = soltNode;
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
        if (this.actions) return; // 副本随弹窗销毁，真实牌由对应玩法自行处理。
        if (!this.soltNode || !this.iconNode2) return;
        const tiles = this.iconNode2.children.filter((item) => item.getChildByName("bg"));
        tiles.forEach((item) => {
            item.parent = this.soltNode;
            item.active = false;
        });
    }

    private playCloseAnimation(onClosed?: () => void) {
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        this.returnTilesToSlotNode();

        const target = this.viewNode ?? this.node;
        const maskOpacity = this.maskNode ? this.maskNode.getComponent(UIOpacity) : null;

        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                this.node.destroy();
                onClosed?.();
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
        if (this.isClosing || this.continuePending) return;
        AudioManager.instance.playClick();
        if (this.actions) {
            this.playCloseAnimation(this.actions.onExit);
            return;
        }
        this.playCloseAnimation();
        // 关失败弹窗回主菜单 = 放弃本局 → 清掉中途快照,下次从这关 fresh 开始
        if (getCurrentGameMode() === 'activity') ProgressManager.clearActivitySnapshot();
        else {
            director.emit(Constants.eventNames.EventMainLevelGiveUp);
            ProgressManager.clearSnapshot();
        }
        LayerManager.instance.showStartLayer();
    }

    onButtonRestartClick() {
        if (this.isClosing || this.continuePending) return;
        AudioManager.instance.playClick();
        if (this.actions) {
            this.playCloseAnimation(this.actions.onRestart);
            return;
        }

        const restartConfirmNode = this.getRestartConfirmNode();
        if (getCurrentGameMode() === 'main'
            && StreakManager.getStreak() > 0
            && restartConfirmNode
            && !restartConfirmNode.active) {
            if (this.iconNode1) this.iconNode1.active = false;
            if (this.iconNode2) this.iconNode2.active = false;
            restartConfirmNode.active = true;
            return;
        }

        director.emit(Constants.eventNames.EventFailureRestart);
        this.playCloseAnimation();
    }

    private getRestartConfirmNode(): Node | null {
        const gameFrame = this.viewNode?.getChildByName('Game_frame');
        return gameFrame?.getChildByName('frame_3') ?? null;
    }

    onButtonContinueClick() {
        if (this.isClosing || this.continuePending) return;
        AudioManager.instance.playClick();

        // 看视频广告
        this.continuePending = true;
        SDKManager.instance.showVideoAd(() => {
            this.continuePending = false;
            if (!this.node.isValid || this.isClosing) return;
            if (this.actions) {
                this.playCloseAnimation(this.actions.onContinue);
                return;
            }
            director.emit(Constants.eventNames.EventFailureContinue, this.isMax);
            this.playCloseAnimation();
        }, () => {
            this.continuePending = false;
            if (!this.node.isValid || this.isClosing) return;
            LayerManager.instance.showToast("视频播放未完成！");
        }, 'continue');
    }
}
