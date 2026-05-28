import { _decorator, Color, Component, director, Label, Node, sp, tween, UIOpacity, Vec3 } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
const { ccclass, property } = _decorator;

@ccclass('UIWinLayer')
export class UIWinLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(sp.Skeleton)
    skeleton: sp.Skeleton = null!;
    @property(Label)
    rankLabel: Label = null!;

    start() {
        AudioManager.instance.playOneShot(AudioClipNames.game_win);
    }

    init(time: number = 0) {
        this.playOpenAnimation();
        this.rankLabel.string = "";
        this.showRankLabel(97.47, time);
    }

    public playSingleAnimation() {
        // 1. 注册动画完成监听器
        this.skeleton.setCompleteListener((trackEntry: sp.spine.TrackEntry) => {
            // 获取当前播放完成的动画名称
            const animationName = trackEntry.animation ? trackEntry.animation.name : "";

            // 判断是否是你想要监听的那个动画
            if (animationName === 'open') {
                console.log('attack 动画播放了一次并完成了！');

                this.skeleton.animation = 'idle';
                this.skeleton.loop = true;
                this.skeleton.setCompleteListener(null);


            }
        });

        // 2. 播放动画
        // 参数依次为：trackIndex(轨道索引), animationName(动画名), loop(是否循环)
        // 注意：要监听“一次播放完成”，这里的 loop 必须设置为 false
        this.skeleton.setAnimation(0, 'attack', false);
    }


    showRankLabel(rank: number, time: number) {
        const totalSec = Math.max(0, Math.floor(time));
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        this.rankLabel.string = `用时${minutes}分${seconds}秒，已超过${rank.toFixed(2)}%的玩家`;
        const uiOpacity = this.rankLabel.getComponent(UIOpacity);
        uiOpacity.opacity = 0;
        tween(uiOpacity)
            .delay(0.5)
            .to(1, { opacity: 255 }, { easing: 'sineOut' })
            .start();
    }

    private playOpenAnimation() {
        if (!this.node) return;

        const maskOpacity = this.maskNode
            ? (this.maskNode.getComponent(UIOpacity) ?? this.maskNode.addComponent(UIOpacity))
            : null;
        if (maskOpacity) maskOpacity.opacity = 0;

        const target = this.viewNode ?? this.node;

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
        if (!this.node) return;

        const target = this.viewNode ?? this.node;
        const maskOpacity = this.maskNode ? this.maskNode.getComponent(UIOpacity) : null;

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

    update(deltaTime: number) {

    }

    protected onLoad(): void {
        this.playSingleAnimation();
    }

    protected onDestroy(): void {

    }

    protected onEnable(): void {

    }

    onButonCloseClick() {
        AudioManager.instance.playClick();
        this.playCloseAnimation();
    }

    onButtonShareClick() {
        AudioManager.instance.playClick();

    }

    onButtonNextLevelClick() {
        AudioManager.instance.playClick();
        director.emit(Constants.eventNames.EventWinNextLevel);
        this.playCloseAnimation();
    }

    OnBtoonGoHomeClick() {
        AudioManager.instance.playClick();
        this.onButonCloseClick();
        // 胜利时 winLevel 已经 saveLevel(next)+clearSnapshot,这里直接返主菜单即可
        LayerManager.instance.showStartLayer();
    }
}
