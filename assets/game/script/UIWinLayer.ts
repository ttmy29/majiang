import { _decorator, Color, Component, director, Label, Node, sp, sys, tween, UIOpacity, UITransform, v3, Vec3, view } from 'cc';
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
    @property(Node)
    bgNode: Node = null!;
    @property(Node)
    effectNode1: Node = null!;
    @property(Node)
    effectNode2: Node = null!;
    @property(Node)
    effectNode3: Node = null!;

    start() {
        AudioManager.instance.playOneShot(AudioClipNames.game_win);
    }

    init(time: number = 0) {
        this.playOpenAnimation();
        this.rankLabel.string = "";
        this.showRankLabel(97.47, time);
        this.playLightBurst();
    }

    public playSingleAnimation() {
        // // 1. 注册动画完成监听器
        // this.skeleton.setCompleteListener((trackEntry: sp.spine.TrackEntry) => {
        //     // 获取当前播放完成的动画名称
        //     const animationName = trackEntry.animation ? trackEntry.animation.name : "";

        //     // 判断是否是你想要监听的那个动画
        //     if (animationName === 'open') {
        //         console.log('attack 动画播放了一次并完成了！');

        //         this.skeleton.animation = 'idle';
        //         this.skeleton.loop = true;
        //         this.skeleton.setCompleteListener(null);


        //     }
        // });

        // this.scheduleOnce(() => {
        //         this.skeleton.animation = 'idle';
        //         this.skeleton.loop = true;
        // }, 3.5);


        // 2. 播放动画
        // 参数依次为：trackIndex(轨道索引), animationName(动画名), loop(是否循环)
        // 注意：要监听“一次播放完成”，这里的 loop 必须设置为 false
        //this.skeleton.setAnimation(0, 'attack', false);
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
        //界面适配
        const visibleSize = view.getVisibleSize();
        const designSize = this.bgNode.getComponent(UITransform).contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.min(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));
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
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            //window.dnSDK?.track?.('SHARE', {target: 'APP_MESSAGE'});
            wx.shareAppMessage({
                title: "上头小游戏（15个好友在玩）",
                imageUrl: "https://sziaa-cdn.jinkezhexin.top/6dc992aeb0427213a3720f55584a9d92.png"
            });
        }
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


    public playLightBurst() {
        this.effectNode1.scale = v3(1, 1, 0);
        tween(this.effectNode1)
            .to(0.5, { scale:  v3(0.9, 0.6, 0) }, { easing: 'sineInOut' })
            .to(0.5, { scale:  v3(1, 1, 0) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
        this.effectNode2.scale = v3(0.5, 0.5, 0);
        tween(this.effectNode2)
            .delay(0.1)
            .to(0.5, { scale:  v3(1, 1, 0) }, { easing: 'sineInOut' })
            .start();
        this.effectNode3.getComponent(UIOpacity).opacity = 0;
        tween(this.effectNode3.getComponent(UIOpacity))
            .delay(0.2)
            .to(0.5, { opacity: 255 }, { easing: 'sineInOut' })
            .start();
    }

}
