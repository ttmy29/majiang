import { _decorator, Component, Node, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Mingpig')
export class Mingpig extends Component {

    /** 摇摆角度（正负，默认 15°） */
    @property
    public shakeAngle: number = 15;

    /** 单次摇摆时长（秒，默认 0.2） */
    @property
    public shakeDuration: number = 0.2;

    /** 摇完后的停留时长（秒，默认 2） */
    @property
    public stopDuration: number = 2;

    /** 摇摆时的放大倍数（默认 1.1） */
    @property
    public shakeScale: number = 1.1;

    start() {
        this._StartShake();
    }

    private _StartShake() {
        const originAngle = 0;
        const left = this.shakeAngle;
        const right = -this.shakeAngle;
        const dur = this.shakeDuration;
        const stop = this.stopDuration;
        const big = this.shakeScale;
        const originScale = 1;

        tween(this.node)
            .sequence(
                // 快速放大
                tween().to(dur * 0.5, { scale: new Vec3(big, big, 1) }),
                // 放大状态下摇两下
                tween().to(dur, { angle: left }),
                tween().to(dur, { angle: right }),
                tween().to(dur, { angle: left }),
                tween().to(dur, { angle: right }),
                tween().to(dur, { angle: originAngle }),
                // 缩小回原大小
                tween().to(dur * 0.5, { scale: new Vec3(originScale, originScale, 1) }),
                tween().delay(stop),
            )
            .repeatForever()
            .start();
    }

    onDestroy() {
        tween(this.node).stop();
    }
}
