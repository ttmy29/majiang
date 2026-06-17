import { _decorator, Animation, AnimationClip, assetManager, builtinResMgr, Button, Color, Component, director, Graphics, instantiate, Label, Material, Node, Prefab, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, v3, Vec3, view, Widget } from 'cc';
import { Constants } from './config/Constants';
import { LayerManager } from './manager/LayerManager';
import { MahjongItem } from './MahjongItem';
import { AudioManager, AudioClipNames } from './manager/AudioManager';
import { boxEffect } from './boxEffect';
const { ccclass, property } = _decorator;

interface HudPayload {
    remain: number;
    total: number;
    slots: number;
    slotCap: number;
    hasTimer: boolean;
    timeSec: number;
    comboTimes: number;
    comboActive: boolean;
}

interface ToastPayload {
    msg: string;
    seconds: number;
}

interface GameUiInitPayload {
    mahjongItem: Prefab;
    iconFrames: Map<string, SpriteFrame>;
}

interface RenderSlotPayload {
    slotID: number;
    unlocked: boolean;
    type: string;
    progress: number;
    required: number;
    refreshing: boolean;
}

interface ClearSlotPayload {
    slotID: number;
}

interface ResetSlotsPayload {
    targetBoxStates: { slotID: number; unlocked: boolean }[];
}

interface ShuffleTileEffectPayload {
    worldPosition: Vec3;
    scale?: number;
    duration?: number;
}

@ccclass('UIGameLayer')
export class UIGameLayer extends Component {
    @property(Node)
    slotNodeArr: Node[] = []!;
    //撤回按钮
    @property(Node)
    undoButton: Node = null!;
    //换牌按钮
    @property(Node)
    switchButton: Node = null!;
    //解锁盒子按钮
    @property(Node)
    unlockButton: Node = null!;
    //随机道具按钮
    @property(Node)
    randomPropButton: Node = null!;
    @property(Node)
    unlockTipsNode: Node = null!;
    @property(Node)
    switchTipsNode: Node = null!;
    @property(Node)
    randomPropTipsNode: Node = null!;
    @property(Node)
    comboNode: Node = null!;
    @property(Node)
    comboLabelNode: Node = null!;
    @property(Node)
    bgNode: Node = null!;

    // 每个槽位在场景里的原始位置，MoveIn 时回到自己的原点而不是写死坐标
    private slotOriginPositions: Vec3[] = [];
    private propButtonOriginPositions: Vec3[] = [];

    // HUD label —— 由 GameCtrl emit EventHudUpdate / EventShowToast 触发渲染
    private targetLabel: Label = null!;
    private statusLabel: Label = null!;

    private toastLabel: Label = null!;

    // comboNode 下的进度条 fill 节点和连击计数文本
    private comboBarSprite: Sprite = null!;
    private comboCountLabel: Label = null!;
    private comboLevelNodes: Node[] = [];
    private comboLevelOriginPositions: Vec3[] = [];
    private comboLevelOriginScales: Vec3[] = [];
    private comboLevelOpacities: UIOpacity[] = [];
    private comboNodeOriginScale: Vec3 = new Vec3(1, 1, 1);
    private comboRefreshSeq = 0;
    // 当前已经播放到的连击口号下标(0~7),combo 中断或窗口到期时清零
    private comboAudioLevel = 0;
    // 每 3 次连击解锁下一级口号,与 COMBO_AUDIOS 长度对应,超过 7 后不再升级
    private static readonly COMBO_STEP = 3;
    // 连击展示进度条时长（秒）。计数由 GameCtrl 持续累加,这里仅控制 UI 隐藏节奏。
    private static readonly COMBO_DURATION = 2;
    private static readonly COMBO_AUDIOS: { audio: AudioClipNames }[] = [
        { audio: AudioClipNames.combo_level1 },
        { audio: AudioClipNames.combo_level2 },
        { audio: AudioClipNames.combo_level3 },
        { audio: AudioClipNames.combo_level4 },
        { audio: AudioClipNames.combo_level5 },
        { audio: AudioClipNames.combo_level6 },
        { audio: AudioClipNames.combo_level7 },
    ];
    private static readonly COMBO_BOX_EFFECT_NAME = 'comboBoxEffect';
    private static readonly COMBO_BOX_EFFECT_SIBLING_INDEX = 0;

    // 目标槽预览相关 —— 由 EventGameUiInit 注入 prefab + 资源 map，EventRenderSlot 触发渲染
    private mahjongItem: Prefab = null!;
    private iconFrames: Map<string, SpriteFrame> = new Map();
    private slotPreviews: (Node | null)[] = [];
    private boxEffectPrefab: Prefab | null = null;
    private boxEffectLoading = false;
    private pendingBoxEffectLevel = -1;
    private activeBoxEffectLevel = -1;
    private comboBoxEffectSyncScheduled = false;
    private comboBoxEffects: (Node | null)[] = [];
    private targetSlotUnlocked: boolean[] = [];
    private shuffleEffectNode: Node | null = null;
    private shuffleEffectAnimation: Animation | null = null;
    private shuffleEffectOpacity: UIOpacity | null = null;
    private shuffleEffectClip: AnimationClip | null = null;
    private shuffleEffectSeq = 0;
    private isGuideLevel = false;
    private hasLevelUiMode = false;
    private slotRootTop = 0;
    private guideNode: Node | null = null;

    protected onLoad() {
        //背景适配
        this.adaptBackground();

        this.slotOriginPositions = this.slotNodeArr.map(node => node ? node.position.clone() : new Vec3());
        this.slotRootTop = this.getSlotRootWidget()?.top ?? 0;
        this.propButtonOriginPositions = [this.undoButton, this.switchButton, this.unlockButton].map(btn => btn ? btn.position.clone() : new Vec3());
        //this.setupHudLabels();
        this.setupComboNode();
        this.preloadShuffleEffectClip();
    }

    adaptBackground() {
        // 1. 获取当前屏幕可视区域大小 (实际设备的屏幕尺寸)
        const visibleSize = view.getVisibleSize();

        // 2. 获取项目设置中的原始设计分辨率 (你在 Cocos 项目设置里填的宽高)
        const designSize = this.bgNode.getComponent(UITransform).contentSize;

        // 3. 分别计算宽和高的缩放比例
        const scaleX = visibleSize.width / designSize.width;
        const scaleY = visibleSize.height / designSize.height;

        // 4. 选择适配策略（通常背景图用策略 A）

        // 【策略 A：等比缩放，铺满全屏不留黑边】(推荐)
        // 取宽、高比例中的最大值。这样图片不会拉伸变形，但超出的边缘可能会被裁剪。
        const maxScale = Math.max(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));

        /*
        // 【策略 B：强行拉伸填满全屏】(不推荐，除非图片很简单)
        // 直接应用各自的比例，图片会被拉伸、压扁变形。
        this.bgNode.setScale(new Vec3(scaleX, scaleY, 1));
        
        // 【策略 C：等比缩放，全部显示完整】
        // 取宽、高比例中的最小值。图片完整显示，但屏幕上下或左右可能会出现黑边。
        const minScale = Math.min(scaleX, scaleY);
        this.bgNode.setScale(new Vec3(minScale, minScale, 1));
        */
    }

    private setupComboNode() {
        if (!this.comboNode) return;
        this.comboNodeOriginScale = this.comboNode.scale.clone();
        const progressBar = this.comboNode.getChildByName('ProgressBar');
        const bar = progressBar?.getChildByName('Bar');
        if (bar) this.comboBarSprite = bar.getComponent(Sprite)!;
        const countNode = this.comboNode.getChildByName('countLabel');
        if (countNode) this.comboCountLabel = countNode.getComponent(Label)!;
        if (this.comboLabelNode) this.comboLabelNode.active = false;
        for (let i = 0; i < UIGameLayer.COMBO_AUDIOS.length; i++) {
            const levelNode = this.comboNode.getChildByName(`${i + 1}`);
            if (!levelNode) continue;
            const opacity = levelNode.getComponent(UIOpacity) || levelNode.addComponent(UIOpacity);
            this.comboLevelNodes[i] = levelNode;
            this.comboLevelOriginPositions[i] = levelNode.position.clone();
            this.comboLevelOriginScales[i] = levelNode.scale.clone();
            this.comboLevelOpacities[i] = opacity;
            opacity.opacity = 0;
            levelNode.active = false;
        }
        this.comboNode.setScale(this.comboNodeOriginScale.clone());
        this.comboNode.active = false;
    }

    private setupHudLabels() {
        this.targetLabel = this.ensureLabel('targetLabel', new Vec3(0, 548, 0), 30, new Color(255, 245, 215, 255), 520, 46);
        this.statusLabel = this.ensureLabel('statusLabel', new Vec3(0, 340, 0), 26, new Color(245, 252, 255, 255), 650, 38);
        //this.comboLabel = this.ensureLabel('comboLabel', new Vec3(0, 300, 0), 30, new Color(255, 214, 92, 255), 160, 42);
        this.toastLabel = this.ensureLabel('toastLabel', new Vec3(0, -18, 0), 42, new Color(255, 0, 0, 255), 650, 70);
        this.targetLabel.node.active = false;
        //this.comboLabel.node.active = false;
        this.toastLabel.node.active = false;
    }

    private ensureLabel(name: string, pos: Vec3, fontSize: number, color: Color, width: number, height: number): Label {
        let node = this.node.getChildByName(name);
        if (!node) {
            node = new Node(name);
            node.layer = this.node.layer;
            this.node.addChild(node);
            node.setPosition(pos);
        }
        const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
        transform.setContentSize(width, height);
        const label = node.getComponent(Label) || node.addComponent(Label);
        label.fontSize = fontSize;
        label.lineHeight = height;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }

    start() {

    }

    update(deltaTime: number) {

    }

    onDisable() {
        this.registerGlobalEvent(false);
        this.onEventCleanSlotContainers();
        director.emit(Constants.eventNames.EventClearAllMahjongTiles);
        this.clearComboBoxEffects();
        // 界面隐藏时关闭连击显示并把状态复位,避免下次显示时残留上一局的进度条/口号
        this.resetComboNode();
    }

    onEnable() {
        this.registerGlobalEvent(true);
        if (this.hasLevelUiMode) this.applyLevelUiMode();
    }


    private registerGlobalEvent(_register: boolean) {
        if (_register) {
            director.on(Constants.eventNames.EventShowSlotShake, this.onEventShowSlotShake, this);
            director.on(Constants.eventNames.EventShowSlotUnlock, this.onEventShowSlotUnlock, this);
            director.on(Constants.eventNames.EventShowSlotMoveIn, this.onEventShowSlotMoveIn, this);
            director.on(Constants.eventNames.EventShowSlotMoveOut, this.onEventShowSlotMoveOut, this);
            director.on(Constants.eventNames.EventHudUpdate, this.onEventHudUpdate, this);
            director.on(Constants.eventNames.EventComboUpdate, this.onEventComboUpdate, this);
            director.on(Constants.eventNames.EventShowToast, this.onEventShowToast, this);
            director.on(Constants.eventNames.EventGameUiInit, this.onEventGameUiInit, this);
            director.on(Constants.eventNames.EventLevelStart, this.onEventLevelStart, this);
            director.on(Constants.eventNames.EventRenderSlot, this.onEventRenderSlot, this);
            director.on(Constants.eventNames.EventClearSlot, this.onEventClearSlot, this);
            director.on(Constants.eventNames.EventResetSlots, this.onEventResetSlots, this);
            director.on(Constants.eventNames.EventCleanSlotContainers, this.onEventCleanSlotContainers, this);
            director.on(Constants.eventNames.EventSetUndoButtonStatus, this.onSetUndoButtonStatus, this);
            director.on(Constants.eventNames.EventSetPropCount, this.onSetPropCount, this);
            director.on(Constants.eventNames.EventSetRandomPropButton, this.onSetRandomPropButton, this);
            director.on(Constants.eventNames.EventShowTipsAnimator, this.onShowTipsAnimator, this);
            director.on(Constants.eventNames.EventShowShuffleTileEffect, this.onEventShowShuffleTileEffect, this);
            director.on(Constants.eventNames.EventHideGuide, this.onEventHideGuide, this);
            director.on(Constants.eventNames.EventStopTipsAnimator, this.onStopTipsAnimator, this);
            director.on(Constants.eventNames.EventClearComboBoxEffects, this.clearComboBoxEffects, this);
        } else {
            director.off(Constants.eventNames.EventShowSlotShake, this.onEventShowSlotShake, this);
            director.off(Constants.eventNames.EventShowSlotUnlock, this.onEventShowSlotUnlock, this);
            director.off(Constants.eventNames.EventShowSlotMoveIn, this.onEventShowSlotMoveIn, this);
            director.off(Constants.eventNames.EventShowSlotMoveOut, this.onEventShowSlotMoveOut, this);
            director.off(Constants.eventNames.EventHudUpdate, this.onEventHudUpdate, this);
            director.off(Constants.eventNames.EventComboUpdate, this.onEventComboUpdate, this);
            director.off(Constants.eventNames.EventShowToast, this.onEventShowToast, this);
            director.off(Constants.eventNames.EventGameUiInit, this.onEventGameUiInit, this);
            director.off(Constants.eventNames.EventLevelStart, this.onEventLevelStart, this);
            director.off(Constants.eventNames.EventRenderSlot, this.onEventRenderSlot, this);
            director.off(Constants.eventNames.EventClearSlot, this.onEventClearSlot, this);
            director.off(Constants.eventNames.EventResetSlots, this.onEventResetSlots, this);
            director.off(Constants.eventNames.EventCleanSlotContainers, this.onEventCleanSlotContainers, this);
            director.off(Constants.eventNames.EventSetUndoButtonStatus, this.onSetUndoButtonStatus, this);
            director.off(Constants.eventNames.EventSetPropCount, this.onSetPropCount, this);
            director.off(Constants.eventNames.EventSetRandomPropButton, this.onSetRandomPropButton, this);
            director.off(Constants.eventNames.EventShowTipsAnimator, this.onShowTipsAnimator, this);
            director.off(Constants.eventNames.EventShowShuffleTileEffect, this.onEventShowShuffleTileEffect, this);
            director.off(Constants.eventNames.EventHideGuide, this.onEventHideGuide, this);
            director.off(Constants.eventNames.EventStopTipsAnimator, this.onStopTipsAnimator, this);
            director.off(Constants.eventNames.EventClearComboBoxEffects, this.clearComboBoxEffects, this);
        }
    }

    onEventGameUiInit(payload: GameUiInitPayload) {
        this.mahjongItem = payload.mahjongItem;
        this.iconFrames = payload.iconFrames;
    }

    onEventLevelStart(level: number) {
        this.hasLevelUiMode = true;
        this.isGuideLevel = level === 0;
        this.clearComboBoxEffects();
        this.resetComboNode();
        this.applyLevelUiMode();
        this.setGuideVisible(this.isGuideLevel, level);
    }

    private onEventHideGuide() {
        this.setGuideVisible(false, 0);
    }

    private getSlotRootWidget(): Widget | null {
        return this.slotNodeArr[0]?.parent?.getComponent(Widget) || null;
    }

    private applyLevelUiMode() {
        if (this.isGuideLevel) {
            this.resetComboNode();
            this.onStopTipsAnimator();
        }

        if (this.slotNodeArr[0]) this.slotNodeArr[0].active = !this.isGuideLevel;
        if (this.slotNodeArr[3]) this.slotNodeArr[3].active = !this.isGuideLevel;
        if (this.slotNodeArr[4]) this.slotNodeArr[4].active = !this.isGuideLevel;

        const levelNode = this.node.getChildByName('levelLabel');
        if (levelNode) levelNode.active = !this.isGuideLevel;

        const widget = this.getSlotRootWidget();
        if (widget) {
            widget.top = this.isGuideLevel ? 300 : this.slotRootTop;
            widget.updateAlignment();
        }

        if (this.undoButton) this.undoButton.active = !this.isGuideLevel;
        if (this.unlockButton) this.unlockButton.active = !this.isGuideLevel;
        if (this.switchButton) this.switchButton.active = !this.isGuideLevel;
    }

    private setGuideVisible(visible: boolean, level: number) {
        if (visible) {
            if (!this.guideNode?.isValid) {
                this.guideNode = LayerManager.instance.showUI('guide', level);
            }
            return;
        }

        if (this.guideNode?.isValid) {
            this.guideNode.destroy();
        }
        this.guideNode = null;
    }

    onEventRenderSlot(payload: RenderSlotPayload) {
        const slotNode = this.slotNodeArr[payload.slotID];
        if (!slotNode) {
            console.warn(`[UIGameLayer] onEventRenderSlot 找不到 slotID ${payload.slotID}`);
            return;
        }
        this.targetSlotUnlocked[payload.slotID] = payload.unlocked;
        if (!payload.unlocked) this.clearComboBoxEffect(payload.slotID);
        else if (payload.type && this.activeBoxEffectLevel >= 0) this.showComboBoxEffectForSlot(payload.slotID, this.activeBoxEffectLevel);

        // 锁 / 提示 / 解锁按钮 等子节点的显隐
        const locked = !payload.unlocked;
        const lockNode = slotNode.getChildByName('lock');
        if (lockNode) lockNode.active = locked;
        const tipsNode = slotNode.getChildByName('tips');
        if (tipsNode) tipsNode.active = locked;
        // box_2(锁箱盖子)同样跟随解锁状态显隐;但解锁/移入移出动画进行中(refreshing)时,
        // box_2 由对应动画自行控制(甩出/盖上),这里不插手,避免把正飞出的盖子提前关掉。
        // 恢复存档时 refreshing 为 false,这里会把已解锁槽位上残留的 box_2 正确关掉,
        // 修复"applySnapshot 恢复后已解锁的 slot3/slot4 盖子还盖着"的问题。
        const box2Node = slotNode.getChildByName('box_2');
        if (box2Node && !payload.refreshing) box2Node.active = locked;
        for (const child of slotNode.children) {
            const name = child.name.toLowerCase();
            if (child.name === 'tips' || child.name === 'lock' || name.includes('unlock') || child.name.includes('解锁')) {
                child.active = locked;
            }
        }

        // 隐藏 item1~item4 占位图
        for (let j = 1; j <= 4; j++) {
            const itemNode = slotNode.getChildByName(`item${j}`);
            if (itemNode) itemNode.active = false;
        }
        const iconNode = slotNode.getChildByName('item1');
        if (iconNode) {
            const sprite = iconNode.getComponent(Sprite) || iconNode.addComponent(Sprite);
            sprite.enabled = false;
            sprite.spriteFrame = null;
        }

        // 预览图
        let preview = this.slotPreviews[payload.slotID];
        if (payload.unlocked && payload.type) {
            const isNewlyCreated = !preview || !preview.isValid;
            if (isNewlyCreated) {
                // 关卡重开时旧 preview 的 destroy 是延迟到帧末才生效,
                // 这一帧 slotNode 下可能还残留着上一局的 targetPreview_xxx 节点,
                // 而 MahjongItem.onDisable 会把 scale 强制改回 BoardScale(0.57),
                // 玩家就会看到预览先放大到 0.57 再被新 preview 替换成 0.36(肉眼可见缩小一下)。
                // 这里主动把残留节点先脱离父节点再销毁,确保这一帧不会渲染那个变大的中间态。
                for (const child of slotNode.children.slice()) {
                    if (child.name.startsWith('targetPreview_')) {
                        Tween.stopAllByTarget(child);
                        child.removeFromParent();
                        child.destroy();
                    }
                }
                preview = instantiate(this.mahjongItem);
                preview.name = `targetPreview_${payload.type}`;
                // 先把 scale/position 设到目标值再 addChild,避免 prefab 默认 scale=1 在 onEnable
                // 那一帧被渲染成"大尺寸"再缩到 SlotScale,造成"从大到正常"的可视缩放。
                preview.setScale(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1);
                if (iconNode) preview.setPosition(iconNode.position);
                slotNode.addChild(preview);
                this.slotPreviews[payload.slotID] = preview;
            }
            // 防御性停掉 preview 节点上的所有 tween,避免上一局留下的 scale 动画在新一帧里继续插值
            Tween.stopAllByTarget(preview);
            const item = preview.getComponent(MahjongItem) || preview.addComponent(MahjongItem);
            item.setData(payload.type, 0, 0, 0, this.iconFrames.get(payload.type) || null);
            preview.active = true;
            preview.setPosition(iconNode ? iconNode.position : Vec3.ZERO);
            preview.setScale(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1);
            // 保留原本的 UIOpacity 组件，以兼容其他动画对透明度的预期
            preview.getComponent(UIOpacity) || preview.addComponent(UIOpacity);
        } else if (preview?.isValid) {
            preview.active = false;
        }
    }

    onEventClearSlot(payload: ClearSlotPayload) {
        const slotNode = this.slotNodeArr[payload.slotID];
        if (!slotNode) return;
        this.clearComboBoxEffect(payload.slotID);

        const preview = this.slotPreviews[payload.slotID];
        if (preview?.isValid) {
            Tween.stopAllByTarget(preview);
            // 先 removeFromParent 再 destroy:Cocos 的 destroy 延迟到帧末执行,
            // 期间 MahjongItem.onDisable 会把 scale 强制改回 BoardScale(0.57),
            // 如果节点仍挂在 slotNode 下,玩家会看到预览先放大到 0.57 再被新 preview 替换成 0.36,
            // 表现为"肉眼可见的缩小一下"。先脱离父节点就不会再渲染那一帧。
            preview.removeFromParent();
            preview.destroy();
        }
        this.slotPreviews[payload.slotID] = null;

        // 兜底：扫一遍 slot 子节点，把所有目标预览/已收集的牌都清掉
        for (const child of slotNode.children.slice()) {
            if (child.name.startsWith('targetPreview_') || child.name.startsWith('targetTile_')) {
                Tween.stopAllByTarget(child);
                child.removeFromParent();
                child.destroy();
            }
        }
    }

    // 关卡重开时一次性把所有槽位的 transform/box_2 复位到场景初始状态，
    // 把上一局 MoveOut/Shake/Unlock 留下的脏 tween 全部冲掉
    onEventResetSlots(payload: ResetSlotsPayload) {
        this.clearComboBoxEffects();
        for (let i = 0; i < this.slotNodeArr.length; i++) {
            const slot = this.slotNodeArr[i];
            if (!slot) continue;
            Tween.stopAllByTarget(slot);
            const origin = this.slotOriginPositions[i];
            if (origin) slot.setPosition(origin.clone());
            slot.setScale(1, 1, 1);
            slot.setRotationFromEuler(new Vec3(0, 0, 0));
        }

        for (const state of payload.targetBoxStates) {
            const slot = this.slotNodeArr[state.slotID];
            if (!slot) continue;
            this.targetSlotUnlocked[state.slotID] = state.unlocked;
            const locked = !state.unlocked;

            const lockNode = slot.getChildByName('lock');
            if (lockNode) lockNode.active = locked;
            const tipsNode = slot.getChildByName('tips');
            if (tipsNode) tipsNode.active = locked;

            const box2 = slot.getChildByName('box_2');
            if (!box2) continue;
            Tween.stopAllByTarget(box2);
            const opacity = box2.getComponent(UIOpacity);
            if (opacity) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 255;
            }
            box2.setPosition(0, 0, 0);
            box2.setScale(1, 1, 1);
            box2.setRotationFromEuler(new Vec3(0, 0, 0));
            box2.active = locked;
        }
        this.slotNodeArr.forEach((node, index) => {
            if (node && this.slotOriginPositions[index]) {
                node.position.set(this.slotOriginPositions[index]);
            }
        });
    }

    // 清理槽位容器: slot1~4 下面除了 item1~4/box_2/lock 这些 prefab 自带的锚点和锁,
    // 其他都是上一局/上一次失败弹窗残留的脏节点(slotTile_*、targetTile_* 等),全部销毁。
    // 同时把 slot3/slot4 的 box_2/lock 重新点亮(被 onEventResetSlots 翻成 unlocked 时关掉的),
    // 让锁着的两个槽位回到"盖着箱子+挂锁"的初始外观,lock 顶到最上层避免被 box_2 盖住
    onEventCleanSlotContainers() {
        this.clearComboBoxEffects();
        const keep = ['item1', 'item2', 'item3', 'item4', 'box_2', 'lock', "motionStreak","box","box4"];
        for (let i = 1; i <= 4; i++) {
            const slot = this.slotNodeArr[i];
            if (!slot) continue;
            slot.active = true;
            for (const child of slot.children.slice()) {
                if (keep.indexOf(child.name) < 0) {
                    child.destroy();
                    continue;
                }
                if (slot.name === 'slot3' || slot.name === 'slot4') {
                    if (child.name === 'box_2' || child.name === 'lock') {
                        child.active = true;
                        if (child.name === 'lock') {
                            child.setSiblingIndex(slot.children.length - 1);
                        }
                    }
                }
            }
        }
        this.applyLevelUiMode();
    }

    onEventHudUpdate(payload: HudPayload) {
        return
        this.targetLabel.string = '';
        this.targetLabel.node.active = true;

        //const timeText = payload.hasTimer ? `    ${payload.timeSec}秒` : '';
        //this.statusLabel.string = `剩余 ${payload.remain}/${payload.total}    槽位 ${payload.slots}/${payload.slotCap}${timeText}`;
        this.statusLabel.string = '';
        // 连击展示已迁移到 comboNode（进度条 + countLabel），由 EventComboUpdate 驱动
        void payload;
    }

    // 每次匹配完成都会触发：把 comboNode 显示出来,进度条重置到 1,然后在
    // COMBO_DURATION 秒内匀速倒数到 0；如果途中再次完成匹配,会再次进入这个
    // 函数,Tween.stopAllByTarget 会打断旧动画并重新开始,countLabel 同步刷新
    onEventComboUpdate(comboTimes: number) {
        if (!this.comboNode || !this.comboBarSprite) return;

        // GameCtrl 从 0 开始新一轮 combo 时,已播放过的口号等级要从头来过,
        // 旧的 comboLabel 文本也要先收掉
        if (comboTimes <= 1) {
            this.resetComboNode();
            this.comboAudioLevel = 0;
            this.hideComboLevelNodes();
            return;
        }

        // 每 COMBO_STEP 次连击解锁下一级口号:第 3/6/9/... 次时按顺序播一个
        if (comboTimes % UIGameLayer.COMBO_STEP !== 0) return;

        const targetLevel = comboTimes / UIGameLayer.COMBO_STEP;
        const maxLevel = UIGameLayer.COMBO_AUDIOS.length;
        const shouldPlayComboLevel = targetLevel > this.comboAudioLevel && targetLevel <= maxLevel;

        // 只有在解锁新口号时才显示 UI(第 3/6/9/... 次)
        if (!shouldPlayComboLevel) return;

        const seq = ++this.comboRefreshSeq;
        const originScale = this.comboNodeOriginScale.clone();
        const popStartScale = new Vec3(originScale.x * 0.78, originScale.y * 0.78, originScale.z);
        const popPeakScale = new Vec3(originScale.x * 1.08, originScale.y * 1.08, originScale.z);

        Tween.stopAllByTarget(this.comboNode);
        Tween.stopAllByTarget(this.comboBarSprite);
        this.hideComboLevelNodes();
        this.comboNode.active = true;
        this.comboNode.setScale(popStartScale);
        if (this.comboCountLabel) this.comboCountLabel.string = `${comboTimes}`;

        this.comboBarSprite.fillRange = 1;
        tween(this.comboNode)
            .to(0.12, { scale: popPeakScale }, { easing: 'backOut' })
            .to(0.06, { scale: originScale }, { easing: 'quadOut' })
            .call(() => {
                if (seq !== this.comboRefreshSeq || !this.comboNode?.isValid) return;

                // 播放对应等级的口号音效和图片
                this.comboAudioLevel = targetLevel;
                this.playComboLevel(targetLevel - 1);

                Tween.stopAllByTarget(this.comboBarSprite);
                this.comboBarSprite.fillRange = 1;
                tween(this.comboBarSprite)
                    .to(UIGameLayer.COMBO_DURATION, { fillRange: 0 })
                    .call(() => {
                        if (seq !== this.comboRefreshSeq || !this.comboNode?.isValid) return;
                        this.comboNode.active = false;
                        // 展示进度走完只隐藏 UI 并重置口号播放状态,不影响 GameCtrl 的连击计数
                        this.comboAudioLevel = 0;
                        this.hideComboLevelNodes();
                    })
                    .start();
            })
            .start();
    }

    // Hide legacy text and every prebuilt combo image node.
    private hideComboLevelNodes(exceptIndex: number = -1) {
        if (this.comboLabelNode?.isValid) this.comboLabelNode.active = false;
        for (let i = 0; i < this.comboLevelNodes.length; i++) {
            if (i === exceptIndex) continue;
            const levelNode = this.comboLevelNodes[i];
            if (!levelNode?.isValid) continue;
            const opacity = this.comboLevelOpacities[i];
            Tween.stopAllByTarget(levelNode);
            if (opacity?.isValid) {
                Tween.stopAllByTarget(opacity);
                opacity.opacity = 0;
            }
            const originPosition = this.comboLevelOriginPositions[i];
            const originScale = this.comboLevelOriginScales[i];
            if (originPosition) levelNode.setPosition(originPosition);
            if (originScale) levelNode.setScale(originScale);
            levelNode.active = false;
        }
    }

    private playComboLevel(index: number) {
        const entry = UIGameLayer.COMBO_AUDIOS[index];
        if (!entry) return;
        AudioManager.instance.playOneShot(entry.audio);
        this.showComboBoxEffects(index);
        const levelNode = this.comboLevelNodes[index];
        if (!levelNode?.isValid) return;

        this.hideComboLevelNodes(index);
        const opacity = this.comboLevelOpacities[index] || levelNode.getComponent(UIOpacity) || levelNode.addComponent(UIOpacity);
        this.comboLevelOpacities[index] = opacity;
        // const originPosition = this.comboLevelOriginPositions[index] || levelNode.position.clone();
        // const originScale = this.comboLevelOriginScales[index] || levelNode.scale.clone();
        // const dropStartPosition = new Vec3(originPosition.x, originPosition.y + 24, originPosition.z);
        // const impactPosition = new Vec3(originPosition.x, originPosition.y - 6, originPosition.z);
        // const fadePosition = new Vec3(originPosition.x, originPosition.y - 16, originPosition.z);
        // const startScale = new Vec3(originScale.x * 1.04, originScale.y * 1.04, originScale.z);
        // const impactScale = new Vec3(originScale.x * 1.08, originScale.y * 0.92, originScale.z);

        Tween.stopAllByTarget(levelNode);
        Tween.stopAllByTarget(opacity);
        levelNode.active = true;
        // levelNode.setPosition(dropStartPosition);
        // levelNode.setScale(startScale);
        opacity.opacity = 255;

        // tween(levelNode)
        //     .to(0.1, { position: impactPosition, scale: impactScale }, { easing: 'quadIn' })
        //     .to(0.08, { position: originPosition, scale: originScale }, { easing: 'backOut' })
        //     .delay(0.35)
        //     .to(0.38, { position: fadePosition }, { easing: 'sineIn' })
        //     .call(() => {
        //         if (!levelNode.isValid) return;
        //         levelNode.setPosition(originPosition);
        //         levelNode.setScale(originScale);
        //         if (opacity.isValid) opacity.opacity = 0;
        //         levelNode.active = false;
        //     })
        //     .start();
        // tween(opacity)
        //     .delay(0.44)
        //     .to(0.38, { opacity: 0 }, { easing: 'sineIn' })
        //     .start();
    }

    private showComboBoxEffects(levelIndex: number) {
        this.activeBoxEffectLevel = levelIndex;
        const prefab = this.boxEffectPrefab;
        if (!prefab) {
            this.pendingBoxEffectLevel = levelIndex;
            this.loadBoxEffectPrefab();
            return;
        }

        for (let slotID = 1; slotID <= 4; slotID++) {
            this.showComboBoxEffectForSlot(slotID, levelIndex, false);
        }
        this.requestSyncComboBoxEffects();
    }

    private showComboBoxEffectForSlot(slotID: number, levelIndex: number, syncAfterShow: boolean = true) {
        const slot = this.slotNodeArr[slotID];
        if (!slot?.isValid) return;
        if (!this.targetSlotUnlocked[slotID]) {
            this.clearComboBoxEffect(slotID);
            return;
        }

        const prefab = this.boxEffectPrefab;
        if (!prefab) {
            this.pendingBoxEffectLevel = levelIndex;
            this.loadBoxEffectPrefab();
            return;
        }

        let effectNode = this.comboBoxEffects[slotID];
        if (!effectNode?.isValid) {
            effectNode = slot.getChildByName(UIGameLayer.COMBO_BOX_EFFECT_NAME);
            if (!effectNode?.isValid) {
                effectNode = instantiate(prefab);
                effectNode.name = UIGameLayer.COMBO_BOX_EFFECT_NAME;
                slot.addChild(effectNode);
            }
            this.comboBoxEffects[slotID] = effectNode;
        }

        effectNode.active = true;
        effectNode.setPosition(0, 0, 0);
        effectNode.setSiblingIndex(UIGameLayer.COMBO_BOX_EFFECT_SIBLING_INDEX);
        const effect = effectNode.getComponent(boxEffect);
        if (effect) effect.setEffectLevel(levelIndex);
        if (syncAfterShow) this.requestSyncComboBoxEffects();
    }

    private requestSyncComboBoxEffects() {
        if (this.comboBoxEffectSyncScheduled) return;
        this.comboBoxEffectSyncScheduled = true;
        this.scheduleOnce(this.syncComboBoxEffects, 0);
    }

    private syncComboBoxEffects = () => {
        this.comboBoxEffectSyncScheduled = false;
        if (this.activeBoxEffectLevel < 0) return;

        for (let slotID = 1; slotID <= 4; slotID++) {
            if (!this.targetSlotUnlocked[slotID]) continue;
            const effectNode = this.comboBoxEffects[slotID];
            if (!effectNode?.isValid || !effectNode.activeInHierarchy) continue;
            effectNode.setSiblingIndex(UIGameLayer.COMBO_BOX_EFFECT_SIBLING_INDEX);
            const effect = effectNode.getComponent(boxEffect);
            if (effect) effect.setEffectLevel(this.activeBoxEffectLevel);
        }
    };

    private loadBoxEffectPrefab() {
        if (this.boxEffectPrefab || this.boxEffectLoading) return;
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.warn('[UIGameLayer] game bundle not found for boxEffect');
            return;
        }

        this.boxEffectLoading = true;
        bundle.load<Prefab>('prefab/boxEffect', Prefab, (err, prefab) => {
            this.boxEffectLoading = false;
            if (err || !prefab) {
                console.warn('[UIGameLayer] load boxEffect prefab failed', err);
                return;
            }

            this.boxEffectPrefab = prefab;
            const pendingLevel = this.pendingBoxEffectLevel;
            this.pendingBoxEffectLevel = -1;
            if (pendingLevel >= 0 && this.node.activeInHierarchy) {
                this.showComboBoxEffects(pendingLevel);
            }
        });
    }

    private clearComboBoxEffect(slotID: number) {
        const effectNode = this.comboBoxEffects[slotID];
        if (effectNode?.isValid) {
            Tween.stopAllByTarget(effectNode);
            effectNode.removeFromParent();
            effectNode.destroy();
        }
        this.comboBoxEffects[slotID] = null;

        const slot = this.slotNodeArr[slotID];
        const stray = slot?.getChildByName(UIGameLayer.COMBO_BOX_EFFECT_NAME);
        if (stray?.isValid) {
            Tween.stopAllByTarget(stray);
            stray.removeFromParent();
            stray.destroy();
        }
    }

    private clearComboBoxEffects() {
        this.pendingBoxEffectLevel = -1;
        this.activeBoxEffectLevel = -1;
        this.comboBoxEffectSyncScheduled = false;
        this.unschedule(this.syncComboBoxEffects);
        for (let slotID = 1; slotID <= 4; slotID++) {
            this.clearComboBoxEffect(slotID);
        }
    }

    private resetComboNode() {
        this.comboRefreshSeq++;
        if (this.comboNode) Tween.stopAllByTarget(this.comboNode);
        if (this.comboBarSprite) {
            Tween.stopAllByTarget(this.comboBarSprite);
            this.comboBarSprite.fillRange = 1;
        }
        if (this.comboNode?.isValid) {
            this.comboNode.setScale(this.comboNodeOriginScale.clone());
            this.comboNode.active = false;
        }
        // 口号等级也归零,下次连击重新从 level1 开始
        this.comboAudioLevel = 0;
        this.hideComboLevelNodes();
    }

    onEventShowToast(payload: ToastPayload) {
        if (!payload.msg) {
            this.toastLabel.node.active = false;
            return;
        }
        this.toastLabel.string = payload.msg;
        this.toastLabel.node.active = true;
        this.toastLabel.node.setScale(0.86, 0.86, 1);
        tween(this.toastLabel.node).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
        if (payload.seconds > 0) {
            this.scheduleOnce(() => {
                if (this.toastLabel?.node.isValid) this.toastLabel.node.active = false;
            }, payload.seconds);
        }
    }
    onEventShowSlotShake(slotID: number, flyDuration: number = 0.198) {
        // 1. 获取目标节点并进行安全检查
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotShake 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }

        // 2. 停止该节点上可能正在播放的缩放动画
        Tween.stopAllByTarget(targetNode);

        // 3. 重置初始状态为 (1, 1, 1)
        targetNode.setScale(new Vec3(1, 1, 1));

        // 防御性归位
        const origin = this.slotOriginPositions[slotID];
        if (origin) targetNode.setPosition(origin.clone());

        // 4. 执行横向挤压弹动缓动动画 (Scale)
        // 等飞行结束、牌真正撞到槽位的那一刻才开始挤压,符合"撞击 -> 挤压"的物理直觉
        const startDelay = Math.max(0, flyDuration);

        // tween(targetNode)
        //     .delay(startDelay)
        //     // 【调整 2】：时间全面拉长，并加入 sine 缓动曲线消除机械的僵硬感
        //     // 第一段：被撞击挤压变扁 (sineOut，减速到达最大形变，显得有阻力)
        //     .to(0.14, { scale: new Vec3(1.028, 0.978, 1) }, { easing: 'sineOut' })
        //     // 第二段：反弹拉长 (sineInOut，平滑地度过反弹过程)
        //     .to(0.18, { scale: new Vec3(0.996, 1.007, 1) }, { easing: 'sineInOut' })
        //     // 第三段：平稳收缩回原状 (sineOut，平缓落定)
        //     .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
        //     .start();

        // tween(targetNode)
        //     .delay(startDelay)
        //     // 第一段：时间保持 0.14s，形变幅度减半（从 2.8% 降到 1.4%）
        //     .to(0.14, { scale: new Vec3(1.014, 0.986, 1) }, { easing: 'sineOut' })

        //     // 第二段：时间保持 0.18s，反弹幅度减半（从 0.7% 降到 0.3%）
        //     .to(0.18, { scale: new Vec3(0.997, 1.003, 1) }, { easing: 'sineInOut' })

        //     // 第三段：时间保持 0.14s，平稳收回
        //     .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
        //     .start();


        tween(targetNode)
            .delay(startDelay)
            // 第一段：大幅缩短到 0.05s。由于速度极快，1.2% 的形变会一闪而过，形成清脆的硬质弹性
            .to(0.05, { scale: new Vec3(1.012, 0.988, 1) }, { easing: 'sineOut' })

            // 第二段：0.08s 快速反弹，形变压到极其微弱的 0.2%
            .to(0.08, { scale: new Vec3(0.998, 1.002, 1) }, { easing: 'sineInOut' })

            // 第三段：0.06s 迅速归位
            .to(0.06, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();

    }


    //解锁槽位的动画
    onEventShowSlotUnlock(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotUnlock 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }

        const lockTips = targetNode.getChildByName('box_2');
        targetNode.getChildByName('lock').active = false;
        if (!lockTips) {
            console.warn(`[UIGameLayer] onEventShowSlotUnlock 找不到 lock 节点`);
            return;
        }

        // 1. 停止相关节点可能正在播放的动画，防止重叠
        Tween.stopAllByTarget(targetNode);
        Tween.stopAllByTarget(lockTips);

        // ==========================================
        // 第一部分：外层 root (targetNode) 回弹动画
        // ==========================================
        targetNode.setScale(new Vec3(1, 1, 1)); // 重置基准状态

        tween(targetNode)
            .to(0.1333, { scale: new Vec3(1.1260, 0.9280, 1) })   // 撑大压扁
            .to(0.1334, { scale: new Vec3(0.94132, 1.04392, 1) }) // 反向回拉 (0.2667s)
            .to(0.1166, { scale: new Vec3(1, 1, 1) })             // 回正 (0.3833s)
            .start();

        // ==========================================
        // 第二部分：锁提示层 (lockTips) 甩出退场动画
        // ==========================================
        // 确保显示并重置到基准状态
        lockTips.active = true;
        lockTips.setPosition(new Vec3(0, 0, 0));
        lockTips.setScale(new Vec3(1, 1, 1));
        lockTips.setRotationFromEuler(new Vec3(0, 0, 0));
        lockTips.setSiblingIndex(2000);
        // 获取或添加 UIOpacity 组件用于控制透明度
        let uiOpacity = lockTips.getComponent(UIOpacity);
        if (!uiOpacity) {
            uiOpacity = lockTips.addComponent(UIOpacity);
        }
        uiOpacity.opacity = 255; // 初始 alpha = 1 (0-255制)
        Tween.stopAllByTarget(uiOpacity); // 确保透明度动画也被清理

        // 轨迹动画 (位置 X, Y)
        tween(lockTips)
            .delay(0.1667)                                      // 0 ~ 0.1667s 停留在原点
            .to(0.1833, { position: new Vec3(29, 29, 0) })      // 抬起至 (29, 29) 耗至 0.35s
            .to(0.2167, { position: new Vec3(74, -48, 0) })     // 斜向掉出 耗至 0.5667s
            .call(() => {
                // 动画彻底结束后隐藏节点
                lockTips.active = false;
            })
            .delay(0.2)
            .call(() => {
                lockTips.setPosition(new Vec3(0, 0, 0));
                lockTips.setScale(new Vec3(1, 1, 1));
                uiOpacity.opacity = 255;
                lockTips.angle = 0;
            })
            .start();

        // 缩放动画
        tween(lockTips)
            .delay(0.2667)                                      // 前半段保持 1
            .to(0.3000, { scale: new Vec3(0.8017, 0.8017, 1) }) // 缩至 80.17% 耗至 0.5667s
            .start();

        // 旋转动画 (Z轴倾斜)
        tween(lockTips)
            .delay(0.2667)
            .to(0.1666, { eulerAngles: new Vec3(0, 0, -14.166) }) // 倾斜旋转 耗至 0.4333s
            .start();

        // 透明度淡出动画
        tween(uiOpacity)
            .delay(0.35)                                        // 0 ~ 0.35s alpha 为 1
            .to(0.2167, { opacity: 0 })                         // 最后快速淡没 耗至 0.5667s
            .start();
    }

    onEventShowSlotMoveOut(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotMoveOut 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }
        let motionStreakNode = targetNode.getChildByName('motionStreak');
        if (motionStreakNode) {
            motionStreakNode.setPosition(new Vec3(0, -140, 0));
            motionStreakNode.active = false;
        }


        // 1. 停止当前节点的所有动画
        Tween.stopAllByTarget(targetNode);

        // ==========================================
        // 盖子下压动画 (task_gaiziNew)
        // ==========================================
        // 如果你的节点树中有独立的盖子节点，可以在这里同步触发
        const gaiZi = targetNode.getChildByName('box_2'); // 请替换为实际的盖子节点名
        if (gaiZi) {
            gaiZi.setSiblingIndex(2000);
            gaiZi.active = true;
            // 初始状态：高高拔起并拉伸
            gaiZi.setPosition(new Vec3(0, 165, 0));
            gaiZi.setScale(new Vec3(1.09, 1.44, 1));
            gaiZi.angle = 0;
            let gaiZiOpacity = gaiZi.getComponent(UIOpacity) || gaiZi.addComponent(UIOpacity);
            gaiZiOpacity.opacity = 0;
            Tween.stopAllByTarget(gaiZiOpacity);
            Tween.stopAllByTarget(gaiZi);

            // 0.2167s 压入并恢复原本比例
            tween(gaiZi)
                .to(0.2167, { position: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1) })
                .call(() => {
                    // 盖子贴合的瞬间播放音效,跟视觉节奏对齐
                    AudioManager.instance.playOneShot(AudioClipNames.gaigaizi);

                })
                .start();

            // 同步淡入
            tween(gaiZiOpacity)
                .to(0.2167, { opacity: 255 })
                .start();
        }

        // ==========================================
        // 旧格子挤压动画 (lastTimeOver 0.1833s ~ 0.3333s)
        // ==========================================
        tween(targetNode)
            .delay(0.1833)
            .to(0.05, { scale: new Vec3(1.03, 0.97, 1) }) // 横向拉伸，纵向压扁
            .to(0.05, { scale: new Vec3(0.98, 1.02, 1) }) // 横向回缩，纵向拉长
            .to(0.05, { scale: new Vec3(1, 1, 1) })       // 回正
            .start();
        const targetPosY = targetNode.y + 1500;

        tween(targetNode)
            .delay(0.3333)
            .to(0.4500, { position: new Vec3(targetNode.x, targetPosY, 0) }) // 大幅度向上退场，飞出屏幕顶部（速度对齐原左右挪动）
            .call(() => {
                if (motionStreakNode) motionStreakNode.active = false;
            })
            .start();
    }

    onEventShowSlotMoveIn(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotMoveIn 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }
        if (this.activeBoxEffectLevel >= 0) this.showComboBoxEffectForSlot(slotID, this.activeBoxEffectLevel);
        let motionStreakNode = targetNode.getChildByName('motionStreak');
        if (motionStreakNode) {
            motionStreakNode.setPosition(new Vec3(0, 140, 0));
            motionStreakNode.active = false;
        }
        const box2Node = targetNode.getChildByName('box_2');
        if (box2Node) box2Node.active = false;
        // 1. 停止 MoveOut 可能带来的遗留动画
        Tween.stopAllByTarget(targetNode);
        // 任务箱滑回的起手音效
        AudioManager.instance.playOneShot(AudioClipNames.taskBoxMove);
        // 2. 回到该槽位在场景里的原始位置（不再写死 ±200, 0）
        const originPos = this.slotOriginPositions[slotID] ?? targetNode.position.clone();
        // 从顶部上方落入：先把节点放到原始位置正上方，再下落归位
        targetNode.setPosition(new Vec3(originPos.x, originPos.y + 1500, 0));
        tween(targetNode)
            // 时长 0.45s:若调整,必须同步 Constants.slotAnim.MoveInWait(需 >= 此值),
            // 否则 movingIn 提前解除,挂起的牌会飞向盒子还没归位的"半路(偏上)"坐标。
            .to(0.45, { position: originPos.clone() }, { easing: 'quadOut' })
            .call(() => {
                targetNode.setPosition(originPos.clone());
                if (motionStreakNode) motionStreakNode.active = false;
            })
            .start();
    }

    onSetUndoButtonStatus(status: boolean) {
        if (this.isGuideLevel) return;
        if (status) {
            //this.undoButton.getComponent(Button)!.interactable = true;
            //this.undoButton.getChildByName("chehui").getComponent(Sprite)!.customMaterial = builtinResMgr.get<Material>('ui-sprite-gray-material');
            this.undoButton.getChildByName("mask").active = true;
        } else {
            //this.undoButton.getComponent(Button)!.interactable = false;
            //this.undoButton.getChildByName("chehui").getComponent(Sprite)!.customMaterial = null;
            this.undoButton.getChildByName("mask").active = false;
        }
    }

    // 刷新道具(撤回/换牌)剩余次数显示:>0 显示 di+countLabel(次数),==0 显示 ad1(看广告)
    onSetPropCount(payload: { undo: number; switch: number }) {
        this.applyPropCount(this.undoButton, payload.undo);
        this.applyPropCount(this.switchButton, payload.switch);
    }

    // 随机道具按钮当前是否显示。去重用:目标状态与当前一致时不再跑 onSetRandomPropButtonShow 的 tween,
    // 避免普通关卡每次开局都把 tips 节点等多余地动一遍。
    private randomPropShown = false;

    // GameCtrl 通知随机道具(额外免费道具)按钮显隐
    private onSetRandomPropButton(show: boolean) {
        if (this.isGuideLevel) show = false;
        if (show === this.randomPropButton.active) return;
        this.randomPropShown = show;
        this.onSetRandomPropButtonShow(show);
    }

    onSetRandomPropButtonShow(isShow: boolean) {
        if (isShow) {
            const idx = Math.floor(Math.random() * 3);
            const icon = [this.undoButton, this.switchButton, this.unlockButton][idx].getChildByName('icon');
            const iconSprite = icon.getComponent(Sprite);
            this.randomPropButton.getChildByName("icon").getComponent(Sprite)!.spriteFrame = iconSprite!.spriteFrame;
            this.randomPropButton.getComponent(Button)!.clickEvents[0].customEventData = [idx] + '';
        } else {
            this.randomPropButton.getChildByName("icon").getComponent(Sprite)!.spriteFrame = null;
            Tween.stopAllByTarget(this.randomPropButton);
            this.randomPropButton.active = false;
        }
        const spacing = 180;
        const startX = -1.5 * spacing;
        const buttons = [this.unlockButton, this.switchButton, this.undoButton];

        buttons.forEach((btn, i) => {
            if (!btn) return;
            Tween.stopAllByTarget(btn);
            let targetX = 0;
            if (isShow) {
                targetX = startX + i * spacing;
            } else {
                if (btn === this.undoButton) targetX = this.propButtonOriginPositions[0].x;
                else if (btn === this.switchButton) targetX = this.propButtonOriginPositions[1].x;
                else if (btn === this.unlockButton) targetX = this.propButtonOriginPositions[2].x;
            }
            tween(btn)
                .to(0.3, { position: new Vec3(targetX, btn.position.y, 0) }, { easing: 'sineOut' })
                .call(() => {
                    if (isShow && i === 2) {
                        Tween.stopAllByTarget(this.randomPropButton);
                        const randomBtnTargetX = startX + 3 * spacing;
                        this.randomPropButton.setPosition(new Vec3(randomBtnTargetX, this.randomPropButton.position.y, 0));
                        this.randomPropButton.active = true;
                    }
                })
                .start();
        });

        [this.unlockTipsNode, this.switchTipsNode].forEach((node, i) => {
            if (!node) return;
            Tween.stopAllByTarget(node);
            const btnIndex = i === 0 ? buttons.indexOf(this.unlockButton) : buttons.indexOf(this.switchButton);
            let targetX = 0;
            if (isShow) {
                targetX = startX + btnIndex * spacing;
            } else {
                targetX = this.propButtonOriginPositions[i === 0 ? 2 : 1].x;
            }
            tween(node)
                .to(0.3, { position: new Vec3(targetX, node.position.y, 0) }, { easing: 'sineOut' })
                .start();
        });
    }
    
    private applyPropCount(button: Node, count: number) {
        if (!button) return;
        const hasCount = count > 0;
        const di = button.getChildByName('di');
        const countLabel = button.getChildByName('countLabel');
        const ad1 = button.getChildByName('ad1');
        if (di) di.active = hasCount;
        if (countLabel) {
            countLabel.active = hasCount;
            if (hasCount) {
                const label = countLabel.getComponent(Label);
                if (label) label.string = String(count);
            }
        }
        if (ad1) ad1.active = !hasCount;
    }

    onClickSetButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("setting", 1);
    }

    private preloadShuffleEffectClip() {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.warn('[UIGameLayer] game bundle not found, shuffle effect will use fallback tween');
            return;
        }

        bundle.load('resources/magic/animation', AnimationClip, (err, clip) => {
            if (err || !clip) {
                console.warn('[UIGameLayer] load shuffle effect animation failed', err);
                return;
            }
            //clip.speed = 0.3;
            this.shuffleEffectClip = clip;
            if (this.shuffleEffectAnimation) {
                this.shuffleEffectAnimation.defaultClip = clip;
            }
        });
    }

    private ensureShuffleEffectNode(): Node {
        if (this.shuffleEffectNode?.isValid) return this.shuffleEffectNode;

        const node = new Node('shuffleEffectNode');
        node.layer = this.node.layer;
        node.active = false;
        this.node.addChild(node);
        node.addComponent(UITransform).setContentSize(212, 210);
        node.addComponent(Sprite);
        // const graphics = node.addComponent(Graphics);
        // graphics.lineWidth = 8;
        // graphics.strokeColor = new Color(255, 244, 156, 230);
        // graphics.circle(0, 0, 88);
        // graphics.stroke();
        this.shuffleEffectOpacity = node.addComponent(UIOpacity);
        this.shuffleEffectAnimation = node.addComponent(Animation);
        if (this.shuffleEffectClip) {
            this.shuffleEffectAnimation.defaultClip = this.shuffleEffectClip;
        }
        this.shuffleEffectNode = node;
        return node;
    }

    private onEventShowShuffleTileEffect(payload: ShuffleTileEffectPayload) {
        if (!payload?.worldPosition) return;

        const node = this.ensureShuffleEffectNode();
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        const localPosition = transform.convertToNodeSpaceAR(payload.worldPosition);
        const scale = payload.scale ?? Constants.MahjongBoard.BoardScale;
        const duration = payload.duration ?? Constants.shuffleAnim.Duration;
        const seq = ++this.shuffleEffectSeq;

        Tween.stopAllByTarget(node);
        if (this.shuffleEffectOpacity) Tween.stopAllByTarget(this.shuffleEffectOpacity);
        if (this.shuffleEffectAnimation) this.shuffleEffectAnimation.stop();

        node.active = true;
        node.setPosition(localPosition);
        node.setScale(1, 1, 1);
        node.setRotationFromEuler(0, 0, 0);
        node.setSiblingIndex(this.node.children.length - 1);
        if (this.shuffleEffectOpacity) this.shuffleEffectOpacity.opacity = 255;

        if (this.shuffleEffectAnimation && this.shuffleEffectClip) {
            this.shuffleEffectAnimation.defaultClip = this.shuffleEffectClip;
            this.shuffleEffectAnimation.play();
            this.scheduleOnce(() => {
                if (seq !== this.shuffleEffectSeq) return;
                if (node?.isValid) node.active = false;
            }, duration);
            return;
        }

        tween(node)
            .to(duration * 0.5, { scale: new Vec3(scale * 1.08, scale * 1.08, 1) }, { easing: 'sineOut' })
            .to(duration * 0.5, { scale: new Vec3(scale, scale, 1) }, { easing: 'sineInOut' })
            .call(() => {
                if (seq !== this.shuffleEffectSeq) return;
                if (node?.isValid) node.active = false;
            })
            .start();
    }


    onShowTipsAnimator(index: number) {
        // index 1 是 解锁槽位按钮  2 是换牌按钮
        let targetNode = index == 1 ? this.unlockButton : this.switchButton;
        let tipsNode = index == 1 ? this.unlockTipsNode : this.switchTipsNode;
        if(index == 3){
            targetNode = this.randomPropButton;
            tipsNode = this.randomPropTipsNode;
        }
        if (!targetNode || !tipsNode) return;

        // 同时只允许一个引导提示存在,触发前先把对方 index 的提示清理掉
        this.stopTipsAt(index === 1 ? 2 : 1);

        // 1. 停止这俩节点可能正在播放的动画，防止多次调用时发生动画叠加冲突
        Tween.stopAllByTarget(targetNode);

        let tipsOpacity = tipsNode.getComponent(UIOpacity);
        if (!tipsOpacity) {
            tipsOpacity = tipsNode.addComponent(UIOpacity);
        }
        Tween.stopAllByTarget(tipsOpacity);

        // ==========================================
        // 第一部分：Tips 节点 - 渐显 -> 保持 3 秒 -> 渐隐
        // ==========================================
        tipsNode.active = true;
        tipsOpacity.opacity = 0;

        tween(tipsOpacity)
            .to(0.3, { opacity: 255 })
            .delay(3.0)
            .to(0.3, { opacity: 0 })
            .call(() => {
                tipsNode.active = false;
            })
            .start();

        // ==========================================
        // 第二部分：按钮节点 - 1.5s 周期无限呼吸
        // ==========================================
        targetNode.setScale(new Vec3(1, 1, 1));

        tween(targetNode)
            .repeatForever(
                tween()
                    .to(0.75, { scale: new Vec3(1.07, 1.07, 1) })
                    .to(0.75, { scale: new Vec3(1, 1, 1) })
            )
            .start();

        // ==========================================
        // 第三部分：点击打断逻辑
        // ==========================================

        // 注册点击事件
        targetNode.once(Node.EventType.TOUCH_END, () => {
            // 停止按钮的呼吸动画并回正比例
            Tween.stopAllByTarget(targetNode);
            targetNode.setScale(new Vec3(1, 1, 1));
            // 通知 GameCtrl 引导提示已被玩家响应,可以解锁"动画中不计时"的状态
            director.emit(Constants.eventNames.EventTipsAnimatorEnd);
        }, this);
    }

    // GameCtrl 通知:玩家在提示动画中点了牌,把两侧提示一并清掉(以哪侧在播为准的成本反而更高)
    onStopTipsAnimator() {
        this.stopTipsAt(1);
        this.stopTipsAt(2);
    }

    // 把指定 index 那一侧的提示彻底清掉:停止按钮呼吸、停止 tips 渐显、隐藏 tips 节点
    private stopTipsAt(index: number) {
        const targetNode = index === 1 ? this.unlockButton : this.switchButton;
        const tipsNode = index === 1 ? this.unlockTipsNode : this.switchTipsNode;
        if (targetNode) {
            Tween.stopAllByTarget(targetNode);
            targetNode.setScale(new Vec3(1, 1, 1));
        }
        if (tipsNode) {
            const opacity = tipsNode.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            tipsNode.active = false;
        }
    }
}
