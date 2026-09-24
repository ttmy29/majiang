import { _decorator, Button, Component, director, Label, Node, ProgressBar, sys, tween, Tween, UIOpacity, v3, Vec3, Widget } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { SDKManager } from '../../loading/SDKManager';
import { TravelRecoveryManager } from './manager/TravelRecoveryManager';
import { ProgressManager } from './manager/ProgressManager';
import { StreakManager, WinStreakRewardConfig, WinStreakSettlement } from './manager/StreakManager';
const { ccclass, property } = _decorator;

interface WinLayerData {
    time?: number;
    iq?: number;
    nextLevel?: number;
    comboTimes?: number;
    winStreakSettlement?: WinStreakSettlement | null;
    isActivity?: boolean;
    isTravel?: boolean;
    travelCompleted?: boolean;
}

@ccclass('UIWinLayer')
export class UIWinLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(Label)
    rankLabel: Label = null!;
    @property(Label)
    iqLabel: Label = null!;
    @property(Label)
    levleNexLabel: Label = null!;
    @property(Label)
    gridLabel1: Label = null!;
    @property(Label)
    gridLabel2: Label = null!;
    @property(Label)
    gridLabel3: Label = null!;
    @property(Node)
    effectNode1: Node = null!;
    @property(Node)
    effectNode2: Node = null!;
    @property(Node)
    effectNode3: Node = null!;
    @property(Node)
    winStreakNode: Node = null!;
    @property(Label)
    winStreakTimeLabel: Label = null!;
    @property(Node)
    winStreakBox1: Node = null!;
    @property(Node)
    winStreakBox2: Node = null!;
    @property(Node)
    winStreakBox3: Node = null!;
    @property(ProgressBar)
    winStreakProgressBar: ProgressBar = null!;
    @property(Label)
    winStreakNowLabel: Label = null!;
    @property(Label)
    winStreakNextLabel: Label = null!;

    private streakSettlement: WinStreakSettlement | null = null;
    private displayedReward: WinStreakRewardConfig | null = null;
    private nextLevel = 0;
    private isActivity = false;
    private isTravel = false;
    private travelCompleted = false;
    private onContinue: (() => void) | null = null;
    private onExit: (() => void) | null = null;
    private isClosing = false;
    start() {
        AudioManager.instance.playOneShot(AudioClipNames.game_win);
    }

    init(dataOrTime: WinLayerData | number = 0, onContinue?: () => void, onExit?: () => void) {
        const data = typeof dataOrTime === 'number' ? { time: dataOrTime } : (dataOrTime || {});
        const time = data.time ?? 0;
        const iqText = this.formatNumber(data.iq ?? 0);
        const nextLevel = Math.max(0, Math.floor(data.nextLevel ?? 0));
        const comboTimes = Math.max(0, Math.floor(data.comboTimes ?? 0));
        this.nextLevel = nextLevel;
        this.isActivity = !!data.isActivity;
        this.isTravel = !!data.isTravel;
        this.travelCompleted = !!data.travelCompleted;
        this.onContinue = typeof onContinue === 'function' ? onContinue : null;
        this.onExit = typeof onExit === 'function' ? onExit : null;

        if (!data.isTravel) director.emit(Constants.eventNames.EventSetIQLabelVisible, false);
        this.playOpenAnimation();
        this.setLabelString(this.rankLabel, this.getSettlementCopyText());
        this.setLabelString(this.iqLabel, iqText);
        this.setLabelString(this.levleNexLabel, data.travelCompleted ? '旅程完成' : this.isActivity ? '挑战成功' : `关卡 ${nextLevel}`);
        this.setLabelString(this.gridLabel1, this.formatTime(time));
        this.setLabelString(this.gridLabel2, iqText);
        this.setLabelString(this.gridLabel3, `${comboTimes}`);
        this.playLightBurst();
        this.initWinStreak(data);
    }

    protected onDestroy(): void {
        this.onContinue = null;
        this.onExit = null;
        this.unschedule(this.refreshWinStreakCountdown);
        if (this.winStreakProgressBar?.isValid) Tween.stopAllByTarget(this.winStreakProgressBar);
        for (const box of this.getWinStreakBoxes()) {
            if (box?.isValid) {
                box.off(Button.EventType.CLICK, this.onWinStreakChestClick, this);
                Tween.stopAllByTarget(box);
            }
        }
    }

    private initWinStreak(data: WinLayerData): void {
        this.resolveWinStreakRefs();
        const settlement = data.winStreakSettlement ?? null;
        this.streakSettlement = settlement;
        if (!this.winStreakNode?.isValid || data.isActivity || data.isTravel || !settlement) {
            if (this.winStreakNode?.isValid) this.winStreakNode.active = false;
            return;
        }

        this.winStreakNode.active = true;
        this.renderWinStreakSettlement(settlement);
        this.bindWinStreakChestButtons();
        this.unschedule(this.refreshWinStreakCountdown);
        this.schedule(this.refreshWinStreakCountdown, 1);
    }

    private resolveWinStreakRefs(): void {
        this.winStreakNode = this.winStreakNode || this.viewNode?.getChildByName('winStreak') || null!;
        if (!this.winStreakNode?.isValid) return;
        this.winStreakTimeLabel = this.winStreakTimeLabel
            || this.winStreakNode.getChildByName('Label')?.getComponent(Label)
            || null!;
        this.winStreakBox1 = this.winStreakBox1 || this.winStreakNode.getChildByName('box1') || null!;
        this.winStreakBox2 = this.winStreakBox2 || this.winStreakNode.getChildByName('box2') || null!;
        this.winStreakBox3 = this.winStreakBox3 || this.winStreakNode.getChildByName('box3') || null!;
        this.winStreakProgressBar = this.winStreakProgressBar
            || this.winStreakNode.getChildByName('ProgressBar')?.getComponent(ProgressBar)
            || null!;
        this.winStreakNowLabel = this.winStreakNowLabel
            || this.winStreakNode.getChildByName('now')?.getComponent(Label)
            || null!;
        this.winStreakNextLabel = this.winStreakNextLabel
            || this.winStreakNode.getChildByName('mext')?.getComponent(Label)
            || null!;
    }

    private renderWinStreakSettlement(settlement: WinStreakSettlement): void {
        this.displayedReward = settlement.displayReward;
        this.setLabelString(this.winStreakNowLabel, `${settlement.displayFrom}`);
        this.setLabelString(this.winStreakNextLabel, `${settlement.displayTo}`);
        this.setLabelString(
            this.winStreakTimeLabel,
            StreakManager.formatRemainingTime(settlement.after.remainingSeconds),
        );
        this.showWinStreakBox(settlement.displayReward.boxType);

        const bar = this.winStreakProgressBar;
        if (!bar?.isValid) return;
        Tween.stopAllByTarget(bar);
        bar.progress = this.getWinStreakDisplayProgress(
            settlement.displayProgressBefore,
            settlement.displayFrom,
            settlement.displayTo,
        );
        tween(bar)
            .delay(0.45)
            .to(0.75, {
                progress: this.getWinStreakDisplayProgress(
                    settlement.displayProgressAfter,
                    settlement.displayFrom,
                    settlement.displayTo,
                ),
            }, { easing: 'sineOut' })
            .call(() => {
                if (settlement.claimableRewards.length <= 0) return;
                const reward = settlement.claimableRewards[0];
                LayerManager.instance.showToast(`已获得 ${StreakManager.getRewardDescription(reward)}`);
            })
            .start();
    }

    private refreshWinStreakCountdown = (): void => {
        if (!this.winStreakNode?.isValid || !this.winStreakNode.active) return;
        const viewState = StreakManager.getRewardViewState();
        this.setLabelString(this.winStreakTimeLabel, StreakManager.formatRemainingTime(viewState.remainingSeconds));
        if (this.streakSettlement && viewState.cycleStartedAt !== this.streakSettlement.after.cycleStartedAt) {
            this.streakSettlement = null;
            const reward = viewState.nextReward;
            const from = viewState.previousThreshold;
            const span = Math.max(1, reward.threshold - from);
            this.displayedReward = reward;
            this.setLabelString(this.winStreakNowLabel, `${from}`);
            this.setLabelString(this.winStreakNextLabel, `${reward.threshold}`);
            this.showWinStreakBox(reward.boxType);
            if (this.winStreakProgressBar?.isValid) {
                Tween.stopAllByTarget(this.winStreakProgressBar);
                const progress = Math.max(0, Math.min(1, (viewState.progress - from) / span));
                this.winStreakProgressBar.progress = this.getWinStreakDisplayProgress(
                    progress,
                    from,
                    reward.threshold,
                );
            }
        }
    };

    private getWinStreakDisplayProgress(progress: number, from: number, to: number): number {
        const clamped = Math.max(0, Math.min(1, progress));
        if (from !== 0 || to !== 3) return clamped;

        // The first reward track art places its two separators at 30% and 66%.
        if (clamped <= 1 / 3) return clamped * 0.9;
        if (clamped <= 2 / 3) return 0.3 + (clamped - 1 / 3) * 1.08;
        return 0.66 + (clamped - 2 / 3) * 1.02;
    }

    private bindWinStreakChestButtons(): void {
        for (const box of this.getWinStreakBoxes()) {
            if (!box?.isValid) continue;
            const button = box.getComponent(Button) || box.addComponent(Button);
            box.off(Button.EventType.CLICK, this.onWinStreakChestClick, this);
            box.on(Button.EventType.CLICK, this.onWinStreakChestClick, this);
            button.interactable = true;
        }
    }

    private onWinStreakChestClick(): void {
        const reward = this.displayedReward;
        if (!reward) return;
        AudioManager.instance.playClick();
        const progress = StreakManager.getRewardViewState().progress;
        const description = StreakManager.getRewardDescription(reward);
        LayerManager.instance.showToast(progress >= reward.threshold
            ? `已获得 ${description}`
            : `达到 ${reward.threshold} 连胜可获得 ${description}`);
    }

    private showWinStreakBox(boxType: number): void {
        const visibleIndex = boxType === 1 ? 0 : boxType === 2 ? 1 : 2;
        this.getWinStreakBoxes().forEach((box, index) => {
            if (box?.isValid) box.active = index === visibleIndex;
        });
    }

    private getWinStreakBoxes(): Array<Node | null> {
        return [this.winStreakBox1, this.winStreakBox2, this.winStreakBox3];
    }

    private formatTime(time: number): string {
        const totalSec = Math.max(0, Math.floor(time));
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}分${seconds}秒`;
    }

    private formatNumber(value: number): string {
        const fixed = (Math.round(value * 10) / 10).toFixed(1);
        return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
    }

    private setLabelString(label: Label | null | undefined, value: string) {
        if (label?.isValid) label.string = value;
    }

    private getSettlementCopyText(): string {
        const texts = Constants.settlementCopyTexts;
        if (!Array.isArray(texts) || texts.length === 0) return "";
        return texts[Math.floor(Math.random() * texts.length)] || "";
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
            .call(() => {
                this.refreshOpenAnimationWidgets(target);
            })
            .start();

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.5, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }
    }

    private refreshOpenAnimationWidgets(target: Node) {
        this.refreshWinWidgetNodes(target);
        this.scheduleOnce(() => {
            this.refreshWinWidgetNodes(target);
        }, 0);
    }

    private refreshWinWidgetNodes(target: Node) {
        if (!this.node?.isValid) return;

        this.refreshWidget(target);
        this.refreshWidget(this.iqLabel?.node);
        this.refreshWidget(this.findChildByName(target, 'ye'));
    }

    private refreshWidget(node: Node | null | undefined) {
        if (!node?.isValid) return;
        node.getComponent(Widget)?.updateAlignment();
    }

    private findChildByName(parent: Node | null | undefined, name: string): Node | null {
        if (!parent?.isValid) return null;
        if (parent.name === name) return parent;

        for (const child of parent.children) {
            const result = this.findChildByName(child, name);
            if (result) return result;
        }

        return null;
    }

    private playCloseAnimation(onClosed?: () => void) {
        if (!this.node?.isValid || this.isClosing) return;
        this.isClosing = true;

        const target = this.viewNode ?? this.node;
        const maskOpacity = this.maskNode ? this.maskNode.getComponent(UIOpacity) : null;

        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                if (this.node?.isValid) this.node.destroy();
                onClosed?.();
            })
            .start();

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }

    onButonCloseClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.playCloseAnimation(this.onExit || undefined);
    }

    onButtonShareClick() {
        AudioManager.instance.playClick();
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            //window.dnSDK?.track?.('SHARE', {target: 'APP_MESSAGE'});
            wx.shareAppMessage({
                title: SDKManager.sharData.string,
                imageUrl: SDKManager.sharData.getRandomImageUrl()
            });
        }
    }

    onButtonNextLevelClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        if (this.isTravel && !this.travelCompleted && ProgressManager.loadTravelRemaining() === 0) {
            TravelRecoveryManager.show(() => {
                if (this.node?.isValid && !this.isClosing) this.continueToNextLevel();
            });
            return;
        }
        this.continueToNextLevel();
    }

    private continueToNextLevel(): void {
        const onContinue = this.onContinue
            ?? (this.isActivity
                ? () => LayerManager.instance.showStartLayer()
                : () => director.emit(Constants.eventNames.EventWinNextLevel));
        this.onContinue = null;
        this.playCloseAnimation(onContinue);
    }

    OnBtoonGoHomeClick() {
        if (this.isClosing) return;
        if (this.onExit) {
            this.onButonCloseClick();
            return;
        }
        AudioManager.instance.playClick();
        this.onButonCloseClick();
        // 胜利时 winLevel 已经 saveLevel(next)+clearSnapshot,这里直接返主菜单即可
        LayerManager.instance.showStartLayer();
    }

    public playLightBurst() {
        if (!this.effectNode1?.isValid || !this.effectNode2?.isValid || !this.effectNode3?.isValid) return;

        this.effectNode1.scale = v3(1, 1, 0);
        tween(this.effectNode1)
            .to(0.5, { scale: v3(0.9, 0.6, 0) }, { easing: 'sineInOut' })
            .to(0.5, { scale: v3(1, 1, 0) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();

        this.effectNode2.scale = v3(0.5, 0.5, 0);
        tween(this.effectNode2)
            .delay(0.1)
            .to(0.5, { scale: v3(1, 1, 0) }, { easing: 'sineInOut' })
            .start();

        const effectOpacity = this.effectNode3.getComponent(UIOpacity) ?? this.effectNode3.addComponent(UIOpacity);
        effectOpacity.opacity = 0;
        tween(effectOpacity)
            .delay(0.2)
            .to(0.5, { opacity: 255 }, { easing: 'sineInOut' })
            .start();
    }

}
