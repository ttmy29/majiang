import { _decorator, Component, Node, sys, UITransform, Vec3, view } from 'cc';
import { ensureLevelJson, resolveLevelLoadOptions, warmupForwardWindow } from './config/LevelJsonLoader';
import { AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';

// 声明 wx 全局变量避免 TS 报错
declare const wx: any;

const { ccclass, property } = _decorator;

@ccclass('UIStartLayer')
export class UIStartLayer extends Component {

    @property(Node)
    bgNode: Node = null!;
    @property(Node)
    gameClubButton: Node = null!;
    @property(Node)
    customerServiceButton: Node = null!;

    private enteringGame = false;

    // 保存微信原生按钮的实例引用，方便后续显示/隐藏/销毁
    private wxGameClubBtn: any = null;
    private wxFeedbackBtn: any = null;

    protected onLoad(): void {
        // Adapt the start screen background to the current viewport.
        const visibleSize = view.getVisibleSize();
        const designSize = this.bgNode.getComponent(UITransform).contentSize;
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;
        const maxScale = Math.max(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));
    }

    protected onEnable(): void {
        this.enteringGame = false;
        this.refreshWarmupWindow();

        // 界面显示时，展示微信原生按钮
        if (this.wxGameClubBtn) this.wxGameClubBtn.show();
        if (this.wxFeedbackBtn) this.wxFeedbackBtn.show();
    }

    protected onDisable(): void {
        // 界面隐藏时，必须隐藏微信原生按钮，否则会穿透到游戏层
        if (this.wxGameClubBtn) this.wxGameClubBtn.hide();
        if (this.wxFeedbackBtn) this.wxFeedbackBtn.hide();
    }

    protected onDestroy(): void {
        // 节点销毁时，彻底销毁微信原生按钮
        if (this.wxGameClubBtn) this.wxGameClubBtn.destroy();
        if (this.wxFeedbackBtn) this.wxFeedbackBtn.destroy();
    }

    start() {
        this.refreshWarmupWindow();
        this.scheduleOnce(() => {
            window.dnSDK?.track?.('LOAD_FINISH', {});
        }, 0);

        // 初始化微信相关按钮
        if (sys.platform === sys.Platform.WECHAT_GAME && typeof wx !== 'undefined') {
            this.initWeChatButtons();
        }
    }

    update(deltaTime: number) {

    }

    // --- 微信按钮辅助逻辑 ---
    private initWeChatButtons() {
        if (this.gameClubButton) {
            this.wxGameClubBtn = this.createTransparentWeChatBtn(this.gameClubButton, 'gameClub');
        }
        if (this.customerServiceButton) {
            this.wxFeedbackBtn = this.createTransparentWeChatBtn(this.customerServiceButton, 'feedback');
        }
    }

    /**
     * 将 Cocos 节点坐标转换为微信屏幕坐标，并创建透明覆盖按钮
     */
    private createTransparentWeChatBtn(targetNode: Node, type: 'gameClub' | 'feedback') {
        const uiTrans = targetNode.getComponent(UITransform);
        if (!uiTrans) {
            console.warn(`UIStartLayer: targetNode ${targetNode.name} is missing UITransform`);
            return null;
        }

        // 1. 获取 Cocos 节点在世界坐标系下的位置和尺寸
        const worldPos = uiTrans.convertToWorldSpaceAR(new Vec3(0, 0, 0));
        const width = uiTrans.contentSize.width;
        const height = uiTrans.contentSize.height;
        const anchorX = uiTrans.anchorPoint.x;
        const anchorY = uiTrans.anchorPoint.y;

        // 2. 获取屏幕和视图比例数据
        const visibleSize = view.getVisibleSize(); // Cocos 视窗分辨率
        const frameSize = view.getFrameSize();     // 设备实际屏幕物理分辨率
        const ratioW = frameSize.width / visibleSize.width;
        const ratioH = frameSize.height / visibleSize.height;

        // 3. 计算微信所需的左上角绝对坐标 (微信坐标系左上角为 0,0)
        const left = (worldPos.x - width * anchorX) * ratioW;
        // Cocos Y轴从下往上，微信 Y轴从上往下，需要反转
        const top = frameSize.height - (worldPos.y + height * (1 - anchorY)) * ratioH;
        const btnWidth = width * ratioW;
        const btnHeight = height * ratioH;

        // 4. 定义透明按钮样式
        const style = {
            left: left,
            top: top,
            width: btnWidth,
            height: btnHeight,
            backgroundColor: '#00000000', // 完全透明
            color: '#00000000',
            textAlign: 'center'
        };

        // 5. 根据类型创建对应的微信原生按钮
        if (type === 'gameClub') {
            return wx.createGameClubButton({
                type: 'text', // 使用文字类型并设为空，配合透明背景做隐形点击区
                text: '',
                style: style
            });
        } else if (type === 'feedback') {
            return wx.createFeedbackButton({
                type: 'text',
                text: '',
                style: style
            });
        }
    }
    // ----------------------

    // 点击开始游戏
    async onClickStartButton() {
        AudioManager.instance.playClick();
        if (this.enteringGame) return;

        this.enteringGame = true;
        try {
            const level = ProgressManager.loadLevel();
            const opts = resolveLevelLoadOptions(level);
            const json = await ensureLevelJson(level, opts);
            if (!json) {
                console.warn(`UIStartLayer: no level JSON ready for level ${level}`);
                return;
            }
            LayerManager.instance.showGameLayer();
        } finally {
            this.enteringGame = false;
        }
    }

    onClickSetButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("setting");
    }

    onClickGameClubButton() {
        AudioManager.instance.playClick();
    }

    onClickFeedbackButton() {
        AudioManager.instance.playClick();
    }

    private refreshWarmupWindow() {
        const level = ProgressManager.loadLevel();
        void warmupForwardWindow(level, 10);
    }
}
