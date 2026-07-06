import { _decorator, Button, Component, Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

const VIEW_SCALE = 0.6;
const OPEN_START_SCALE = VIEW_SCALE * 0.3;
const OPEN_OVERSHOOT_SCALE = VIEW_SCALE * 1.05;

@ccclass('UIaddDesktopLayer')
export class UIaddDesktopLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    view2Node: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(Node)
    button1Node: Node = null!;
    @property(Node)
    button2Node: Node = null!;

    private isClosing = false;

    protected onLoad(): void {
        this.initNodeRefs();

        this.showView();
        this.bindButtons();
    }

    protected onEnable(): void {
        this.showView();
    }

    protected onDestroy(): void {
        if (this.button1Node?.isValid) {
            this.button1Node.off(Button.EventType.CLICK, this.onButton1Click, this);
        }
        if (this.button2Node?.isValid) {
            this.button2Node.off(Button.EventType.CLICK, this.onButton2Click, this);
        }
        this.stopPopupTweens();
    }

    init() {
        this.showView();
        this.playOpenAnimation();
    }

    onButton1Click() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.playSwitchToView2Animation();
    }

    onButton2Click() {
        this.close();
    }

    close() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.playCloseAnimation();
    }

    private initNodeRefs() {
        this.viewNode = this.viewNode || this.node.getChildByName('view')!;
        this.view2Node = this.view2Node || this.node.getChildByName('view2')!;
        this.maskNode = this.maskNode || this.node.getChildByName('bg')!;
        this.button1Node = this.button1Node || this.findChildByName(this.viewNode, 'button1')!;
        this.button2Node = this.button2Node || this.findChildByName(this.view2Node, 'button2')!;
    }

    private bindButtons() {
        this.bindButton(this.button1Node, this.onButton1Click);
        this.bindButton(this.button2Node, this.onButton2Click);
    }

    private bindButton(node: Node | null, callback: () => void) {
        if (!node) return;

        const button = node.getComponent(Button) || node.addComponent(Button);
        node.off(Button.EventType.CLICK, callback, this);
        node.on(Button.EventType.CLICK, callback, this);
        button.interactable = true;
    }

    private showView() {
        if (this.viewNode) {
            this.viewNode.active = true;
            this.viewNode.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));
        }
        if (this.view2Node) {
            this.view2Node.active = false;
            this.view2Node.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));
        }
    }

    private showView2() {
        if (this.viewNode) {
            Tween.stopAllByTarget(this.viewNode);
            this.viewNode.active = false;
            this.viewNode.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));
        }
        if (this.view2Node) {
            Tween.stopAllByTarget(this.view2Node);
            this.view2Node.active = true;
            this.view2Node.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));
        }
    }

    private playSwitchToView2Animation() {
        if (!this.view2Node?.isValid) return;
        if (!this.viewNode?.isValid || !this.viewNode.active) {
            this.showView2();
            this.playOpenViewAnimation(this.view2Node);
            return;
        }

        Tween.stopAllByTarget(this.viewNode);
        Tween.stopAllByTarget(this.view2Node);
        this.view2Node.active = false;
        this.view2Node.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));

        tween(this.viewNode)
            .to(0.18, { scale: new Vec3(OPEN_START_SCALE, OPEN_START_SCALE, 1) }, { easing: 'quadIn' })
            .call(() => {
                this.viewNode.active = false;
                this.viewNode.setScale(new Vec3(VIEW_SCALE, VIEW_SCALE, 1));
                this.view2Node.active = true;
                this.playOpenViewAnimation(this.view2Node);
            })
            .start();
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.getActiveViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();

        if (maskOpacity) maskOpacity.opacity = 0;
        this.playOpenViewAnimation(target);

        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.5, { opacity: 255 }, { easing: 'sineOut' })
                .start();
        }
    }

    private playCloseAnimation() {
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        const target = this.getActiveViewNode();
        const maskOpacity = this.getMaskOpacity(false);

        this.stopPopupTweens();

        tween(target)
            .to(0.18, { scale: new Vec3(OPEN_START_SCALE, OPEN_START_SCALE, 1) }, { easing: 'quadIn' })
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

    private playOpenViewAnimation(target: Node) {
        target.setScale(new Vec3(OPEN_START_SCALE, OPEN_START_SCALE, 1));

        tween(target)
            .to(0.35, { scale: new Vec3(OPEN_OVERSHOOT_SCALE, OPEN_OVERSHOOT_SCALE, 1) }, { easing: 'sineOut' })
            .to(0.15, { scale: new Vec3(VIEW_SCALE, VIEW_SCALE, 1) }, { easing: 'sineInOut' })
            .start();
    }

    private getActiveViewNode(): Node {
        if (this.view2Node?.active) return this.view2Node;
        return this.viewNode || this.node;
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('bg');
        if (!mask) return null;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens() {
        if (this.viewNode?.isValid) Tween.stopAllByTarget(this.viewNode);
        if (this.view2Node?.isValid) Tween.stopAllByTarget(this.view2Node);

        const maskOpacity = this.maskNode?.isValid ? this.maskNode.getComponent(UIOpacity) : null;
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

