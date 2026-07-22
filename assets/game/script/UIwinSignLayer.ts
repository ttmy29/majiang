import { _decorator, Button, Component, Label, Node, tween, Tween, UIOpacity, UITransform, Vec3, view, Widget } from 'cc';
import { Constants } from './config/Constants';
import { AudioManager } from './manager/AudioManager';
import { ProgressManager } from './manager/ProgressManager';
const { ccclass, property } = _decorator;

@ccclass('UIwinSignLayer')
export class UIwinSignLayer extends Component {
    @property(Node)
    bgNode: Node = null!;
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    effectNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;

    private openedByInit = false;
    private isClosing = false;
    private hasGrantedOpenLeaf = false;
    private closeButtonNode: Node | null = null;
    private tipsLabel: Label | null = null;
    private onCloseComplete: (() => void) | null = null;

    protected onLoad(): void {
        this.initNodeRefs();
        this.refreshTipsText();
        this.refreshTodayFinish();
        this.fitBgToViewTop();
        this.fitEffectToViewRightTop();
        this.bindCloseButton();
    }

    protected onEnable(): void {
        this.refreshTipsText();
        this.refreshTodayFinish();
        this.fitBgToViewTop();
        this.fitEffectToViewRightTop();
    }

    start() {
        if (!this.openedByInit) {
            this.grantOpenLeaf();
            this.playOpenAnimation();
        }
    }

    update(deltaTime: number) {

    }

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }
        this.stopEffectLightAnimation();
        this.stopPopupTweens();
    }

    init(onClose?: () => void) {
        this.openedByInit = true;
        this.onCloseComplete = typeof onClose === 'function' ? onClose : null;
        this.initNodeRefs();
        this.refreshTipsText();
        this.fitBgToViewTop();
        this.fitEffectToViewRightTop();
        this.refreshTodayFinish(this.grantOpenLeaf() || new Date());
        this.playOpenAnimation();
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

    onButtonBackClick() {
        this.onButonCloseClick();
    }

    private initNodeRefs() {
        this.bgNode = this.bgNode || this.node.getChildByName('bg');
        this.viewNode = this.viewNode || this.node.getChildByName('view') || this.node;
        this.effectNode = this.effectNode || this.node.getChildByName('effect');
        this.maskNode = this.maskNode || this.bgNode;
        this.tipsLabel = this.tipsLabel || this.findChildByName(this.node, 'tips')?.getComponent(Label) || null;
    }

    private refreshTipsText(now = new Date()) {
        const label = this.tipsLabel || this.findChildByName(this.node, 'tips')?.getComponent(Label);
        if (!label?.isValid) return;

        this.tipsLabel = label;
        const index = now.getDay() === 1 ? 0 : 1;
        label.string = Constants.winSign[index] || Constants.winSign[1] || Constants.winSign[0] || '';
    }

    private grantOpenLeaf(): Date | null {
        if (this.hasGrantedOpenLeaf) return null;
        this.hasGrantedOpenLeaf = true;

        const now = new Date();
        if (!ProgressManager.signToday(now)) return null;
        ProgressManager.addLeafConut(1);
        return now;
    }

    private fitBgToViewTop() {
        this.fitCoverNodeToView(this.bgNode, false);
    }

    private fitEffectToViewRightTop() {
        this.stopEffectLightAnimation();
        this.fitCoverNodeToView(this.effectNode, true);
        this.playEffectLightAnimation();
    }

    private fitCoverNodeToView(target: Node | null, alignRightTop: boolean) {
        if (!target?.isValid) return;

        const transform = target.getComponent(UITransform);
        if (!transform) return;

        const targetWidget = target.getComponent(Widget);
        if (targetWidget) targetWidget.enabled = false;

        const visibleSize = view.getVisibleSize();
        const designSize = transform.contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);

        target.setScale(new Vec3(maxScale, maxScale, 1));
        target.setPosition(this.getCoverNodePosition(transform, maxScale, alignRightTop, target.position.z));

        const opacity = target.getComponent(UIOpacity);
        if (opacity) opacity.opacity = 255;
    }

    private getCoverNodePosition(transform: UITransform, nodeScale: number, alignRightTop: boolean, z: number): Vec3 {
        const visibleSize = view.getVisibleSize();
        const designSize = transform.contentSize;
        const anchor = transform.anchorPoint;
        const x = alignRightTop
            ? visibleSize.width / 2 - designSize.width * nodeScale * (1 - anchor.x)
            : (0.5 - anchor.x) * designSize.width * nodeScale;
        const y = visibleSize.height / 2 - designSize.height * nodeScale * (1 - anchor.y);
        return new Vec3(x, y, z);
    }

    private refreshTodayFinish(date = new Date()) {
        const finishSlots = this.getWeekFinishSlots();
        if (finishSlots.length <= 0) return;

        finishSlots.sort((a, b) => a.slot.position.x - b.slot.position.x);

        const jsDay = date.getDay();
        const todayIndex = jsDay === 0 ? 6 : jsDay - 1;

        finishSlots.forEach(({ finish }, index) => {
            finish.active = index === todayIndex;
        });
    }

    private getWeekFinishSlots(): { slot: Node; finish: Node }[] {
        const slots: { slot: Node; finish: Node }[] = [];
        this.collectWeekFinishSlots(this.getViewNode(), slots);
        return slots;
    }

    private collectWeekFinishSlots(parent: Node | null, slots: { slot: Node; finish: Node }[]) {
        if (!parent) return;

        for (const child of parent.children) {
            if (/^select\d+$/.test(child.name)) {
                const finish = child.getChildByName('finish');
                if (finish) slots.push({ slot: child, finish });
            }

            this.collectWeekFinishSlots(child, slots);
        }
    }

    private bindCloseButton() {
        const closeButton = this.findChildByName(this.node, 'button')
            || this.findChildByName(this.node, 'back')
            || this.findChildByName(this.node, 'Game_btn_guanbi')
            || this.findChildByName(this.node, 'closeButton');
        if (!closeButton) return;

        this.closeButtonNode = closeButton;
        const button = closeButton.getComponent(Button) || closeButton.addComponent(Button);
        closeButton.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButonCloseClick, this);
        button.interactable = true;
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.getViewNode();
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
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        const target = this.getViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();

        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                const onCloseComplete = this.onCloseComplete;
                this.onCloseComplete = null;
                this.node.destroy();
                onCloseComplete?.();
            })
            .start();

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }

    private getViewNode(): Node {
        return this.viewNode || this.node.getChildByName('view') || this.node;
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('bg');
        if (!mask) return null;
        this.maskNode = mask;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens() {
        const target = this.getViewNode();
        if (target?.isValid) Tween.stopAllByTarget(target);

        const mask = this.maskNode || this.node.getChildByName('bg');
        const maskOpacity = mask?.isValid ? mask.getComponent(UIOpacity) : null;
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    private playEffectLightAnimation() {
        if (!this.effectNode?.isValid || this.isClosing) return;

        const transform = this.effectNode.getComponent(UITransform);
        if (!transform) return;

        const baseScale = this.effectNode.scale.x;
        const swellScale = baseScale * 1.035;
        const glowScale = baseScale * 1.06;
        const z = this.effectNode.position.z;
        const basePosition = this.getCoverNodePosition(transform, baseScale, true, z);
        const swellPosition = this.getCoverNodePosition(transform, swellScale, true, z);
        const glowPosition = this.getCoverNodePosition(transform, glowScale, true, z);
        const baseEuler = new Vec3(0, 0, -0.4);

        const opacity = this.effectNode.getComponent(UIOpacity) || this.effectNode.addComponent(UIOpacity);
        this.stopEffectLightAnimation();

        this.effectNode.setPosition(basePosition);
        this.effectNode.setScale(new Vec3(baseScale, baseScale, 1));
        this.effectNode.eulerAngles = baseEuler;
        opacity.opacity = 205;

        tween(this.effectNode)
            .to(3.2, {
                position: swellPosition,
                scale: new Vec3(swellScale, swellScale, 1),
                eulerAngles: new Vec3(0, 0, 0.9)
            }, { easing: 'sineInOut' })
            .to(3.6, {
                position: glowPosition,
                scale: new Vec3(glowScale, glowScale, 1),
                eulerAngles: new Vec3(0, 0, -0.8)
            }, { easing: 'sineInOut' })
            .to(3, {
                position: basePosition,
                scale: new Vec3(baseScale, baseScale, 1),
                eulerAngles: baseEuler
            }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();

        tween(opacity)
            .to(1.6, { opacity: 245 }, { easing: 'sineInOut' })
            .to(2.2, { opacity: 175 }, { easing: 'sineInOut' })
            .to(1.8, { opacity: 230 }, { easing: 'sineInOut' })
            .to(2.4, { opacity: 205 }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private stopEffectLightAnimation() {
        if (!this.effectNode?.isValid) return;

        Tween.stopAllByTarget(this.effectNode);
        const opacity = this.effectNode.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
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

