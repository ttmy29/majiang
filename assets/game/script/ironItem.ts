import { _decorator, Component, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
const { ccclass } = _decorator;

interface ShardState {
    position: Vec3;
    scale: Vec3;
    eulerAngles: Vec3;
}

@ccclass('ironItem')
export class ironItem extends Component {
    private spriteNode: Node | null = null;
    private shardNodes: Node[] = [];
    private shardStates: Map<Node, ShardState> = new Map();
    private unlocked = false;

    onLoad() {
        this.ensureNodes();
        this.resetLocked();
    }

    resetLocked() {
        this.ensureNodes();
        this.unlocked = false;
        this.node.active = true;
        this.stopTweens();

        if (this.spriteNode?.isValid) {
            this.spriteNode.active = true;
            this.resetVisual(this.spriteNode);
        }
        for (const shard of this.shardNodes) {
            if (!shard?.isValid) continue;
            shard.active = false;
            this.resetShardVisual(shard);
        }
    }

    playUnlock(done?: () => void) {
        this.ensureNodes();
        if (this.unlocked) {
            done?.();
            return;
        }
        this.unlocked = true;
        this.stopTweens();

        if (this.spriteNode?.isValid) {
            this.spriteNode.active = false;
        }

        const shards = this.shardNodes.filter((node) => !!node?.isValid);
        if (shards.length === 0) {
            this.playFallbackUnlock(done);
            return;
        }

        let remaining = shards.length;
        const finishShard = () => {
            remaining -= 1;
            if (remaining <= 0) done?.();
        };

        for (let i = 0; i < shards.length; i++) {
            this.playShardUnlock(shards[i], i, shards.length, finishShard);
        }
    }

    private resetVisual(node: Node) {
        node.setScale(1, 1, 1);
        node.eulerAngles = new Vec3(0, 0, 0);
        const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        opacity.opacity = 255;
    }

    private resetShardVisual(node: Node) {
        const state = this.getShardState(node);
        node.setPosition(state.position);
        node.setScale(state.scale);
        node.eulerAngles = state.eulerAngles.clone();
        const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        opacity.opacity = 255;
    }

    private playShardUnlock(node: Node, index: number, total: number, done: () => void) {
        this.resetShardVisual(node);
        node.active = true;

        const state = this.getShardState(node);
        const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        opacity.opacity = 255;

        const baseAngle = Math.atan2(state.position.y, state.position.x);
        const fallbackAngle = -Math.PI * 0.72 + (Math.PI * 1.44 * (index + 0.5)) / Math.max(1, total);
        const angle = Number.isFinite(baseAngle) && (Math.abs(state.position.x) + Math.abs(state.position.y) > 0.1)
            ? baseAngle
            : fallbackAngle;
        const distance = 34 + index * 9;
        const delay = index * 0.025;
        const lift = 10 + index * 3;
        const spin = (index % 2 === 0 ? 1 : -1) * (28 + index * 12);

        const midPos = new Vec3(
            state.position.x + Math.cos(angle) * distance * 0.38,
            state.position.y + Math.sin(angle) * distance * 0.38 + lift * 0.45,
            state.position.z,
        );
        const endPos = new Vec3(
            state.position.x + Math.cos(angle) * distance,
            state.position.y + Math.sin(angle) * distance + lift,
            state.position.z,
        );
        const popScale = new Vec3(state.scale.x * 1.12, state.scale.y * 1.12, state.scale.z);
        const endScale = new Vec3(state.scale.x * 0.78, state.scale.y * 0.78, state.scale.z);

        tween(node)
            .delay(delay)
            .to(0.1, {
                position: midPos,
                scale: popScale,
                eulerAngles: new Vec3(state.eulerAngles.x, state.eulerAngles.y, state.eulerAngles.z + spin * 0.35),
            }, { easing: 'sineOut' })
            .to(0.24, {
                position: endPos,
                scale: endScale,
                eulerAngles: new Vec3(state.eulerAngles.x, state.eulerAngles.y, state.eulerAngles.z + spin),
            }, { easing: 'quadOut' })
            .start();

        tween(opacity)
            .delay(delay + 0.08)
            .to(0.24, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (node?.isValid) node.active = false;
                done();
            })
            .start();
    }

    private playFallbackUnlock(done?: () => void) {
        this.resetVisual(this.node);
        const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        tween(this.node)
            .to(0.12, { scale: new Vec3(1.18, 1.18, 1) }, { easing: 'sineOut' })
            .to(0.14, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
            .start();
        tween(opacity)
            .delay(0.08)
            .to(0.18, { opacity: 0 })
            .call(() => done?.())
            .start();
    }

    private ensureNodes() {
        if (!this.spriteNode?.isValid) this.spriteNode = this.node.getChildByName('sprite');
        this.shardNodes = this.node.children.filter((child) => /^iron\d+$/i.test(child.name));
        for (const shard of this.shardNodes) {
            this.getShardState(shard);
        }
    }

    private getShardState(node: Node): ShardState {
        let state = this.shardStates.get(node);
        if (!state) {
            state = {
                position: node.position.clone(),
                scale: node.scale.clone(),
                eulerAngles: node.eulerAngles.clone(),
            };
            this.shardStates.set(node, state);
        }
        return state;
    }

    private stopTweens() {
        Tween.stopAllByTarget(this.node);
        if (this.spriteNode?.isValid) Tween.stopAllByTarget(this.spriteNode);
        for (const shard of this.shardNodes) {
            if (!shard?.isValid) continue;
            Tween.stopAllByTarget(shard);
        }

        const rootOpacity = this.node.getComponent(UIOpacity);
        if (rootOpacity) Tween.stopAllByTarget(rootOpacity);
        const spriteOpacity = this.spriteNode?.getComponent(UIOpacity);
        if (spriteOpacity) Tween.stopAllByTarget(spriteOpacity);
        for (const shard of this.shardNodes) {
            const opacity = shard?.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
        }
    }
}
