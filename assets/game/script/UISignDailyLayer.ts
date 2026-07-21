import { _decorator, Button, Component, director, Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { Constants } from './config/Constants';
import { AudioManager } from './manager/AudioManager';
import { ArchiveManager } from './manager/ArchiveManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';

const { ccclass, property } = _decorator;
type DailySignRewardType = 'undo' | 'switch' | 'unlock';

interface DailySignRewardConfig {
    type: DailySignRewardType;
    name: string;
    count: number;
}

const DAILY_SIGN_REWARDS: DailySignRewardConfig[][] = [
    [{ type: 'switch', name: '换牌', count: 1 }],
    [{ type: 'undo', name: '撤回', count: 1 }],
    [{ type: 'unlock', name: '解锁', count: 1 }],
    [{ type: 'switch', name: '换牌', count: 2 }],
    [{ type: 'undo', name: '撤回', count: 2 }],
    [{ type: 'unlock', name: '解锁', count: 2 }],
    [
        { type: 'unlock', name: '解锁', count: 1 },
        { type: 'switch', name: '换牌', count: 1 },
        { type: 'undo', name: '撤回', count: 1 },
    ],
];

@ccclass('UISignDailyLayer')
export class UISignDailyLayer extends Component {

    @property({ type: [Node] })
    public itemNodeArr: Node[] = [];

    private viewNode: Node | null = null;
    private maskNode: Node | null = null;
    private closeButtonNode: Node | null = null;
    private signButtonNode: Node | null = null;
    private isClosing = false;
    private isSigning = false;

    protected onLoad(): void {
        this.viewNode = this.node.getChildByName('view') || this.node;
        this.maskNode = this.node.getChildByName('bg');
        this.initItemNodes();
        this.bindCloseButton();
        this.bindSignButton();
        this.refreshSignState();
    }

    start() {
        ProgressManager.markDailySignShownToday();
        this.playOpenAnimation();
    }

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }
        if (this.signButtonNode?.isValid) {
            this.signButtonNode.off(Button.EventType.CLICK, this.onButtonSignClick, this);
        }
        this.stopPopupTweens();
    }

    close() {
        this.playCloseAnimation();
    }

    onButonCloseClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.close();
    }

    onButtonCloseClick() {
        this.onButonCloseClick();
    }

    onButtonSignClick() {
        if (this.isSigning || ProgressManager.hasDailySignedToday()) return;
        this.isSigning = true;
        AudioManager.instance.playClick();

        const signed = ProgressManager.signDailyToday();
        const rewards = signed
            ? this.grantDailySignReward(ProgressManager.loadSevenDaySignClaimedCount())
            : [];
        this.refreshSignState();
        this.isSigning = false;

        if (signed) {
            const rewardText = rewards
                .map(reward => `${reward.name} * ${reward.count}`)
                .join('、');
            LayerManager.instance.showToast(rewardText ? `签到成功，获得 ${rewardText}` : '签到成功');
        }
    }

    private grantDailySignReward(day: number): DailySignRewardConfig[] {
        const rewards = DAILY_SIGN_REWARDS[day - 1] || [];
        if (rewards.length === 0) return [];

        const counts: Record<DailySignRewardType, number> = {
            undo: 0,
            switch: 0,
            unlock: 0,
        };
        for (const reward of rewards) {
            counts[reward.type] += reward.count;
        }

        if (counts.undo > 0) {
            ProgressManager.saveUndoCount(ProgressManager.loadUndoCount() + counts.undo);
        }
        if (counts.switch > 0) {
            ProgressManager.saveSwitchCount(ProgressManager.loadSwitchCount() + counts.switch);
        }
        if (counts.unlock > 0) {
            ProgressManager.saveUnlockCount(ProgressManager.loadUnlockCount() + counts.unlock);
        }

        ArchiveManager.instance.scheduleUpload();
        director.emit(Constants.eventNames.EventFavoriteRewardClaimed, counts);
        return rewards;
    }

    private initItemNodes() {
        const assignedItems = new Map<string, Node>();
        for (const item of this.itemNodeArr) {
            if (item?.isValid) assignedItems.set(item.name, item);
        }

        const items: Node[] = [];
        for (let i = 1; i <= 7; i++) {
            const name = `item${i}`;
            const item = assignedItems.get(name) || this.findChildByName(this.node, name);
            if (item) items.push(item);
        }
        this.itemNodeArr = items;
    }

    private bindCloseButton() {
        const closeButton = this.findChildByName(this.node, 'Game_btn_guanbi');
        if (!closeButton) return;

        this.closeButtonNode = closeButton;
        const button = closeButton.getComponent(Button) || closeButton.addComponent(Button);
        closeButton.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButonCloseClick, this);
        button.interactable = true;
    }

    private bindSignButton() {
        const signButton = this.findChildByName(this.node, 'sign');
        if (!signButton) return;

        this.signButtonNode = signButton;
        const button = signButton.getComponent(Button) || signButton.addComponent(Button);
        signButton.off(Button.EventType.CLICK, this.onButtonSignClick, this);
        signButton.on(Button.EventType.CLICK, this.onButtonSignClick, this);
        button.interactable = !ProgressManager.hasDailySignedToday();
    }

    private refreshSignState() {
        const claimedCount = ProgressManager.loadSevenDaySignClaimedCount();
        for (let i = 0; i < this.itemNodeArr.length; i++) {
            const item = this.itemNodeArr[i];
            if (!item?.isValid) continue;

            const claimed = i < claimedCount;
            const unclaimedNode = item.getChildByName('nonre');
            const claimedNode = item.getChildByName('get');
            if (unclaimedNode) unclaimedNode.active = true;
            if (claimedNode) claimedNode.active = claimed;
        }

        const hasSignedToday = ProgressManager.hasDailySignedToday();
        if (this.signButtonNode?.isValid) {
            this.signButtonNode.active = !hasSignedToday;
        }

        const signButton = this.signButtonNode?.getComponent(Button);
        if (signButton) signButton.interactable = !hasSignedToday && !this.isSigning;
    }

    private playOpenAnimation() {
        if (!this.node?.isValid || this.isClosing) return;

        const target = this.viewNode || this.node;
        const maskOpacity = this.getMaskOpacity(true);
        this.stopPopupTweens();

        if (maskOpacity) maskOpacity.opacity = 0;
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
        if (!this.node?.isValid || this.isClosing) return;
        this.isClosing = true;

        const target = this.viewNode || this.node;
        const maskOpacity = this.getMaskOpacity(true);
        this.stopPopupTweens();

        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                if (this.node?.isValid) this.node.destroy();
            })
            .start();

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        if (!this.maskNode?.isValid) return null;
        return this.maskNode.getComponent(UIOpacity)
            || (createIfMissing ? this.maskNode.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens() {
        const target = this.viewNode || this.node;
        if (target?.isValid) Tween.stopAllByTarget(target);

        const maskOpacity = this.getMaskOpacity(false);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    private findChildByName(parent: Node | null, name: string): Node | null {
        if (!parent) return null;
        if (parent.name === name) return parent;

        for (const child of parent.children) {
            const result = this.findChildByName(child, name);
            if (result) return result;
        }

        return null;
    }
}
