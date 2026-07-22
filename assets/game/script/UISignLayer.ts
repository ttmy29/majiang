import { _decorator, Button, Component, director, Label, Node, ProgressBar, tween, Tween, UIOpacity, UITransform, Vec3, view, Widget } from 'cc';
import { Constants } from './config/Constants';
import { AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { SDKManager } from '../../loading/SDKManager';
const { ccclass, property } = _decorator;

type SignRewardType = 'undo' | 'switch' | 'unlock';

interface SignRewardConfig {
    requiredDays?: number;
    requireMonthDays?: boolean;
    rewardType: SignRewardType;
    rewardName: string;
    rewardCount: number;
}

const SIGN_REWARD_CONFIGS: SignRewardConfig[] = [
    { requiredDays: 3, rewardType: 'undo', rewardName: '撤回', rewardCount: 1 },
    { requiredDays: 7, rewardType: 'switch', rewardName: '换牌', rewardCount: 1 },
    { requiredDays: 10, rewardType: 'unlock', rewardName: '解锁盒子', rewardCount: 1 },
    { requiredDays: 20, rewardType: 'switch', rewardName: '换牌', rewardCount: 2 },
    { requireMonthDays: true, rewardType: 'unlock', rewardName: '解锁盒子', rewardCount: 2 },
];

@ccclass('UISignLayer')
export class UISignLayer extends Component {
    @property(Node)
    bgNode: Node = null!;
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(Label)
    dateLabel: Label = null!;

    private openedByInit = false;
    private isClosing = false;
    private countLabel: Label | null = null;
    private signProgressBar: ProgressBar | null = null;
    private leaf1Node: Node | null = null;
    private leaf2Node: Node | null = null;
    private closeButtonNode: Node | null = null;
    private startButtonNode: Node | null = null;
    private makeupButtonNode: Node | null = null;
    private onStartActivity: (() => void) | null = null;
    private onStartMakeupActivity: (() => void) | null = null;
    private isMakeupAdPending = false;
    private rewardBoxClickHandlers: Map<Node, () => void> = new Map();

    protected onLoad(): void {
        this.initNodeRefs();
        this.fitBgToViewTop();
        this.bindCloseButton();
        this.bindActionButtons();
        this.bindRewardBoxes();
        this.refreshSignState();
    }

    protected onEnable(): void {
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        director.on(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        this.fitBgToViewTop();
        this.refreshSignState();
    }

    protected onDisable(): void {
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
    }

    start() {
        if (!this.openedByInit) {
            this.playOpenAnimation();
        }
    }

    init(onStartActivity?: () => void, onStartMakeupActivity?: () => void) {
        this.openedByInit = true;
        this.onStartActivity = typeof onStartActivity === 'function' ? onStartActivity : null;
        this.onStartMakeupActivity = typeof onStartMakeupActivity === 'function'
            ? onStartMakeupActivity
            : null;
        this.initNodeRefs();
        this.fitBgToViewTop();
        this.bindActionButtons();
        this.bindRewardBoxes();
        this.refreshSignState();
        this.playOpenAnimation();
    }

    update(deltaTime: number) {

    }

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }
        if (this.startButtonNode?.isValid) {
            this.startButtonNode.off(Button.EventType.CLICK, this.onStartButtonClick, this);
        }
        if (this.makeupButtonNode?.isValid) {
            this.makeupButtonNode.off(Button.EventType.CLICK, this.onMakeupButtonClick, this);
        }
        this.onStartActivity = null;
        this.onStartMakeupActivity = null;
        this.unbindRewardBoxes();
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        this.stopPopupTweens();
    }

    private onSignInUpdate = () => {
        this.refreshSignState();
    };

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

    onButtonBackClick() {
        this.onButonCloseClick();
    }

    private onStartButtonClick = () => {
        if (this.isClosing || !this.onStartActivity) return;
        AudioManager.instance.playClick();
        const onStartActivity = this.onStartActivity;
        this.onStartActivity = null;
        this.playCloseAnimation(onStartActivity);
    };

    private onMakeupButtonClick = () => {
        if (this.isClosing || this.isMakeupAdPending || !this.onStartMakeupActivity) return;
        if (ProgressManager.loadMissingSignDaysBeforeToday().length <= 0) {
            this.refreshActionButtons();
            return;
        }

        AudioManager.instance.playClick();
        this.isMakeupAdPending = true;
        this.setMakeupButtonInteractable(false);
        SDKManager.instance.showVideoAd(() => {
            this.isMakeupAdPending = false;
            const onStartMakeupActivity = this.onStartMakeupActivity;
            this.onStartMakeupActivity = null;
            this.playCloseAnimation(onStartMakeupActivity);
        }, () => {
            this.isMakeupAdPending = false;
            this.setMakeupButtonInteractable(true);
            LayerManager.instance.showToast('视频播放未完成！');
        }, 'sign_makeup');
    };

    private initNodeRefs() {
        this.bgNode = this.bgNode || this.node.getChildByName('bg');
        this.viewNode = this.viewNode || this.node.getChildByName('view') || this.node;
        this.maskNode = this.maskNode || this.node.getChildByName('mask');
        this.dateLabel = this.dateLabel || this.findChildByName(this.node, 'dateLabel')?.getComponent(Label)!;
        const topNode = this.findChildByName(this.node, 'top');
        this.countLabel = this.countLabel || topNode?.getChildByName('count')?.getComponent(Label) || null;
        this.leaf1Node = this.leaf1Node || topNode?.getChildByName('leaf1') || null;
        this.leaf2Node = this.leaf2Node || topNode?.getChildByName('leaf2') || null;
        this.signProgressBar = this.signProgressBar || this.findChildByName(this.node, 'progressBar')?.getComponent(ProgressBar) || null;
    }

    private fitBgToViewTop() {
        if (!this.bgNode?.isValid) return;

        const bgTransform = this.bgNode.getComponent(UITransform);
        if (!bgTransform) return;

        const bgWidget = this.bgNode.getComponent(Widget);
        if (bgWidget) bgWidget.enabled = false;

        const visibleSize = view.getVisibleSize();
        const designSize = bgTransform.contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);

        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));

        const anchor = bgTransform.anchorPoint;
        const x = (0.5 - anchor.x) * designSize.width * maxScale;
        const y = visibleSize.height / 2 - designSize.height * maxScale * (1 - anchor.y);
        this.bgNode.setPosition(new Vec3(x, y, this.bgNode.position.z));

        const bgOpacity = this.bgNode.getComponent(UIOpacity);
        if (bgOpacity) bgOpacity.opacity = 255;
    }

    private refreshDateLabel() {
        if (!this.dateLabel) return;

        const now = new Date();
        const year = now.getFullYear();
        const monthNumber = now.getMonth() + 1;
        const month = monthNumber < 10 ? `0${monthNumber}` : `${monthNumber}`;
        this.dateLabel.string = `${year} / ${month}`;
    }

    private refreshSignState() {
        this.refreshDateLabel();
        this.refreshCountLabel();
        this.refreshLeafState();
        this.refreshCalendarItems();
        this.refreshProgressBar();
        this.refreshRewardDayLabels();
        this.refreshRewardBoxes();
        this.refreshActionButtons();
    }

    private refreshCountLabel() {
        if (!this.countLabel) return;
        this.countLabel.string = `${ProgressManager.loadSignStreak()}`;
    }

    private refreshLeafState() {
        const hasStreak = ProgressManager.loadSignStreak() > 0;
        if (this.leaf1Node) this.leaf1Node.active = hasStreak;
        if (this.leaf2Node) this.leaf2Node.active = !hasStreak;
    }

    private refreshCalendarItems() {
        const now = new Date();
        const daysInMonth = this.getDaysInMonth(now);
        const signedDays = new Set(ProgressManager.loadSignMonthDays(now));
        const items = this.getCalendarItems();

        for (const item of items) {
            const day = this.getCalendarItemDay(item);
            const visible = day >= 1 && day <= daysInMonth;
            item.active = visible;
            this.setFirstLabelString(item, `${day}`);

            const signedNode = item.getChildByName('now');
            if (signedNode) {
                signedNode.active = visible && signedDays.has(day);
                this.setFirstLabelString(signedNode, `${day}`);
            }
        }
    }

    private refreshProgressBar() {
        if (!this.signProgressBar) return;

        const now = new Date();
        const daysInMonth = this.getDaysInMonth(now);
        const signedCount = ProgressManager.loadSignMonthDays(now).length;
        this.signProgressBar.progress = daysInMonth > 0 ? Math.min(1, Math.max(0, signedCount / daysInMonth)) : 0;
    }

    private refreshRewardDayLabels() {
        const progressNode = this.signProgressBar?.node || this.findChildByName(this.node, 'progressBar');
        if (!progressNode) return;

        const now = new Date();
        for (let i = 1; i <= 5; i++) {
            const label = progressNode.getChildByName(`label${i}`)?.getComponent(Label);
            if (label) label.string = `${ProgressManager.getSignRewardRequiredDays(i, now)}`;
        }
    }

    private refreshRewardBoxes() {
        const now = new Date();
        let highlightedFirstUnclaimed = false;

        for (let i = 1; i <= 5; i++) {
            const box = this.findChildByName(this.node, `box${i}`);
            if (!box) continue;

            const rewardConfig = this.getSignRewardConfig(i, now);
            const claimed = ProgressManager.hasClaimedSignReward(i, now);
            const claimable = ProgressManager.isSignRewardClaimable(i, now);
            const closeNode = box.getChildByName('close');
            const openNode = box.getChildByName('open');
            const effectNode = box.getChildByName('effect1');
            const redNode = box.getChildByName('red') || this.findChildByName(box, 'red');
            if (closeNode) closeNode.active = !claimed;
            if (openNode) openNode.active = claimed;
            if (redNode) redNode.active = claimable;
            if (effectNode) {
                const showEffect = claimable && !!rewardConfig && !highlightedFirstUnclaimed;
                effectNode.active = showEffect;
                highlightedFirstUnclaimed = highlightedFirstUnclaimed || showEffect;
            }
        }
    }

    private onRewardBoxClick(index: number) {
        AudioManager.instance.playClick();

        if (ProgressManager.hasClaimedSignReward(index)) return;

        const rewardConfig = this.getSignRewardConfig(index);
        if (!rewardConfig) return;

        if (ProgressManager.loadSignMonthCount() < rewardConfig.requiredDays) {
            LayerManager.instance.showToast(`累计签到${rewardConfig.requiredDays}天可领取`);
            return;
        }

        if (!ProgressManager.claimSignReward(index)) return;

        this.grantSignReward(rewardConfig);
        LayerManager.instance.showToast(`获得了奖励 ${rewardConfig.rewardName} * ${rewardConfig.rewardCount}`);
        this.refreshSignState();
    }

    private getSignRewardConfig(index: number, now = new Date()): (SignRewardConfig & { requiredDays: number }) | null {
        const config = SIGN_REWARD_CONFIGS[index - 1];
        if (!config) return null;

        const requiredDays = ProgressManager.getSignRewardRequiredDays(index, now);
        return { ...config, requiredDays };
    }

    private grantSignReward(rewardConfig: SignRewardConfig) {
        switch (rewardConfig.rewardType) {
            case 'undo':
                ProgressManager.saveUndoCount(ProgressManager.loadUndoCount() + rewardConfig.rewardCount);
                director.emit(Constants.eventNames.EventFavoriteRewardClaimed, { undo: rewardConfig.rewardCount });
                break;
            case 'switch':
                ProgressManager.saveSwitchCount(ProgressManager.loadSwitchCount() + rewardConfig.rewardCount);
                director.emit(Constants.eventNames.EventFavoriteRewardClaimed, { switch: rewardConfig.rewardCount });
                break;
            case 'unlock':
                ProgressManager.saveUnlockCount(ProgressManager.loadUnlockCount() + rewardConfig.rewardCount);
                director.emit(Constants.eventNames.EventFavoriteRewardClaimed, { unlock: rewardConfig.rewardCount });
                break;
        }
    }

    private getCalendarItems(): Node[] {
        const layout = this.findChildByName(this.node, 'Layout');
        if (!layout) return [];

        return layout.children
            .filter((child) => /^item\d+$/.test(child.name))
            .sort((a, b) => this.getCalendarItemDay(a) - this.getCalendarItemDay(b));
    }

    private getCalendarItemDay(item: Node): number {
        const match = item.name.match(/^item(\d+)$/);
        if (!match) return 0;

        const day = parseInt(match[1], 10);
        return Number.isFinite(day) ? day : 0;
    }

    private getDaysInMonth(date: Date): number {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    private setFirstLabelString(parent: Node, value: string) {
        const label = parent.getChildByName('Label')?.getComponent(Label);
        if (label) label.string = value;
    }

    private bindCloseButton() {
        const closeButton = this.findChildByName(this.node, 'back')
            || this.findChildByName(this.node, 'Game_btn_guanbi')
            || this.findChildByName(this.node, 'closeButton');
        if (!closeButton) return;

        this.closeButtonNode = closeButton;
        const button = closeButton.getComponent(Button) || closeButton.addComponent(Button);
        closeButton.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButonCloseClick, this);
        button.interactable = true;
    }

    private bindActionButtons() {
        const startButton = this.findChildByName(this.node, 'start');
        if (startButton) {
            this.startButtonNode = startButton;
            const button = startButton.getComponent(Button) || startButton.addComponent(Button);
            startButton.off(Button.EventType.CLICK, this.onStartButtonClick, this);
            startButton.on(Button.EventType.CLICK, this.onStartButtonClick, this);
            button.interactable = true;
        }

        const makeupButton = this.findChildByName(this.node, 'button');
        if (makeupButton) {
            this.makeupButtonNode = makeupButton;
            const button = makeupButton.getComponent(Button) || makeupButton.addComponent(Button);
            makeupButton.off(Button.EventType.CLICK, this.onMakeupButtonClick, this);
            makeupButton.on(Button.EventType.CLICK, this.onMakeupButtonClick, this);
            button.interactable = true;
        }
        this.refreshActionButtons();
    }

    private refreshActionButtons() {
        const hasSignedToday = ProgressManager.hasSignedToday();
        const hasMissingDays = ProgressManager.loadMissingSignDaysBeforeToday().length > 0;
        if (this.startButtonNode?.isValid) {
            this.startButtonNode.active = !hasSignedToday && !!this.onStartActivity;
        }
        if (this.makeupButtonNode?.isValid) {
            this.makeupButtonNode.active = hasSignedToday
                && hasMissingDays
                && !!this.onStartMakeupActivity;
        }
    }

    private setMakeupButtonInteractable(interactable: boolean) {
        const button = this.makeupButtonNode?.getComponent(Button);
        if (button?.isValid) button.interactable = interactable;
    }

    private bindRewardBoxes() {
        for (let i = 1; i <= 5; i++) {
            const box = this.findChildByName(this.node, `box${i}`);
            if (!box) continue;

            const oldHandler = this.rewardBoxClickHandlers.get(box);
            if (oldHandler) box.off(Button.EventType.CLICK, oldHandler, this);

            const handler = () => this.onRewardBoxClick(i);
            this.rewardBoxClickHandlers.set(box, handler);

            const button = box.getComponent(Button) || box.addComponent(Button);
            box.on(Button.EventType.CLICK, handler, this);
            button.interactable = true;
        }
    }

    private unbindRewardBoxes() {
        for (const [box, handler] of this.rewardBoxClickHandlers) {
            if (box?.isValid) box.off(Button.EventType.CLICK, handler, this);
        }
        this.rewardBoxClickHandlers.clear();
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.getViewNode();
        const targetOpacity = this.getViewOpacity(true);
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();

        target.setScale(new Vec3(1, 1, 1));
        if (targetOpacity) targetOpacity.opacity = 0;
        if (maskOpacity) maskOpacity.opacity = 0;

        if (targetOpacity) {
            tween(targetOpacity)
                .to(0.25, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.25, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }
    }

    private playCloseAnimation(onClosed?: () => void) {
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        const target = this.getViewNode();
        const targetOpacity = this.getViewOpacity(true);
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();
        target.setScale(new Vec3(1, 1, 1));

        if (targetOpacity) {
            tween(targetOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .call(() => {
                    this.node.destroy();
                    onClosed?.();
                })
                .start();
        } else {
            this.scheduleOnce(() => {
                this.node.destroy();
                onClosed?.();
            });
        }

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }

    private getViewNode(): Node {
        return this.viewNode || this.node.getChildByName('view') || this.node;
    }

    private getViewOpacity(createIfMissing: boolean): UIOpacity | null {
        const target = this.getViewNode();
        return target.getComponent(UIOpacity) || (createIfMissing ? target.addComponent(UIOpacity) : null);
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('mask');
        if (!mask) return null;
        this.maskNode = mask;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens() {
        const target = this.getViewNode();
        if (target?.isValid) Tween.stopAllByTarget(target);

        const targetOpacity = target?.isValid ? target.getComponent(UIOpacity) : null;
        if (targetOpacity) Tween.stopAllByTarget(targetOpacity);

        const mask = this.maskNode || this.node.getChildByName('mask');
        const maskOpacity = mask?.isValid ? mask.getComponent(UIOpacity) : null;
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
