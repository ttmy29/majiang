import { _decorator, Color, Component, director, find, Graphics, Node, Sprite, tween, UITransform, Vec3, Tween } from 'cc';
import { Constants } from './config/Constants';
const { ccclass, property } = _decorator;

interface HighlightRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

@ccclass('GuideCtrl')
export class GuideCtrl extends Component {
    @property(Node)
    fingerNode: Node = null!;

    @property
    shadowOpacity: number = 140;

    @property
    targetNodePath: string = 'Canvas/gameLayer/slotNode/slot1';

    @property
    targetHighlightX: number = -150;

    @property
    targetHighlightY: number = 305;

    @property
    targetHighlightWidth: number = 300;

    @property
    targetHighlightHeight: number = 125;

    @property
    targetHighlightPaddingX: number = 12;

    @property
    targetHighlightPaddingY: number = 12;

    @property
    tileHighlightX: number = 0;

    @property
    tileHighlightY: number = -210;

    @property
    tileHighlightWidth: number = 310;

    @property
    tileHighlightHeight: number = 290;

    @property
    pressOffsetX: number = 2;

    @property
    pressOffsetY: number = -5;

    @property
    reboundOffsetX: number = -8;

    @property
    reboundOffsetY: number = 10;

    @property
    pressScale: number = 0.65;

    @property
    reboundScale: number = 1.05;



    @property
    tapMoveDuration: number = 0.15;

    private _initScale: Vec3 = new Vec3();
    private _initPos: Vec3 = new Vec3();
    private _basePos: Vec3 = new Vec3();
    private _shadowRoot: Node | null = null;
    private _shadowGraphics: Graphics | null = null;

    start() {
        window.dnSDK?.track?.('TUTORIAL_START', {});

        this._initScale.set(this.fingerNode.scale);
        this._initPos.set(this.fingerNode.position);
        this._basePos.set(this._initPos);

        this.refreshGuideMask();
        this.scheduleOnce(() => this.refreshGuideMask(), 0);
        this.playSlideAndClickAnim();
    }

    onEnable() {
        director.on(Constants.eventNames.EventGuideTileTapped, this.onGuideTileTapped, this);
        find('Canvas/gameLayer/Game_btn_shezhi').active = false;
    }

    onDisable() {
        director.off(Constants.eventNames.EventGuideTileTapped, this.onGuideTileTapped, this);
        find('Canvas/gameLayer/Game_btn_shezhi').active = true;
        const sdk = window.dnSDK;
        if (typeof sdk?.onTutorialFinish === 'function') {
            sdk.onTutorialFinish();
        } else {
            sdk?.track?.('TUTORIAL_FINISH', {});
        }
    }

    private onGuideTileTapped(payload: { count: number; type: string; col: number; row: number; layer: number; worldPos: Vec3 }) {
        const offset = this.getTapOffset(payload);
        //console.log('onGuideTileTapped', payload);
        if (!offset) return;
        this._basePos.set(
            this._initPos.x + offset.x,
            this._initPos.y + offset.y,
            this._initPos.z,
        );
        this.moveFingerTo(this._basePos);
    }

    private getTapOffset(payload: { count: number; type: string; col: number; row: number; layer: number; worldPos: Vec3 }): { x: number; y: number } | null {
        if (payload.type == '4005') {
            if (payload.col == 4) { //点的是左边边的一个
                if (payload.count == 1) {
                    return {
                        x: -80,
                        y: 0,
                    };
                }
                if (payload.count == 2) {
                    return {
                        x: -35,
                        y: -170,
                    };
                }
            }
            if (payload.row == 3) { //点的是右边的一个
                if (payload.count == 2) {
                    return {
                        x: -35,
                        y: -170,
                    };
                }
            }
        }
        return null;
    }

    private moveFingerTo(target: Vec3) {
        Tween.stopAllByTarget(this.fingerNode);
        const dest = target.clone();
        tween(this.fingerNode)
            .to(this.tapMoveDuration, { position: dest }, { easing: 'sineOut' })
            .call(() => this.playSlideAndClickAnim())
            .start();
    }

    public refresh() {
        this.refreshGuideMask();
    }

    private refreshGuideMask() {
        const bgNode = this.node.getChildByName('bg') || this.node;
        const bgSprite = bgNode.getComponent(Sprite);
        if (bgSprite) bgSprite.enabled = false;

        const unusedMask = bgNode.getChildByName('mask');
        if (unusedMask) unusedMask.active = false;
        const oldOutline = bgNode.getChildByName('highlightOutline');
        if (oldOutline) oldOutline.destroy();

        const ui = bgNode.getComponent(UITransform) || bgNode.addComponent(UITransform);
        const rootUi = this.node.getComponent(UITransform);
        if (rootUi) ui.setContentSize(rootUi.contentSize);
        const width = ui.contentSize.width;
        const height = ui.contentSize.height;
        if (width <= 0 || height <= 0) return;

        this.ensureShadowRoot(bgNode, ui);

        const left = -width / 2;
        const right = width / 2;
        const bottom = -height / 2;
        const top = height / 2;
        const highlights = this.getHighlightRects(bgNode, left, right, bottom, top);

        this.drawShadowCells(left, right, bottom, top, highlights);
    }

    private getHighlightRects(bgNode: Node, left: number, right: number, bottom: number, top: number): HighlightRect[] {
        const targetRect = this.getTargetNodeHighlightRect(bgNode, left, right, bottom, top)
            || this.clampRect({
                x: this.targetHighlightX,
                y: this.targetHighlightY,
                width: this.targetHighlightWidth,
                height: this.targetHighlightHeight,
            }, left, right, bottom, top);

        return [
            targetRect,
            // The tile group around the hand pointer.
            this.clampRect({
                x: this.tileHighlightX,
                y: this.tileHighlightY,
                width: this.tileHighlightWidth,
                height: this.tileHighlightHeight,
            }, left, right, bottom, top),
        ].filter(rect => rect.width > 0 && rect.height > 0);
    }

    private getTargetNodeHighlightRect(bgNode: Node, left: number, right: number, bottom: number, top: number): HighlightRect | null {
        const target = find(this.targetNodePath);
        const targetUi = target?.getComponent(UITransform);
        const bgUi = bgNode.getComponent(UITransform);
        if (!target || !targetUi || !bgUi || targetUi.contentSize.width <= 0 || targetUi.contentSize.height <= 0) return null;

        const width = targetUi.contentSize.width;
        const height = targetUi.contentSize.height;
        const anchor = targetUi.anchorPoint;
        const localLeft = -anchor.x * width - this.targetHighlightPaddingX;
        const localRight = (1 - anchor.x) * width + this.targetHighlightPaddingX;
        const localBottom = -anchor.y * height - this.targetHighlightPaddingY;
        const localTop = (1 - anchor.y) * height + this.targetHighlightPaddingY;
        const corners = [
            new Vec3(localLeft, localBottom, 0),
            new Vec3(localLeft, localTop, 0),
            new Vec3(localRight, localBottom, 0),
            new Vec3(localRight, localTop, 0),
        ];

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const corner of corners) {
            const world = targetUi.convertToWorldSpaceAR(corner);
            const local = bgUi.convertToNodeSpaceAR(world);
            minX = Math.min(minX, local.x);
            maxX = Math.max(maxX, local.x);
            minY = Math.min(minY, local.y);
            maxY = Math.max(maxY, local.y);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
        return this.clampRect({
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            width: maxX - minX,
            height: maxY - minY,
        }, left, right, bottom, top);
    }

    private drawShadowCells(
        left: number,
        right: number,
        bottom: number,
        top: number,
        highlights: HighlightRect[],
    ) {
        const graphics = this._shadowGraphics;
        if (!graphics) return;
        graphics.clear();
        graphics.fillColor = new Color(0, 0, 0, this.shadowOpacity);

        const xs = [left, right];
        const ys = [bottom, top];
        for (const rect of highlights) {
            xs.push(rect.x - rect.width / 2, rect.x + rect.width / 2);
            ys.push(rect.y - rect.height / 2, rect.y + rect.height / 2);
        }
        const sortedXs = this.sortedUnique(xs);
        const sortedYs = this.sortedUnique(ys);

        for (let xi = 0; xi < sortedXs.length - 1; xi++) {
            for (let yi = 0; yi < sortedYs.length - 1; yi++) {
                const x1 = sortedXs[xi];
                const x2 = sortedXs[xi + 1];
                const y1 = sortedYs[yi];
                const y2 = sortedYs[yi + 1];
                if (x2 <= x1 || y2 <= y1) continue;

                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;
                if (highlights.some(rect => this.contains(rect, cx, cy))) continue;
                graphics.rect(x1, y1, x2 - x1, y2 - y1);
                graphics.fill();
            }
        }
    }

    private ensureShadowRoot(bgNode: Node, bgUi: UITransform): Node {
        if (!this._shadowRoot?.isValid) {
            this._shadowRoot = bgNode.getChildByName('shadowRoot') || new Node('shadowRoot');
            this._shadowRoot.layer = bgNode.layer;
            if (!this._shadowRoot.parent) bgNode.addChild(this._shadowRoot);
        }

        this._shadowRoot.setPosition(Vec3.ZERO);
        const shadowUi = this._shadowRoot.getComponent(UITransform) || this._shadowRoot.addComponent(UITransform);
        shadowUi.setContentSize(bgUi.contentSize);
        this._shadowRoot.setSiblingIndex(0);

        this._shadowGraphics = this._shadowRoot.getComponent(Graphics) || this._shadowRoot.addComponent(Graphics);
        return this._shadowRoot;
    }

    private clampRect(rect: HighlightRect, left: number, right: number, bottom: number, top: number): HighlightRect {
        const x1 = Math.max(left, rect.x - rect.width / 2);
        const x2 = Math.min(right, rect.x + rect.width / 2);
        const y1 = Math.max(bottom, rect.y - rect.height / 2);
        const y2 = Math.min(top, rect.y + rect.height / 2);
        return {
            x: (x1 + x2) / 2,
            y: (y1 + y2) / 2,
            width: Math.max(0, x2 - x1),
            height: Math.max(0, y2 - y1),
        };
    }

    private sortedUnique(values: number[]): number[] {
        return values
            .filter(value => Number.isFinite(value))
            .sort((a, b) => a - b)
            .filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) > 0.001);
    }

    private contains(rect: HighlightRect, x: number, y: number): boolean {
        return x >= rect.x - rect.width / 2
            && x <= rect.x + rect.width / 2
            && y >= rect.y - rect.height / 2
            && y <= rect.y + rect.height / 2;
    }

    playSlideAndClickAnim() {
        Tween.stopAllByTarget(this.fingerNode);

        const pressPos = new Vec3(
            this._basePos.x + this.pressOffsetX,
            this._basePos.y + this.pressOffsetY,
            this._basePos.z,
        );
        const reboundPos = new Vec3(
            this._basePos.x + this.reboundOffsetX,
            this._basePos.y + this.reboundOffsetY,
            this._basePos.z,
        );
        const pressScale = new Vec3(
            this._initScale.x * this.pressScale,
            this._initScale.y * this.pressScale,
            this._initScale.z,
        );
        const reboundScale = new Vec3(
            this._initScale.x * this.reboundScale,
            this._initScale.y * this.reboundScale,
            this._initScale.z,
        );

        tween(this.fingerNode)
            .sequence(
                tween(this.fingerNode).set({ position: this._basePos, scale: this._initScale }),
                // Match the reference tap: quick press, slight hold, elastic rebound, then settle.
                tween(this.fingerNode).to(0.08, { position: pressPos, scale: pressScale }, { easing: 'sineIn' }),
                tween(this.fingerNode).delay(0.04),
                tween(this.fingerNode).to(0.2, { position: reboundPos, scale: reboundScale }, { easing: 'backOut' }),
                tween(this.fingerNode).to(0.16, { position: this._basePos, scale: this._initScale }, { easing: 'sineInOut' }),
                tween(this.fingerNode).delay(0.5)
            )
            .repeatForever()
            .start();
    }

    stopAndHide() {
        Tween.stopAllByTarget(this.fingerNode);
        this.fingerNode.active = false;
    }
}
