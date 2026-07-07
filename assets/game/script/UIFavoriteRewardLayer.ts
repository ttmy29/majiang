import { _decorator, Button, Component, Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

const VIEW_SCALE = 0.6;
const OPEN_START_SCALE = VIEW_SCALE * 0.3;
const OPEN_OVERSHOOT_SCALE = VIEW_SCALE * 1.05;

@ccclass('UIFavoriteRewardLayer')
export class UIFavoriteRewardLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(Node)
    rewardButton: Node = null!;

    private isClosing = false;

    protected onLoad(): void {
        this.viewNode = this.viewNode || this.node.getChildByName('view') || this.node;
        this.maskNode = this.maskNode || this.node.getChildByName('bg');
        this.rewardButton = this.rewardButton || this.findChildByName(this.node, 'rewardButton')!;
        this.bindRewardButton();
    }

    start() {
        this.playOpenAnimation();
    }

    update(deltaTime: number) {

    }

    protected onDestroy(): void {
        if (this.rewardButton?.isValid) {
            this.rewardButton.off(Button.EventType.CLICK, this.onRewardButtonClick, this);
        }

        if (this.viewNode?.isValid) Tween.stopAllByTarget(this.viewNode);
        const maskOpacity = this.maskNode?.isValid ? this.maskNode.getComponent(UIOpacity) : null;
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    onRewardButtonClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.close();
    }

    close() {
        this.playCloseAnimation();
    }

    private bindRewardButton() {
        if (!this.rewardButton) return;

        const button = this.rewardButton.getComponent(Button) || this.rewardButton.addComponent(Button);
        this.rewardButton.off(Button.EventType.CLICK, this.onRewardButtonClick, this);
        this.rewardButton.on(Button.EventType.CLICK, this.onRewardButtonClick, this);
        button.interactable = true;
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.viewNode || this.node;
        const maskOpacity = this.getMaskOpacity(true);

        Tween.stopAllByTarget(target);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);

        if (maskOpacity) maskOpacity.opacity = 0;
        target.setScale(new Vec3(OPEN_START_SCALE, OPEN_START_SCALE, 1));

        tween(target)
            .to(0.35, { scale: new Vec3(OPEN_OVERSHOOT_SCALE, OPEN_OVERSHOOT_SCALE, 1) }, { easing: 'sineOut' })
            .to(0.15, { scale: new Vec3(VIEW_SCALE, VIEW_SCALE, 1) }, { easing: 'sineInOut' })
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

        const target = this.viewNode || this.node;
        const maskOpacity = this.getMaskOpacity(true);

        Tween.stopAllByTarget(target);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);

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

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('bg');
        if (!mask) return null;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
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

