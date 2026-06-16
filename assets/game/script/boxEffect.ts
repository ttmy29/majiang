import { _decorator, Component, Node, Sprite, SpriteFrame, tween, Tween, UIOpacity, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('boxEffect')
export class boxEffect extends Component {
    private static readonly BOX1_MIN_OPACITY = 80;
    private static readonly BOX2_MOVE_Y = 80;
    private static readonly BOX2_MOVE_DURATION = 0.8;
    private static readonly BOX2_LOOP_DELAY = 0.2;
    private hasStarted = false;
    private box2StartPosition: Vec3 | null = null;
    private currentLevelIndex = -1;


    @property(Node)
    private box1: Node = null!;
    @property(Node)
    private box2: Node = null!;
    @property(Node)
    private box3: Node = null!;
    @property({ type: [SpriteFrame] })
    public box1SpriteArr: SpriteFrame[] = [];
    @property({ type: [SpriteFrame] })
    public box2SpriteArr: SpriteFrame[] = [];
    @property({ type: [SpriteFrame] })
    public box3SpriteArr: SpriteFrame[] = [];

    start() {
        this.hasStarted = true;
        this.restartEffects();
    }

    protected onEnable(): void {
        if (this.hasStarted) {
            this.restartEffects();
        }
    }

    protected onDisable(): void {
        console.log("boxEffect onDisable")
        this.stopEffects();
    }

    update(deltaTime: number) {

    }

    public setEffectLevel(index: number): void {
        const maxIndex = Math.max(
            this.box1SpriteArr.length,
            this.box2SpriteArr.length,
            this.box3SpriteArr.length,
        ) - 1;
        if (maxIndex < 0) return;

        const nextIndex = Math.max(0, Math.min(index, maxIndex));
        this.currentLevelIndex = nextIndex;
        this.applySpriteFrame(this.box1, this.box1SpriteArr[nextIndex]);
        this.applySpriteFrame(this.box3, this.box2SpriteArr[nextIndex]);
        this.applySpriteFrame(this.box2, this.box3SpriteArr[nextIndex]);

        if (this.node.activeInHierarchy && this.hasStarted) {
            this.restartEffects();
        }
    }

    private applySpriteFrame(node: Node, frame: SpriteFrame | undefined): void {
        if (!node?.isValid || !frame) return;
        const sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
        sprite.spriteFrame = frame;
    }

    private playEffects(): void {
        if (this.currentLevelIndex >= 0) {
            this.applySpriteFrame(this.box1, this.box1SpriteArr[this.currentLevelIndex]);
            this.applySpriteFrame(this.box3, this.box2SpriteArr[this.currentLevelIndex]);
            this.applySpriteFrame(this.box2, this.box3SpriteArr[this.currentLevelIndex]);
        }
        if (this.box3?.isValid) this.box3.active = true;
        this.playBox1Blink();
        this.playBox2Float();
    }

    private restartEffects(): void {
        this.stopEffects();
        this.playEffects();
    }

    private playBox1Blink(): void {
        if (!this.box1?.isValid) return;

        this.box1.active = true;
        const opacity = this.box1.getComponent(UIOpacity) || this.box1.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 255;

        tween(opacity)
            .to(0.45, { opacity: boxEffect.BOX1_MIN_OPACITY }, { easing: 'sineInOut' })
            .to(0.45, { opacity: 255 }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private playBox2Float(): void {
        if (!this.box2?.isValid) return;

        this.box2.active = true;
        if (!this.box2StartPosition) {
            this.box2StartPosition = this.box2.position.clone();
        }
        const startPosition = this.box2StartPosition.clone();
        const endPosition = new Vec3(startPosition.x, startPosition.y + boxEffect.BOX2_MOVE_Y, startPosition.z);
        const opacity = this.box2.getComponent(UIOpacity) || this.box2.addComponent(UIOpacity);

        Tween.stopAllByTarget(this.box2);
        Tween.stopAllByTarget(opacity);
        this.box2.setPosition(startPosition);
        opacity.opacity = 255;

        tween(this.box2)
            .set({ position: startPosition })
            .to(boxEffect.BOX2_MOVE_DURATION, { position: endPosition }, { easing: 'sineOut' })
            .delay(boxEffect.BOX2_LOOP_DELAY)
            .union()
            .repeatForever()
            .start();

        tween(opacity)
            .set({ opacity: 255 })
            .to(boxEffect.BOX2_MOVE_DURATION, { opacity: 0 }, { easing: 'sineIn' })
            .delay(boxEffect.BOX2_LOOP_DELAY)
            .union()
            .repeatForever()
            .start();
    }

    private stopEffects(): void {
        if (this.box1?.isValid) {
            Tween.stopAllByTarget(this.box1);
            const opacity = this.box1.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
            }
        }

        if (this.box2?.isValid) {
            Tween.stopAllByTarget(this.box2);
            if (this.box2StartPosition) this.box2.setPosition(this.box2StartPosition);
            const opacity = this.box2.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
            }
        }
    }
}
