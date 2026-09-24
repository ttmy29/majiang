import { _decorator, assetManager, Component, director, EventMouse, Node, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
import { StorageKey, StorageManager } from './manager/StorageManager';
import { ProgressManager } from './manager/ProgressManager';
import { Utils } from './util/Utils';
import { getCurrentGameMode } from './config/GameMode';
import { Constants } from './config/Constants';
import { clearLevelBundleCaches } from './config/LevelJsonLoader';
import { UigmLayer } from './UigmLayer';
const { ccclass, property } = _decorator;

const GM_TAP_WINDOW_MS = 2000;
const GM_TAP_THRESHOLD = 9;

@ccclass('UISetingLayer')
export class UISetingLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;

    opentype: number = 0;
    private isClearingCache = false;
    private onQuit: (() => void) | null = null;
    private isClosing = false;
    private gmTriggerNode: Node | null = null;
    private gmTapTimes: number[] = [];
    private gmTriggered = false;

    start() {

    }

    init(opentype: number, onQuit?: () => void) {
        //console.log('UISetingLayer.init', opentype);
        this.opentype = opentype;
        this.onQuit = typeof onQuit === 'function' ? onQuit : null;

        // opentype === 1 时才显示 viewNode 下的 button 节点
        const buttonNode = this.viewNode?.getChildByName('Game_frame')?.getChildByName('button');
        const releaseNode = this.viewNode?.getChildByName('Game_frame')?.getChildByName('release');
        if (opentype === 1) {
            buttonNode.active = true;
            releaseNode.active = false
        } else {
            buttonNode.active = false;
            releaseNode.active = true
        }
        this.configureGmTrigger(opentype === 1 && !this.onQuit, buttonNode);

        this.applySavedSettings();
        this.playOpenAnimation();
    }

    private applySavedSettings() {
        const audioSet = this.viewNode?.getChildByName('Game_frame')?.getChildByName('audioSet');
        if (!audioSet) return;

        this.applySwitchState(audioSet.getChildByName('music'), StorageKey.Music);
        this.applySwitchState(audioSet.getChildByName('audio'), StorageKey.Audio);
        this.applySwitchState(audioSet.getChildByName('vibrate'), StorageKey.Vibrate);
    }

    private applySwitchState(switchNode: Node | null, key: StorageKey) {
        if (!switchNode) return;
        const isOn = StorageManager.instance.getBoolean(key, true);
        const dakai = switchNode.getChildByName('dakai_1');
        const guanbi = switchNode.getChildByName('guanbi_1');
        if (dakai) dakai.active = isOn;
        if (guanbi) guanbi.active = !isOn;
    }
    private playOpenAnimation() {
        if (!this.node) return;

        const maskOpacity = this.maskNode
            ? (this.maskNode.getComponent(UIOpacity) ?? this.maskNode.addComponent(UIOpacity))
            : null;
        if (maskOpacity) maskOpacity.opacity = 0;

        const target = this.viewNode ?? this.node;

        target.setScale(new Vec3(0.3, 0.3, 1));

        // 【修改】：手动分成两段。
        // 前 0.35 秒舒缓地放大到 1.05（略微超出）
        // 后 0.15 秒轻轻地收缩回 1
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

    private playCloseAnimation(onClosed?: () => void) {
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        const target = this.viewNode ?? this.node;
        const maskOpacity = this.maskNode ? this.maskNode.getComponent(UIOpacity) : null;

        // 压缩到 0.18 秒，直接缩回 0.3
        tween(target)
            .to(0.18, { scale: new Vec3(0.3, 0.3, 1) }, { easing: 'quadIn' })
            .call(() => {
                this.node.destroy();
                onClosed?.();
            })
            .start();

        // 遮罩同步在 0.18 秒内快速淡出，不拖泥带水
        if (maskOpacity) {
            tween(maskOpacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }
    }
    update(deltaTime: number) {

    }
    protected onLoad(): void {

    }

    protected onDestroy(): void {
        this.gmTriggerNode = null;
        this.gmTapTimes.length = 0;
    }

    protected onEnable(): void {

    }

    private configureGmTrigger(enabled: boolean, buttonNode: Node | null): void {
        if (this.gmTriggerNode?.isValid) {
            this.gmTriggerNode.off(Node.EventType.TOUCH_END, this.onGmTriggerTouchEnd, this);
            this.gmTriggerNode.destroy();
        }
        this.gmTriggerNode = null;
        this.gmTapTimes.length = 0;
        this.gmTriggered = false;

        if (!enabled || !buttonNode) return;

        const trigger = new Node('gmTrigger');
        trigger.layer = buttonNode.layer;
        trigger.setPosition(0, 168.57, 0);
        trigger.addComponent(UITransform).setContentSize(200, 200);
        buttonNode.addChild(trigger);
        trigger.on(Node.EventType.TOUCH_END, this.onGmTriggerTouchEnd, this);
        this.gmTriggerNode = trigger;
    }

    private onGmTriggerTouchEnd(): void {
        if (this.gmTriggered || this.isClosing) return;

        const now = Date.now();
        this.gmTapTimes = this.gmTapTimes.filter((tapTime) => now - tapTime <= GM_TAP_WINDOW_MS);
        this.gmTapTimes.push(now);
        if (this.gmTapTimes.length < GM_TAP_THRESHOLD) return;

        this.gmTriggered = true;
        this.gmTapTimes.length = 0;
        this.playCloseAnimation(() => {
            if (!UigmLayer.show()) LayerManager.instance.showToast('GM 面板打开失败');
        });
    }

    onButtonSwichtClick(event: EventMouse, data: string) {
        AudioManager.instance.playClick();
        const targetNode = event.target as Node;
        const willOpen = !targetNode.getChildByName("dakai_1").active;
        targetNode.getChildByName("dakai_1").active = willOpen;
        targetNode.getChildByName("guanbi_1").active = !willOpen;

        switch (targetNode.name) {
            case 'music':
                AudioManager.instance.setMusicEnabled(willOpen);
                break;
            case 'audio':
                AudioManager.instance.setEffectEnabled(willOpen);
                break;
            case 'vibrate':
                Utils.setVibrateEnabled(willOpen);
                break;
        }
    }

    onButonCloseClick() {
        AudioManager.instance.playClick();
        this.playCloseAnimation();
    }

    onButtonQuitClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        // 独立玩法自行处理退出，不发送主线放弃事件或清除主线存档。
        if (this.onQuit) {
            this.playCloseAnimation(this.onQuit);
            return;
        }
        this.onButonCloseClick();
        // 设置面板里的"退出游戏" = 主动放弃本局 → 清掉中途快照
        if (getCurrentGameMode() === 'activity') {
            ProgressManager.clearActivitySnapshot();
        } else {
            director.emit(Constants.eventNames.EventMainLevelGiveUp);
            ProgressManager.clearSnapshot();
        }
        LayerManager.instance.showStartLayer();
    }


    onButtonReleaseClick() {
        if (this.isClearingCache) return;
        this.isClearingCache = true;

        AudioManager.instance.playClick();
        try {
            // 清理关卡 JSON、索引和三个关卡 Bundle 的运行时缓存。
            clearLevelBundleCaches();

            // 非 Web 平台（如微信小游戏）才有文件缓存管理器；不会清除 sys.localStorage 中的玩家存档。
            const cacheManager = assetManager.cacheManager;
            if (cacheManager) {
                cacheManager.clearCache();
                LayerManager.instance.showToast('缓存已清理');
            } else {
                // Web 预览的网络缓存由浏览器管理，此处只能清理关卡运行时缓存。
                console.warn('UISetingLayer: cacheManager is unavailable on the current platform');
                LayerManager.instance.showToast('运行缓存已清理');
            }
        } catch (err) {
            console.warn('UISetingLayer: clear level cache failed', err);
            LayerManager.instance.showToast('缓存清理失败，请重试');
            this.isClearingCache = false;
            return;
        }

        this.playCloseAnimation();
    }

}
