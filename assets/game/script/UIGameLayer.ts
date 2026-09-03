import { _decorator, Animation, AnimationClip, assetManager, Button, Color, Component, director, instantiate, Label, Mask, Node, Prefab, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, v3, Vec3, view, Widget } from 'cc';
import { Constants } from './config/Constants';
import { GameMode } from './config/GameMode';
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

interface LevelStartPayload {
    level: number;
    difficultyLevel?: number;
    mode?: GameMode;
    boardId?: number;
    displayName?: string;
    openingToastText?: string;
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

interface IQUpdatePayload {
    value: number;
    addValue?: number;
    animate?: boolean;
    slotID?: number;
}

@ccclass('UIGameLayer')
export class UIGameLayer extends Component {
    private static readonly BOTTOM_UI_SLOT_ROOT_TOP = 933.632;
    private static readonly BOTTOM_UI_SLOT_ROOT_BOTTOM = 220.368;
    private static readonly BOTTOM_UI_STORED_SLOT_Y = 196.97;
    private static readonly BOTTOM_UI_RIGHT_TARGET_X = 151;
    // 在暂存布局基础上整体上移 30px，高度仍保持 641px。
    private static readonly BOTTOM_UI_BOARD_TOP = 93.9;
    private static readonly BOTTOM_UI_BOARD_BOTTOM = 599.1;
    private static readonly BOTTOM_UI_COMBO_TOP = 120;
    // 牌盒刷新播放 1s glow，旧盒在特效后半段同步下沉，收尾时保留一条底座边缘。
    private static readonly SLOT_GLOW_DURATION = 1;
    // glow/huaban 起效后很快清掉旧牌，不再等牌盒下沉完成。
    private static readonly SLOT_EFFECT_TILE_CLEAR_DELAY = 0.12;
    private static readonly SLOT_GROUP_COLLISION_SPREAD = 0.12;
    private static readonly SLOT_GROUP_COLLISION_IMPACT = 0.1;
    private static readonly SLOT_GROUP_COLLISION_REBOUND = 0.12;
    private static readonly SLOT_GROUP_COLLISION_DISTANCE = 24;
    private static readonly SLOT_REVEAL_DURATION = 0.5;
    // 小推板起点比 groove 的裁切底边再低一点，避免抗锯齿边缘漏出。
    private static readonly SLOT_SMALL_PAD_HIDDEN_EXTRA = 2;
    // 在 Inspector 停靠点基础上再多推出一点，让推板和带出的牌盒关系更明显。
    private static readonly SLOT_SMALL_PAD_PUSH_EXTRA = 24;
    // 推板到位时比牌盒上边缘多露出的高度，突出“推板带出牌盒”的层次。
    private static readonly SLOT_SMALL_PAD_VISIBLE_EXTENSION = 14;
    // 无法读取小推板尺寸时的兜底带出比例；正常情况会按小推板上边缘动态计算。
    private static readonly SLOT_SMALL_PAD_FALLBACK_LIFT_RATIO = 0.22;
    // 牌盒底边越过遮罩裁切线后再多留一点安全距离，避免阴影提前穿帮。
    private static readonly SLOT_REVEAL_MASK_CLEARANCE = 2;
    private static readonly SLOT_HIDE_SINK = 0.25;
    private static readonly SLOT_HIDE_DELAY = UIGameLayer.SLOT_GLOW_DURATION - UIGameLayer.SLOT_HIDE_SINK;
    private static readonly SLOT_REVEAL_START_SCALE = 0.91;
    // 退场结束/入场起始时，在凹槽裁切线上方保留的牌盒边缘高度。
    private static readonly SLOT_RETRACTED_VISIBLE_EDGE = 1;
    // 没有新目标时，让牌盒顶边再越过裁切线一段，确保完全移出。
    private static readonly SLOT_RETRACTED_HIDDEN_EXTRA = 18;
    // 没有创建遮罩时的位移兜底。
    private static readonly SLOT_REVEAL_START_OFFSET_RATIO = 1.10;
    private static readonly SLOT_GROOVE_WIDTH_RATIO = 1.044;
    // 新凹槽图为 454:145；按当前场景宽度等比缩放，避免旧 454:177 比例造成纵向拉高。
    private static readonly SLOT_GROOVE_HEIGHT_RATIO = 0.7954;
    private static readonly SLOT_GROOVE_Y_RATIO = -0.15;

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
    // slotNode 下新增的 box1~box4 背景节点，下标与 slotNodeArr 的目标槽位保持一致。
    private slotBoxBackgrounds: (Node | null)[] = [];
    // 目标牌盒运行时包进固定遮罩父节点；牌盒自身在遮罩内移动，形成从槽口顶出的裁切效果。
    private slotRevealMasks: (Node | null)[] = [];
    private slotGrooves: (Node | null)[] = [];
    private slotPads: (Node | null)[] = [];
    private slotSmallPads: (Node | null)[] = [];
    private slotSmallPadOriginPositions: Vec3[] = [];
    private slotDecorEnabled: boolean[] = [];
    private slotGrooveAnimationSeq: number[] = [];
    // 记录每个牌盒当前所处的位移动画阶段，避免撞击/解锁动画中断 MoveIn 的收尾回调后，
    // 把只应在升降期间开启的 Mask 永久留在常态界面上。
    private slotMotionPhases: ('idle' | 'moveOut' | 'moveIn')[] = [];
    private slotGlowPrefab: Prefab | null = null;
    private slotHuabanPrefab: Prefab | null = null;
    private slotGlowLoading = false;
    private slotHuabanLoading = false;
    private slotGlowEffects: (Node | null)[] = [];
    private slotGlowSeq: number[] = [];
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
    private iqLabel: Label | null = null;
    private iqEffectNode: Node | null = null;
    private currentIQValue = 0;
    private iqLabelDefaultStyle: {
        color: Color;
        enableOutline: boolean;
        outlineColor: Color;
        outlineWidth: number;
    } | null = null;
    private addIQCountPrefab: Prefab | null = null;
    private addIQCountLoading = false;
    private pendingIQAnimations: { addValue: number; position: Vec3 | null }[] = [];
    private isGuideLevel = false;
    private hasLevelUiMode = false;
    private slotRootTop = 0;
    private guideNode: Node | null = null;

    protected onLoad() {
        //背景适配
        this.adaptBackground();

        this.slotOriginPositions = this.slotNodeArr.map(node => node ? node.position.clone() : new Vec3());
        this.cacheSlotBoxBackgrounds();
        this.setupSlotRevealMasks();
        this.slotRootTop = this.getSlotRootWidget()?.top ?? 0;
        this.propButtonOriginPositions = [this.undoButton, this.switchButton, this.unlockButton].map(btn => btn ? btn.position.clone() : new Vec3());
        //this.setupHudLabels();
        this.setupComboNode();
        this.preloadSlotEffectPrefabs();
        this.preloadShuffleEffectClip();
    }

    private cacheSlotBoxBackgrounds() {
        const slotRoot = this.slotNodeArr[0]?.parent;
        for (let slotID = 1; slotID < this.slotNodeArr.length; slotID++) {
            this.slotBoxBackgrounds[slotID] = slotRoot?.getChildByName(`box${slotID}`) || null;
        }
    }

    private setSlotBoxBackgroundVisible(slotID: number, visible: boolean) {
        const boxBackground = this.slotBoxBackgrounds[slotID];
        // 新手引导只使用前两个目标槽，box3/box4 不能被动画收尾重新点亮。
        const shouldShow = visible && !(this.isGuideLevel && (slotID === 3 || slotID === 4));
        if (boxBackground?.isValid) boxBackground.active = shouldShow;
    }

    /**
     * 给 slot1~slot4 增加固定的矩形遮罩父节点。
     * 遮罩向上/左右留出余量，避免槽位挤压、解锁盖子飞出时被误裁；
     * 下边缘贴近牌盒底部，只在牌盒下沉/升起阶段裁切。
     */
    private setupSlotRevealMasks() {
        for (let slotID = 1; slotID < this.slotNodeArr.length; slotID++) {
            const slot = this.slotNodeArr[slotID];
            if (!slot?.isValid || !slot.parent) continue;

            const wrapperName = `slotRevealMask_${slotID}`;
            const currentParent = slot.parent;
            if (currentParent.name === wrapperName && currentParent.getComponent(Mask)) {
                this.slotRevealMasks[slotID] = currentParent;
                currentParent.getComponent(Mask)!.enabled = false;
                this.slotOriginPositions[slotID] = Vec3.ZERO.clone();
                const slotTransform = slot.getComponent(UITransform);
                this.ensureSlotGroove(
                    currentParent.parent,
                    currentParent,
                    slot,
                    slotTransform?.contentSize.width || 296,
                    slotTransform?.contentSize.height || 124,
                    slotID,
                    currentParent.position.clone(),
                );
                this.alignSlotRevealMaskToGroove(currentParent, this.slotGrooves[slotID]);
                continue;
            }

            const originalParent = currentParent;
            const originalSiblingIndex = slot.getSiblingIndex();
            const originalPosition = slot.position.clone();

            const wrapper = new Node(wrapperName);
            wrapper.layer = slot.layer;
            const wrapperTransform = wrapper.addComponent(UITransform);
            const slotTransform = slot.getComponent(UITransform);
            const slotWidth = slotTransform?.contentSize.width || 296;
            const slotHeight = slotTransform?.contentSize.height || 124;
            // 横向留出回弹空间；纵向把主要余量放在上方，底边仍可作为“槽口”裁切线。
            // 下边界比牌盒最终底边再低约 17% 高度。配合 0.95h 位移和 0.91 缩放，
            // 起始帧会露出约 19% 的牌盒高度，与参考视频的“先露一条薄边”比例一致。
            wrapperTransform.setContentSize(slotWidth * 1.5, slotHeight * 2.3);
            wrapperTransform.setAnchorPoint(0.5, 0.29);
            const mask = wrapper.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_RECT;
            // 常态关闭，避免裁切解锁盖子甩出；只在牌盒下沉/升起阶段开启。
            mask.enabled = false;

            originalParent.addChild(wrapper);
            wrapper.setPosition(originalPosition);
            wrapper.setSiblingIndex(Math.min(originalSiblingIndex, originalParent.children.length - 1));

            slot.setParent(wrapper, true);
            slot.setPosition(Vec3.ZERO);
            this.ensureSlotGroove(originalParent, wrapper, slot, slotWidth, slotHeight, slotID, originalPosition);
            this.alignSlotRevealMaskToGroove(wrapper, this.slotGrooves[slotID]);

            this.slotRevealMasks[slotID] = wrapper;
            // 包装后牌盒的动画原点变为遮罩父节点内的 (0, 0)。
            this.slotOriginPositions[slotID] = Vec3.ZERO.clone();
        }
    }

    /** 使用场景中已配置的垫子/凹槽节点；节点尺寸和位置由 Inspector 保留并可直接调整。 */
    private ensureSlotGroove(
        originalParent: Node | null,
        wrapper: Node,
        slot: Node,
        slotWidth: number,
        slotHeight: number,
        slotID: number,
        originalPosition: Vec3,
    ) {
        if (!originalParent?.isValid) return;
        const grooveName = `slotGroove_${slotID}`;
        const padName = `slotPad_${slotID}`;
        const smallPadName = `slotPadSmall_${slotID}`;
        // 这些节点已放进 game.scene：已有节点的 UITransform 不覆盖，方便直接在 Inspector 调整。
        const oldChildGroove = wrapper.getChildByName(grooveName);
        if (oldChildGroove) oldChildGroove.removeFromParent();
        let groove = originalParent.getChildByName(grooveName);
        const grooveWasCreated = !groove;
        if (!groove) {
            groove = new Node(grooveName);
            groove.layer = slot.layer;
            originalParent.addChild(groove);
        }
        let pad = originalParent.getChildByName(padName);
        const padWasCreated = !pad;
        if (!pad) {
            pad = new Node(padName);
            pad.layer = slot.layer;
            originalParent.addChild(pad);
        }
        // 小垫片属于凹槽的内部层，不再作为 slotNode 下的独立装饰显示。
        // 兼容旧场景：如果仍是 groove 的兄弟节点，运行时保留世界坐标并迁入 groove。
        let smallPad = groove.getChildByName(smallPadName)
            || groove.getChildByName('slotPadSmall')
            || originalParent.getChildByName(smallPadName)
            || originalParent.getChildByName('slotPadSmall');
        const smallPadWasCreated = !smallPad;
        if (!smallPad) {
            smallPad = new Node(smallPadName);
            smallPad.layer = slot.layer;
            groove.addChild(smallPad);
        } else if (smallPad.parent !== groove) {
            smallPad.setParent(groove, true);
        }

        const transform = groove.getComponent(UITransform) || groove.addComponent(UITransform);
        const sprite = groove.getComponent(Sprite) || groove.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.color = Color.WHITE;
        if (grooveWasCreated) {
            transform.setContentSize(slotWidth * UIGameLayer.SLOT_GROOVE_WIDTH_RATIO, slotHeight * UIGameLayer.SLOT_GROOVE_HEIGHT_RATIO);
            groove.setPosition(
                originalPosition.x,
                originalPosition.y + slotHeight * UIGameLayer.SLOT_GROOVE_Y_RATIO,
                originalPosition.z,
            );
        }
        // 装饰永远排在所有牌盒 wrapper 后面，避免还原/重开时绿色垫子盖住牌盒。
        groove.setSiblingIndex(0);
        groove.active = false;

        const padTransform = pad.getComponent(UITransform) || pad.addComponent(UITransform);
        const padSprite = pad.getComponent(Sprite) || pad.addComponent(Sprite);
        padSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        padSprite.type = Sprite.Type.SIMPLE;
        padSprite.color = Color.WHITE;
        if (padWasCreated) {
            padTransform.setContentSize(slotWidth * UIGameLayer.SLOT_GROOVE_WIDTH_RATIO, slotHeight * 0.88);
            pad.setPosition(
                originalPosition.x,
                originalPosition.y + slotHeight * UIGameLayer.SLOT_GROOVE_Y_RATIO,
                originalPosition.z,
            );
        }
        pad.setSiblingIndex(0);
        pad.active = true;

        const smallPadTransform = smallPad.getComponent(UITransform) || smallPad.addComponent(UITransform);
        const smallPadSprite = smallPad.getComponent(Sprite) || smallPad.addComponent(Sprite);
        smallPadSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        smallPadSprite.type = Sprite.Type.SIMPLE;
        smallPadSprite.color = Color.WHITE;
        if (smallPadWasCreated) {
            smallPadTransform.setContentSize(slotWidth * UIGameLayer.SLOT_GROOVE_WIDTH_RATIO, slotHeight * 0.88);
            smallPad.setPosition(Vec3.ZERO);
        }
        // groove 的 Sprite 先绘制，内部小垫片作为子节点绘制在深色槽面上方。
        smallPad.setSiblingIndex(groove.children.length - 1);
        smallPad.active = false;
        this.slotGrooves[slotID] = groove;
        this.slotPads[slotID] = pad;
        this.slotSmallPads[slotID] = smallPad;
        this.slotSmallPadOriginPositions[slotID] = smallPad.position.clone();
        this.slotDecorEnabled[slotID] = false;
        groove.active = false;
        pad.active = false;
        smallPad.active = false;
    }

    /**
     * 将遮罩底边对齐到场景中 slotGroove 的实际底边。
     * 这样美术在 Inspector 调整凹槽尺寸/位置后，牌盒下沉的裁切线仍会自动跟随。
     */
    private alignSlotRevealMaskToGroove(wrapper: Node, groove: Node | null) {
        if (!wrapper?.isValid || !groove?.isValid) return;
        const wrapperTransform = wrapper.getComponent(UITransform);
        const grooveTransform = groove.getComponent(UITransform);
        if (!wrapperTransform || !grooveTransform || wrapperTransform.contentSize.height <= 0) return;

        // wrapper 与 groove 当前是同一父节点的兄弟，位置差即可得到 groove 在 wrapper 内的坐标。
        const grooveBottomInWrapper =
            groove.position.y
            - wrapper.position.y
            - grooveTransform.anchorPoint.y * grooveTransform.contentSize.height;
        const anchorY = Math.max(
            0.02,
            Math.min(0.98, -grooveBottomInWrapper / wrapperTransform.contentSize.height),
        );
        wrapperTransform.setAnchorPoint(0.5, anchorY);
    }

    private setSlotDecorEnabled(slotID: number, enabled: boolean) {
        this.slotDecorEnabled[slotID] = enabled;
        const groove = this.slotGrooves[slotID];
        const pad = this.slotPads[slotID];
        const smallPad = this.slotSmallPads[slotID];
        this.resetSlotSmallPad(slotID);
        if (!enabled) {
            if (groove?.isValid) groove.active = false;
            if (pad?.isValid) pad.active = false;
            if (smallPad?.isValid) smallPad.active = false;
            return;
        }
        // 默认态只显示大垫子。小垫片属于 groove 的内部层，保持关闭。
        if (groove?.isValid) groove.active = false;
        if (pad?.isValid) pad.active = true;
        if (smallPad?.isValid) smallPad.active = false;
    }

    private setSlotGrooveVisible(slotID: number, visible: boolean) {
        if (!this.slotDecorEnabled[slotID]) return;
        const groove = this.slotGrooves[slotID];
        const pad = this.slotPads[slotID];
        const smallPad = this.slotSmallPads[slotID];
        if (!visible) this.resetSlotSmallPad(slotID);
        if (groove?.isValid) groove.active = visible;
        if (pad?.isValid) pad.active = !visible;
        // 小推板只在 MoveIn 设置好完全隐藏的起点后单独启用，避免 MoveOut 阶段提前露出。
        if (smallPad?.isValid) smallPad.active = false;
    }

    private resetSlotSmallPad(slotID: number) {
        const smallPad = this.slotSmallPads[slotID];
        if (!smallPad?.isValid) return;
        Tween.stopAllByTarget(smallPad);
        const origin = this.slotSmallPadOriginPositions[slotID];
        if (origin) smallPad.setPosition(origin.clone());
    }

    /** 把小推板放到完全隐藏的起点，并计算推出终点及其上边缘位置。 */
    private prepareSlotSmallPadPush(slotID: number): {
        pushPosition: Vec3;
        pushedTopEdgeY: number | null;
    } | null {
        if (!this.slotDecorEnabled[slotID]) return null;
        const smallPad = this.slotSmallPads[slotID];
        const origin = this.slotSmallPadOriginPositions[slotID];
        if (!smallPad?.isValid || !origin) return null;

        this.resetSlotSmallPad(slotID);
        const pushPosition = new Vec3(
            origin.x,
            origin.y + UIGameLayer.SLOT_SMALL_PAD_PUSH_EXTRA,
            origin.z,
        );
        const smallPadTransform = smallPad.getComponent(UITransform);
        const grooveTransform = smallPad.parent?.getComponent(UITransform);
        const slotParentTransform = this.slotNodeArr[slotID]?.parent?.getComponent(UITransform);
        let pushedTopEdgeY: number | null = null;
        if (smallPadTransform && slotParentTransform) {
            // 临时放到推出终点换算边缘坐标，同一帧会继续切到隐藏起点，不会被渲染出来。
            smallPad.setPosition(pushPosition);
            const topEdgeWorld = smallPadTransform.convertToWorldSpaceAR(new Vec3(
                0,
                smallPadTransform.contentSize.height * (1 - smallPadTransform.anchorPoint.y),
                0,
            ));
            pushedTopEdgeY = slotParentTransform.convertToNodeSpaceAR(topEdgeWorld).y;
        }
        const hiddenPosition = origin.clone();
        if (smallPadTransform && grooveTransform) {
            const scaledTopOffset = smallPadTransform.contentSize.height
                * Math.abs(smallPad.scale.y)
                * (1 - smallPadTransform.anchorPoint.y);
            hiddenPosition.y = -grooveTransform.contentSize.height * grooveTransform.anchorPoint.y
                - scaledTopOffset
                - UIGameLayer.SLOT_SMALL_PAD_HIDDEN_EXTRA;
        } else {
            hiddenPosition.y -= 124;
        }
        smallPad.setPosition(hiddenPosition);
        smallPad.active = true;
        return { pushPosition, pushedTopEdgeY };
    }

    private playSlotSmallPadPush(slotID: number, pushPosition: Vec3, duration: number) {
        const smallPad = this.slotSmallPads[slotID];
        if (!smallPad?.isValid) return;
        tween(smallPad)
            .to(duration, {
                position: pushPosition,
            }, { easing: 'sineIn' })
            .start();
    }

    private setSlotGrooveAnimationState(slotID: number, _visible: boolean): number {
        const seq = (this.slotGrooveAnimationSeq[slotID] || 0) + 1;
        this.slotGrooveAnimationSeq[slotID] = seq;
        this.setSlotGrooveVisible(slotID, _visible);
        return seq;
    }

    private setSlotRevealMaskEnabled(slotID: number, enabled: boolean) {
        const wrapper = this.slotRevealMasks[slotID];
        const mask = wrapper?.getComponent(Mask);
        if (mask) mask.enabled = enabled;
    }

    /** 把牌盒恢复到常态完整显示；可选 seq 用来拦截上一轮动画的延迟收尾。 */
    private restoreSlotStableVisualState(slotID: number, seq?: number): boolean {
        if (seq !== undefined && this.slotGrooveAnimationSeq[slotID] !== seq) return false;
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode?.isValid) return false;

        const origin = this.slotOriginPositions[slotID];
        if (origin) targetNode.setPosition(origin.clone());
        targetNode.setScale(1, 1, 1);
        const opacity = targetNode.getComponent(UIOpacity) || targetNode.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 255;
        this.setSlotBoxBackgroundVisible(slotID, true);
        this.setSlotRevealMaskEnabled(slotID, false);
        this.setSlotGrooveVisible(slotID, false);
        const motionStreakNode = targetNode.getChildByName('motionStreak');
        if (motionStreakNode?.isValid) motionStreakNode.active = false;
        this.slotMotionPhases[slotID] = 'idle';
        return true;
    }

    private finishSlotMoveIn(slotID: number, seq: number): boolean {
        if (this.slotMotionPhases[slotID] !== 'moveIn') return false;
        return this.restoreSlotStableVisualState(slotID, seq);
    }

    private setSlotAtRevealStart(slotID: number): Node | null {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) return null;

        Tween.stopAllByTarget(targetNode);
        const originPos = this.slotOriginPositions[slotID] ?? targetNode.position.clone();
        const opacity = targetNode.getComponent(UIOpacity) || targetNode.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 255;
        const startScale = UIGameLayer.SLOT_REVEAL_START_SCALE;
        targetNode.setPosition(this.getSlotRetractedPosition(slotID, originPos, startScale));
        targetNode.setScale(startScale, startScale, 1);
        this.setSlotRevealMaskEnabled(slotID, true);
        return targetNode;
    }

    private getSlotRetractedPosition(
        slotID: number,
        originPos: Vec3,
        scale: number,
        keepVisibleEdge = true,
    ): Vec3 {
        const targetNode = this.slotNodeArr[slotID];
        const slotTransform = targetNode?.getComponent(UITransform);
        const slotHeight = slotTransform?.contentSize.height || 124;
        const wrapperTransform = this.slotRevealMasks[slotID]?.getComponent(UITransform);
        const slotAnchorY = slotTransform?.anchorPoint.y ?? 0.5;
        const slotTopOffset = slotHeight * scale * (1 - slotAnchorY);
        const edgeOffset = keepVisibleEdge
            ? UIGameLayer.SLOT_RETRACTED_VISIBLE_EDGE
            : -UIGameLayer.SLOT_RETRACTED_HIDDEN_EXTRA;
        const retractedY = wrapperTransform
            ? -wrapperTransform.contentSize.height * wrapperTransform.anchorPoint.y
                - slotTopOffset
                + edgeOffset
            : originPos.y - slotHeight * (keepVisibleEdge
                ? UIGameLayer.SLOT_REVEAL_START_OFFSET_RATIO
                : 1.4);
        return new Vec3(originPos.x, retractedY, originPos.z);
    }

    /** 应用“牌盒在下”暂存方案中的场景坐标；对照组完全沿用 scene 原值。 */
    private applyBottomUiExperimentLayout() {
        const slotRoot = this.slotNodeArr[0]?.parent || null;
        const slotRootWidget = slotRoot?.getComponent(Widget) || null;
        if (slotRootWidget) {
            slotRootWidget.isAlignTop = false;
            slotRootWidget.isAlignBottom = true;
            slotRootWidget.top = UIGameLayer.BOTTOM_UI_SLOT_ROOT_TOP;
            slotRootWidget.bottom = UIGameLayer.BOTTOM_UI_SLOT_ROOT_BOTTOM;
            slotRootWidget.updateAlignment();
        }

        const storedSlot = this.slotNodeArr[0];
        if (storedSlot) {
            storedSlot.setPosition(storedSlot.position.x, UIGameLayer.BOTTOM_UI_STORED_SLOT_Y, storedSlot.position.z);
        }
        for (const index of [2, 4]) {
            const target = this.slotNodeArr[index];
            if (target) target.setPosition(UIGameLayer.BOTTOM_UI_RIGHT_TARGET_X, target.position.y, target.position.z);
        }

        const boardNode = this.node.getChildByName('pNode');
        const boardWidget = boardNode?.getComponent(Widget) || null;
        if (boardWidget) {
            boardWidget.isAlignTop = true;
            boardWidget.isAlignBottom = true;
            boardWidget.top = UIGameLayer.BOTTOM_UI_BOARD_TOP;
            boardWidget.bottom = UIGameLayer.BOTTOM_UI_BOARD_BOTTOM;
            boardWidget.updateAlignment();
        }

        const comboWidget = this.comboNode?.getComponent(Widget) || null;
        if (comboWidget) {
            comboWidget.top = UIGameLayer.BOTTOM_UI_COMBO_TOP;
            comboWidget.updateAlignment();
        }
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
        this.clearAllSlotGlowEffects();
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
            director.on(Constants.eventNames.EventUIPrefabsReady, this.onUIPrefabsReady, this);
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
            director.on(Constants.eventNames.EventIQUpdate, this.onEventIQUpdate, this);
            director.on(Constants.eventNames.EventSetIQLabelVisible, this.onEventSetIQLabelVisible, this);
        } else {
            director.off(Constants.eventNames.EventShowSlotShake, this.onEventShowSlotShake, this);
            director.off(Constants.eventNames.EventShowSlotUnlock, this.onEventShowSlotUnlock, this);
            director.off(Constants.eventNames.EventShowSlotMoveIn, this.onEventShowSlotMoveIn, this);
            director.off(Constants.eventNames.EventShowSlotMoveOut, this.onEventShowSlotMoveOut, this);
            director.off(Constants.eventNames.EventHudUpdate, this.onEventHudUpdate, this);
            director.off(Constants.eventNames.EventComboUpdate, this.onEventComboUpdate, this);
            director.off(Constants.eventNames.EventShowToast, this.onEventShowToast, this);
            director.off(Constants.eventNames.EventGameUiInit, this.onEventGameUiInit, this);
            director.off(Constants.eventNames.EventUIPrefabsReady, this.onUIPrefabsReady, this);
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
            director.off(Constants.eventNames.EventIQUpdate, this.onEventIQUpdate, this);
            director.off(Constants.eventNames.EventSetIQLabelVisible, this.onEventSetIQLabelVisible, this);
        }
    }

    onEventGameUiInit(payload: GameUiInitPayload) {
        this.mahjongItem = payload.mahjongItem;
        this.iconFrames = payload.iconFrames;
    }

    private onUIPrefabsReady() {
        if (this.isGuideLevel) this.setGuideVisible(true, 0);
    }

    onEventLevelStart(payloadOrLevel: LevelStartPayload | number, difficultyLevel = 0) {
        const payload: LevelStartPayload = typeof payloadOrLevel === 'number'
            ? { level: payloadOrLevel, difficultyLevel, mode: 'main' }
            : payloadOrLevel;
        const level = payload.level;
        const mode = payload.mode || 'main';

        this.hasLevelUiMode = true;
        this.isGuideLevel = mode === 'main' && level === 0;
        this.pendingIQAnimations.length = 0;
        this.clearComboBoxEffects();
        this.resetComboNode();
        this.applyLevelUiMode();
        this.setIQLabelVisible(!this.isGuideLevel);
        this.onEventIQUpdate({ value: 40, animate: false });
        this.setGuideVisible(this.isGuideLevel, level);



        if (payload.openingToastText) LayerManager.instance.showToast(payload.openingToastText);

    }

    private onEventHideGuide() {
        this.setGuideVisible(false, 0);
    }

    private onEventIQUpdate(payload: IQUpdatePayload) {
        if (!payload || typeof payload.value !== 'number') return;
        this.currentIQValue = payload.value;
        const label = this.ensureIQLabel();
        if (label) label.string = this.formatIQNumber(payload.value);
        this.updateIQEffectVisual(payload.value);
        if (!payload.animate || !payload.addValue || payload.addValue <= 0) return;
        if (this.isGuideLevel) return;
        this.playAddIQAnimation(payload.addValue, this.getIQAnimationPosition(payload.slotID));
    }

    private onEventSetIQLabelVisible(visible: boolean) {
        this.setIQLabelVisible(visible);
    }

    private setIQLabelVisible(visible: boolean) {
        const label = this.ensureIQLabel();
        if (label?.node?.isValid) label.node.active = visible;
        this.updateIQEffectVisual(this.currentIQValue);
    }

    private ensureIQLabel(): Label | null {
        if (!this.iqLabel?.isValid) {
            const node = this.findChildByName(this.node, 'iqLabel');
            this.iqLabel = node?.getComponent(Label) || null;
        }
        if (this.iqLabel && !this.iqLabelDefaultStyle) {
            this.iqLabelDefaultStyle = {
                color: this.iqLabel.color.clone(),
                enableOutline: this.iqLabel.enableOutline,
                outlineColor: this.iqLabel.outlineColor.clone(),
                outlineWidth: this.iqLabel.outlineWidth,
            };
        }
        return this.iqLabel;
    }

    private ensureIQEffectNode(): Node | null {
        if (!this.iqEffectNode?.isValid) {
            this.iqEffectNode = this.findChildByName(this.node, 'IQ_effect');
        }
        return this.iqEffectNode;
    }

    private updateIQEffectVisual(value: number) {
        const label = this.ensureIQLabel();
        const effectNode = this.ensureIQEffectNode();
        const enhanced = value >= 50;

        if (effectNode?.isValid) effectNode.active = enhanced && !!label?.node.active;
        if (!label) return;

        if (enhanced) {
            label.color = new Color(0xf6, 0xdd, 0x11, 255);
            label.enableOutline = true;
            label.outlineWidth = 2;
            label.outlineColor = new Color(0x61, 0x24, 0x03, 255);
            return;
        }

        if (this.iqLabelDefaultStyle) {
            label.color = this.iqLabelDefaultStyle.color.clone();
            label.enableOutline = this.iqLabelDefaultStyle.enableOutline;
            label.outlineWidth = this.iqLabelDefaultStyle.outlineWidth;
            label.outlineColor = this.iqLabelDefaultStyle.outlineColor.clone();
        }
    }

    private formatIQNumber(value: number): string {
        const fixed = (Math.round(value * 10) / 10).toFixed(1);
        return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
    }

    private playAddIQAnimation(addValue: number, position: Vec3 | null) {
        if (!this.addIQCountPrefab) {
            this.pendingIQAnimations.push({ addValue, position });
            this.loadAddIQCountPrefab();
            return;
        }
        this.spawnAddIQAnimation(addValue, position);
    }

    private loadAddIQCountPrefab() {
        if (this.addIQCountLoading || this.addIQCountPrefab) return;
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.warn('[UIGameLayer] game bundle not found for addIQCount');
            this.pendingIQAnimations.length = 0;
            return;
        }

        this.addIQCountLoading = true;
        bundle.load<Prefab>('prefab/addIQCount', Prefab, (err, prefab) => {
            this.addIQCountLoading = false;
            if (!this.node?.isValid) return;
            if (err || !prefab) {
                console.warn('[UIGameLayer] load addIQCount prefab failed', err);
                this.pendingIQAnimations.length = 0;
                return;
            }

            this.addIQCountPrefab = prefab;
            const pending = this.pendingIQAnimations.splice(0);
            for (const item of pending) this.spawnAddIQAnimation(item.addValue, item.position);
        });
    }

    private spawnAddIQAnimation(addValue: number, position: Vec3 | null) {
        if (!this.node?.isValid) return;
        if (!this.addIQCountPrefab) return;
        const startPosition = position || this.getIQLabelPosition();
        if (!startPosition) return;

        const node = instantiate(this.addIQCountPrefab);
        node.layer = this.node.layer;
        this.node.addChild(node);
        node.setPosition(startPosition);
        node.setScale(new Vec3(0.35, 0.35, 1));
        node.setSiblingIndex(this.node.children.length - 1);

        const addLabel = node.getChildByName('label')?.getComponent(Label) || this.findLabelInNode(node);
        if (addLabel) addLabel.string = `+${this.formatIQNumber(addValue)}`;

        const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        opacity.opacity = 255;
        Tween.stopAllByTarget(node);
        Tween.stopAllByTarget(opacity);

        const startPos = node.position.clone();
        const endPos = new Vec3(startPos.x, startPos.y + 70, startPos.z);
        tween(node)
            .to(0.16, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .to(0.55, { position: endPos }, { easing: 'sineOut' })
            .call(() => {
                if (node?.isValid) node.destroy();
            })
            .start();
        tween(opacity)
            .delay(0.24)
            .to(0.55, { opacity: 0 }, { easing: 'sineOut' })
            .start();
    }

    private findLabelInNode(node: Node): Label | null {
        const label = node.getComponent(Label);
        if (label) return label;
        for (const child of node.children) {
            const childLabel = this.findLabelInNode(child);
            if (childLabel) return childLabel;
        }
        return null;
    }

    private getIQAnimationPosition(slotID?: number): Vec3 | null {
        if (typeof slotID === 'number' && slotID >= 0) {
            const slotNode = this.slotNodeArr[slotID];
            if (slotNode?.isValid) return this.getLocalPositionInLayer(slotNode);
        }
        return this.getIQLabelPosition();
    }

    private getIQLabelPosition(): Vec3 | null {
        const label = this.ensureIQLabel();
        if (!label?.node?.isValid) return null;
        return this.getLocalPositionInLayer(label.node);
    }

    private getLocalPositionInLayer(source: Node): Vec3 {
        if (source.parent === this.node) return source.position.clone();
        const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        return transform.convertToNodeSpaceAR(source.worldPosition);
    }

    private findChildByName(parent: Node, name: string): Node | null {
        const direct = parent.getChildByName(name);
        if (direct) return direct;
        for (const child of parent.children) {
            const found = this.findChildByName(child, name);
            if (found) return found;
        }
        return null;
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
        this.setSlotBoxBackgroundVisible(3, !this.isGuideLevel);
        this.setSlotBoxBackgroundVisible(4, !this.isGuideLevel);

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
        this.setSlotDecorEnabled(payload.slotID, payload.unlocked);
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
        this.clearSlotTileVisuals(payload.slotID);
    }

    private clearSlotTileVisuals(slotID: number) {
        const slotNode = this.slotNodeArr[slotID];
        if (!slotNode) return;

        const preview = this.slotPreviews[slotID];
        if (preview?.isValid) {
            Tween.stopAllByTarget(preview);
            // 先 removeFromParent 再 destroy:Cocos 的 destroy 延迟到帧末执行,
            // 期间 MahjongItem.onDisable 会把 scale 强制改回 BoardScale(0.57),
            // 如果节点仍挂在 slotNode 下,玩家会看到预览先放大到 0.57 再被新 preview 替换成 0.36,
            // 表现为"肉眼可见的缩小一下"。先脱离父节点就不会再渲染那一帧。
            preview.removeFromParent();
            preview.destroy();
        }
        this.slotPreviews[slotID] = null;

        // 兜底：扫一遍 slot 子节点，把所有目标预览/已收集的牌都清掉
        for (const child of slotNode.children.slice()) {
            if (child.name.startsWith('targetPreview_') || child.name.startsWith('targetTile_')) {
                Tween.stopAllByTarget(child);
                child.removeFromParent();
                child.destroy();
            }
        }
    }

    private scheduleSlotTileClearAfterEffect(slotID: number, grooveSeq: number) {
        this.scheduleOnce(() => {
            if (this.slotGrooveAnimationSeq[slotID] !== grooveSeq
                || this.slotMotionPhases[slotID] !== 'moveOut') return;
            this.clearSlotTileVisuals(slotID);
        }, UIGameLayer.SLOT_EFFECT_TILE_CLEAR_DELAY);
    }

    // 关卡重开时一次性把所有槽位的 transform/box_2 复位到场景初始状态，
    // 把上一局 MoveOut/Shake/Unlock 留下的脏 tween 全部冲掉
    onEventResetSlots(payload: ResetSlotsPayload) {
        this.clearComboBoxEffects();
        this.clearAllSlotGlowEffects();
        for (let i = 1; i < this.slotNodeArr.length; i++) {
            this.setSlotDecorEnabled(i, false);
        }
        for (let i = 0; i < this.slotNodeArr.length; i++) {
            const slot = this.slotNodeArr[i];
            if (!slot) continue;
            Tween.stopAllByTarget(slot);
            this.setSlotGrooveAnimationState(i, false);
            this.restoreSlotStableVisualState(i);
            slot.setRotationFromEuler(new Vec3(0, 0, 0));
        }

        for (const state of payload.targetBoxStates) {
            const slot = this.slotNodeArr[state.slotID];
            if (!slot) continue;
            this.targetSlotUnlocked[state.slotID] = state.unlocked;
            const locked = !state.unlocked;
            this.setSlotDecorEnabled(state.slotID, state.unlocked);

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
            Tween.stopAllByTarget(slot);
            this.setSlotGrooveAnimationState(i, false);
            this.restoreSlotStableVisualState(i);
            this.setSlotDecorEnabled(i, false);
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
        effectNode.setPosition(-2, -7, 0);
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

        // MoveOut 期间不应再接收牌；若有迟到事件也不能让 Shake 截断下沉动画。
        if (this.slotMotionPhases[slotID] === 'moveOut') return;

        // 2. 停止该节点上可能正在播放的缩放动画
        Tween.stopAllByTarget(targetNode);

        // MoveIn 的总时长和业务层 movingIn 等待都是 0.5s。同一帧中业务回调可能先触发 Shake，
        // stopAllByTarget 会令 MoveIn 最后的 .call() 不再执行。这里先主动完成收尾，确保 Mask 关闭。
        if (this.slotMotionPhases[slotID] === 'moveIn') {
            this.finishSlotMoveIn(slotID, this.slotGrooveAnimationSeq[slotID]);
        } else {
            this.restoreSlotStableVisualState(slotID);
        }

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


    // 解锁槽位：移除旧的盒盖甩出/回弹，直接复用新目标槽从底部升起的动画。
    onEventShowSlotUnlock(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotUnlock 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }

        // 停掉锁盖可能残留的 tween，并立即隐藏所有锁定态节点。
        Tween.stopAllByTarget(targetNode);
        this.restoreSlotStableVisualState(slotID);
        for (const child of targetNode.children) {
            const name = child.name.toLowerCase();
            if (child.name === 'box_2'
                || child.name === 'lock'
                || child.name === 'tips'
                || name.includes('unlock')
                || child.name.includes('解锁')) {
                Tween.stopAllByTarget(child);
                const opacity = child.getComponent(UIOpacity);
                if (opacity) Tween.stopAllByTarget(opacity);
                child.active = false;
            }
        }

        // 新目标牌已在业务层创建，随整个槽位一起从槽口底部升起。
        this.onEventShowSlotMoveIn(slotID);
    }

    private preloadSlotEffectPrefabs() {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.warn('[UIGameLayer] game bundle not found for merge effects');
            return;
        }

        if (!this.slotGlowPrefab && !this.slotGlowLoading) {
            this.slotGlowLoading = true;
            bundle.load<Prefab>('prefab/glow', Prefab, (err, prefab) => {
                this.slotGlowLoading = false;
                if (!this.node?.isValid) return;
                if (err || !prefab) {
                    console.warn('[UIGameLayer] load glow prefab failed', err);
                    return;
                }
                this.slotGlowPrefab = prefab;
            });
        }

        if (!this.slotHuabanPrefab && !this.slotHuabanLoading) {
            this.slotHuabanLoading = true;
            bundle.load<Prefab>('prefab/huaban', Prefab, (err, prefab) => {
                this.slotHuabanLoading = false;
                if (!this.node?.isValid) return;
                if (err || !prefab) {
                    console.warn('[UIGameLayer] load huaban prefab failed', err);
                    return;
                }
                this.slotHuabanPrefab = prefab;
            });
        }
    }

    private playSlotGlow(slotID: number) {
        const targetNode = this.slotNodeArr[slotID];
        const effects: { name: 'glow' | 'huaban'; prefab: Prefab }[] = [];
        if (this.slotGlowPrefab) effects.push({ name: 'glow', prefab: this.slotGlowPrefab });
        if (this.slotHuabanPrefab) effects.push({ name: 'huaban', prefab: this.slotHuabanPrefab });
        if (!targetNode?.isValid || effects.length === 0) {
            if (effects.length === 0) this.preloadSlotEffectPrefabs();
            return;
        }
        const selected = effects[Math.floor(Math.random() * effects.length)];

        this.clearSlotGlowEffect(slotID);
        const seq = this.slotGlowSeq[slotID];
        const effectNode = instantiate(selected.prefab);
        effectNode.name = `slotMergeEffect_${selected.name}_${slotID}`;
        effectNode.layer = targetNode.layer;

        // glow 要留在槽口上方，不能挂在会下沉的牌盒上，也不能被 reveal Mask 裁掉。
        const effectParent = targetNode.parent?.parent || targetNode.parent || this.node;
        effectParent.addChild(effectNode);
        effectNode.setWorldPosition(targetNode.worldPosition);
        effectNode.setSiblingIndex(effectParent.children.length - 1);
        this.slotGlowEffects[slotID] = effectNode;

        const animation = effectNode.getComponent(Animation);
        if (animation) {
            animation.play(selected.name);
            AudioManager.instance.playOneShot(AudioClipNames.mahjong_merge_sd);
        } else {
            console.warn(`[UIGameLayer] ${selected.name} prefab has no Animation component`);
        }

        this.scheduleOnce(() => {
            if (this.slotGlowSeq[slotID] !== seq || this.slotGlowEffects[slotID] !== effectNode) return;
            this.clearSlotGlowEffect(slotID);
        }, UIGameLayer.SLOT_GLOW_DURATION + 0.05);
    }

    private clearSlotGlowEffect(slotID: number) {
        this.slotGlowSeq[slotID] = (this.slotGlowSeq[slotID] || 0) + 1;
        const effectNode = this.slotGlowEffects[slotID];
        if (effectNode?.isValid) {
            effectNode.getComponent(Animation)?.stop();
            effectNode.removeFromParent();
            effectNode.destroy();
        }
        this.slotGlowEffects[slotID] = null;
    }

    private clearAllSlotGlowEffects() {
        for (let slotID = 1; slotID < this.slotNodeArr.length; slotID++) {
            this.clearSlotGlowEffect(slotID);
        }
    }

    /**
     * 目标预览牌 + 3 张收集牌共 4 张：左边两张保持一组，右边两张保持一组，
     * 两组先向外拉开，再整体向中间对撞。
     * 返回撞击发生前的等待时间，供 glow、音效和牌盒下沉与撞击点对齐。
     */
    private playSlotGroupCollision(targetNode: Node): number {
        const tileNodes = targetNode.children
            .filter((child) => child.active
                && (child.name.startsWith('targetPreview_') || child.name.startsWith('targetTile_')))
            .sort((left, right) => left.position.x - right.position.x || left.name.localeCompare(right.name));
        if (tileNodes.length !== 4) return 0;

        const centerGap = Math.abs(tileNodes[2].position.x - tileNodes[1].position.x);
        const distance = Math.min(
            UIGameLayer.SLOT_GROUP_COLLISION_DISTANCE,
            Math.max(10, centerGap * 0.35),
        );
        for (let index = 0; index < tileNodes.length; index++) {
            const node = tileNodes[index];
            const origin = node.position.clone();
            // 左两张方向一致，右两张方向一致，保证每边两张在运动中保持一组。
            const groupDirection = index < 2 ? -1 : 1;
            Tween.stopAllByTarget(node);
            const originScale = node.scale.clone();
            const spreadPosition = new Vec3(origin.x + groupDirection * distance, origin.y, origin.z);
            const impactPosition = new Vec3(origin.x - groupDirection * distance, origin.y, origin.z);
            const impactScale = new Vec3(originScale.x * 0.92, originScale.y * 1.06, originScale.z);
            tween(node)
                .to(UIGameLayer.SLOT_GROUP_COLLISION_SPREAD, {
                    position: spreadPosition,
                }, { easing: 'sineOut' })
                .to(UIGameLayer.SLOT_GROUP_COLLISION_IMPACT, {
                    position: impactPosition,
                    scale: impactScale,
                }, { easing: 'quadIn' })
                .to(UIGameLayer.SLOT_GROUP_COLLISION_REBOUND, {
                    position: origin,
                    scale: originScale,
                }, { easing: 'backOut' })
                .start();
        }

        return UIGameLayer.SLOT_GROUP_COLLISION_SPREAD + UIGameLayer.SLOT_GROUP_COLLISION_IMPACT;
    }

    onEventShowSlotMoveOut(slotID: number, willReceiveNewTarget = true) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotMoveOut 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }
        this.setSlotBoxBackgroundVisible(slotID, false);
        let motionStreakNode = targetNode.getChildByName('motionStreak');
        if (motionStreakNode) {
            motionStreakNode.setPosition(new Vec3(0, -140, 0));
            motionStreakNode.active = false;
        }


        // 1. 停止当前节点的所有动画
        Tween.stopAllByTarget(targetNode);
        this.alignSlotRevealMaskToGroove(this.slotRevealMasks[slotID]!, this.slotGrooves[slotID]);
        const grooveSeq = this.setSlotGrooveAnimationState(slotID, false);
        this.slotMotionPhases[slotID] = 'moveOut';
        // 碰撞和 glow 阶段保持完整显示；下沉开始时再启用遮罩。
        // 有新目标时留一条底座边缘，没有新目标时则完全移出。
        this.setSlotRevealMaskEnabled(slotID, false);
        const originPos = this.slotOriginPositions[slotID] ?? targetNode.position.clone();
        // 退场始终从记录的布局原点开始，避免多轮刷新后位移累计。
        targetNode.setPosition(originPos.clone());
        targetNode.setScale(new Vec3(1, 1, 1));
        const targetOpacity = targetNode.getComponent(UIOpacity) || targetNode.addComponent(UIOpacity);
        Tween.stopAllByTarget(targetOpacity);
        targetOpacity.opacity = 255;

        // 左右各两张保持成组，先向两边拉开再整体向中间对撞；撞击瞬间播放 glow 与合并音效。
        const collisionImpactDelay = this.playSlotGroupCollision(targetNode);

        // 不再播放原版的盒盖下压/淡入和牌盒挤压。
        // 碰撞后播放 glow，特效进入后半段时整盒连同已收集牌开始下沉。
        // 与入场共用 0.91 缩放和 sineInOut，形成“沉下去 → 新盒升起来”的完整刷新。
        const endScale = UIGameLayer.SLOT_REVEAL_START_SCALE;
        const retractedPosition = this.getSlotRetractedPosition(
            slotID,
            originPos,
            endScale,
            willReceiveNewTarget,
        );
        tween(targetNode)
            .delay(collisionImpactDelay)
            .call(() => {
                this.playSlotGlow(slotID);
                this.scheduleSlotTileClearAfterEffect(slotID, grooveSeq);
            })
            .delay(UIGameLayer.SLOT_HIDE_DELAY)
            .call(() => {
                if (this.slotGrooveAnimationSeq[slotID] !== grooveSeq
                    || this.slotMotionPhases[slotID] !== 'moveOut') return;
                this.setSlotGrooveVisible(slotID, true);
                this.setSlotRevealMaskEnabled(slotID, true);
            })
            .to(UIGameLayer.SLOT_HIDE_SINK, {
                position: retractedPosition,
                scale: new Vec3(endScale, endScale, 1),
            }, { easing: 'sineInOut' })
            .call(() => {
                targetNode.setPosition(retractedPosition);
                targetNode.setScale(endScale, endScale, 1);
                if (motionStreakNode) motionStreakNode.active = false;
            })
            .start();
    }

    onEventShowSlotMoveIn(slotID: number, playSound = true) {
        const targetNode = this.slotNodeArr[slotID];
        if (!targetNode) {
            console.warn(`[UIGameLayer] onEventShowSlotMoveIn 找不到 slotID 为 ${slotID} 的节点`);
            return;
        }
        // 移入期间保持隐藏，等 finishSlotMoveIn 收尾后再由稳定态显示。
        this.setSlotBoxBackgroundVisible(slotID, false);
        if (this.activeBoxEffectLevel >= 0) this.showComboBoxEffectForSlot(slotID, this.activeBoxEffectLevel);
        let motionStreakNode = targetNode.getChildByName('motionStreak');
        if (motionStreakNode) {
            motionStreakNode.setPosition(new Vec3(0, 140, 0));
            motionStreakNode.active = false;
        }
        const box2Node = targetNode.getChildByName('box_2');
        if (box2Node) box2Node.active = false;
        this.alignSlotRevealMaskToGroove(this.slotRevealMasks[slotID]!, this.slotGrooves[slotID]);
        const grooveSeq = this.setSlotGrooveAnimationState(slotID, true);
        this.slotMotionPhases[slotID] = 'moveIn';
        // 1. 停止 MoveOut 可能带来的遗留动画，并确保处于遮罩下的同一起始态。
        this.setSlotAtRevealStart(slotID);
        // 任务箱滑回的起手音效
        if (playSound) AudioManager.instance.playOneShot(AudioClipNames.taskBoxMove);
        // 2. 小推板同步带出牌盒并多露出一截；推板到位后停住，牌盒再独立完成剩余上升。
        // 不使用透明度与回弹，保持类似自动麻将桌的硬质机械感。
        const originPos = this.slotOriginPositions[slotID] ?? targetNode.position.clone();
        const revealStartPos = targetNode.position.clone();
        const startScale = UIGameLayer.SLOT_REVEAL_START_SCALE;
        let preLiftRatio = UIGameLayer.SLOT_SMALL_PAD_FALLBACK_LIFT_RATIO;
        const smallPadPush = this.prepareSlotSmallPadPush(slotID);
        const pushedPadTopEdgeY = smallPadPush?.pushedTopEdgeY ?? null;
        const slotTransform = targetNode.getComponent(UITransform);
        if (pushedPadTopEdgeY !== null && slotTransform) {
            const topHeight = slotTransform.contentSize.height * (1 - slotTransform.anchorPoint.y);
            const startTopEdgeY = revealStartPos.y + topHeight * startScale;
            const fullTopEdgeTravel = originPos.y - revealStartPos.y + topHeight * (1 - startScale);
            if (Math.abs(fullTopEdgeTravel) > 0.001) {
                preLiftRatio = Math.max(0.05, Math.min(
                    0.95,
                    (pushedPadTopEdgeY
                        - UIGameLayer.SLOT_SMALL_PAD_VISIBLE_EXTENSION
                        - startTopEdgeY) / fullTopEdgeTravel,
                ));
            }
        }
        const preLiftPos = new Vec3(
            revealStartPos.x + (originPos.x - revealStartPos.x) * preLiftRatio,
            revealStartPos.y + (originPos.y - revealStartPos.y) * preLiftRatio,
            revealStartPos.z + (originPos.z - revealStartPos.z) * preLiftRatio,
        );
        const preLiftScale = startScale + (1 - startScale) * preLiftRatio;
        const preLiftDuration = UIGameLayer.SLOT_REVEAL_DURATION * preLiftRatio;
        const riseDuration = UIGameLayer.SLOT_REVEAL_DURATION - preLiftDuration;
        // 遮罩不能在两段交接时立刻关闭：那时牌盒下半部仍在槽口下方，会把自身阴影整块露出。
        // 根据牌盒底边越过裁切线的实际进度，换算到当前两段 easing 的时间点再关闭。
        let revealMaskDisableDelay = UIGameLayer.SLOT_REVEAL_DURATION;
        const revealMaskTransform = this.slotRevealMasks[slotID]?.getComponent(UITransform);
        if (slotTransform && revealMaskTransform) {
            const bottomHeight = slotTransform.contentSize.height * slotTransform.anchorPoint.y;
            const startBottomEdgeY = revealStartPos.y - bottomHeight * startScale;
            const fullBottomEdgeTravel = originPos.y - revealStartPos.y
                - bottomHeight * (1 - startScale);
            if (Math.abs(fullBottomEdgeTravel) > 0.001) {
                const maskBottomEdgeY = -revealMaskTransform.contentSize.height
                    * revealMaskTransform.anchorPoint.y;
                const safeRatio = Math.max(preLiftRatio, Math.min(
                    1,
                    (maskBottomEdgeY
                        + UIGameLayer.SLOT_REVEAL_MASK_CLEARANCE
                        - startBottomEdgeY) / fullBottomEdgeTravel,
                ));
                const riseProgress = (safeRatio - preLiftRatio) / (1 - preLiftRatio);
                const riseTimeRatio = 2 / Math.PI * Math.asin(Math.max(0, Math.min(1, riseProgress)));
                revealMaskDisableDelay = preLiftDuration + riseDuration * riseTimeRatio;
            }
        }
        this.scheduleOnce(() => {
            if (this.slotGrooveAnimationSeq[slotID] !== grooveSeq
                || this.slotMotionPhases[slotID] !== 'moveIn') return;
            this.setSlotRevealMaskEnabled(slotID, false);
        }, revealMaskDisableDelay);
        if (smallPadPush) {
            this.playSlotSmallPadPush(slotID, smallPadPush.pushPosition, preLiftDuration);
        }
        tween(targetNode)
            // 推板和牌盒同时启动，交接时推板比牌盒边缘多露出一截。
            // 前段加速、后段减速；时长按各自行程分配，交接点速度连续，不再半路停顿。
            .to(preLiftDuration, {
                position: preLiftPos,
                scale: new Vec3(preLiftScale, preLiftScale, 1),
            }, { easing: 'sineIn' })
            .to(riseDuration, {
                position: originPos.clone(),
                scale: new Vec3(1, 1, 1),
            }, { easing: 'sineOut' })
            .call(() => {
                this.finishSlotMoveIn(slotID, grooveSeq);
            })
            .start();

        // 正常 tween 收尾之外再留一个带序号/阶段校验的兜底；旧轮次不会误关新一轮动画的 Mask。
        this.scheduleOnce(() => {
            this.finishSlotMoveIn(slotID, grooveSeq);
        }, UIGameLayer.SLOT_REVEAL_DURATION + 0.05);
    }

    onSetUndoButtonStatus(status: boolean) {
        if (this.isGuideLevel) return;
        if (status) {
            this.undoButton.getChildByName("mask").active = true;
        } else {
            this.undoButton.getChildByName("mask").active = false;
        }
    }

    // 刷新道具(撤回/换牌/解锁)剩余次数显示:>0 显示 di+countLabel(次数),==0 显示 ad1(看广告)
    onSetPropCount(payload: { undo: number; switch: number; unlock?: number }) {
        this.applyPropCount(this.undoButton, payload.undo);
        this.applyPropCount(this.switchButton, payload.switch);
        this.applyPropCount(this.unlockButton, payload.unlock ?? 0);
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
        //LayerManager.instance.showUI("win");
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
