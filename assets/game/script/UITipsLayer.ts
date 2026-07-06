import { _decorator, Button, Component, Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

type TipsLayerParam = number | string | { type?: number | string; tipsType?: number | string };

@ccclass('UITipsLayer')
export class UITipsLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;

    private readonly defaultTipsType = 1;
    private currentTipsType = this.defaultTipsType;
    private openedByInit = false;
    private isClosing = false;
    private closeButtonNode: Node | null = null;

    protected onLoad(): void {
        this.viewNode = this.viewNode || this.node.getChildByName('view');
        this.maskNode = this.maskNode || this.node.getChildByName('bg');
        this.bindCloseButton();
        this.showTipsType(this.currentTipsType);
    }

    start() {
        if (!this.openedByInit) {
            this.playOpenAnimation();
        }
    }

    update(deltaTime: number) {

    }

    init(type?: TipsLayerParam) {
        this.openedByInit = true;
        this.currentTipsType = this.normalizeTipsType(type);
        this.showTipsType(this.currentTipsType);
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

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }

        if (this.viewNode?.isValid) Tween.stopAllByTarget(this.viewNode);
        const maskOpacity = this.maskNode?.isValid ? this.maskNode.getComponent(UIOpacity) : null;
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    private bindCloseButton() {
        const closeButton = this.findChildByName(this.node, 'Game_btn_guanbi');
        if (!closeButton) return;

        this.closeButtonNode = closeButton;
        closeButton.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButonCloseClick, this);
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.getViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        Tween.stopAllByTarget(target);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);

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

        Tween.stopAllByTarget(target);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);

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

    private getViewNode(): Node {
        return this.viewNode || this.node.getChildByName('view') || this.node;
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('bg');
        if (!mask) return null;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private normalizeTipsType(type?: TipsLayerParam): number {
        if (type === undefined || type === null || type === '') {
            return this.defaultTipsType;
        }

        const rawType = typeof type === 'object' ? type.type ?? type.tipsType : type;
        const tipsType = Number(rawType);
        if (!Number.isFinite(tipsType)) {
            return this.defaultTipsType;
        }

        return Math.trunc(tipsType);
    }

    private showTipsType(type: number) {
        const view = this.getViewNode();
        const targetName = `type${type}`;
        let hasTarget = false;

        for (const child of view.children) {
            if (!/^type\d+$/.test(child.name)) continue;
            const shouldShow = child.name === targetName;
            child.active = shouldShow;
            hasTarget = hasTarget || shouldShow;
        }

        if (!hasTarget && type !== this.defaultTipsType) {
            this.showTipsType(this.defaultTipsType);
        }
    }

    private findChildByName(parent: Node | null, name: string): Node | null {
        if (!parent) return null;
        if (parent.name === name) return parent;

        const children = parent.children;
        if (!children || children.length <= 0) return null;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const result = this.findChildByName(child, name);
            if (result) return result;
        }

        return null;
    }
}

