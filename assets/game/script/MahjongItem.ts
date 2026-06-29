import { _decorator, Component, EventTouch, MotionStreak, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { Constants } from './config/Constants';
import { LayerManager } from './manager/LayerManager';
import { AudioManager, AudioClipNames } from './manager/AudioManager';
const { ccclass, property } = _decorator;

@ccclass('MahjongItem')
export class MahjongItem extends Component {

    @property(Node)
    iconNode: Node = null!;
    @property(Node)
    shadowNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(MotionStreak)
    streak: MotionStreak = null!;
    item_id = '';
    row = 0;
    col = 0;
    layer = 0;

    private touchTween: Tween<Node> | null = null;
    private shakeOriginPos: Vec3 | null = null;
    private blockedFeedbackStreakActive: boolean | null = null;
    // 记录常态下，阴影是否应该显示
    private _originalShadowActive: boolean = false;
    // start() 跑过一次后置 true。用于区分"首次激活（由 start 接管阴影挂载）"
    // 和"节点池/父节点反激活后重启（onEnable 需要主动挂回）"两种场景
    private _started: boolean = false;
    private boardScale = Constants.MahjongBoard.BoardScale;

    // 同 z 层容器内的深度排序。row+col 合成单一深度键:
    // 屏幕越靠"下+右"(row+col 越大)画得越在前面。
    public static compareBoardDisplayOrderRC(rowA: number, colA: number, rowB: number, colB: number): number {
        const keyA = rowA + colA;
        const keyB = rowB + colB;
        if (keyA !== keyB) return keyA - keyB;
        return rowA - rowB;
    }

    public static refreshLayerDisplayOrder(layerContainer: Node | null | undefined) {
        if (!layerContainer?.isValid) return;

        const children = layerContainer.children.slice();
        const chainNodes = children.filter((node) => MahjongItem.isChainNode(node));
        const ironNodes = children.filter((node) => MahjongItem.isIronNode(node));
        const tileNodes = children
            .map((node) => ({ node, item: node.getComponent(MahjongItem) }))
            .filter((entry): entry is { node: Node; item: MahjongItem } => !!entry.item)
            .sort((a, b) => MahjongItem.compareBoardDisplayOrderRC(a.item.row, a.item.col, b.item.row, b.item.col));
        const overlaySet = new Set([...chainNodes, ...ironNodes]);

        let index = 0;
        for (const child of children) {
            if (!child.getComponent(MahjongItem) && !overlaySet.has(child)) {
                child.setSiblingIndex(index++);
            }
        }
        for (const entry of tileNodes) {
            entry.node.setSiblingIndex(index++);
        }
        for (const child of chainNodes) {
            child.setSiblingIndex(index++);
        }
        for (const child of ironNodes) {
            child.setSiblingIndex(index++);
        }
    }

    private static isChainNode(node: Node): boolean {
        return node.name.startsWith('chainLink_');
    }

    private static isIronNode(node: Node): boolean {
        return node.name.startsWith('ironLock_');
    }

    private static bringOverlayNodesToTop(layerContainer: Node | null | undefined) {
        if (!layerContainer?.isValid) return;
        for (const child of layerContainer.children.slice()) {
            if (MahjongItem.isChainNode(child)) {
                child.setSiblingIndex(layerContainer.children.length - 1);
            }
        }
        for (const child of layerContainer.children.slice()) {
            if (MahjongItem.isIronNode(child)) {
                child.setSiblingIndex(layerContainer.children.length - 1);
            }
        }
    }

    onDisable() {
        this.disableTileTouch();
        this.node.off(Node.EventType.TRANSFORM_CHANGED, this.syncShadowTransform, this);
        this.node.off(Node.EventType.PARENT_CHANGED, this.onTileParentChanged, this);
        this.stopTouchTween();
        // 父节点正在反激活时，任何 setParent / addChild / setSiblingIndex 都会抛
        // "Cannot change hierarchy while activating or deactivating the parent."
        // 这里只做属性瞬时还原，层级相关的恢复留到下次 start / onTileParentChanged
        const baseScale = this.getBoardScale();
        this.node.setScale(baseScale);
        this.node.eulerAngles = new Vec3(0, 0, 0);
    }

    onEnable() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchstart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchend, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchcancel, this);
        this.node.on(Node.EventType.TRANSFORM_CHANGED, this.syncShadowTransform, this);
        this.node.on(Node.EventType.PARENT_CHANGED, this.onTileParentChanged, this);

        // 已经被 start 接管过的牌如果是因 pNode 反激活而走过 onDisable，
        // 那时阴影层级未恢复（onDisable 注释解释了为什么不能动 hierarchy）。
        // 重新激活后由这里把阴影挂回正确的 _layer_<N>_ 容器。
        // 首次 onEnable 时 _started 还是 false，全部交给 start() 处理，避免重复挂载。
        if (this._started && this.isOnBoard()) {
            this.attachShadowToLayer();
            if (this.shadowNode?.isValid) {
                this.shadowNode.active = this._originalShadowActive;
            }
        }
    }

    onDestroy() {
        // 阴影已被抽到层容器,不会随 tile.destroy 自动清理;但按下时阴影会临时挂回 tile 内部,
        // 这种情况由 tile.destroy 自动回收即可,不需要主动 destroy
        if (this.shadowNode?.isValid && this.shadowNode.parent !== this.node) {
            this.shadowNode.destroy();
        }
    }

    start() {
        if (this.node.parent) {
            if (!this.isOnBoard()) {
                this.disableTileTouch();
            }
        }

        // 把阴影抽到独立渲染层：所有阴影先于所有牌身渲染，
        // 相邻牌的阴影会被对方的牌身自然遮住，消除相邻处的暗带。
        // 只有真正落在棋盘上的 tile 才挂阴影 —— 进度恢复时 slot/target 上的牌
        // 也会走 start(),若无条件挂阴影会把 shadowNode 误挂进 slot/target 容器里
        if (this.isOnBoard()) {
            this.attachShadowToLayer();
        }

        // 延迟一帧计算阴影状态，确保周围的兄弟节点都已经完全实例化并绑定了行列数据
        this.scheduleOnce(() => {
            this.updateShadowStatus();
        });

        this._started = true;
    }

    // 判断 tile 当前是否"挂在棋盘上"。容器化后 tile 直接 parent 是 _layer_<N>_,
    // 棋盘 pNode 是它的 grandparent;tile 飞到 flyLayer/槽位时不满足
    private isOnBoard(): boolean {
        return this.node.parent?.parent?.name === 'pNode';
    }

    /**
     * 把阴影挂到 tile 所在的 _layer_<N>_ 容器里的最前面位置,
     * 让阴影先于同层牌身渲染,但仍盖在更低层牌身之上。
     */
    private attachShadowToLayer() {
        if (!this.shadowNode?.isValid) return;
        const parent = this.node.parent;
        if (!parent) return;

        if (this.shadowNode.parent !== parent) {
            // 第二个参数 true：保持世界变换，先到位再被 sync 覆盖
            this.shadowNode.setParent(parent, true);
        }
        // 阴影排在层容器最前面,后续 tile.start 时其他 tile 的阴影也会排在前面,
        // 多张阴影之间相对顺序不重要(它们渲染到同一像素时颜色相同)
        if (this.shadowNode.getSiblingIndex() !== 0) {
            this.shadowNode.setSiblingIndex(0);
        }
        this.syncShadowTransform();
    }

    /**
     * 把阴影的局部 transform 同步成 tile 的局部 transform。
     * 容器化后阴影跟 tile 在同一个 _layer_<N>_ 容器下,位置/缩放都是默认,直接复制即可。
     * 按下时阴影会临时 detach 到 tile 内部,这时不需要同步(detachShadowToTile 已 reset)。
     */
    private syncShadowTransform() {
        if (!this.shadowNode?.isValid) return;
        if (this.shadowNode.parent === this.node) return;

        this.shadowNode.setPosition(this.node.position);
        this.shadowNode.setScale(this.node.scale);
        this.shadowNode.setRotationFromEuler(this.node.eulerAngles);
    }

    /**
     * 牌被移到其他容器（fly layer / 槽位）或撤回到棋盘时调用：
     * - 回到 pNode → 重新挂回对应 layer 阴影容器并按原状态显示
     * - 进入 fly layer / 槽位 → 把阴影内嵌到牌身下方，跟着牌一起显示
     * - 完全脱离父节点 → 隐藏阴影（不销毁，便于撤回时复用）
     */
    private onTileParentChanged() {
        if (!this.shadowNode?.isValid) return;

        const parent = this.node.parent;
        if (parent && this.isOnBoard()) {
            this.attachShadowToLayer();
            this.shadowNode.active = this._originalShadowActive;
        } else if (parent) {
            this.detachShadowToTile();
        } else {
            this.shadowNode.active = false;
        }
    }

    onTouchstart() {
        // 牌被点中飞向槽位/目标的途中仍保留着触摸回调(disableTileTouch 要等落位才执行)。
        // 此时再响应按下,会在 flyLayer 里用错坐标系跑 isBlockedByUpperMahjong,误弹"被上方块锁住"
        // 并让飞行中的牌抖动。与 onTouchend / onTouchcancel 的 isOnBoard 守卫保持一致。
        if (!this.isOnBoard()) return;
        this.click();
    }

    onTouchend(event?: EventTouch) {
        // 撤回后的牌会让 GameCtrl 的 TOUCH_END 回调排到本回调之前,
        // 此时 onTileTap 已经把牌 setParent 到 flyLayer 并启动了入槽 tween,
        // 这里再启动 resetScale 的 tween 会跟入槽 tween 抢同一个 scale 属性,
        // 导致最终缩放卡在 BoardScale 而不是 SlotScale。检查 parent 是不是棋盘,
        // 不在棋盘上说明 tile 已被业务层接管,放弃 reset
        if (!this.isOnBoard()) return;

        const blocked = this.isBlockedByUpperMahjong();
        // 如果被遮挡(正在播放抖动动画),手指抬起时不中断动画
        if (!blocked) {
            this.resetScale(false); // 播放 Q 弹缩小动画
        } else {
            // 防御性还原：极少数情况下 touchstart 时未被遮挡（playSelectedFeedback
            // 已把阴影 detach 到 tile 内部），touchend 时由于撤回等事件让上方出现新牌
            // 而变为被遮挡——这时不会走 resetScale，阴影会卡在 tile 节点里。
            this.reattachShadowIfDetached();
        }
    }

    onTouchcancel() {
        // 同 onTouchend 的考量,牌已经被业务层接管时不要 reset
        if (!this.isOnBoard()) return;

        const blocked = this.isBlockedByUpperMahjong();
        // 如果被遮挡,手指移出范围时也不中断动画
        if (!blocked) {
            this.resetScale(false); // 播放 Q 弹缩小动画
        } else {
            this.reattachShadowIfDetached();
        }
    }

    /**
     * 把阴影从 tile 内部挪回到共享 _layer_<N>_ 容器中。
     * 仅在阴影确实被 detachShadowToTile 临时移到 tile 下时才动作。
     */
    private reattachShadowIfDetached() {
        if (!this.shadowNode?.isValid) return;
        if (this.shadowNode.parent !== this.node) return;
        this.attachShadowToLayer();
        MahjongItem.refreshLayerDisplayOrder(this.node.parent);
        this.shadowNode.active = this._originalShadowActive;
    }

    click(): boolean {

        const blocked = this.isBlockedByUpperMahjong();
        if (blocked) {
            // Blocked tiles cannot be selected, so only play the shake feedback.
            LayerManager.instance.showToast("被上方块锁住");
            this.playBlockedFeedback();
        } else {
            // Selectable tiles are enlarged and moved to the top while pressing.
            this.playSelectedFeedback();
        }

        return blocked;
    }

    setData(item_id: string, row: number, col: number, layer = 0, frame: SpriteFrame | null = null) {
        this.item_id = item_id;
        this.row = row;
        this.col = col;
        this.layer = layer;

        const sprite = this.iconNode.getComponent(Sprite);
        if (!sprite) return;
        if (frame) {
            sprite.spriteFrame = frame;
        } else {
            console.log('MahjongItem: no frame for item', item_id);
        }

        this.setPlayable(true);
    }

    setBoardScale(scale: number) {
        this.boardScale = scale;
    }

    private hideLegacyIcon() {
        const iconSprite = this.iconNode?.getComponent(Sprite);
        if (iconSprite?.isValid) iconSprite.spriteFrame = null;
    }

    setPlayable(playable: boolean) {
        if (!this.maskNode) {
            this.maskNode = this.node.getChildByName('mask');
        }
        if (this.maskNode) {
            this.maskNode.active = !playable;
        }

        let opacity = this.node.getComponent(UIOpacity);
        if (!opacity) {
            opacity = this.node.addComponent(UIOpacity);
        }

        if (this.maskNode) {
            let maskOpacity = this.maskNode.getComponent(UIOpacity);
            if (!maskOpacity) maskOpacity = this.maskNode.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
        }
    }

    /**
     * 刷新阴影状态：判断同层上下左右是否有牌
     * row/col 是半格坐标(每张牌占 2 半格,见 GameCtrl.pickPositions),所以相邻牌差值为 ±2
     */
    public updateShadowStatus() {
        if (!this.shadowNode) return;
        const parent = this.node.parent;
        if (!parent) return;

        let hasRowMinus = false;
        let hasRowPlus = false;
        let hasColMinus = false;
        let hasColPlus = false;

        for (const child of parent.children) {
            if (child === this.node || !child.activeInHierarchy) continue;
            const item = child.getComponent(MahjongItem);

            // 必须在同一层才算有效包围
            if (!item || item.layer !== this.layer) continue;

            // 同行/同列且差 2 半格(即贴身相邻)才算有效邻居
            if (item.col === this.col) {
                if (item.row === this.row - 2) hasRowMinus = true;
                if (item.row === this.row + 2) hasRowPlus = true;
            } else if (item.row === this.row) {
                if (item.col === this.col - 2) hasColMinus = true;
                if (item.col === this.col + 2) hasColPlus = true;
            }
        }

        // 四方都有牌则被完全包围
        const isSurrounded = hasRowMinus && hasRowPlus && hasColMinus && hasColPlus;

        // 被包围则隐藏阴影，反之有一个方向空缺就显示
        this._originalShadowActive = !isSurrounded;
        this.shadowNode.active = this._originalShadowActive;
    }

    isBlockedByUpperMahjong(): boolean {
        if (!this.maskNode) {
            this.maskNode = this.node.getChildByName('mask');
        }
        if (this.maskNode?.active) return true;

        const myLayerContainer = this.node.parent;
        const pNode = myLayerContainer?.parent;
        if (!myLayerContainer || !pNode) return false;

        const curPos = this.node.position;

        // 跟 GameCtrl.isTileBlocked 用同一套阈值:相邻 step 的 82% 内算遮挡。
        // 之前这里写死的 80/100 是按 BoardScale=0.75 时手调出来的像素值,
        // 跟 GameCtrl 的 TileStepX*0.82=62.3 / TileStepY*0.82=77.9 略有出入,
        // 会出现"GameCtrl 算挡 / MahjongItem 算不挡"的判定不一致,统一掉。
        const fitRatio = this.boardScale / Constants.MahjongBoard.BoardScale;
        const blockLimitX = Constants.MahjongBoard.TileStepX * fitRatio * 0.82;
        const blockLimitY = Constants.MahjongBoard.TileStepY * fitRatio * 0.82;

        // 容器化后只能从同层容器看到同层 tiles,上层 tile 在兄弟 _layer_<M>_ 容器里
        for (const layerContainer of pNode.children) {
            if (layerContainer === myLayerContainer) continue;
            const m = layerContainer.name.match(/^_layer_(\d+)_$/);
            if (!m) continue;
            const cl = parseInt(m[1], 10);
            if (cl <= this.layer) continue;

            for (const child of layerContainer.children) {
                if (!child.activeInHierarchy) continue;
                const item = child.getComponent(MahjongItem);
                if (!item) continue;

                const pos = child.position;
                if (Math.abs(pos.x - curPos.x) < blockLimitX && Math.abs(pos.y - curPos.y) < blockLimitY) {
                    return true;
                }
            }
        }

        return false;
    }

    playTapFeedback() {
        this.stopTouchTween();
    }

    playErrorFeedback() {
        this.playBlockedFeedback();
    }

    /**
     * 【优化】：手指按下时的反馈。
     * 时长调整为 0.15 秒，引入 sineOut 缓动，让放大到达顶点时更圆润丝滑
     */
    private playSelectedFeedback() {
        const baseScale = this.getBoardScale();
        this.stopTouchTween();

        // 选中麻将的"抬起"音效,跟放大动画同时触发
        AudioManager.instance.playOneShot(AudioClipNames.mahjongClick);

        // 按下时把阴影临时移回 tile 内部，跟着 tile 一起 bringToTop，
        // 这样阴影会盖在相邻牌身上而不被遮住（松开后由 resetScale 挂回共享层）
        this.detachShadowToTile();

        this.touchTween = tween(this.node)
            .to(0.15, {
                scale: new Vec3(baseScale.x * 1.08, baseScale.y * 1.08, baseScale.z)
            }, { easing: 'sineOut' }) // 正弦减速，极具平滑感
            .call(() => { this.touchTween = null; })
            .start();

        this.bringToTop();
    }

    /**
     * 把阴影从共享层临时挂回 tile 节点内部，并放在背景图之前渲染。
     * 仅用于按下时让阴影跟着 tile 置顶，不参与平时的"被相邻牌覆盖"机制。
     */
    private detachShadowToTile() {
        if (!this.shadowNode?.isValid) return;
        this.shadowNode.active = true;
        if (this.shadowNode.parent === this.node) return;

        this.shadowNode.setParent(this.node, false);
        this.shadowNode.setPosition(0, 0, 0);
        this.shadowNode.setScale(1, 1, 1);
        this.shadowNode.setRotationFromEuler(0, 0, 0);
        this.shadowNode.setSiblingIndex(0); // 排在 bg 之前
    }

    private playBlockedFeedback() {
        this.stopTouchTween();
        this.setBlockedFeedbackStreakHidden(true);
        const originPos = this.shakeOriginPos?.clone() || this.node.position.clone();
        this.shakeOriginPos = originPos.clone();

        AudioManager.instance.playOneShot(AudioClipNames.mj_error);

        // 初始状态重置
        this.node.setPosition(originPos);
        this.node.eulerAngles = new Vec3(0, 0, 2); // 0s 时 EulerZ 为 2°

        const ox = originPos.x;
        const oy = originPos.y;
        const oz = originPos.z;

        // 调整：时间整体拉长，幅度略微收敛 (-5, +3, -1.5)
        const tweenX = tween(this.node)
            .to(0.08, { position: new Vec3(ox - 5, oy, oz) })  // 舒缓地向左甩
            .to(0.10, { position: new Vec3(ox + 3, oy, oz) })  // 舒缓地向右回甩
            .to(0.08, { position: new Vec3(ox - 1.5, oy, oz) })// 较轻地向左甩
            .to(0.06, { position: originPos });                // 平滑回正
        // X轴总时长从 0.2 秒增加到 0.32 秒

        // Z 轴旋转的时间同步拉长，保持与 X 轴一致
        const tweenZ = tween(this.node)
            .to(0.16, { eulerAngles: new Vec3(0, 0, -1.5) })
            .to(0.16, { eulerAngles: new Vec3(0, 0, 0) });
        // Z轴总时长: 0.32 秒

        // 使用 parallel 并行执行 X 轴位移和 Z 轴旋转
        this.touchTween = tween(this.node)
            .parallel(tweenX, tweenZ)
            .call(() => {
                this.node.setPosition(originPos);
                this.node.eulerAngles = new Vec3(0, 0, 0); // 确保角度回正
                this.shakeOriginPos = null;
                this.touchTween = null;
                this.setBlockedFeedbackStreakHidden(false);
            })
            .start();
    }

    /**
     * 手松开或移出取消时触发
     * @param immediate 是否瞬间重置
     */
    private resetScale(immediate: boolean = false) {
        this.stopTouchTween();
        const baseScale = this.getBoardScale();

        // 把按下时挂到 tile 内部的阴影挂回共享层（updateShadowStatus 会决定可见性）
        this.attachShadowToLayer();
        // 让牌在“掉落”的过程中就已经处于正确的遮挡关系中，消除动画结束时的突兀感。
        MahjongItem.refreshLayerDisplayOrder(this.node.parent);

        // 动态重新计算一次并还原阴影（防止长按期间周围牌被消除导致的状态错误）
        this.updateShadowStatus();

        // 如果强制瞬间还原，或者节点已经处于非激活状态，直接设置属性值
        if (immediate || !this.node.activeInHierarchy) {
            this.node.setScale(baseScale);
            this.node.eulerAngles = new Vec3(0, 0, 0);
            return;
        }

        // 正常手指抬起时，播放 Q 弹缩小动画
        this.touchTween = tween(this.node)
            .to(0.22, {
                scale: baseScale,
                eulerAngles: new Vec3(0, 0, 0)
            }, { easing: 'backOut' })
            .call(() => {
                this.touchTween = null;
            })
            .start();
    }

    /**
     * 恢复存档时,棋盘上仍在场的牌做一次"淡入 + 轻微缩放弹入"。
     * 没有飞行,不影响 slot/target 上已就位的牌,只给"瞬间满盘"补一点入场感。
     * 复用 touchTween 轨道:弹入途中玩家点牌时 stopTouchTween 能干净打断,交回 resetScale 接管缩放。
     * @param delay 起始延迟,调用方可按牌序错峰传入(当前默认 0,整盘同时弹入)
     */
    public playRestoreFeedback(delay = 0) {
        if (!this.node?.isValid) return;
        const baseScale = this.getBoardScale();
        this.stopTouchTween();

        // 牌身淡入:setPlayable 只创建 UIOpacity 不写 opacity,所以这里独占该通道,互不干扰
        const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        opacity.opacity = 0;
        Tween.stopAllByTarget(opacity);
        tween(opacity)
            .delay(delay)
            .to(0.2, { opacity: 255 }, { easing: 'sineOut' })
            .start();

        // 阴影挂在层容器里、不是牌的子节点,牌身 UIOpacity 不会级联到它,
        // 单独补一段同样的淡入,避免"阴影先现、牌后淡入"的割裂。保留它原有目标透明度。
        if (this.shadowNode?.isValid && this.shadowNode.active) {
            const shadowOpacity = this.shadowNode.getComponent(UIOpacity) || this.shadowNode.addComponent(UIOpacity);
            const shadowTarget = shadowOpacity.opacity > 0 ? shadowOpacity.opacity : 255;
            shadowOpacity.opacity = 0;
            Tween.stopAllByTarget(shadowOpacity);
            tween(shadowOpacity)
                .delay(delay)
                .to(0.2, { opacity: shadowTarget }, { easing: 'sineOut' })
                .start();
        }

        // 轻微缩放弹入:从 0.82 倍弹回原大小,backOut 带一点过冲营造"弹一下"的手感
        this.node.setScale(baseScale.x * 0.82, baseScale.y * 0.82, baseScale.z);
        this.touchTween = tween(this.node)
            .delay(delay)
            .to(0.26, { scale: baseScale.clone() }, { easing: 'backOut' })
            .call(() => { this.touchTween = null; })
            .start();
    }

    private stopTouchTween() {
        if (!this.touchTween) return;
        this.touchTween.stop();
        this.touchTween = null;
        if (this.shakeOriginPos) {
            this.node.setPosition(this.shakeOriginPos);
            this.node.eulerAngles = new Vec3(0, 0, 0);
            this.shakeOriginPos = null;
            this.setBlockedFeedbackStreakHidden(false);
        }
    }

    private getBoardScale(): Vec3 {
        return new Vec3(this.boardScale, this.boardScale, 1);
    }

    private bringToTop() {
        const parent = this.node.parent;
        if (!parent) return;

        this.node.setSiblingIndex(parent.children.length - 1);
        MahjongItem.bringOverlayNodesToTop(parent);
    }

    private getMotionStreak(): MotionStreak | null {
        if (this.streak?.isValid) return this.streak;

        const streak = this.node.getChildByName('motionStreak')?.getComponent(MotionStreak) || null;
        if (streak) this.streak = streak;
        return streak;
    }

    setMotionStreakEnabled(enabled: boolean) {
        const streak = this.getMotionStreak();
        if (!streak) return;
        streak.reset();
        streak.enabled = enabled;
    }

    private setBlockedFeedbackStreakHidden(hidden: boolean) {
        const streak = this.getMotionStreak();
        const streakNode = streak?.node;
        if (!streak || !streakNode?.isValid) return;

        if (hidden) {
            if (this.blockedFeedbackStreakActive === null) {
                this.blockedFeedbackStreakActive = streakNode.active;
            }
            streak.reset();
            streakNode.active = false;
            return;
        }

        if (this.blockedFeedbackStreakActive === null) return;
        streakNode.active = this.blockedFeedbackStreakActive;
        this.blockedFeedbackStreakActive = null;
        streak.reset();
    }

    // 禁用触摸方法
    disableTileTouch() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchstart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchend, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchcancel, this);
        this.setMotionStreakEnabled(false);
    }

    // 重新启用触摸,撤回让牌从槽飞回棋盘时调;先 off 一次保证不会重复绑定
    enableTileTouch() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchstart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchend, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchcancel, this);
        this.node.on(Node.EventType.TOUCH_START, this.onTouchstart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchend, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchcancel, this);
        this.setMotionStreakEnabled(true);
    }
}
