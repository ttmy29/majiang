import { _decorator, builtinResMgr, Button, Color, Component, director, instantiate, Label, Material, Node, Prefab, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { Constants } from './config/Constants';
import { LayerManager } from './manager/LayerManager';
import { MahjongItem } from './MahjongItem';
import { AudioManager, AudioClipNames } from './manager/AudioManager';
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
    @property(Node)
    unlockTipsNode: Node = null!;
    @property(Node)
    switchTipsNode: Node = null!;
    @property(Node)
    comboNode:Node = null!;
    @property(Node)
    comboLabelNode:Node = null!;

    // 每个槽位在场景里的原始位置，MoveIn 时回到自己的原点而不是写死坐标
    private slotOriginPositions: Vec3[] = [];

    // HUD label —— 由 GameCtrl emit EventHudUpdate / EventShowToast 触发渲染
    private targetLabel: Label = null!;
    private statusLabel: Label = null!;

    private toastLabel: Label = null!;

    // comboNode 下的进度条 fill 节点和连击计数文本
    private comboBarSprite: Sprite = null!;
    private comboCountLabel: Label = null!;
    // comboLabelNode 上挂的 Label,显示 "不错/厉害/..." 这种连击口号
    private comboTextLabel: Label = null!;
    // 当前已经播放到的连击口号下标(0~7),combo 中断或窗口到期时清零
    private comboAudioLevel = 0;
    // 每 3 次连击解锁下一级口号,与 COMBO_AUDIOS 长度对应,超过 7 后不再升级
    private static readonly COMBO_STEP = 3;
    // 连击窗口时长（秒），与 GameCtrl.updateCombo 中的 5000ms 保持一致
    private static readonly COMBO_DURATION = 5;
    // 连击口号:每 3 次连击按顺序播一个,同步在 comboLabelNode 上显示对应文本
    private static readonly COMBO_AUDIOS: { audio: AudioClipNames; text: string }[] = [
        { audio: AudioClipNames.combo_level1, text: '不错' },
        { audio: AudioClipNames.combo_level2, text: '厉害' },
        { audio: AudioClipNames.combo_level3, text: '牛的' },
        { audio: AudioClipNames.combo_level4, text: '绝了!' },
        { audio: AudioClipNames.combo_level5, text: '太强了!' },
        { audio: AudioClipNames.combo_level6, text: '赢麻了!' },
        { audio: AudioClipNames.combo_level7, text: '无敌了!' },
    ];

    // 目标槽预览相关 —— 由 EventGameUiInit 注入 prefab + 资源 map，EventRenderSlot 触发渲染
    private mahjongItem: Prefab = null!;
    private iconFrames: Map<string, SpriteFrame> = new Map();
    private slotPreviews: (Node | null)[] = [];

    protected onLoad() {
        this.slotOriginPositions = this.slotNodeArr.map(node => node ? node.position.clone() : new Vec3());
        this.setupHudLabels();
        this.setupComboNode();
    }

    private setupComboNode() {
        if (!this.comboNode) return;
        const progressBar = this.comboNode.getChildByName('ProgressBar');
        const bar = progressBar?.getChildByName('Bar');
        if (bar) this.comboBarSprite = bar.getComponent(Sprite)!;
        const countNode = this.comboNode.getChildByName('countLabel');
        if (countNode) this.comboCountLabel = countNode.getComponent(Label)!;
        if (this.comboLabelNode) {
            this.comboTextLabel = this.comboLabelNode.getComponent(Label)!;
            this.comboLabelNode.active = false;
        }
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
    }

    onEnable() {
        this.registerGlobalEvent(true);
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
            director.on(Constants.eventNames.EventRenderSlot, this.onEventRenderSlot, this);
            director.on(Constants.eventNames.EventClearSlot, this.onEventClearSlot, this);
            director.on(Constants.eventNames.EventResetSlots, this.onEventResetSlots, this);
            director.on(Constants.eventNames.EventSetUndoButtonStatus, this.onSetUndoButtonStatus, this);
            director.on(Constants.eventNames.EventShowTipsAnimator, this.onShowTipsAnimator, this);
            director.on(Constants.eventNames.EventStopTipsAnimator, this.onStopTipsAnimator, this);
        } else {
            director.off(Constants.eventNames.EventShowSlotShake, this.onEventShowSlotShake, this);
            director.off(Constants.eventNames.EventShowSlotUnlock, this.onEventShowSlotUnlock, this);
            director.off(Constants.eventNames.EventShowSlotMoveIn, this.onEventShowSlotMoveIn, this);
            director.off(Constants.eventNames.EventShowSlotMoveOut, this.onEventShowSlotMoveOut, this);
            director.off(Constants.eventNames.EventHudUpdate, this.onEventHudUpdate, this);
            director.off(Constants.eventNames.EventComboUpdate, this.onEventComboUpdate, this);
            director.off(Constants.eventNames.EventShowToast, this.onEventShowToast, this);
            director.off(Constants.eventNames.EventGameUiInit, this.onEventGameUiInit, this);
            director.off(Constants.eventNames.EventRenderSlot, this.onEventRenderSlot, this);
            director.off(Constants.eventNames.EventClearSlot, this.onEventClearSlot, this);
            director.off(Constants.eventNames.EventResetSlots, this.onEventResetSlots, this);
            director.off(Constants.eventNames.EventSetUndoButtonStatus, this.onSetUndoButtonStatus, this);
            director.off(Constants.eventNames.EventShowTipsAnimator, this.onShowTipsAnimator, this);
            director.off(Constants.eventNames.EventStopTipsAnimator, this.onStopTipsAnimator, this);
        }
    }

    onEventGameUiInit(payload: GameUiInitPayload) {
        this.mahjongItem = payload.mahjongItem;
        this.iconFrames = payload.iconFrames;
    }

    onEventRenderSlot(payload: RenderSlotPayload) {
        const slotNode = this.slotNodeArr[payload.slotID];
        if (!slotNode) {
            console.warn(`[UIGameLayer] onEventRenderSlot 找不到 slotID ${payload.slotID}`);
            return;
        }

        // 锁 / 提示 / 解锁按钮 等子节点的显隐
        const locked = !payload.unlocked;
        const lockNode = slotNode.getChildByName('lock');
        if (lockNode) lockNode.active = locked;
        const tipsNode = slotNode.getChildByName('tips');
        if (tipsNode) tipsNode.active = locked;
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
    }

    onEventHudUpdate(payload: HudPayload) {
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
        this.comboNode.active = true;
        if (this.comboCountLabel) this.comboCountLabel.string = `${comboTimes}`;

        // GameCtrl 在窗口过期后会把 comboTimes 重新置为 1,意味着开启新一轮 combo,
        // 已播放过的口号等级要从头来过,旧的 comboLabel 文本也要先收掉
        if (comboTimes <= 1) {
            this.comboAudioLevel = 0;
            if (this.comboLabelNode) this.comboLabelNode.active = false;
        }

        // 每 COMBO_STEP 次连击解锁下一级口号:第 3/6/9/... 次时按顺序播一个
        const targetLevel = Math.floor(comboTimes / UIGameLayer.COMBO_STEP);
        const maxLevel = UIGameLayer.COMBO_AUDIOS.length;
        if (targetLevel > this.comboAudioLevel && targetLevel <= maxLevel) {
            this.comboAudioLevel = targetLevel;
            this.playComboLevel(targetLevel - 1);
        }

        Tween.stopAllByTarget(this.comboBarSprite);
        this.comboBarSprite.fillRange = 1;
        tween(this.comboBarSprite)
            .to(UIGameLayer.COMBO_DURATION, { fillRange: 0 })
            .call(() => {
                if (this.comboNode?.isValid) this.comboNode.active = false;
                // 窗口走完意味着这一轮 combo 结束,下一次匹配再从 level1 开始
                this.comboAudioLevel = 0;
                if (this.comboLabelNode?.isValid) this.comboLabelNode.active = false;
            })
            .start();
    }

    // 播放对应等级的连击口号音效,同步在 comboLabelNode 上弹一下文本
    // 文本只跟着这次音效出现:弹入 → 短暂停留 → 自动收起,下次音效再播再显示
    private playComboLevel(index: number) {
        const entry = UIGameLayer.COMBO_AUDIOS[index];
        if (!entry) return;
        AudioManager.instance.playOneShot(entry.audio);
        if (!this.comboLabelNode) return;
        if (this.comboTextLabel) this.comboTextLabel.string = entry.text;
        Tween.stopAllByTarget(this.comboLabelNode);
        this.comboLabelNode.active = true;
        this.comboLabelNode.setScale(0.6, 0.6, 1);
        tween(this.comboLabelNode)
            .to(0.12, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'sineOut' })
            .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .delay(0.9)
            .call(() => {
                if (this.comboLabelNode?.isValid) this.comboLabelNode.active = false;
            })
            .start();
    }

    private resetComboNode() {
        if (this.comboBarSprite) {
            Tween.stopAllByTarget(this.comboBarSprite);
            this.comboBarSprite.fillRange = 1;
        }
        if (this.comboNode?.isValid) this.comboNode.active = false;
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
            .call(()=>{
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

        // 1. 停止当前节点的所有动画
        Tween.stopAllByTarget(targetNode);

        // 2. 判断是左侧还是右侧槽位 (通常 4 个槽位 0,1 为左，2,3 为右，你可以根据实际场景微调)
        const isLeft = slotID == 1 || slotID == 3;

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
        const targetPosX = !isLeft ? 1000 : -1000;

        tween(targetNode)
            .delay(0.3333)
            .to(0.3000, { position: new Vec3(targetPosX, targetNode.y, 0) }) // 大幅度斜向退场，飞出屏幕
            .start();
    }

    onEventShowSlotMoveIn(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotMoveIn 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }
        targetNode.getChildByName('box_2').active = false;
        // 1. 停止 MoveOut 可能带来的遗留动画
        Tween.stopAllByTarget(targetNode);
        // 任务箱滑回的起手音效
        AudioManager.instance.playOneShot(AudioClipNames.taskBoxMove);
        // 2. 回到该槽位在场景里的原始位置（不再写死 ±200, 0）
        const originPos = this.slotOriginPositions[slotID] ?? targetNode.position.clone();
        tween(targetNode)
            .to(0.3, { position: originPos.clone() }, { easing: 'quadOut' })
            .call(() => {
                targetNode.setPosition(originPos.clone());
            })
            .start();
    }

    onSetUndoButtonStatus(status: boolean) {
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

    onClickSetButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("setting", 1);
        //this.onShowTipsAnimator(1);
    }


    onShowTipsAnimator(index: number) {
        // index 1 是 解锁槽位按钮  2 是换牌按钮
        const targetNode = index == 1 ? this.unlockButton : this.switchButton;
        const tipsNode = index == 1 ? this.unlockTipsNode : this.switchTipsNode;

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


