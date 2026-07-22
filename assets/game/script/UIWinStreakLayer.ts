import { _decorator, Button, Component, director, DirectorEvent, EventTouch, Label, Layout, Node, ProgressBar, ScrollView, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3, view, Widget } from 'cc';
import { AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { ProgressManager } from './manager/ProgressManager';
import { StorageKey, StorageManager } from './manager/StorageManager';
import { StreakManager, WinStreakRewardConfig, WinStreakRewardType, WinStreakSettlement, WinStreakViewState } from './manager/StreakManager';
const { ccclass, property } = _decorator;

const REWARD_ICON_SIZE = 76;
const REWARD_ICON_X = -105;
const REWARD_LABEL_X = 30;
const PROGRESS_ANIMATION_SECONDS = 0.8;
const DAILY_MANUAL_INTRO_HOLD_SECONDS = 1;
const DAILY_MANUAL_INTRO_SCROLL_SECONDS = 1.2;
const DAILY_MANUAL_INTRO_VERSION = 'top-v2';

interface UIWinStreakInitOptions {
    settlement?: WinStreakSettlement | null;
    autoClaimRewards?: WinStreakRewardConfig[];
    onContinue?: () => void;
}

@ccclass('UIWinStreakLayer')
export class UIWinStreakLayer extends Component {
    @property(Node)
    viewNode: Node | null = null;

    @property(Node)
    maskNode: Node | null = null;

    @property(Node)
    tipsView: Node | null = null;

    @property(ScrollView)
    scrollView: ScrollView | null = null;

    @property(Label)
    countdownLabel: Label | null = null;

    @property(Node)
    contentNode: Node | null = null;

    @property(Node)
    markerNode: Node | null = null;

    @property(ProgressBar)
    progressBar: ProgressBar | null = null;

    @property(Node)
    startButtonNode: Node | null = null;

    @property([SpriteFrame])
    boxSprites: SpriteFrame[] = [];

    @property(SpriteFrame)
    switchRewardSprite: SpriteFrame | null = null;

    @property(SpriteFrame)
    leafRewardSprite: SpriteFrame | null = null;

    @property(SpriteFrame)
    undoRewardSprite: SpriteFrame | null = null;

    @property(SpriteFrame)
    unlockRewardSprite: SpriteFrame | null = null;

    private closeButtonNode: Node | null = null;
    private isClosing = false;
    private isTipsClosing = false;
    private rootOpacity: UIOpacity | null = null;
    private rootTargetOpacity = 255;
    private readonly originalScales = new Map<Node, Vec3>();
    private readonly tipsOriginalScales = new Map<Node, Vec3>();
    private readonly rewardDialogBoxes: Node[] = [];
    private rewardViewState: WinStreakViewState | null = null;
    private markerBaseContentPosition: Vec3 | null = null;
    private markerLabelOffset: Vec3 | null = null;
    private autoClaimSettlement: WinStreakSettlement | null = null;
    private pendingAutoClaimRewards: WinStreakRewardConfig[] = [];
    private autoClaimFlowStarted = false;
    private displayedProgressOverride: number | null = null;
    private progressAnimationProxy: { progress: number } | null = null;
    private onContinue: (() => void) | null = null;
    private isManualEntry = true;
    private shouldPlayDailyManualIntro = false;
    private dailyManualIntroHolding = false;
    private dailyManualIntroScrollWasEnabled = true;

    public init(options?: UIWinStreakInitOptions): void {
        this.isManualEntry = !options?.settlement && !options?.onContinue;
        this.autoClaimSettlement = options?.settlement ?? null;
        this.pendingAutoClaimRewards = (options?.autoClaimRewards ?? []).map((reward) => ({ ...reward }));
        this.onContinue = typeof options?.onContinue === 'function' ? options.onContinue : null;
        this.displayedProgressOverride = this.autoClaimSettlement?.before.progress ?? null;
        if (this.closeButtonNode?.isValid && this.onContinue) this.closeButtonNode.active = false;
        this.setStartButtonReady(this.pendingAutoClaimRewards.length <= 0);
        if (this.node?.isValid) this.refreshRewardView(false);
    }

    protected onLoad(): void {
        this.initNodeRefs();
        this.hideUntilFirstFrameDrawn();
        this.fitBgToViewTop();
        this.bindCloseButton();
        this.bindStartButton();
        this.captureOriginalScales();
        this.initRewardNodes();
        this.initTipsView();
        this.refreshRewardView(false);
    }

    protected onEnable(): void {
        this.fitBgToViewTop();
        this.refreshRewardView(false);
        this.unschedule(this.refreshCountdown);
        this.schedule(this.refreshCountdown, 1);
    }

    protected onDisable(): void {
        this.unschedule(this.refreshCountdown);
        this.restoreDailyManualIntroScrollState();
    }

    protected start(): void {
        // 若上次领奖流程被应用退出打断，手动再次打开时也会继续完成待领取奖励。
        if (this.pendingAutoClaimRewards.length <= 0) {
            this.pendingAutoClaimRewards = StreakManager.getClaimableRewards();
        }
        this.setStartButtonReady(this.pendingAutoClaimRewards.length <= 0);
        this.shouldPlayDailyManualIntro = this.shouldPlayDailyManualIntroToday();
        director.once(DirectorEvent.AFTER_DRAW, this.onFirstFrameDrawn, this);
    }

    protected onDestroy(): void {
        // 玩家在自动流程结束前关闭弹窗时仍完成领取；StreakManager 会按节点幂等去重。
        this.claimPendingAutoRewards(false);
        this.onContinue = null;
        director.off(DirectorEvent.AFTER_DRAW, this.onFirstFrameDrawn, this);
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButtonCloseClick, this);
        }
        if (this.startButtonNode?.isValid) {
            this.startButtonNode.off(Button.EventType.CLICK, this.onButtonStartClick, this);
        }
        this.unschedule(this.refreshCountdown);
        this.unscheduleAllCallbacks();
        this.restoreDailyManualIntroScrollState();
        this.stopPopupTweens();
        this.stopProgressAnimation();
        this.stopRewardTweens();
        this.stopTipsTweens();
    }

    public close(): void {
        this.playCloseAnimation();
    }

    public onButtonCloseClick(): void {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.close();
    }

    // 兼容项目中已有弹窗使用的旧事件名。
    public onButonCloseClick(): void {
        this.onButtonCloseClick();
    }

    public onButtonRewardClick(event: EventTouch, data: string): void {
        if (this.isClosing) return;

        const touchNode = event.currentTarget as unknown as Node | null;
        const dialogBox = this.findAncestorByNamePrefix(touchNode, 'dialogBox');
        if (!dialogBox?.isValid) return;

        const shadow = dialogBox.getChildByName('shadow');
        const reward = dialogBox.getChildByName('reward');
        if (!shadow?.isValid || !reward?.isValid) return;

        AudioManager.instance.playClick();

        const threshold = Math.max(0, Math.floor(Number(data) || 0));
        const config = StreakManager.getRewardAt(threshold);
        if (!config) return;

        this.playRewardFeedback(dialogBox, config);
    }

    private playRewardFeedback(dialogBox: Node, config: WinStreakRewardConfig): void {
        const shadow = dialogBox.getChildByName('shadow');
        const reward = dialogBox.getChildByName('reward');
        if (!shadow?.isValid || !reward?.isValid) return;

        this.renderRewardContent(reward, config);

        const shadowOpacity = this.getOrAddOpacity(shadow);
        Tween.stopAllByTarget(shadowOpacity);

        shadow.active = true;
        shadowOpacity.opacity = 0;
        tween(shadowOpacity)
            .to(0.08, { opacity: 255 }, { easing: 'quadOut' })
            .to(0.25, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (shadow.isValid) shadow.active = false;
            })
            .start();

        // 重复点击保留按钮和阴影反馈，但不重启正在播放的奖励动画。
        if (reward.active) return;

        const rewardOpacity = this.getOrAddOpacity(reward);
        Tween.stopAllByTarget(rewardOpacity);
        reward.active = true;
        rewardOpacity.opacity = 0;
        tween(rewardOpacity)
            .delay(0.12)
            .to(0.25, { opacity: 255 }, { easing: 'sineOut' })
            .delay(5)
            .to(0.25, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => {
                if (reward.isValid) reward.active = false;
            })
            .start();
    }

    private renderRewardContent(reward: Node, config: WinStreakRewardConfig): void {
        const labelNode = this.findChildByName(reward, 'label');
        const rewardLabel = labelNode?.getComponent(Label);
        if (rewardLabel) {
            rewardLabel.string = `${StreakManager.getRewardName(config.type)} +${config.amount}`;
        }
        if (labelNode?.isValid) {
            labelNode.setPosition(new Vec3(REWARD_LABEL_X, 0, labelNode.position.z));
        }

        let iconNode = reward.getChildByName('rewardIcon');
        if (!iconNode) {
            iconNode = new Node('rewardIcon');
            iconNode.layer = reward.layer;
            reward.addChild(iconNode);
            iconNode.setSiblingIndex(1);
        }

        const iconTransform = iconNode.getComponent(UITransform) || iconNode.addComponent(UITransform);
        iconTransform.setContentSize(REWARD_ICON_SIZE, REWARD_ICON_SIZE);

        const iconSprite = iconNode.getComponent(Sprite) || iconNode.addComponent(Sprite);
        iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        iconSprite.spriteFrame = this.getRewardSprite(config.type);
        iconNode.active = !!iconSprite.spriteFrame;
        iconNode.setPosition(new Vec3(REWARD_ICON_X, 0, iconNode.position.z));
    }

    private getRewardSprite(type: WinStreakRewardType): SpriteFrame | null {
        switch (type) {
            case 'switch': return this.switchRewardSprite;
            case 'leaf': return this.leafRewardSprite;
            case 'undo': return this.undoRewardSprite;
            case 'unlock': return this.unlockRewardSprite;
        }
    }

    private initNodeRefs(): void {
        this.viewNode = this.viewNode || this.node.getChildByName('view');
        this.maskNode = this.maskNode || this.node.getChildByName('bg');
        this.tipsView = this.tipsView || this.node.getChildByName('tipsView');
        this.scrollView = this.scrollView
            || this.viewNode?.getChildByName('scrollView')?.getComponent(ScrollView)
            || null;
        this.contentNode = this.contentNode || this.scrollView?.content || null;
        this.progressBar = this.progressBar
            || this.contentNode?.getChildByName('ProgressBar')?.getComponent(ProgressBar)
            || null;
        this.countdownLabel = this.countdownLabel
            || this.node.getChildByName('top')?.getChildByName('timeBg')?.getChildByName('Label')?.getComponent(Label)
            || null;
        this.markerNode = this.markerNode || this.contentNode?.getChildByName('down') || null;
        this.startButtonNode = this.startButtonNode
            || this.node.getChildByName('down')?.getChildByName('button')
            || null;
        this.closeButtonNode = this.closeButtonNode || this.findChildByName(this.node, 'close');
    }

    private bindStartButton(): void {
        const buttonNode = this.startButtonNode;
        if (!buttonNode?.isValid) return;
        const button = buttonNode.getComponent(Button) || buttonNode.addComponent(Button);
        buttonNode.off(Button.EventType.CLICK, this.onButtonStartClick, this);
        buttonNode.on(Button.EventType.CLICK, this.onButtonStartClick, this);
        button.interactable = true;
    }

    public onButtonStartClick(): void {
        if (this.isClosing) return;
        if (this.startButtonNode?.getComponent(Button)?.interactable === false) return;

        AudioManager.instance.playClick();
        const onContinue = this.onContinue;
        this.onContinue = null;
        if (onContinue) {
            this.playCloseAnimation(onContinue);
            return;
        }

        director.emit(Constants.eventNames.EventWinStreakStartGame);
        this.playCloseAnimation();
    }

    public onButtonTipsClick(): void {
        if (this.isClosing) return;
        const tipsView = this.tipsView;
        if (!tipsView?.isValid || tipsView.active) return;

        AudioManager.instance.playClick();
        this.playTipsOpenAnimation();
    }

    public onButtonTipsCloseClick(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid || !tipsView.active || this.isTipsClosing) return;

        AudioManager.instance.playClick();
        this.closeTipsView();
    }

    public closeTipsView(): void {
        this.playTipsCloseAnimation();
    }

    private fitBgToViewTop(): void {
        const bgNode = this.maskNode;
        if (!bgNode?.isValid) return;

        const bgTransform = bgNode.getComponent(UITransform);
        if (!bgTransform) return;

        const bgWidget = bgNode.getComponent(Widget);
        if (bgWidget) bgWidget.enabled = false;

        const visibleSize = view.getVisibleSize();
        const designSize = bgTransform.contentSize;
        if (designSize.width <= 0 || designSize.height <= 0) return;

        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);
        bgNode.setScale(new Vec3(maxScale, maxScale, 1));

        const anchor = bgTransform.anchorPoint;
        const x = (0.5 - anchor.x) * designSize.width * maxScale;
        const y = visibleSize.height / 2 - designSize.height * maxScale * (1 - anchor.y);
        bgNode.setPosition(new Vec3(x, y, bgNode.position.z));

        const bgOpacity = bgNode.getComponent(UIOpacity);
        if (bgOpacity) bgOpacity.opacity = 255;
    }

    private bindCloseButton(): void {
        const closeButton = this.closeButtonNode;
        if (!closeButton?.isValid) return;

        const button = closeButton.getComponent(Button) || closeButton.addComponent(Button);
        closeButton.off(Button.EventType.CLICK, this.onButtonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButtonCloseClick, this);
        button.interactable = true;
    }

    private initRewardNodes(): void {
        this.rewardDialogBoxes.length = 0;
        this.collectChildrenByNamePrefix(this.node, 'dialogBox', this.rewardDialogBoxes);

        for (const dialogBox of this.rewardDialogBoxes) {
            const shadow = dialogBox.getChildByName('shadow');
            const reward = dialogBox.getChildByName('reward');

            if (shadow?.isValid) {
                const opacity = this.getOrAddOpacity(shadow);
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 0;
                shadow.active = false;
            }

            if (reward?.isValid) {
                const opacity = this.getOrAddOpacity(reward);
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 0;
                reward.active = false;
            }
        }
    }

    private initTipsView(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid) return;

        this.isTipsClosing = false;
        const bg = tipsView.getChildByName('bg');
        if (bg?.isValid) {
            bg.active = true;
            this.getOrAddOpacity(bg).opacity = 255;
        }

        for (const target of this.getTipsViewNodes()) {
            this.tipsOriginalScales.set(target, target.scale.clone());
            target.active = true;
        }

        tipsView.active = false;
    }

    private playTipsOpenAnimation(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid) return;

        const bg = tipsView.getChildByName('bg');
        const viewNodes = this.getTipsViewNodes();
        this.stopTipsTweens();
        this.isTipsClosing = false;

        if (bg?.isValid) {
            const bgOpacity = this.getOrAddOpacity(bg);
            bg.active = true;
            bgOpacity.opacity = 0;
        }

        for (const target of viewNodes) {
            const originalScale = this.getTipsOriginalScale(target);
            target.active = true;
            target.setScale(this.scaleByRatio(originalScale, 0.15));
        }

        tipsView.active = true;

        if (bg?.isValid) {
            const bgOpacity = this.getOrAddOpacity(bg);
            tween(bgOpacity)
                .to(0.18, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }

        viewNodes.forEach((target, index) => {
            const originalScale = this.getTipsOriginalScale(target);
            tween(target)
                .delay(0.18 + index * 0.1)
                .to(0.2, { scale: this.scaleByRatio(originalScale, 1.08) }, { easing: 'quadOut' })
                .to(0.08, { scale: originalScale.clone() }, { easing: 'sineInOut' })
                .start();
        });
    }

    private playTipsCloseAnimation(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid || !tipsView.active || this.isTipsClosing) return;

        const bg = tipsView.getChildByName('bg');
        const viewNodes = this.getTipsViewNodes();
        this.stopTipsTweens();
        this.isTipsClosing = true;

        [...viewNodes].reverse().forEach((target, index) => {
            const originalScale = this.getTipsOriginalScale(target);
            tween(target)
                .delay(index * 0.04)
                .to(0.12, { scale: this.scaleByRatio(originalScale, 0.15) }, { easing: 'quadIn' })
                .call(() => {
                    if (target.isValid) target.active = false;
                })
                .start();
        });

        const closeDelay = viewNodes.length > 0 ? 0.12 + (viewNodes.length - 1) * 0.04 : 0;
        if (bg?.isValid) {
            const bgOpacity = this.getOrAddOpacity(bg);
            tween(bgOpacity)
                .delay(closeDelay)
                .to(0.15, { opacity: 0 }, { easing: 'sineIn' })
                .call(() => this.finishTipsClose())
                .start();
        } else {
            this.scheduleOnce(() => this.finishTipsClose(), closeDelay);
        }
    }

    private finishTipsClose(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid) return;

        const bg = tipsView.getChildByName('bg');
        if (bg?.isValid) {
            bg.active = true;
            this.getOrAddOpacity(bg).opacity = 255;
        }

        for (const target of this.getTipsViewNodes()) {
            target.active = true;
            target.setScale(this.getTipsOriginalScale(target));
        }

        tipsView.active = false;
        this.isTipsClosing = false;
    }

    private getTipsViewNodes(): Node[] {
        const view = this.tipsView?.getChildByName('view');
        if (!view?.isValid) return [];

        return ['view1', 'view2', 'view3', 'view4']
            .map(name => view.getChildByName(name))
            .filter((node): node is Node => !!node?.isValid);
    }

    private getTipsOriginalScale(target: Node): Vec3 {
        let originalScale = this.tipsOriginalScales.get(target);
        if (!originalScale) {
            originalScale = target.scale.clone();
            this.tipsOriginalScales.set(target, originalScale);
        }
        return originalScale;
    }

    private onFirstFrameDrawn(): void {
        // 先让全屏 Widget 按原始缩放完成首帧对齐，再播放缩放动画。
        // 否则 Widget 会在 view.scale = 0.3 时反向放大 viewport，导致 ScrollView 底部计算错误。
        this.playOpenAnimation();
        if (this.rootOpacity?.isValid) {
            this.rootOpacity.opacity = this.rootTargetOpacity;
        }

        if (this.shouldPlayDailyManualIntro && this.playDailyManualIntro()) return;

        this.refreshRewardView(true);
        this.scheduleOnce(() => this.refreshRewardView(true), 0);
        this.scheduleOnce(this.startAutoClaimFlow, 0.5);
    }

    private playDailyManualIntro(): boolean {
        const scrollView = this.scrollView;
        if (!scrollView?.isValid || !this.contentNode?.isValid) return false;

        this.refreshRewardView(false);
        scrollView.stopAutoScroll();
        this.dailyManualIntroScrollWasEnabled = scrollView.enabled;
        this.dailyManualIntroHolding = true;

        if (!this.positionScrollViewAtTop()) {
            this.restoreDailyManualIntroScrollState();
            return false;
        }
        scrollView.enabled = false;
        this.markDailyManualIntroShown();

        // Widget 可能在下一帧更新可视区域，再调用一次引擎的顶部定位避免边界误差。
        this.scheduleOnce(() => {
            if (this.dailyManualIntroHolding) this.positionScrollViewAtTop();
        }, 0);
        this.scheduleOnce(this.startDailyManualIntroScroll, DAILY_MANUAL_INTRO_HOLD_SECONDS);
        return true;
    }

    private startDailyManualIntroScroll = (): void => {
        if (!this.node?.isValid || this.isClosing) return;

        this.restoreDailyManualIntroScrollState();
        const currentProgress = this.displayedProgressOverride
            ?? this.rewardViewState?.progress
            ?? StreakManager.getRewardViewState().progress;
        this.positionAndScrollToProgress(currentProgress, DAILY_MANUAL_INTRO_SCROLL_SECONDS);
        this.scheduleOnce(this.startAutoClaimFlow, DAILY_MANUAL_INTRO_SCROLL_SECONDS);
    };

    private positionScrollViewAtTop(): boolean {
        const scrollView = this.scrollView;
        const content = this.contentNode;
        if (!scrollView?.isValid || !content?.isValid || !scrollView.view) return false;

        content.getComponent(Layout)?.updateLayout();
        scrollView.stopAutoScroll();
        scrollView.scrollToTop(0, false);
        return true;
    }

    private restoreDailyManualIntroScrollState(): void {
        if (!this.dailyManualIntroHolding) return;
        if (this.scrollView?.isValid) this.scrollView.enabled = this.dailyManualIntroScrollWasEnabled;
        this.dailyManualIntroHolding = false;
    }

    private shouldPlayDailyManualIntroToday(): boolean {
        if (!this.isManualEntry) return false;
        return StorageManager.instance.getItem(StorageKey.WinStreakManualIntroShownDate) !== this.getDailyManualIntroFlag();
    }

    private markDailyManualIntroShown(): void {
        StorageManager.instance.setItem(StorageKey.WinStreakManualIntroShownDate, this.getDailyManualIntroFlag());
    }

    private getDailyManualIntroFlag(): string {
        return `${this.getTodayDateKey()}:${DAILY_MANUAL_INTRO_VERSION}`;
    }

    private getTodayDateKey(): string {
        const now = new Date();
        return `${now.getFullYear()}-${this.padDatePart(now.getMonth() + 1)}-${this.padDatePart(now.getDate())}`;
    }

    private padDatePart(value: number): string {
        return value < 10 ? `0${value}` : `${value}`;
    }

    private startAutoClaimFlow = (): void => {
        if (this.autoClaimFlowStarted) return;
        if (this.pendingAutoClaimRewards.length <= 0) {
            this.setStartButtonReady(true);
            return;
        }
        this.autoClaimFlowStarted = true;
        this.setStartButtonReady(false);
        this.playAutoClaimProgressAnimation(this.autoClaimSettlement, () => {
            this.claimPendingAutoRewards(true);
            this.setStartButtonReady(true);
        });
    };

    private playAutoClaimProgressAnimation(
        settlement: WinStreakSettlement | null,
        onComplete: () => void,
    ): void {
        const progressBar = this.progressBar;
        if (!settlement || !progressBar?.isValid) {
            this.displayedProgressOverride = null;
            this.refreshRewardView(false);
            onComplete();
            return;
        }

        const from = Math.max(0, settlement.before.progress);
        const to = Math.max(from, settlement.after.progress);
        if (to <= from) {
            this.displayedProgressOverride = null;
            this.refreshRewardView(false);
            onComplete();
            return;
        }

        this.stopProgressAnimation();
        this.displayedProgressOverride = from;
        this.setProgressBarProgress(from);
        this.positionAndScrollToProgress(from);

        const proxy = { progress: from };
        this.progressAnimationProxy = proxy;
        tween(proxy)
            .to(PROGRESS_ANIMATION_SECONDS, { progress: to }, {
                easing: 'quadOut',
                onUpdate: () => {
                    if (!this.node?.isValid || this.isClosing) return;
                    this.displayedProgressOverride = proxy.progress;
                    this.setProgressBarProgress(proxy.progress);
                    this.positionAndScrollToProgress(proxy.progress);
                    this.setMarkerProgressLabel(Math.floor(proxy.progress));
                },
            })
            .call(() => {
                this.progressAnimationProxy = null;
                this.displayedProgressOverride = null;
                this.refreshRewardView(false);
                this.positionAndScrollToProgress(to);
                onComplete();
            })
            .start();
    }

    private claimPendingAutoRewards(showFeedback: boolean): void {
        if (this.pendingAutoClaimRewards.length <= 0) return;

        const pending = this.pendingAutoClaimRewards;
        this.pendingAutoClaimRewards = [];
        const claimed = StreakManager.claimRewards(pending);
        if (claimed.length <= 0 || !showFeedback || !this.node?.isValid) return;

        this.refreshRewardView(false);
        this.scheduleOnce(() => this.positionAndScrollToProgress(this.rewardViewState?.progress ?? 0), 0);

        const reward = claimed[0];
        const dialogBox = this.getRewardNode(reward.threshold, 'dialogBox');
        if (dialogBox?.isValid) this.playRewardFeedback(dialogBox, reward);
    }

    private setStartButtonReady(ready: boolean): void {
        const button = this.startButtonNode?.getComponent(Button);
        if (button?.isValid) button.interactable = ready;
    }

    private hideUntilFirstFrameDrawn(): void {
        // 打开动画需要先用正常缩放完成一次布局；隐藏这一帧，避免完整 UI 先闪现。
        this.rootOpacity = this.getOrAddOpacity(this.node);
        this.rootTargetOpacity = this.rootOpacity.opacity;
        this.rootOpacity.opacity = 0;
    }

    private refreshRewardView(scrollToProgress: boolean): void {
        if (!this.node?.isValid) return;
        const state = StreakManager.getRewardViewState();
        this.rewardViewState = state;
        const displayedProgress = this.displayedProgressOverride ?? state.progress;
        this.renderRewardView(displayedProgress === state.progress
            ? state
            : { ...state, progress: displayedProgress });
        this.setProgressBarProgress(displayedProgress);
        if (scrollToProgress) this.positionAndScrollToProgress(displayedProgress);
    }

    private refreshCountdown = (): void => {
        if (!this.node?.isValid) return;
        const previousCycle = this.rewardViewState?.cycleStartedAt;
        const state = StreakManager.getRewardViewState();
        this.rewardViewState = state;
        if (this.countdownLabel?.isValid) {
            this.countdownLabel.string = StreakManager.formatRemainingTime(state.remainingSeconds);
        }
        if (previousCycle !== undefined && previousCycle !== state.cycleStartedAt) {
            this.refreshRewardView(false);
            this.scheduleOnce(() => {
                this.positionAndScrollToProgress(this.displayedProgressOverride ?? state.progress);
            }, 0);
        }
    };

    private renderRewardView(state: WinStreakViewState): void {
        if (this.countdownLabel?.isValid) {
            this.countdownLabel.string = StreakManager.formatRemainingTime(state.remainingSeconds);
        }

        const levelText = `关卡 ${Math.max(1, Math.floor(ProgressManager.loadLevel()))}`;
        for (const name of ['label1', 'label2']) {
            const label = this.startButtonNode?.getChildByName(name)?.getComponent(Label);
            if (label?.isValid) label.string = levelText;
        }

        const content = this.contentNode;
        if (!content?.isValid) return;

        // prefab 中 line43 是 45 胜的备用表现，最终节点统一使用 content/top。
        //const alternateFinal = content.getChildByName('line43');
        //if (alternateFinal?.isValid) alternateFinal.active = false;

        for (const child of content.children) {
            const match = /^line(\d+)$/.exec(child.name);
            if (!match) continue;
            const achievedLine = child.getChildByName('line2');
            // 暂时屏蔽按连胜进度隐藏路线的表现，line2 始终显示。
            if (achievedLine?.isValid) achievedLine.active = true;
        }

        for (const config of StreakManager.getRewardConfigs()) {
            const achieved = state.progress >= config.threshold;
            const icon = this.getRewardNode(config.threshold, 'icon2');
            const box = this.getRewardNode(config.threshold, 'dialogBox')?.getChildByName('box1');
            if (icon?.isValid) this.getOrAddOpacity(icon).opacity = achieved ? 255 : 175;
            if (box?.isValid) {
                this.getOrAddOpacity(box).opacity = achieved ? 255 : 210;
                const boxSprite = box.getComponent(Sprite);
                const frameIndex = config.boxType === 1 ? 0 : config.boxType === 2 ? 1 : 2;
                const frame = this.boxSprites[frameIndex];
                if (boxSprite?.isValid && frame?.isValid) boxSprite.spriteFrame = frame;
            }
        }

        this.setMarkerProgressLabel(Math.floor(state.progress));
    }

    private positionAndScrollToProgress(progress: number, duration = 0): void {
        const scrollView = this.scrollView;
        const content = this.contentNode;
        if (!scrollView?.isValid || !content?.isValid) return;

        content.getComponent(Layout)?.updateLayout();
        const contentTransform = content.getComponent(UITransform);
        const icon = this.getCurrentMarkerNode('icon1');
        const label = this.getCurrentMarkerNode('Label');
        if (!contentTransform || !icon?.isValid || !label?.isValid) return;

        const markerPosition = this.getProgressContentPosition(progress, contentTransform);
        if (!markerPosition) return;
        icon.setWorldPosition(contentTransform.convertToWorldSpaceAR(markerPosition));
        const labelPosition = markerPosition.clone().add(this.markerLabelOffset ?? new Vec3());
        label.setWorldPosition(contentTransform.convertToWorldSpaceAR(labelPosition));

        const configs = StreakManager.getRewardConfigs();
        const maxProgress = configs[configs.length - 1]?.threshold ?? 45;
        const safeProgress = Math.max(0, Math.min(maxProgress, progress));
        scrollView.stopAutoScroll();
        scrollView.scrollToPercentVertical(
            safeProgress / Math.max(1, maxProgress),
            Math.max(0, duration),
            duration > 0,
        );
    }

    private getProgressContentPosition(progress: number, contentTransform: UITransform): Vec3 | null {
        if (!this.ensureMarkerGeometry(contentTransform) || !this.markerBaseContentPosition) return null;

        const configs = StreakManager.getRewardConfigs();
        if (configs.length <= 0) return this.markerBaseContentPosition.clone();

        const maxProgress = configs[configs.length - 1].threshold;
        const safeProgress = Math.max(0, Math.min(maxProgress, progress));
        let lowerThreshold = 0;
        let upperThreshold = configs[0].threshold;
        for (const config of configs) {
            if (config.threshold <= safeProgress) lowerThreshold = config.threshold;
            if (config.threshold >= safeProgress) {
                upperThreshold = config.threshold;
                break;
            }
        }

        const lower = this.getRewardAnchorPosition(lowerThreshold, contentTransform);
        const upper = this.getRewardAnchorPosition(upperThreshold, contentTransform);
        const ratio = upperThreshold === lowerThreshold
            ? 0
            : (safeProgress - lowerThreshold) / (upperThreshold - lowerThreshold);
        const position = new Vec3();
        Vec3.lerp(position, lower, upper, Math.max(0, Math.min(1, ratio)));
        return position;
    }

    private ensureMarkerGeometry(contentTransform: UITransform): boolean {
        if (this.markerBaseContentPosition && this.markerLabelOffset) return true;

        const icon = this.getCurrentMarkerNode('icon1');
        const label = this.getCurrentMarkerNode('Label');
        if (!icon?.isValid || !label?.isValid) return false;

        this.markerBaseContentPosition = contentTransform.convertToNodeSpaceAR(icon.worldPosition).clone();
        const labelPosition = contentTransform.convertToNodeSpaceAR(label.worldPosition);
        this.markerLabelOffset = labelPosition.subtract(this.markerBaseContentPosition.clone());
        return true;
    }

    private getRewardAnchorPosition(threshold: number, contentTransform: UITransform): Vec3 {
        if (threshold <= 0 || !this.markerBaseContentPosition) {
            return this.markerBaseContentPosition?.clone() ?? new Vec3();
        }
        const icon = this.getRewardNode(threshold, 'icon2');
        return icon?.isValid
            ? contentTransform.convertToNodeSpaceAR(icon.worldPosition)
            : this.markerBaseContentPosition.clone();
    }

    private getRewardLineRoot(threshold: number): Node | null {
        const content = this.contentNode;
        if (!content?.isValid) return null;
        const lineByThreshold: Record<number, string> = {
            3: 'line1', 6: 'line4', 10: 'line8', 13: 'line11',
            16: 'line14', 20: 'line18', 25: 'line23', 28: 'line26',
            32: 'line30', 35: 'line33', 40: 'line38',
        };
        return threshold === 45 ? content.getChildByName('top') : content.getChildByName(lineByThreshold[threshold]);
    }

    private getRewardNode(threshold: number, name: 'icon2' | 'Label' | 'dialogBox'): Node | null {
        const layeredNode = this.contentNode
            ?.getChildByName('rewardOverlay')
            ?.getChildByName(`${name}_${threshold}`);
        if (layeredNode?.isValid) return layeredNode;
        return this.getRewardLineRoot(threshold)?.getChildByName(name) || null;
    }

    private setProgressBarProgress(progress: number): void {
        const progressBar = this.progressBar;
        if (!progressBar?.isValid) return;
        const configs = StreakManager.getRewardConfigs();
        const maxProgress = configs[configs.length - 1]?.threshold ?? 45;
        const contentTransform = this.contentNode?.getComponent(UITransform);
        if (!contentTransform) {
            progressBar.progress = Math.max(0, Math.min(1, progress / Math.max(1, maxProgress)));
            return;
        }

        const markerPosition = this.getProgressContentPosition(progress, contentTransform);
        const finalPosition = this.getProgressContentPosition(maxProgress, contentTransform);
        const startY = progressBar.node.position.y;
        const totalLength = finalPosition ? finalPosition.y - startY : 0;
        if (!markerPosition || totalLength <= 0) {
            progressBar.progress = Math.max(0, Math.min(1, progress / Math.max(1, maxProgress)));
            return;
        }

        progressBar.totalLength = totalLength;
        progressBar.progress = Math.max(0, Math.min(1, (markerPosition.y - startY) / totalLength));
    }

    private setMarkerProgressLabel(progress: number): void {
        const markerLabel = this.getCurrentMarkerNode('Label')?.getComponent(Label);
        if (markerLabel?.isValid) markerLabel.string = `${Math.max(0, progress)}`;
    }

    private getCurrentMarkerNode(name: 'icon1' | 'Label'): Node | null {
        const overlayNode = this.contentNode?.getChildByName('rewardOverlay')?.getChildByName(name);
        if (overlayNode?.isValid) return overlayNode;
        return this.markerNode?.getChildByName(name) || null;
    }

    private playOpenAnimation(): void {
        if (!this.node?.isValid || this.isClosing) return;

        const animatedNodes = this.getAnimatedNodes();
        const maskOpacity = this.getMaskOpacity(true);
        this.stopPopupTweens();

        if (maskOpacity) maskOpacity.opacity = 0;

        for (const target of animatedNodes) {
            const originalScale = this.getOriginalScale(target);
            target.setScale(this.scaleByRatio(originalScale, 0.3));

            tween(target)
                .to(0.35, { scale: this.scaleByRatio(originalScale, 1.05) }, { easing: 'sineOut' })
                .to(0.15, { scale: originalScale.clone() }, { easing: 'sineInOut' })
                .start();
        }

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.5, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }
    }

    private playCloseAnimation(onClosed?: () => void): void {
        if (!this.node?.isValid || this.isClosing) return;
        this.isClosing = true;

        const animatedNodes = this.getAnimatedNodes();
        const maskOpacity = this.getMaskOpacity(true);
        this.stopPopupTweens();

        const closeButton = this.closeButtonNode?.getComponent(Button);
        if (closeButton) closeButton.interactable = false;

        animatedNodes.forEach((target, index) => {
            const originalScale = this.getOriginalScale(target);
            const animation = tween(target)
                .to(0.18, { scale: this.scaleByRatio(originalScale, 0.3) }, { easing: 'quadIn' });

            if (index === 0) {
                animation.call(() => {
                    if (this.node?.isValid) this.node.destroy();
                    onClosed?.();
                });
            }

            animation.start();
        });

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }

        if (animatedNodes.length === 0) {
            this.node.destroy();
            onClosed?.();
        }
    }

    private getAnimatedNodes(): Node[] {
        const nodes = [
            this.viewNode,
            this.node.getChildByName('top'),
            this.node.getChildByName('down'),
        ];

        return nodes.filter((node, index): node is Node =>
            !!node?.isValid && nodes.indexOf(node) === index
        );
    }

    private captureOriginalScales(): void {
        for (const target of this.getAnimatedNodes()) {
            this.originalScales.set(target, target.scale.clone());
        }
    }

    private getOriginalScale(target: Node): Vec3 {
        let originalScale = this.originalScales.get(target);
        if (!originalScale) {
            originalScale = target.scale.clone();
            this.originalScales.set(target, originalScale);
        }
        return originalScale;
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode;
        if (!mask?.isValid) return null;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens(): void {
        for (const target of this.getAnimatedNodes()) {
            Tween.stopAllByTarget(target);
        }

        const maskOpacity = this.maskNode?.isValid ? this.maskNode.getComponent(UIOpacity) : null;
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    private stopRewardTweens(): void {
        for (const dialogBox of this.rewardDialogBoxes) {
            if (!dialogBox?.isValid) continue;

            const shadowOpacity = dialogBox.getChildByName('shadow')?.getComponent(UIOpacity);
            const rewardOpacity = dialogBox.getChildByName('reward')?.getComponent(UIOpacity);
            if (shadowOpacity?.isValid) Tween.stopAllByTarget(shadowOpacity);
            if (rewardOpacity?.isValid) Tween.stopAllByTarget(rewardOpacity);
        }
    }

    private stopProgressAnimation(): void {
        if (this.progressAnimationProxy) {
            Tween.stopAllByTarget(this.progressAnimationProxy);
            this.progressAnimationProxy = null;
        }
        if (this.progressBar?.isValid) Tween.stopAllByTarget(this.progressBar);
    }

    private stopTipsTweens(): void {
        const tipsView = this.tipsView;
        if (!tipsView?.isValid) return;

        const bgOpacity = tipsView.getChildByName('bg')?.getComponent(UIOpacity);
        if (bgOpacity?.isValid) Tween.stopAllByTarget(bgOpacity);

        for (const target of this.getTipsViewNodes()) {
            Tween.stopAllByTarget(target);
        }
    }

    private getOrAddOpacity(target: Node): UIOpacity {
        return target.getComponent(UIOpacity) || target.addComponent(UIOpacity);
    }

    private scaleByRatio(scale: Vec3, ratio: number): Vec3 {
        return new Vec3(scale.x * ratio, scale.y * ratio, scale.z);
    }

    private findChildByName(parent: Node | null, name: string): Node | null {
        if (!parent?.isValid) return null;
        if (parent.name === name) return parent;

        for (const child of parent.children) {
            const result = this.findChildByName(child, name);
            if (result) return result;
        }

        return null;
    }

    private findAncestorByNamePrefix(node: Node | null, namePrefix: string): Node | null {
        let current = node;
        while (current?.isValid) {
            if (current.name.startsWith(namePrefix)) return current;
            current = current.parent;
        }
        return null;
    }

    private collectChildrenByNamePrefix(parent: Node, namePrefix: string, result: Node[]): void {
        for (const child of parent.children) {
            if (child.name.startsWith(namePrefix)) result.push(child);
            this.collectChildrenByNamePrefix(child, namePrefix, result);
        }
    }
}
