import { _decorator, Button, Component, Node, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
const { ccclass, property } = _decorator;

type TipsLayerParam = number | string | { type?: number | string; tipsType?: number | string };
type Type1Lock = {
    lock: Node;
    tile: Node;
    helper: Node | null;
};
type Type2Pair = {
    cover: Node;
    flip: Node;
    tile: Node;
};
type Type2NodeState = {
    position: Vec3;
    scale: Vec3;
    eulerAngles: Vec3;
    opacity: number;
    active: boolean;
    siblingIndex: number;
};
type Type3Group = {
    tiles: Node[];
    chain: Node | null;
};
type Type3BoxTarget = {
    position: Vec3;
    scale: Vec3;
};

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
    private viewBaseScale: Vec3 | null = null;
    private type1NodeStates: Map<Node, Type2NodeState> = new Map();
    private type1AnimatedNodes: Node[] = [];
    private type2NodeStates: Map<Node, Type2NodeState> = new Map();
    private type2AnimatedNodes: Node[] = [];
    private type3NodeStates: Map<Node, Type2NodeState> = new Map();
    private type3AnimatedNodes: Node[] = [];
    private readonly type1FingerPressOffset = new Vec3(-8, 10, 0);
    private readonly type1FingerReboundOffset = new Vec3(6, -8, 0);
    private readonly type2FingerPressOffset = new Vec3(-8, 10, 0);
    private readonly type2FingerReboundOffset = new Vec3(6, -8, 0);
    private readonly type3FingerPressOffset = new Vec3(2, -5, 0);
    private readonly type3FingerReboundOffset = new Vec3(-8, 10, 0);
    private readonly type3BoxTileScaleRatio = 0.58;

    protected onLoad(): void {
        this.viewNode = this.viewNode || this.node.getChildByName('view');
        this.maskNode = this.maskNode || this.node.getChildByName('bg');
        this.cacheViewBaseScale();
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
        this.stopType1Animation(false);
        this.stopType2Animation(false);
        this.stopType3Animation(false);

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

        const baseScale = this.getViewBaseScale(target);
        if (maskOpacity) maskOpacity.opacity = 0;
        target.setScale(this.getScaleByRatio(baseScale, 0.3));

        tween(target)
            .to(0.35, { scale: this.getScaleByRatio(baseScale, 1.05) }, { easing: 'sineOut' })
            .to(0.15, { scale: baseScale.clone() }, { easing: 'sineInOut' })
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
        this.stopType1Animation(false);
        this.stopType2Animation(false);
        this.stopType3Animation(false);

        const target = this.getViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        Tween.stopAllByTarget(target);
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);

        const baseScale = this.getViewBaseScale(target);
        tween(target)
            .to(0.18, { scale: this.getScaleByRatio(baseScale, 0.3) }, { easing: 'quadIn' })
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

    private cacheViewBaseScale() {
        const target = this.getViewNode();
        if (!target?.isValid || this.viewBaseScale) return;
        this.viewBaseScale = target.scale.clone();
    }

    private getViewBaseScale(target: Node): Vec3 {
        if (!this.viewBaseScale) {
            this.viewBaseScale = target.scale.clone();
        }
        return this.viewBaseScale;
    }

    private getScaleByRatio(baseScale: Vec3, ratio: number): Vec3 {
        return new Vec3(baseScale.x * ratio, baseScale.y * ratio, baseScale.z);
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
        let targetNode: Node | null = null;

        for (const child of view.children) {
            if (!/^type\d+$/.test(child.name)) continue;
            const shouldShow = child.name === targetName;
            child.active = shouldShow;
            hasTarget = hasTarget || shouldShow;
            if (shouldShow) targetNode = child;
        }

        if (!hasTarget && type !== this.defaultTipsType) {
            this.showTipsType(this.defaultTipsType);
            return;
        }

        this.stopType1Animation();
        this.stopType2Animation();
        this.stopType3Animation();
        if (type === 1 && targetNode) {
            this.playType1Animation(targetNode);
        } else if (type === 2 && targetNode) {
            this.playType2Animation(targetNode);
        } else if (type === 3 && targetNode) {
            this.playType3Animation(targetNode);
        }
    }

    private playType1Animation(typeNode: Node) {
        const finger = typeNode.getChildByName('finger');
        const locks = this.getType1Locks(typeNode);
        if (!finger?.isValid || locks.length === 0) return;

        const animatedNodes = [finger];
        for (const lock of locks) {
            animatedNodes.push(...this.getType1LockNodes(lock.lock), lock.tile);
            if (lock.helper) animatedNodes.push(lock.helper);
        }
        this.type1AnimatedNodes = Array.from(new Set(animatedNodes));
        this.resetType1AnimationNodes(locks, finger);

        const fingerState = this.getType1NodeState(finger);
        const steps: Tween<Node>[] = [
            tween(finger).call(() => this.resetType1AnimationNodes(locks, finger)),
            tween(finger).delay(0.2),
        ];

        for (let i = 0; i < locks.length; i++) {
            const lock = locks[i];
            const targetPos = this.getType1FingerTargetPosition(lock.helper || lock.tile, fingerState);
            const pressPos = new Vec3(
                targetPos.x + this.type1FingerPressOffset.x,
                targetPos.y + this.type1FingerPressOffset.y,
                targetPos.z,
            );
            const reboundPos = new Vec3(
                targetPos.x + this.type1FingerReboundOffset.x,
                targetPos.y + this.type1FingerReboundOffset.y,
                targetPos.z,
            );
            const pressScale = this.getScaleByRatio(fingerState.scale, 0.9);
            const reboundScale = this.getScaleByRatio(fingerState.scale, 1.05);

            steps.push(
                tween(finger).call(() => this.fadeNode(finger, 255, 0.12)),
                tween(finger).to(i === 0 ? 0.28 : 0.24, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).to(0.08, { position: pressPos, scale: pressScale }, { easing: 'sineIn' }),
                tween(finger).delay(0.04),
                tween(finger).call(() => this.playType1Unlock(lock)),
                tween(finger).to(0.18, { position: reboundPos, scale: reboundScale }, { easing: 'backOut' }),
                tween(finger).to(0.14, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).delay(i === locks.length - 1 ? 1.0 : 0.48),
            );
        }

        tween(finger)
            .sequence(...steps)
            .repeatForever()
            .start();
    }

    private getType1Locks(typeNode: Node): Type1Lock[] {
        const locks = typeNode.children
            .filter((child) => /^iron\d+$/i.test(child.name))
            .sort((a, b) => b.position.y - a.position.y);
        const mahjongs = typeNode.children.filter((child) => /^mahjong/i.test(child.name));
        const result: Type1Lock[] = [];

        for (const lock of locks) {
            const tile = mahjongs
                .slice()
                .sort((a, b) => {
                    const aDistance = Math.abs(a.position.x - lock.position.x) + Math.abs(a.position.y - lock.position.y);
                    const bDistance = Math.abs(b.position.x - lock.position.x) + Math.abs(b.position.y - lock.position.y);
                    return aDistance - bDistance;
                })[0];
            if (!tile) continue;

            const helper = mahjongs
                .filter((node) => node !== tile && node.position.x > tile.position.x)
                .sort((a, b) => Math.abs(a.position.y - tile.position.y) - Math.abs(b.position.y - tile.position.y))[0] || null;

            result.push({ lock, tile, helper });
        }

        return result.slice(0, 2);
    }

    private getType1LockNodes(lock: Node): Node[] {
        return [lock, ...lock.children];
    }

    private getType1FingerTargetPosition(tile: Node, fingerState: Type2NodeState): Vec3 {
        const tileState = this.getType1NodeState(tile);
        const tileTransform = tile.getComponent(UITransform);
        const tileWidth = tileTransform?.contentSize.width || 145;
        const tileHeight = tileTransform?.contentSize.height || 178;
        return new Vec3(
            tileState.position.x + tileWidth * Math.abs(tileState.scale.x) * 0.45,
            tileState.position.y - tileHeight * Math.abs(tileState.scale.y) * 0.34,
            fingerState.position.z,
        );
    }

    private playType1Unlock(lock: Type1Lock) {
        const lockState = this.getType1NodeState(lock.lock);
        const tileState = this.getType1NodeState(lock.tile);
        const helperState = lock.helper ? this.getType1NodeState(lock.helper) : null;
        const targetTile = lock.helper || lock.tile;
        const targetState = lock.helper && helperState ? helperState : tileState;
        const targetOpacity = this.getNodeOpacity(targetTile, true);

        this.stopType1TweenTargets(this.getType1LockNodes(lock.lock));
        this.stopType1TweenTargets([lock.tile]);
        if (lock.helper) this.stopType1TweenTargets([lock.helper]);

        this.restoreType1Node(lock.lock, lockState);
        for (const child of lock.lock.children) {
            this.restoreType1Node(child, this.getType1NodeState(child));
        }
        this.restoreType1Node(lock.tile, tileState);
        if (lock.helper && helperState) this.restoreType1Node(lock.helper, helperState);

        lock.lock.active = true;
        lock.tile.active = true;
        lock.lock.setSiblingIndex(lock.lock.parent ? Math.max(0, lock.lock.parent.children.length - 2) : lock.lock.getSiblingIndex());

        targetTile.active = true;
        targetTile.setSiblingIndex(targetTile.parent ? Math.max(0, targetTile.parent.children.length - 2) : targetTile.getSiblingIndex());
        targetOpacity.opacity = targetState.opacity;
        tween(targetTile)
            .to(0.08, { scale: this.getScaleByRatio(targetState.scale, 1.08) }, { easing: 'sineOut' })
            .to(0.24, {
                position: new Vec3(targetState.position.x + 18, targetState.position.y - 150, targetState.position.z),
                scale: this.getScaleByRatio(targetState.scale, 0.72),
            }, { easing: 'sineInOut' })
            .call(() => {
                if (targetTile?.isValid) targetTile.active = false;
            })
            .start();
        tween(targetOpacity)
            .delay(0.12)
            .to(0.2, { opacity: 0 }, { easing: 'quadOut' })
            .start();

        this.playType1IronUnlock(lock.lock, 0.18);

        if (targetTile !== lock.tile) {
            tween(lock.tile)
                .delay(0.52)
                .to(0.12, { scale: this.getScaleByRatio(tileState.scale, 1.08) }, { easing: 'sineOut' })
                .to(0.14, { scale: tileState.scale.clone() }, { easing: 'backOut' })
                .start();
        }
    }

    private playType1IronUnlock(lockNode: Node, startDelay = 0) {
        const lockState = this.getType1NodeState(lockNode);
        const sprite = lockNode.getChildByName('sprite');
        const shards = lockNode.children.filter((child) => /^iron\d+$/i.test(child.name));

        if (sprite?.isValid) {
            this.restoreType1Node(sprite, this.getType1NodeState(sprite));
            sprite.active = true;
        }
        for (const shard of shards) {
            this.restoreType1Node(shard, this.getType1NodeState(shard));
            shard.active = false;
        }

        tween(lockNode)
            .delay(startDelay + 0.08)
            .to(0.08, {
                scale: this.getScaleByRatio(lockState.scale, 1.08),
                eulerAngles: new Vec3(lockState.eulerAngles.x, lockState.eulerAngles.y, lockState.eulerAngles.z - 5),
            }, { easing: 'sineOut' })
            .call(() => {
                if (sprite?.isValid) sprite.active = false;
                for (let i = 0; i < shards.length; i++) {
                    this.playType1IronShardFly(shards[i], i, shards.length);
                }
            })
            .to(0.08, {
                scale: lockState.scale.clone(),
                eulerAngles: lockState.eulerAngles.clone(),
            }, { easing: 'sineInOut' })
            .delay(0.28)
            .call(() => {
                if (lockNode?.isValid) lockNode.active = false;
            })
            .start();
    }

    private playType1IronShardFly(shard: Node, index: number, total: number) {
        const state = this.getType1NodeState(shard);
        const opacity = this.getNodeOpacity(shard, true);
        Tween.stopAllByTarget(shard);
        Tween.stopAllByTarget(opacity);

        shard.active = true;
        shard.setPosition(state.position);
        shard.setScale(state.scale);
        shard.eulerAngles = state.eulerAngles.clone();
        opacity.opacity = state.opacity;

        const baseAngle = Math.atan2(state.position.y, state.position.x);
        const fallbackAngle = -Math.PI * 0.7 + (Math.PI * 1.4 * (index + 0.5)) / Math.max(1, total);
        const angle = Number.isFinite(baseAngle) && (Math.abs(state.position.x) + Math.abs(state.position.y) > 0.1)
            ? baseAngle
            : fallbackAngle;
        const distance = 34 + index * 8;
        const lift = 8 + index * 3;
        const spin = (index % 2 === 0 ? 1 : -1) * (24 + index * 10);
        const delay = index * 0.02;
        const endPos = new Vec3(
            state.position.x + Math.cos(angle) * distance,
            state.position.y + Math.sin(angle) * distance + lift,
            state.position.z,
        );

        tween(shard)
            .delay(delay)
            .to(0.1, { scale: this.getScaleByRatio(state.scale, 1.12) }, { easing: 'sineOut' })
            .to(0.24, {
                position: endPos,
                scale: this.getScaleByRatio(state.scale, 0.78),
                eulerAngles: new Vec3(state.eulerAngles.x, state.eulerAngles.y, state.eulerAngles.z + spin),
            }, { easing: 'quadOut' })
            .start();

        tween(opacity)
            .delay(delay + 0.08)
            .to(0.24, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (shard?.isValid) shard.active = false;
            })
            .start();
    }

    private resetType1AnimationNodes(locks: Type1Lock[], finger: Node) {
        const fingerState = this.getType1NodeState(finger);
        this.restoreType1Node(finger, fingerState);
        this.setNodeOpacity(finger, 0);
        finger.active = true;
        finger.setSiblingIndex(finger.parent ? finger.parent.children.length - 1 : finger.getSiblingIndex());

        for (const lock of locks) {
            this.restoreType1Node(lock.lock, this.getType1NodeState(lock.lock));
            for (const child of lock.lock.children) {
                this.restoreType1Node(child, this.getType1NodeState(child));
            }
            this.restoreType1Node(lock.tile, this.getType1NodeState(lock.tile));
            if (lock.helper) this.restoreType1Node(lock.helper, this.getType1NodeState(lock.helper));
        }

        finger.setSiblingIndex(finger.parent ? finger.parent.children.length - 1 : finger.getSiblingIndex());
    }

    private stopType1Animation(reset = true) {
        for (const node of this.type1AnimatedNodes) {
            if (!node?.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            if (reset) {
                const state = this.type1NodeStates.get(node);
                if (state) this.restoreType1Node(node, state);
            }
        }
        this.type1AnimatedNodes = [];
    }

    private stopType1TweenTargets(nodes: Node[]) {
        for (const node of nodes) {
            if (!node?.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
        }
    }

    private restoreType1Node(node: Node, state: Type2NodeState) {
        if (!node?.isValid) return;
        node.active = state.active;
        if (node.parent) node.setSiblingIndex(Math.min(state.siblingIndex, node.parent.children.length - 1));
        node.setPosition(state.position);
        node.setScale(state.scale);
        node.eulerAngles = state.eulerAngles.clone();
        this.setNodeOpacity(node, state.opacity);
    }

    private getType1NodeState(node: Node): Type2NodeState {
        let state = this.type1NodeStates.get(node);
        if (!state) {
            state = {
                position: node.position.clone(),
                scale: node.scale.clone(),
                eulerAngles: node.eulerAngles.clone(),
                opacity: this.getNodeOpacity(node, true)?.opacity ?? 255,
                active: node.active,
                siblingIndex: node.getSiblingIndex(),
            };
            this.type1NodeStates.set(node, state);
        }
        return state;
    }

    private playType2Animation(typeNode: Node) {
        const finger = typeNode.getChildByName('finger');
        const pairs = this.getType2Pairs(typeNode);
        if (!finger?.isValid || pairs.length === 0) return;

        const animatedNodes = [finger];
        for (const pair of pairs) {
            animatedNodes.push(pair.cover, pair.flip, pair.tile);
        }
        this.type2AnimatedNodes = Array.from(new Set(animatedNodes));
        this.resetType2AnimationNodes(pairs, finger);

        const fingerState = this.getType2NodeState(finger);
        const steps: Tween<Node>[] = [
            tween(finger).call(() => this.resetType2AnimationNodes(pairs, finger)),
            tween(finger).delay(0.2),
        ];

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const targetPos = this.getType2FingerTargetPosition(pair.cover, fingerState);
            const pressPos = new Vec3(
                targetPos.x + this.type2FingerPressOffset.x,
                targetPos.y + this.type2FingerPressOffset.y,
                targetPos.z,
            );
            const reboundPos = new Vec3(
                targetPos.x + this.type2FingerReboundOffset.x,
                targetPos.y + this.type2FingerReboundOffset.y,
                targetPos.z,
            );
            const pressScale = this.getScaleByRatio(fingerState.scale, 0.9);
            const reboundScale = this.getScaleByRatio(fingerState.scale, 1.05);

            steps.push(
                tween(finger).call(() => this.fadeNode(finger, 255, 0.12)),
                tween(finger).to(i === 0 ? 0.28 : 0.24, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).to(0.08, { position: pressPos, scale: pressScale }, { easing: 'sineIn' }),
                tween(finger).delay(0.04),
                tween(finger).call(() => this.playType2PairReveal(pair)),
                tween(finger).to(0.18, { position: reboundPos, scale: reboundScale }, { easing: 'backOut' }),
                tween(finger).to(0.14, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).delay(i === pairs.length - 1 ? 1.0 : 0.45),
            );
        }

        tween(finger)
            .sequence(...steps)
            .repeatForever()
            .start();
    }

    private getType2Pairs(typeNode: Node): Type2Pair[] {
        const flips = typeNode.children
            .filter((child) => /^flip\d+$/i.test(child.name))
            .sort((a, b) => b.position.y - a.position.y);
        const mahjongs = typeNode.children.filter((child) => /^mahjong/i.test(child.name));
        const pairs: Type2Pair[] = [];

        for (const flip of flips) {
            const rowCards = mahjongs
                .filter((node) => Math.abs(node.position.y - flip.position.y) <= 48)
                .sort((a, b) => Math.abs(a.position.y - flip.position.y) - Math.abs(b.position.y - flip.position.y));
            if (rowCards.length < 2) continue;

            const tile = rowCards
                .filter((node) => node.position.x >= flip.position.x - 8)
                .sort((a, b) => Math.abs(a.position.x - flip.position.x) - Math.abs(b.position.x - flip.position.x))[0]
                || rowCards[0];
            const cover = rowCards
                .filter((node) => node !== tile)
                .sort((a, b) => a.position.x - b.position.x)[0];
            if (!cover) continue;

            pairs.push({ cover, flip, tile });
        }

        return pairs.slice(0, 2);
    }

    private getType2FingerTargetPosition(tile: Node, fingerState: Type2NodeState): Vec3 {
        const tileState = this.getType2NodeState(tile);
        const tileTransform = tile.getComponent(UITransform);
        const tileWidth = tileTransform?.contentSize.width || 145;
        const tileHeight = tileTransform?.contentSize.height || 178;
        return new Vec3(
            tileState.position.x + tileWidth * Math.abs(tileState.scale.x) * 0.45,
            tileState.position.y - tileHeight * Math.abs(tileState.scale.y) * 0.34,
            fingerState.position.z,
        );
    }

    private playType2PairReveal(pair: Type2Pair) {
        const coverState = this.getType2NodeState(pair.cover);
        const flipState = this.getType2NodeState(pair.flip);
        const tileState = this.getType2NodeState(pair.tile);
        const coverOpacity = this.getNodeOpacity(pair.cover, true);
        const flipOpacity = this.getNodeOpacity(pair.flip, true);
        const tileOpacity = this.getNodeOpacity(pair.tile, true);

        Tween.stopAllByTarget(pair.cover);
        Tween.stopAllByTarget(pair.flip);
        Tween.stopAllByTarget(pair.tile);
        Tween.stopAllByTarget(coverOpacity);
        Tween.stopAllByTarget(flipOpacity);
        Tween.stopAllByTarget(tileOpacity);

        pair.tile.active = true;
        pair.flip.active = true;
        pair.cover.active = true;
        pair.cover.setSiblingIndex(pair.cover.parent ? Math.max(0, pair.cover.parent.children.length - 2) : pair.cover.getSiblingIndex());
        this.setNodeOpacity(pair.cover, coverState.opacity);
        this.setNodeOpacity(pair.flip, flipState.opacity);
        tileOpacity.opacity = tileState.opacity;
        pair.tile.setScale(new Vec3(0, tileState.scale.y, tileState.scale.z));

        tween(pair.cover)
            .to(0.08, { scale: this.getScaleByRatio(coverState.scale, 1.06) }, { easing: 'sineOut' })
            .to(0.24, {
                position: new Vec3(coverState.position.x + 78, coverState.position.y - 96, coverState.position.z),
                scale: this.getScaleByRatio(coverState.scale, 0.58),
            }, { easing: 'sineInOut' })
            .call(() => {
                if (pair.cover?.isValid) pair.cover.active = false;
            })
            .start();
        tween(coverOpacity)
            .delay(0.12)
            .to(0.18, { opacity: 0 }, { easing: 'quadOut' })
            .start();

        tween(pair.flip)
            .delay(0.2)
            .to(0.08, { scale: new Vec3(0, flipState.scale.y * 1.04, flipState.scale.z) }, { easing: 'sineIn' })
            .call(() => {
                if (pair.flip?.isValid) pair.flip.active = false;
            })
            .start();
        tween(flipOpacity)
            .delay(0.24)
            .to(0.04, { opacity: 0 }, { easing: 'quadOut' })
            .start();

        tween(pair.tile)
            .delay(0.28)
            .to(0.14, { scale: this.getScaleByRatio(tileState.scale, 1.06) }, { easing: 'backOut' })
            .to(0.08, { scale: tileState.scale.clone() }, { easing: 'sineInOut' })
            .start();
    }

    private resetType2AnimationNodes(pairs: Type2Pair[], finger: Node) {
        const fingerState = this.getType2NodeState(finger);
        this.restoreType2Node(finger, fingerState);
        this.setNodeOpacity(finger, 0);
        finger.active = true;
        finger.setSiblingIndex(finger.parent ? finger.parent.children.length - 1 : finger.getSiblingIndex());

        for (const pair of pairs) {
            const coverState = this.getType2NodeState(pair.cover);
            const flipState = this.getType2NodeState(pair.flip);
            const tileState = this.getType2NodeState(pair.tile);

            this.restoreType2Node(pair.cover, coverState);
            this.restoreType2Node(pair.flip, flipState);
            this.restoreType2Node(pair.tile, tileState);
            this.setNodeOpacity(pair.cover, coverState.opacity);
            this.setNodeOpacity(pair.flip, flipState.opacity);
            this.setNodeOpacity(pair.tile, 0);
            pair.cover.active = true;
            pair.flip.active = true;
            pair.tile.active = true;
        }
    }

    private stopType2Animation(reset = true) {
        for (const node of this.type2AnimatedNodes) {
            if (!node?.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            if (reset) {
                const state = this.type2NodeStates.get(node);
                if (state) this.restoreType2Node(node, state);
            }
        }
        this.type2AnimatedNodes = [];
    }

    private restoreType2Node(node: Node, state: Type2NodeState) {
        if (!node?.isValid) return;
        node.active = state.active;
        if (node.parent) node.setSiblingIndex(Math.min(state.siblingIndex, node.parent.children.length - 1));
        node.setPosition(state.position);
        node.setScale(state.scale);
        node.eulerAngles = state.eulerAngles.clone();
        this.setNodeOpacity(node, state.opacity);
    }

    private getType2NodeState(node: Node): Type2NodeState {
        let state = this.type2NodeStates.get(node);
        if (!state) {
            state = {
                position: node.position.clone(),
                scale: node.scale.clone(),
                eulerAngles: node.eulerAngles.clone(),
                opacity: this.getNodeOpacity(node, true)?.opacity ?? 255,
                active: node.active,
                siblingIndex: node.getSiblingIndex(),
            };
            this.type2NodeStates.set(node, state);
        }
        return state;
    }

    private fadeNode(node: Node, opacity: number, duration: number) {
        const nodeOpacity = this.getNodeOpacity(node, true);
        if (!nodeOpacity) return;
        Tween.stopAllByTarget(nodeOpacity);
        tween(nodeOpacity)
            .to(duration, { opacity }, { easing: 'sineOut' })
            .start();
    }

    private setNodeOpacity(node: Node, opacity: number) {
        const nodeOpacity = this.getNodeOpacity(node, true);
        if (nodeOpacity) nodeOpacity.opacity = opacity;
    }

    private getNodeOpacity(node: Node, createIfMissing: boolean): UIOpacity | null {
        return node.getComponent(UIOpacity) || (createIfMissing ? node.addComponent(UIOpacity) : null);
    }

    private playType3Animation(typeNode: Node) {
        const finger = typeNode.getChildByName('finger');
        const box = typeNode.getChildByName('box_1');
        const groups = this.getType3Groups(typeNode);
        if (!finger?.isValid || !box?.isValid || groups.length === 0) return;

        const animatedNodes = [finger, box];
        for (const group of groups) {
            animatedNodes.push(...group.tiles);
            if (group.chain) animatedNodes.push(group.chain);
        }
        this.type3AnimatedNodes = Array.from(new Set(animatedNodes));
        this.resetType3AnimationNodes(groups, finger, box);

        const fingerState = this.getType3NodeState(finger);
        const lastTapTileState = this.getType3NodeState(this.getType3TapTile(groups[groups.length - 1]));
        const fingerTapOffset = new Vec3(
            fingerState.position.x - lastTapTileState.position.x,
            fingerState.position.y - lastTapTileState.position.y,
            fingerState.position.z - lastTapTileState.position.z,
        );

        const steps: Tween<Node>[] = [
            tween(finger).call(() => this.resetType3AnimationNodes(groups, finger, box)),
            tween(finger).delay(0.2),
        ];
        const totalFlyTiles = groups.reduce((sum, group) => sum + group.tiles.length, 0);
        let nextBoxTileIndex = 0;

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const boxTileStartIndex = nextBoxTileIndex;
            nextBoxTileIndex += group.tiles.length;
            const tapTile = this.getType3TapTile(group);
            const targetPos = this.getType3FingerTargetPosition(tapTile, fingerState, fingerTapOffset);
            const pressPos = new Vec3(
                targetPos.x + this.type3FingerPressOffset.x,
                targetPos.y + this.type3FingerPressOffset.y,
                targetPos.z,
            );
            const reboundPos = new Vec3(
                targetPos.x + this.type3FingerReboundOffset.x,
                targetPos.y + this.type3FingerReboundOffset.y,
                targetPos.z,
            );
            const pressScale = this.getScaleByRatio(fingerState.scale, 0.9);
            const reboundScale = this.getScaleByRatio(fingerState.scale, 1.05);

            steps.push(
                tween(finger).call(() => this.fadeNode(finger, 255, 0.12)),
                tween(finger).to(i === 0 ? 0.28 : 0.24, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).to(0.08, { position: pressPos, scale: pressScale }, { easing: 'sineIn' }),
                tween(finger).delay(0.04),
                tween(finger).call(() => this.playType3GroupFly(group, box, boxTileStartIndex, totalFlyTiles)),
                tween(finger).to(0.18, { position: reboundPos, scale: reboundScale }, { easing: 'backOut' }),
                tween(finger).to(0.14, { position: targetPos, scale: fingerState.scale.clone() }, { easing: 'sineInOut' }),
                tween(finger).delay(i === groups.length - 1 ? 1.0 : 0.55),
            );
        }

        tween(finger)
            .sequence(...steps)
            .repeatForever()
            .start();
    }

    private getType3Groups(typeNode: Node): Type3Group[] {
        const mahjongs = typeNode.children
            .filter((child) => /^mahjong/i.test(child.name))
            .sort((a, b) => a.position.x - b.position.x);
        const chains = typeNode.children
            .filter((child) => /^chain\d+$/i.test(child.name))
            .sort((a, b) => a.position.x - b.position.x);
        const groups: Type3Group[] = [];

        for (let i = 0; i < mahjongs.length; i += 2) {
            const tiles = mahjongs.slice(i, i + 2);
            if (tiles.length < 2) continue;
            const chain = chains[Math.floor(i / 2)] || null;
            groups.push({
                tiles,
                chain,
            });
        }

        return groups.slice(0, 2);
    }

    private getType3TapTile(group: Type3Group): Node {
        return group.tiles
            .slice()
            .sort((a, b) => a.position.x - b.position.x)[0] || group.tiles[0];
    }

    private getType3FingerTargetPosition(tile: Node, fingerState: Type2NodeState, fingerTapOffset: Vec3): Vec3 {
        const tileState = this.getType3NodeState(tile);
        return new Vec3(
            tileState.position.x + fingerTapOffset.x,
            tileState.position.y + fingerTapOffset.y,
            fingerState.position.z,
        );
    }

    private playType3GroupFly(group: Type3Group, box: Node, boxTileStartIndex: number, totalFlyTiles: number) {
        const boxState = this.getType3NodeState(box);

        for (let i = 0; i < group.tiles.length; i++) {
            const node = group.tiles[i];
            const state = this.getType3NodeState(node);
            const opacity = this.getNodeOpacity(node, true);
            Tween.stopAllByTarget(node);
            Tween.stopAllByTarget(opacity);

            node.active = true;
            node.setSiblingIndex(node.parent ? Math.max(0, node.parent.children.length - 2) : node.getSiblingIndex());
            this.setNodeOpacity(node, state.opacity);

            const boxSlotIndex = boxTileStartIndex + i;
            const endTarget = this.getType3BoxTileTarget(box, boxState, state, boxSlotIndex, totalFlyTiles);

            tween(node)
                .to(0.08, { scale: this.getScaleByRatio(state.scale, 1.08) }, { easing: 'sineOut' })
                .to(0.28, { position: endTarget.position, scale: endTarget.scale }, { easing: 'sineInOut' })
                .start();

            tween(opacity)
                .to(0.12, { opacity: state.opacity }, { easing: 'sineOut' })
                .start();
        }

        if (group.chain) {
            this.playType3ChainFly(group.chain, group, box, boxState, boxTileStartIndex, totalFlyTiles);
        }
        this.playType3BoxPulse(box);
    }

    private getType3BoxTileTarget(box: Node, boxState: Type2NodeState, tileState: Type2NodeState, index: number, total: number): Type3BoxTarget {
        const marker = this.getType3BoxSlotMarkers(box)[index];
        if (marker) {
            return {
                position: new Vec3(
                    boxState.position.x + marker.position.x * boxState.scale.x,
                    boxState.position.y + marker.position.y * boxState.scale.y,
                    tileState.position.z,
                ),
                scale: new Vec3(
                    tileState.scale.x * Math.abs(marker.scale.x) * Math.abs(boxState.scale.x),
                    tileState.scale.y * Math.abs(marker.scale.y) * Math.abs(boxState.scale.y),
                    tileState.scale.z,
                ),
            };
        }

        const transform = box.getComponent(UITransform);
        const boxWidth = transform?.contentSize.width || 430;
        const clampedTotal = Math.max(1, total);
        const slotSpan = Math.min(boxWidth * 0.48, 210);
        const startX = boxState.position.x - slotSpan * 0.5;
        const stepX = clampedTotal > 1 ? slotSpan / (clampedTotal - 1) : 0;
        return {
            position: new Vec3(startX + stepX * index, boxState.position.y - 12, tileState.position.z),
            scale: this.getScaleByRatio(tileState.scale, this.type3BoxTileScaleRatio),
        };
    }

    private getType3BoxSlotMarkers(box: Node): Node[] {
        return box.children
            .filter((child) => /^item\d+$/i.test(child.name))
            .sort((a, b) => a.position.x - b.position.x);
    }

    private playType3ChainFly(chain: Node, group: Type3Group, box: Node, boxState: Type2NodeState, boxTileStartIndex: number, totalFlyTiles: number) {
        const state = this.getType3NodeState(chain);
        const opacity = this.getNodeOpacity(chain, true);
        Tween.stopAllByTarget(chain);
        Tween.stopAllByTarget(opacity);

        chain.active = true;
        chain.setSiblingIndex(chain.parent ? Math.max(0, chain.parent.children.length - 2) : chain.getSiblingIndex());
        this.setNodeOpacity(chain, state.opacity);

        const firstTileState = this.getType3NodeState(group.tiles[0]);
        const secondTileState = this.getType3NodeState(group.tiles[Math.max(0, group.tiles.length - 1)]);
        const firstEnd = this.getType3BoxTileTarget(box, boxState, firstTileState, boxTileStartIndex, totalFlyTiles).position;
        const secondEnd = this.getType3BoxTileTarget(box, boxState, secondTileState, boxTileStartIndex + Math.max(1, group.tiles.length - 1), totalFlyTiles).position;
        const endPos = new Vec3(
            (firstEnd.x + secondEnd.x) * 0.5,
            (firstEnd.y + secondEnd.y) * 0.5 + 10,
            state.position.z,
        );

        tween(chain)
            .to(0.08, { scale: this.getScaleByRatio(state.scale, 1.04) }, { easing: 'sineOut' })
            .to(0.28, { position: endPos, scale: this.getScaleByRatio(state.scale, 0.28) }, { easing: 'sineInOut' })
            .call(() => {
                if (chain?.isValid) chain.active = false;
            })
            .start();
        tween(opacity)
            .delay(0.2)
            .to(0.16, { opacity: 0 }, { easing: 'quadOut' })
            .start();
    }

    private playType3BoxPulse(box: Node) {
        const state = this.getType3NodeState(box);
        Tween.stopAllByTarget(box);
        tween(box)
            .delay(0.28)
            .to(0.08, { scale: this.getScaleByRatio(state.scale, 1.08) }, { easing: 'sineOut' })
            .to(0.12, { scale: state.scale.clone() }, { easing: 'backOut' })
            .start();
    }

    private resetType3AnimationNodes(groups: Type3Group[], finger: Node, box: Node) {
        const fingerState = this.getType3NodeState(finger);
        this.restoreType3Node(finger, fingerState);
        this.setNodeOpacity(finger, 0);
        finger.active = true;
        finger.setSiblingIndex(finger.parent ? finger.parent.children.length - 1 : finger.getSiblingIndex());

        this.restoreType3Node(box, this.getType3NodeState(box));

        for (const group of groups) {
            const nodes = group.chain ? [...group.tiles, group.chain] : group.tiles;
            for (const node of nodes) {
                this.restoreType3Node(node, this.getType3NodeState(node));
            }
        }
    }

    private stopType3Animation(reset = true) {
        for (const node of this.type3AnimatedNodes) {
            if (!node?.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            if (reset) {
                const state = this.type3NodeStates.get(node);
                if (state) this.restoreType3Node(node, state);
            }
        }
        this.type3AnimatedNodes = [];
    }

    private restoreType3Node(node: Node, state: Type2NodeState) {
        if (!node?.isValid) return;
        node.active = state.active;
        if (node.parent) node.setSiblingIndex(Math.min(state.siblingIndex, node.parent.children.length - 1));
        node.setPosition(state.position);
        node.setScale(state.scale);
        node.eulerAngles = state.eulerAngles.clone();
        this.setNodeOpacity(node, state.opacity);
    }

    private getType3NodeState(node: Node): Type2NodeState {
        let state = this.type3NodeStates.get(node);
        if (!state) {
            state = {
                position: node.position.clone(),
                scale: node.scale.clone(),
                eulerAngles: node.eulerAngles.clone(),
                opacity: this.getNodeOpacity(node, true)?.opacity ?? 255,
                active: node.active,
                siblingIndex: node.getSiblingIndex(),
            };
            this.type3NodeStates.set(node, state);
        }
        return state;
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

