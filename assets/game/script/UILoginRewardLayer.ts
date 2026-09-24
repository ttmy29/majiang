import { _decorator, BlockInputEvents, Button, Component, director, Node, sys, tween, Tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { SDKManager } from '../../loading/SDKManager';
import { Constants } from './config/Constants';
import { AudioManager } from './manager/AudioManager';
import { ArchiveManager } from './manager/ArchiveManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { StorageKey, StorageManager } from './manager/StorageManager';

declare const wx: any;

const { ccclass } = _decorator;
const VIEW_SCALE = 0.65;
const SHARE_RETURN_SECONDS = 4;

@ccclass('UILoginRewardLayer')
export class UILoginRewardLayer extends Component {
    private maskNode: Node | null = null;
    private viewNode: Node | null = null;
    private closeButtonNode: Node | null = null;
    private shareButtonNode: Node | null = null;
    private claimedNode: Node | null = null;
    private shareStartedAt = 0;
    private sharing = false;
    private closing = false;
    private targetScale = VIEW_SCALE;

    protected onLoad(): void {
        this.maskNode = this.node.getChildByName('bg');
        this.viewNode = this.node.getChildByName('view');
        this.closeButtonNode = this.viewNode?.getChildByName('close') || null;
        this.shareButtonNode = this.viewNode?.getChildByName('shareButton') || null;
        this.claimedNode = this.viewNode?.getChildByName('claimed') || null;
        const visibleSize = view.getVisibleSize();
        this.targetScale = Math.min(VIEW_SCALE, (visibleSize.width - 32) / 1036, (visibleSize.height - 32) / 1200);

        const mask = this.maskNode;
        if (mask) {
            mask.getComponent(UITransform)?.setContentSize(visibleSize);
            mask.getComponent(BlockInputEvents) || mask.addComponent(BlockInputEvents);
            mask.getComponent(Button) || mask.addComponent(Button);
            mask.on(Button.EventType.CLICK, this.onCloseClick, this);
        }
        if (this.viewNode) {
            this.viewNode.getComponent(BlockInputEvents) || this.viewNode.addComponent(BlockInputEvents);
        }
        if (this.closeButtonNode) {
            this.closeButtonNode.getComponent(Button) || this.closeButtonNode.addComponent(Button);
            this.closeButtonNode.on(Button.EventType.CLICK, this.onCloseClick, this);
        }
        if (this.shareButtonNode) {
            this.shareButtonNode.getComponent(Button) || this.shareButtonNode.addComponent(Button);
            this.shareButtonNode.on(Button.EventType.CLICK, this.onShareClick, this);
        }
        director.on('gameBack', this.onGameBack, this);
        this.refreshClaimState();
    }

    start(): void {
        const target = this.viewNode;
        const opacity = this.maskNode?.getComponent(UIOpacity) || this.maskNode?.addComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.5, { opacity: 255 }).start();
        }
        if (target) {
            const scale = this.targetScale;
            target.setScale(new Vec3(scale * 0.3, scale * 0.3, 1));
            tween(target)
                .to(0.35, { scale: new Vec3(scale * 1.05, scale * 1.05, 1) }, { easing: 'sineOut' })
                .to(0.15, { scale: new Vec3(scale, scale, 1) }, { easing: 'sineInOut' })
                .start();
        }
    }

    protected onDestroy(): void {
        director.off('gameBack', this.onGameBack, this);
        if (this.maskNode?.isValid) {
            this.maskNode.off(Button.EventType.CLICK, this.onCloseClick, this);
        }
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onCloseClick, this);
        }
        if (this.shareButtonNode?.isValid) {
            this.shareButtonNode.off(Button.EventType.CLICK, this.onShareClick, this);
        }
        if (this.viewNode?.isValid) Tween.stopAllByTarget(this.viewNode);
        const opacity = this.maskNode?.isValid ? this.maskNode.getComponent(UIOpacity) : null;
        if (opacity) Tween.stopAllByTarget(opacity);
    }

    private onCloseClick(): void {
        if (this.closing) return;
        AudioManager.instance.playClick();
        this.close();
    }

    private onShareClick(): void {
        if (this.closing || this.sharing || this.hasClaimedToday()) return;
        AudioManager.instance.playClick();

        if (sys.platform !== sys.Platform.WECHAT_GAME || typeof wx === 'undefined') {
            this.claimReward();
            return;
        }

        this.sharing = true;
        this.shareStartedAt = Date.now();
        try {
            wx.shareAppMessage({
                title: SDKManager.sharData.string,
                imageUrl: SDKManager.sharData.getRandomImageUrl(),
            });
        } catch (error) {
            this.sharing = false;
            console.warn('UILoginRewardLayer: share failed', error);
            LayerManager.instance.showToast('分享失败，请重试');
        }
    }

    private onGameBack = (): void => {
        if (!this.sharing || this.closing) return;
        this.sharing = false;

        // 微信没有可靠的分享完成回调，沿用局内分享的后台停留时间判定。
        const hideTime = SDKManager.instance.lastHideTime || 0;
        if (hideTime < this.shareStartedAt || Date.now() - hideTime < SHARE_RETURN_SECONDS * 1000) {
            LayerManager.instance.showToast('分享失败，请重试');
            return;
        }
        this.claimReward();
    };

    private claimReward(): void {
        if (this.hasClaimedToday()) {
            this.refreshClaimState();
            return;
        }

        StorageManager.instance.setItem(StorageKey.LoginShareRewardDate, this.today());
        ProgressManager.saveSwitchCount(ProgressManager.loadSwitchCount() + 1);
        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventFavoriteRewardClaimed, { switch: 1 });
        this.refreshClaimState();
        LayerManager.instance.showToast('获得交换 x1');
        this.close();
    }

    private refreshClaimState(): void {
        const claimed = this.hasClaimedToday();
        if (this.shareButtonNode) this.shareButtonNode.active = !claimed;
        if (this.claimedNode) this.claimedNode.active = claimed;
    }

    private hasClaimedToday(): boolean {
        return StorageManager.instance.getItem(StorageKey.LoginShareRewardDate) === this.today();
    }

    private today(): string {
        const now = new Date();
        const pad = (value: number) => value < 10 ? `0${value}` : `${value}`;
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    private close(): void {
        if (this.closing) return;
        this.closing = true;
        this.sharing = false;
        const target = this.viewNode;
        const opacity = this.maskNode?.getComponent(UIOpacity);
        if (target) {
            Tween.stopAllByTarget(target);
            tween(target)
                .to(0.18, { scale: new Vec3(this.targetScale * 0.3, this.targetScale * 0.3, 1) }, { easing: 'quadIn' })
                .call(() => this.node.destroy())
                .start();
        } else {
            this.node.destroy();
        }
        if (opacity) {
            Tween.stopAllByTarget(opacity);
            tween(opacity).to(0.18, { opacity: 0 }).start();
        }
    }
}
