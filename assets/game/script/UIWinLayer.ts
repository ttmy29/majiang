import { _decorator, Component, director, Label, Node, sys, tween, UIOpacity, v3, Vec3, Widget } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { SDKManager } from '../../loading/SDKManager';
const { ccclass, property } = _decorator;

interface WinLayerData {
    time?: number;
    iq?: number;
    nextLevel?: number;
    comboTimes?: number;
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
    start() {
        AudioManager.instance.playOneShot(AudioClipNames.game_win);
    }

    init(dataOrTime: WinLayerData | number = 0) {
        const data = typeof dataOrTime === 'number' ? { time: dataOrTime } : (dataOrTime || {});
        const time = data.time ?? 0;
        const iqText = this.formatNumber(data.iq ?? 0);
        const nextLevel = Math.max(0, Math.floor(data.nextLevel ?? 0));
        const comboTimes = Math.max(0, Math.floor(data.comboTimes ?? 0));

        director.emit(Constants.eventNames.EventSetIQLabelVisible, false);
        this.playOpenAnimation();
        this.setLabelString(this.rankLabel, this.getSettlementCopyText());
        this.setLabelString(this.iqLabel, iqText);
        this.setLabelString(this.levleNexLabel, `关卡 ${nextLevel}`);
        this.setLabelString(this.gridLabel1, this.formatTime(time));
        this.setLabelString(this.gridLabel2, iqText);
        this.setLabelString(this.gridLabel3, `${comboTimes}`);
        this.playLightBurst();
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

    onButonCloseClick() {
        AudioManager.instance.playClick();
        this.playCloseAnimation();
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
        AudioManager.instance.playClick();
        director.emit(Constants.eventNames.EventWinNextLevel);
        this.playCloseAnimation();
    }

    OnBtoonGoHomeClick() {
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
