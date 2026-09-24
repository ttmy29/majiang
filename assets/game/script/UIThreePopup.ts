import { _decorator, Component, EventTouch, Node, tween, Tween, UIOpacity, UITransform, v3, view, Widget } from 'cc';

const { ccclass, property } = _decorator;

/** 只负责新三消弹窗的展示与交互，不直接修改道具、关卡或广告状态。 */
export const ThreePopupEvent = {
    RecoverRequested: 'recover-requested',
    ReviveRequested: 'revive-requested',
    Confirmed: 'confirmed',
    Closed: 'closed',
} as const;

@ccclass('UIThreePopup')
export class UIThreePopup extends Component {
    @property(Node)
    viewNode: Node = null!;

    @property(Node)
    maskNode: Node = null!;

    @property(Node)
    observeNode: Node = null!;

    @property
    maxScale = 0.7;

    private observingTouch: number | null = null;
    private opening = false;
    private fittedScale = 0.7;

    protected onEnable(): void {
        this.node.on(Node.EventType.SIZE_CHANGED, this.fitContent, this);
        view.on('canvas-resize', this.fitContent, this);
        view.on('design-resolution-changed', this.fitContent, this);
        if (this.observeNode) {
            // failureThree 的背景空白处也可按住查看牌面，松手恢复弹窗。
            this.maskNode?.on(Node.EventType.TOUCH_START, this.onObserveStart, this);
            this.maskNode?.on(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.maskNode?.on(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
            this.viewNode?.on(Node.EventType.TOUCH_START, this.onViewObserveStart, this);
            this.viewNode?.on(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.viewNode?.on(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
            this.observeNode.on(Node.EventType.TOUCH_START, this.onObserveStart, this);
            this.observeNode.on(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.observeNode.on(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
        }
        this.node.getComponent(Widget)?.updateAlignment();
        this.fitContent();
        if (this.node.name === 'failureThree') this.playFailureOpenAnimation();
        // Widget 在首帧完成父级尺寸同步后，再做一次等比适配。
        this.scheduleOnce(this.fitContent, 0);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.SIZE_CHANGED, this.fitContent, this);
        view.off('canvas-resize', this.fitContent, this);
        view.off('design-resolution-changed', this.fitContent, this);
        if (this.observeNode?.isValid) {
            this.maskNode?.off(Node.EventType.TOUCH_START, this.onObserveStart, this);
            this.maskNode?.off(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.maskNode?.off(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
            this.viewNode?.off(Node.EventType.TOUCH_START, this.onViewObserveStart, this);
            this.viewNode?.off(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.viewNode?.off(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
            this.observeNode.off(Node.EventType.TOUCH_START, this.onObserveStart, this);
            this.observeNode.off(Node.EventType.TOUCH_END, this.onObserveEnd, this);
            this.observeNode.off(Node.EventType.TOUCH_CANCEL, this.onObserveEnd, this);
        }
        this.unschedule(this.fitContent);
        if (this.node.name === 'failureThree') {
            if (this.viewNode?.isValid) Tween.stopAllByTarget(this.viewNode);
            const maskOpacity = this.maskNode?.getComponent(UIOpacity);
            if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
            this.opening = false;
        }
        this.restoreView();
    }

    /** 广告/奖励由调用方监听事件处理；成功后由调用方执行 close()。 */
    public onAction(_event: unknown, action: string): void {
        switch (action) {
            case 'recover':
                this.node.emit(ThreePopupEvent.RecoverRequested, this);
                break;
            case 'revive':
                this.node.emit(ThreePopupEvent.ReviveRequested, this);
                break;
            case 'confirm':
                this.node.emit(ThreePopupEvent.Confirmed, this);
                this.close();
                break;
            case 'close':
                this.close();
                break;
        }
    }

    public close(): void {
        this.restoreView();
        this.node.emit(ThreePopupEvent.Closed, this);
        this.node.destroy();
    }

    private fitContent(): void {
        const content = this.viewNode?.getComponent(UITransform);
        const available = this.node.getComponent(UITransform)?.contentSize;
        if (!content || !available || available.width <= 0 || available.height <= 0) return;
        const scale = Math.min(
            this.maxScale,
            Math.max(1, available.width - 24) / content.width,
            Math.max(1, available.height - 32) / content.height,
        );
        this.fittedScale = scale;
        if (!this.opening) this.viewNode.setScale(scale, scale, 1);
        this.maskNode?.getComponent(UITransform)?.setContentSize(available);
    }

    private playFailureOpenAnimation(): void {
        if (!this.viewNode?.isValid) return;
        this.opening = true;
        const scale = this.fittedScale;
        this.viewNode.setScale(scale * 0.3, scale * 0.3, 1);
        tween(this.viewNode)
            .to(0.35, { scale: v3(scale * 1.05, scale * 1.05, 1) }, { easing: 'sineOut' })
            .to(0.15, { scale: v3(scale, scale, 1) }, { easing: 'sineInOut' })
            .call(() => {
                this.opening = false;
                this.fitContent();
            })
            .start();
        const maskOpacity = this.maskNode?.getComponent(UIOpacity);
        if (maskOpacity) {
            maskOpacity.opacity = 0;
            tween(maskOpacity).to(0.5, { opacity: 255 }, { easing: 'sineOut' }).start();
        }
    }

    private onViewObserveStart(event: EventTouch): void {
        // 触摸事件会向上冒泡；复活/关闭按钮不应被误认为空白区域。
        let target = event.target as Node | null;
        while (target && target !== this.viewNode) {
            if (target.name === 'reviveButton' || target.name === 'close') return;
            target = target.parent;
        }
        this.onObserveStart(event);
    }

    private onObserveStart(event: EventTouch): void {
        if (this.observingTouch !== null) return;
        this.observingTouch = event.getID();
        this.hideView();
    }

    private onObserveEnd(event: EventTouch): void {
        if (event.getID() === this.observingTouch) this.restoreView();
    }

    private hideView(): void {
        if (this.observingTouch !== null) {
            const maskOpacity = this.maskNode?.getComponent(UIOpacity);
            if (maskOpacity && this.node.name === 'failureThree') Tween.stopAllByTarget(maskOpacity);
            this.setOpacity(0);
        }
    }

    private restoreView(): void {
        this.unschedule(this.hideView);
        this.observingTouch = null;
        this.setOpacity(255);
    }

    private setOpacity(opacity: number): void {
        // 保持节点激活，接收松手/取消事件；全屏 BlockInputEvents 继续阻止误触棋盘。
        for (const target of [this.viewNode, this.maskNode]) {
            if (target?.isValid) {
                const uiOpacity = target.getComponent(UIOpacity);
                if (uiOpacity) uiOpacity.opacity = opacity;
            }
        }
    }
}
