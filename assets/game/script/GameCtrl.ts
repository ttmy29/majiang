import { _decorator, assetManager, Component, director, game, Game, instantiate, Label, Node, Prefab, SpriteFrame, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { Constants } from './config/Constants';
import { getLevelPlayConfig, LevelPlayConfig } from './config/LevelConfig';
import { getLevelJson, hasAnyLevelJson, LevelJson, LevelJsonPosition, preloadAllLevels } from './config/LevelJsonLoader';
import { MahjongItem } from './MahjongItem';
import { AudioManager, AudioClipNames } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager, ProgressSnapshot, TileKey, TileSnap, BoxSnap } from './manager/ProgressManager';
import { Utils } from './util/Utils';
import { SDKManager, SDKEvent } from './manager/SDKManager';

interface RuntimeLevelConfig extends LevelPlayConfig {
    baseDiff: number;
}

const { ccclass, property } = _decorator;

type GameState = 'ready' | 'playing' | 'win' | 'fail';

interface TileRecord {
    uid: number;
    type: string;
    row: number;
    col: number;
    layer: number;
    node: Node;
    item: MahjongItem;
    boardPos: Vec3;
    collected: boolean;
    removed: boolean;
}

interface TargetBox {
    node: Node;
    itemNodes: Node[];
    iconNode: Node | null;
    unlocked: boolean;
    refreshing: boolean;
    // 槽位是否还停在屏幕外：MoveOut 后没找到新目标时置 true，
    // 等后续 fillEmptyTargetBoxes 补到目标再触发 MoveIn 把它带回原位
    movedOut: boolean;
    // 槽位正在播 MoveIn 回原位动画。期间不接受新的匹配——否则 slot 里的牌会按半路位置算飞行目标
    movingIn: boolean;
    type: string;
    progress: number;
    pending: number;
    required: number;
}

@ccclass('GameCtrl')
export class GameCtrl extends Component {
    @property(Node)
    mahjongPnode: Node = null!;

    @property(Node)
    slotPnode: Node = null!;

    @property(Prefab)
    mahjongItem: Prefab = null!;

    @property(Label)
    levelLabel: Label = null!;

    nowLevel = 0;

    // 玩法状态与核心数据
    private gameState: GameState = 'ready';
    private config: RuntimeLevelConfig = null!;
    private levelJson: LevelJson = null!;
    private taskQueue: string[] = [];
    private tiles: TileRecord[] = [];
    private slots: TileRecord[] = [];
    // 失败弹窗"清空后备栏继续"后,被丢弃的牌挂在这里。
    // 它们在 slotNode 里 active=false 隐藏,collectStoredTargets 看到匹配 type 的 box 会把它们捞回来飞向目标槽
    private discardedTiles: TileRecord[] = [];
    private actionHistory: TileRecord[] = [];
    private targetBoxes: TargetBox[] = [];

    private slotNode: Node = null!;
    private flyLayer: Node = null!;
    private slotPositions: Vec3[] = [];
    private slotCapacity = 7;
    private uidSeed = 1;
    private boardFitRatio = 1;

    private remainTime = 0;
    private elapsedTime = 0;
    private lastTickSecond = -1;
    private comboTimes = 0;
    private lastComboAt = 0;
    private comboEmitPending = false;
    private resolvingMatch = false;
    private dealingTiles = false;
    private targetsInitialized = false;
    private hasStarted = false;
    private shuffleAnimating = false;
    private shuffleSeq = 0;
    // 道具(撤回/换牌)剩余次数:>0 直接消耗使用,==0 时点击改为看广告 +3 补充。永久保存(ProgressManager)
    private undoCount = 0;
    private switchCount = 0;
    // 中途快照保存标记：每次玩家操作 settle 后置 true,下一帧统一写入 localStorage 合批
    private snapshotDirty = false;
    private snapshotFlushScheduled = false;
    private _guideTapCount = 0;
    // 闲置帮助提示:玩家点牌后开始 10s 计时,期间没新点击就触发一次提示;
    // 提示动画播放期间(tipsActive=true)点牌不重启计时,等 UI 通知 End 才解除
    private tipsActive = false;
    private static readonly IDLE_TIPS_SECONDS = 10;
    private static readonly GUIDE_LEVEL = 0;

    // UI 相关 —— targetLabel/statusLabel/comboLabel/toastLabel 已搬到 UIGameLayer，
    // levelLabel 是 @property 由场景绑定，留在这里直接读写

    // 资源数据
    private iconIds: string[] = [];
    private iconFrames: Map<string, SpriteFrame> = new Map();

    start() {
        director.on(Constants.eventNames.EventTipsAnimatorEnd, this.onTipsAnimatorEnd, this);
        director.on(Constants.eventNames.EventFailureContinue, this.onEventFailureContinue, this);
        director.on(Constants.eventNames.EventFailureRestart, this.onEventFailureRestart, this);
        director.on(Constants.eventNames.EventWinNextLevel, this.onEventWinNextLevel, this);
        // 切后台/关闭浏览器时强制同步一次快照,作为 checkpoint 保存的兜底
        game.on(Game.EVENT_HIDE, this.onAppHide, this);
        this.initSceneRefs();
        this.preloadMahjongFrames(() => {
            if (this.iconIds.length === 0) {
                console.warn(`GameCtrl: no mahjong tile frames found in ${Constants.MahjongBoard.ResourceDir}`);
                return;
            }
            const bundle = assetManager.getBundle(Constants.GameBundleName);
            preloadAllLevels(bundle, () => {
                if (!hasAnyLevelJson()) {
                    console.warn('GameCtrl: no level JSON loaded under assets/game/json');
                    return;
                }
                // 把 UI 层需要的资源一次性推过去,后续 EventRenderSlot 就有 prefab + iconFrames 可用了
                director.emit(Constants.eventNames.EventGameUiInit, {
                    mahjongItem: this.mahjongItem,
                    iconFrames: this.iconFrames,
                });
                this.scheduleOnce(() => {
                    const { level, snapshot } = this.loadSavedProgress();
                    this.startLevel(level, snapshot);
                    this.hasStarted = true;
                }, 0);
            });
        });
    }

    // 退到 start 层后再点开始，靠 onEnable 触发整局重开
    protected onEnable() {
        if (!this.hasStarted) return;
        // 必须每次重读 — 胜利后玩家回主页再进入,内存里的 nowLevel 还是旧值
        const { level, snapshot } = this.loadSavedProgress();
        this.startLevel(level, snapshot);
    }

    protected onDisable(): void {
    }

    protected onDestroy(): void {
        // 防御性注销 — Canvas 是 persist 节点,GameCtrl 实际不会被销毁,
        // 但开发期 HMR / 场景切换会触发,避免重复监听
        game.off(Game.EVENT_HIDE, this.onAppHide, this);
    }

    // 读关卡号 + 中途快照。引导关永远忽略快照(也清掉防御性 dump)
    private loadSavedProgress(): { level: number; snapshot: ProgressSnapshot | null } {
        const level = ProgressManager.loadLevel();
        if (level === 0) {
            ProgressManager.clearSnapshot();
            return { level, snapshot: null };
        }
        const snapshot = ProgressManager.loadSnapshot();
        return { level, snapshot };
    }

    private onAppHide = () => {
        if (this.gameState !== 'playing' || this.isGuideLevel()) return;
        // 切后台时 scheduleOnce 不再 tick,直接同步 flush
        this.snapshotDirty = true;
        this.flushSnapshot();
    };

    update(deltaTime: number) {
        if (this.gameState !== 'playing' || !this.config) return;

        this.elapsedTime += deltaTime;

        if (this.config.levelTime <= 0) return;

        this.remainTime = Math.max(0, this.remainTime - deltaTime);
        // 倒计时整数秒没变就不刷 HUD，避免 60Hz 重算 filter
        const currentSecond = Math.ceil(this.remainTime);
        if (currentSecond !== this.lastTickSecond) {
            this.lastTickSecond = currentSecond;
            //this.updateHud();
        }
        if (this.remainTime <= 0) this.failLevel('时间到');
    }

    private startLevel(level: number, snapshot: ProgressSnapshot | null = null) {
        this.gameState = 'playing';
        this.nowLevel = level;
        this._guideTapCount = 0;
        director.emit(Constants.eventNames.EventLevelStart, this.nowLevel);
        // 上报关卡进入事件
        SDKManager.instance.report({ event: SDKEvent.level, type: 1, level: this.nowLevel });
        this.uidSeed = 1;
        this.tiles = [];
        this.slots = [];
        this.discardedTiles = [];
        this.actionHistory = [];
        this.snapshotDirty = false;
        this.snapshotFlushScheduled = false;
        this.refreshUndoButtonStatus();
        // 读取并推送道具(撤回/换牌)剩余次数,刷新按钮 di/countLabel/ad1 显示
        this.loadPropCounts();
        this.emitPropCounts();
        this.clearIdleTips();
        this.onUpDateUiInit();
        const rootSlotNode = Utils.findChildDeep(this.node, 'slotNode');
        if (rootSlotNode && this.targetBoxes.length === 0) this.setupTargetSlot(rootSlotNode);

        this.config = this.createLevelConfig(level);
        this.taskQueue = this.buildTaskQueue(this.levelJson);

        //this.resetTargetBoxes();
        this.comboTimes = 0;
        this.lastComboAt = 0;
        this.comboEmitPending = false;
        this.resolvingMatch = false;
        this.dealingTiles = false;
        this.targetsInitialized = false;
        this.shuffleAnimating = false;
        this.shuffleSeq++;

        this.slotCapacity = this.config.slotCount || 7;
        this.remainTime = this.config.levelTime || 300;
        this.elapsedTime = 0;
        this.lastTickSecond = -1;

        this.clearBoard();
        this.generateBoard();

        // 引导关永不恢复快照,确保引导流程从头跑一遍
        const useSnapshot =
            !this.isGuideLevel()
            && snapshot
            && snapshot.level === level
            && snapshot.tiles.length === this.tiles.length;
        if (useSnapshot) {
            this.applySnapshot(snapshot!);
        } else {
            // 全新开局:写入关卡号 + 清掉旧快照,然后正常发牌
            ProgressManager.saveLevel(level);
            ProgressManager.clearSnapshot();
            this.playDealAnimation();
        }
        this.updatePlayableStates();
        this.updateHud();
        if (!useSnapshot) this.showToast('关卡开始', 1);
    }

    private generateBoard() {
        if (!this.mahjongPnode || !this.mahjongItem || !this.levelJson) return;

        const positions = this.levelJson.positions || [];
        if (positions.length === 0) return;

        // 不同关卡 JSON 半格跨度差异很大(level1=10×10,level9=14×16,level10=14×8)。
        // 这里按 bbox 计算本关棋盘缩放:少牌/小跨度放大,多牌/大跨度缩小。
        this.fitBoardAndResizePnode(positions);

        const { cx, cy } = this.computeBoardCenter(positions);
        const halfStepX = Constants.MahjongBoard.TileStepX * this.boardFitRatio / 2;
        const halfStepY = Constants.MahjongBoard.TileStepY * this.boardFitRatio / 2;
        const boardScale = this.getBoardTileScale();

        const sortedPositions = positions
            .slice()
            .sort((a, b) => a.z_layer - b.z_layer || b.y_row - a.y_row || a.x_col - b.x_col);

        for (let i = 0; i < sortedPositions.length; i++) {
            const p = sortedPositions[i];
            const type = String(p.tile_id);
            const x = (p.x_col - cx) * halfStepX;
            const y = (cy - p.y_row) * halfStepY;
            const boardPos = new Vec3(x, y, 0);

            // console.log(
            //     `tile_${i}_${type}   index=${i} type=${type} ` +
            //     `xyz=(x_col=${p.x_col}, y_row=${p.y_row}, z_layer=${p.z_layer}) ` +
            //     `nodePos=(${boardPos.x.toFixed(2)}, ${boardPos.y.toFixed(2)}, ${boardPos.z.toFixed(2)})`
            // );

            const node = instantiate(this.mahjongItem);
            node.name = `tile_${i}_${type}`;
            node.layer = this.mahjongPnode.layer;
            // 初始在屏幕上方，用于进场动画
            node.setPosition(boardPos.x, boardPos.y + 760, boardPos.z);
            node.setScale(boardScale, boardScale, 1);
            this.getOrCreateLayerContainer(p.z_layer).addChild(node);

            const item = node.getComponent(MahjongItem) || node.addComponent(MahjongItem);
            item.setBoardScale(boardScale);
            item.setData(type, p.y_row, p.x_col, p.z_layer, this.iconFrames.get(type) || null);

            const tile: TileRecord = {
                uid: this.uidSeed++,
                type,
                row: p.y_row,
                col: p.x_col,
                layer: p.z_layer,
                node,
                item,
                boardPos: boardPos.clone(),
                collected: false,
                removed: false,
            };
            this.tiles.push(tile);
            node.on(Node.EventType.TOUCH_END, () => this.onTileTap(tile), this);
        }

        // 容器化后:层间顺序由 _layer_<N>_ 容器位置保证,这里只重排每个层容器内部的牌身。
        const layers = new Set<number>();
        for (const tile of this.tiles) {
            layers.add(tile.layer);
        }
        layers.forEach((layer) => this.refreshLayerDisplayOrder(this.getOrCreateLayerContainer(layer)));

        this.updateBoardTileShadows();
    }

    // 以 layer 0 实际出现的半格坐标 bbox 中心为基准做平移
    private computeBoardCenter(positions: LevelJsonPosition[]): { cx: number; cy: number } {
        let minRow = Infinity, maxRow = -Infinity;
        let minCol = Infinity, maxCol = -Infinity;
        for (const p of positions) {
            if (p.z_layer !== 0) continue;
            if (p.y_row < minRow) minRow = p.y_row;
            if (p.y_row > maxRow) maxRow = p.y_row;
            if (p.x_col < minCol) minCol = p.x_col;
            if (p.x_col > maxCol) maxCol = p.x_col;
        }
        // layer 0 为空时退回到全部位置
        if (minRow === Infinity) {
            for (const p of positions) {
                if (p.y_row < minRow) minRow = p.y_row;
                if (p.y_row > maxRow) maxRow = p.y_row;
                if (p.x_col < minCol) minCol = p.x_col;
                if (p.x_col > maxCol) maxCol = p.x_col;
            }
        }
        return { cx: (minCol + maxCol) / 2, cy: (minRow + maxRow) / 2 };
    }

    private buildTaskQueue(json: LevelJson | null): string[] {
        if (!json?.decoded_config?.task?.[0]) return [];
        return json.decoded_config.task[0].map((id) => String(id));
    }

    private getBoardTileScale(): number {
        return Constants.MahjongBoard.BoardScale * this.boardFitRatio;
    }

    // 棋盘自适应:
    // 优先读取 pNode 经过 Widget/屏幕适配后的真实 UITransform 尺寸,
    // 再按关卡 bbox 算 fitRatio。牌位置和大小随关卡 bbox 同比变化。
    // 棋盘 anchor 0.5 居中,小棋盘四周自然形成对称留白。
    private fitBoardAndResizePnode(positions: LevelJsonPosition[]) {
        this.boardFitRatio = 1;
        const ui = this.mahjongPnode.getComponent(UITransform);
        if (!ui || positions.length === 0) return;

        let minHC = Infinity, maxHC = -Infinity, minHR = Infinity, maxHR = -Infinity;
        for (const p of positions) {
            if (p.x_col < minHC) minHC = p.x_col;
            if (p.x_col > maxHC) maxHC = p.x_col;
            if (p.y_row < minHR) minHR = p.y_row;
            if (p.y_row > maxHR) maxHR = p.y_row;
        }

        const halfStepX = Constants.MahjongBoard.TileStepX / 2;
        const halfStepY = Constants.MahjongBoard.TileStepY / 2;
        // 用真实牌预制体尺寸估算 bbox 端点留白,避免按步距低估牌宽高导致默认分辨率溢出。
        const tileSize = this.getMahjongItemVisualSize();
        const tileVisualW = tileSize.width * Constants.MahjongBoard.BoardScale;
        const tileVisualH = tileSize.height * Constants.MahjongBoard.BoardScale;
        const boardW = (maxHC - minHC) * halfStepX + tileVisualW;
        const boardH = (maxHR - minHR) * halfStepY + tileVisualH;

        const area = this.getBoardFitArea(ui);
        const padding = Constants.MahjongBoard.BoardPadding;
        // 棋盘可占用区域 = 运行时真实尺寸去掉 padding
        const usableW = Math.max(1, area.width - padding * 2);
        const usableH = Math.max(1, area.height - padding * 2);

        // fitRatio 让棋盘尽量填满可用区,再用上下限限制极端关卡的视觉跳变。
        const fitRatio = Utils.clamp(
            Math.min(usableW / boardW, usableH / boardH),
            Constants.MahjongBoard.MinBoardFitRatio,
            Constants.MahjongBoard.MaxBoardFitRatio,
        );
        this.boardFitRatio = fitRatio;

        // 不缩放 pNode 本身,避免棋盘牌飞到 flyLayer/slot 时因换父节点产生缩放跳变。
        this.mahjongPnode.setScale(1, 1, 1);

        console.log(
            `[BoardFit] level=${this.nowLevel} ` +
            `halfSpan=(${maxHC - minHC}×${maxHR - minHR}) ` +
            `boardPx=(${boardW.toFixed(1)}×${boardH.toFixed(1)}) ` +
            `tilePx=(${tileVisualW.toFixed(1)}×${tileVisualH.toFixed(1)}) ` +
            `fitArea=(${area.width.toFixed(1)}×${area.height.toFixed(1)}) ` +
            `fitRatio=${fitRatio.toFixed(3)} ` +
            `boardVisible=(${(boardW * fitRatio).toFixed(1)}×${(boardH * fitRatio).toFixed(1)}) ` +
            `usable=(${usableW.toFixed(1)}×${usableH.toFixed(1)})`
        );
    }

    private getMahjongItemVisualSize(): { width: number; height: number } {
        const prefabNode = this.mahjongItem?.data as Node | null;
        const bgNode = prefabNode?.getChildByName('bg');
        const ui = bgNode?.getComponent(UITransform) || prefabNode?.getComponent(UITransform);
        if (ui && ui.contentSize.width > 0 && ui.contentSize.height > 0) {
            return {
                width: ui.contentSize.width,
                height: ui.contentSize.height,
            };
        }

        return {
            width: Constants.MahjongBoard.FallbackTileWidth,
            height: Constants.MahjongBoard.FallbackTileHeight,
        };
    }

    private getBoardFitArea(ui: UITransform): { width: number; height: number } {
        let width = ui.contentSize.width;
        let height = ui.contentSize.height;
        const parentUi = this.mahjongPnode.parent?.getComponent(UITransform);
        if (parentUi && parentUi.contentSize.width > 0 && parentUi.contentSize.height > 0) {
            width = Math.max(width, parentUi.contentSize.width);
            height = Math.max(height, parentUi.contentSize.height);
        }
        if (width > 0 && height > 0) return { width, height };

        return {
            width: Constants.MahjongBoard.FallbackFitWidth,
            height: Constants.MahjongBoard.FallbackFitHeight,
        };
    }

    // ==========================================
    // 玩法交互与核心逻辑
    // ==========================================

    // 闲置 10s 后被 scheduleOnce 调起,随机挑一个引导按钮触发 UI 提示动画。
    // 用 arrow function 保证 this 绑定 + 引用稳定,这样 unschedule 能按引用命中
    private triggerHelpTips = () => {
        if (!this.shouldUseIdleTips() || this.gameState !== 'playing' || this.tipsActive) return;
        this.tipsActive = true;
        // 1=解锁槽位按钮,2=换牌按钮,随机选一个
        const tipsIndex = Math.random() < 0.5 ? 1 : 2;
        director.emit(Constants.eventNames.EventShowTipsAnimator, tipsIndex);
    };

    private isGuideLevel(): boolean {
        return this.nowLevel === GameCtrl.GUIDE_LEVEL;
    }

    private shouldUseCombo(): boolean {
        return !this.isGuideLevel();
    }

    private shouldUseIdleTips(): boolean {
        return !this.isGuideLevel();
    }

    // UI 端玩家点击提示按钮后回传,解锁"动画中不重启计时"的状态;
    // 下次玩家点牌时 onTileTap 会重新排 10s schedule
    private onTipsAnimatorEnd = () => {
        if (!this.tipsActive) return;
        this.tipsActive = false;
    };

    // 关卡开始/胜利/失败时统一调用,把待触发的提示取消、把锁解除,避免跨关卡误触
    private clearIdleTips() {
        this.unschedule(this.triggerHelpTips);
        this.tipsActive = false;
    }

    private onTileTap(tile: TileRecord) {
        if (this.gameState !== 'playing' || this.dealingTiles || this.shuffleAnimating || tile.collected || tile.removed) {
            return;
        }
        if (this.isTileBlocked(tile)) {
            return;
        }

        // 提示动画播放期间玩家点了牌:中断呼吸动画并解锁计时,然后跟正常点牌一样重排 10s 闲置计时
        if (this.shouldUseIdleTips()) {
            if (this.tipsActive) {
                this.tipsActive = false;
                director.emit(Constants.eventNames.EventStopTipsAnimator);
            }
            this.unschedule(this.triggerHelpTips);
            this.scheduleOnce(this.triggerHelpTips, GameCtrl.IDLE_TIPS_SECONDS);
        } else {
            this.clearIdleTips();
        }

        if (tile.item.playTapFeedback) tile.item.playTapFeedback();

        const targetBox = this.findMatchingTargetBox(tile.type);
        if (targetBox) {
            if (this.isGuideLevel()) {
                this._guideTapCount += 1;
                director.emit(Constants.eventNames.EventGuideTileTapped, {
                    count: this._guideTapCount,
                    type: tile.type,
                    col: tile.col,
                    row: tile.row,
                    layer: tile.layer,
                    worldPos: tile.node.worldPosition.clone(),
                });
            }
            this.moveTileToTarget(tile, targetBox);
        } else if (this.isGuideLevel()) {
            tile.item.playErrorFeedback();
        } else {
            this.moveTileToSlot(tile);
        }
    }

    private moveTileToTarget(tile: TileRecord, box: TargetBox) {
        if (box.refreshing || box.progress + box.pending >= box.required) {
            if (this.isGuideLevel()) {
                tile.item.playErrorFeedback();
                return;
            }
            if (this.slots.indexOf(tile) < 0) this.moveTileToSlot(tile);
            return;
        }

        box.pending += 1;
        tile.collected = true;
        tile.removed = true;
        tile.node.name = `targetTile_${tile.uid}`;

        const worldPosition = tile.node.worldPosition.clone();
        const flyLayer = this.ensureFlyLayer();
        tile.node.setParent(flyLayer);
        tile.node.setWorldPosition(worldPosition);
        tile.item.setPlayable(true);

        const targetIndex = Utils.clamp(box.progress + box.pending, 1, Math.max(1, box.required));
        const targetCell = box.itemNodes[targetIndex] || box.iconNode;
        const targetWorldPosition = targetCell ? targetCell.worldPosition.clone() : box.node.worldPosition.clone();
        const targetFlyPosition = Utils.worldToLocalPosition(flyLayer, targetWorldPosition);
        tile.node.setSiblingIndex(flyLayer.children.length - 1);
        const targetBoxPosition = targetCell ? targetCell.position.clone() : Vec3.ZERO.clone();

        // 牌起飞时就触发抖动:把飞行时长传给 UI,让挤压峰值精准落在落位时刻
        const flyToBoxDuration = 0.18 + 0.1;
        director.emit(Constants.eventNames.EventShowSlotShake, this.getTargetBoxSlotID(box), flyToBoxDuration);

        tween(tile.node)
            .to(flyToBoxDuration, { position: targetFlyPosition, scale: new Vec3(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1) })
            .call(() => {
                box.pending = Math.max(0, box.pending - 1);
                if (box.refreshing || !box.type) {
                    if (tile.node?.isValid) tile.node.destroy();
                    return;
                }
                const endWorldPosition = tile.node.worldPosition.clone();
                tile.node.setParent(box.node);
                tile.node.setWorldPosition(endWorldPosition);
                tile.node.setPosition(targetBoxPosition);
                tile.node.setScale(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1);
                // siblingIndex 依 progress 递增即可（这张落下后 progress 就会变成 progress+1）
                tile.node.setSiblingIndex(Constants.MahjongBoard.TargetBoxSiblingBase + box.progress + 1);
                //屏蔽触摸方法
                tile.item.disableTileTouch();
                Utils.onVibrationShort();

                this.onTargetCollected(box);
            })
            .start();

        this.updatePlayableStates();
        this.updateHud();
    }

    private moveTileToSlot(tile: TileRecord) {
        tile.collected = true;
        tile.node.name = `slotTile_${tile.uid}`;
        this.actionHistory.push(tile);
        this.refreshUndoButtonStatus();

        const lastSame = this.slots.reduce((last, st, i) => st.type === tile.type ? i : last, -1);
        this.slots.splice(lastSame >= 0 ? lastSame + 1 : this.slots.length, 0, tile);
        const isSlotFull = this.slots.length >= Math.max(1, this.slotCapacity - 1);

        const worldPosition = tile.node.worldPosition.clone();
        const flyLayer = this.ensureFlyLayer();
        tile.node.setParent(flyLayer);
        tile.node.setWorldPosition(worldPosition);
        tile.item.setPlayable(true);

        this.arrangeSlotTiles(0.16 + 0.1, tile);
        this.updatePlayableStates();
        this.updateHud();

        // 满槽情况下也走完整飞行动画,等牌真正落进槽位再判失败,
        // 否则失败弹窗会在牌还没飞过去时就盖上来
        this.scheduleOnce(() => {
            this.checkEndState();
            this.saveProgressDeferred();
        }, isSlotFull ? 0.16 + 0.1 + 0.05 : 0.18);
    }

    private arrangeSlotTiles(duration = 0.08, flyingTile: TileRecord | null = null) {
        // 底部存牌槽的牌比目标槽小,视觉上略小一圈
        const slotTileScale = Constants.MahjongBoard.SlotTileScale;
        for (let i = 0; i < this.slots.length; i++) {
            const tile = this.slots[i];
            const target = this.getSlotTargetPosition(i);
            if (tile === flyingTile || tile.node.parent !== this.slotNode) {
                const targetWorldPosition = Utils.localToWorldPosition(this.slotNode, target);
                const flyLayer = this.ensureFlyLayer();
                if (tile.node.parent !== flyLayer) {
                    const worldPosition = tile.node.worldPosition.clone();
                    tile.node.setParent(flyLayer);
                    tile.node.setWorldPosition(worldPosition);
                }
                const targetFlyPosition = Utils.worldToLocalPosition(flyLayer, targetWorldPosition);
                tile.node.setSiblingIndex(flyLayer.children.length - 1);

                // 飞入的麻将牌起飞时就触发底部存牌槽抖动,把飞行时长传过去,
                // UI 端会让 shake 的挤压峰值贴住实际落位时刻
                if (tile === flyingTile) {
                    director.emit(Constants.eventNames.EventShowSlotShake, Constants.slotLayer.BottomSlotBarID, duration);
                }

                tween(tile.node)
                    .to(duration, { position: targetFlyPosition, scale: new Vec3(slotTileScale, slotTileScale, 1) })
                    .call(() => {
                        if (!tile.node?.isValid || this.slots.indexOf(tile) < 0) return;
                        const endWorldPosition = tile.node.worldPosition.clone();
                        tile.node.setParent(this.slotNode);
                        tile.node.setWorldPosition(endWorldPosition);
                        tile.node.setPosition(target);
                        tile.node.setScale(slotTileScale, slotTileScale, 1);
                        //屏蔽触摸方法
                        tile.item.disableTileTouch();
                        tile.node.setSiblingIndex(Constants.MahjongBoard.BottomSlotSiblingBase + this.slots.indexOf(tile));
                        // 只有真正"飞进来"的那张牌算落位反馈,其余靠 reparent/位移补位的牌不算
                        if (tile === flyingTile) Utils.onVibrationShort();
                    })
                    .start();
                continue;
            }

            tile.node.setSiblingIndex(Constants.MahjongBoard.BottomSlotSiblingBase + i);
            tween(tile.node)
                .to(duration, { position: target, scale: new Vec3(slotTileScale, slotTileScale, 1) })
                .start();
        }
    }

    private getSlotTargetPosition(index: number): Vec3 {
        if (index < this.slotPositions.length) return this.slotPositions[index].clone();
        const gap = this.slotCapacity <= 7 ? 72 : 62;
        return new Vec3(-((this.slotCapacity - 1) * gap) / 2 + index * gap, 0, 0);
    }

    // UIGameLayer.slotNodeArr[0] 是底部存牌槽，目标槽 slot1~slot4 从下标 1 开始
    private getTargetBoxSlotID(box: TargetBox): number {
        return this.targetBoxes.indexOf(box) + Constants.slotLayer.TargetBoxIndexOffset;
    }

    private emitRenderSlot(box: TargetBox) {
        director.emit(Constants.eventNames.EventRenderSlot, {
            slotID: this.getTargetBoxSlotID(box),
            unlocked: box.unlocked,
            type: box.type,
            progress: box.progress,
            required: box.required,
            refreshing: box.refreshing,
        });
    }

    private emitClearSlot(box: TargetBox) {
        director.emit(Constants.eventNames.EventClearSlot, {
            slotID: this.getTargetBoxSlotID(box),
        });
    }

    private onTargetCollected(box: TargetBox) {
        if (this.gameState !== 'playing') return;
        box.progress = Math.min(box.required, box.progress + 1);

        if (box.progress >= box.required) {
            if (this.isGuideLevel()) {
                director.emit(Constants.eventNames.EventHideGuide);
            }
            this.updateCombo();
            // 等抖动峰值过去再触发槽位移出,避免完成那一下还没看清就被移出。
            // 不提前置 refreshing:progress 已等于 required,findMatchingTargetBox 和 moveTileToTarget
            // 都靠 progress+pending<required 过滤,期间不会再有牌被分配到这个 box。
            this.scheduleOnce(() => {
                this.refreshTargetBoxWithAnimation(box);
            }, 0.18);
            this.updatePlayableStates();
            this.updateHud();
            return;
        }

        this.emitRenderSlot(box);

        this.collectStoredTargets();
        this.fillEmptyTargetBoxes();
        this.updatePlayableStates();
        this.updateHud();
        this.checkEndState();
        this.saveProgressDeferred();
    }

    private collectStoredTargets() {
        if (this.gameState !== 'playing' || this.resolvingMatch) return;
        const moveList: { tile: TileRecord; box: TargetBox; fromDiscarded: boolean }[] = [];
        const plannedByBox = new Map<TargetBox, number>();

        for (const tile of this.slots.slice()) {
            const box = this.findMatchingTargetBox(tile.type);
            if (!box) continue;
            const planned = plannedByBox.get(box) || 0;
            if (box.progress + box.pending + planned >= box.required) continue;
            plannedByBox.set(box, planned + 1);
            moveList.push({ tile, box, fromDiscarded: false });
        }
        // 再扫"清空后备栏"挂起的牌:某个 box 的 type 命中时把它们捞回去
        for (const tile of this.discardedTiles.slice()) {
            if (!tile.node?.isValid) continue;
            const box = this.findMatchingTargetBox(tile.type);
            if (!box) continue;
            const planned = plannedByBox.get(box) || 0;
            if (box.progress + box.pending + planned >= box.required) continue;
            plannedByBox.set(box, planned + 1);
            moveList.push({ tile, box, fromDiscarded: true });
        }
        if (moveList.length === 0) return;

        this.resolvingMatch = true;
        for (const entry of moveList) {
            if (entry.fromDiscarded) {
                const index = this.discardedTiles.indexOf(entry.tile);
                if (index >= 0) this.discardedTiles.splice(index, 1);
                // 隐藏的牌先点亮,紧接着 moveTileToTarget 会把它 reparent 到 flyLayer 开飞
                entry.tile.node.active = true;
            } else {
                const index = this.slots.indexOf(entry.tile);
                if (index >= 0) this.slots.splice(index, 1);
                this.actionHistory = this.actionHistory.filter((t) => t !== entry.tile);
            }
            this.moveTileToTarget(entry.tile, entry.box);
        }
        this.refreshUndoButtonStatus();

        this.arrangeSlotTiles(0.12 + 0.1);
        this.scheduleOnce(() => {
            this.resolvingMatch = false;
            this.collectStoredTargets();
            this.fillEmptyTargetBoxes();
            this.updateHud();
            this.checkEndState();
            this.saveProgressDeferred();
        }, 0.22);
    }

    private checkEndState() {
        if (this.gameState !== 'playing') return;
        if (this.tiles.every((t) => t.removed)) {
            return this.winLevel();
        }
        if (this.slots.length >= Math.max(1, this.slotCapacity - 1)) {
            return this.failLevel('槽位满了');
        }

        this.fillEmptyTargetBoxes();
        //this.lockUnavailableTargetBoxes();
        // if (!this.canStillCompleteTasks()) {
        //     this.failLevel('死局，目标牌不足');
        // }
    }

    private canStillCompleteTasks(): boolean {
        // 把"已上场目标 + 未来队列"按 type 合并需求量,与棋盘剩余张数对比;
        // 任一 type 不够就死局。box.required 通常为 3,队列每项也是 3。
        const demand = new Map<string, number>();
        for (const box of this.targetBoxes) {
            if (!box.unlocked || !box.type) continue;
            const remaining = Math.max(0, box.required - box.progress - box.pending);
            if (remaining > 0) demand.set(box.type, (demand.get(box.type) || 0) + remaining);
        }
        for (const type of this.taskQueue) {
            demand.set(type, (demand.get(type) || 0) + 3);
        }
        if (demand.size === 0) return true;

        const supply = new Map<string, number>();
        for (const tile of this.tiles) {
            if (tile.removed) continue;
            supply.set(tile.type, (supply.get(tile.type) || 0) + 1);
        }
        for (const [type, need] of demand) {
            if ((supply.get(type) || 0) < need) return false;
        }
        return true;
    }

    private winLevel() {
        this.gameState = 'win';
        this.clearIdleTips();
        // 上报关卡成功事件
        SDKManager.instance.report({ event: SDKEvent.level, type: 3, level: this.nowLevel, time: this.elapsedTime });
        // 不论是引导关自动跳关还是普通关弹胜利 UI,通关瞬间就把"下一关"号写入存储,
        // 之后玩家点"下一关"或"回主页"都会让下次进入直接落在下一关
        ProgressManager.saveLevel(this.nowLevel + 1);
        ProgressManager.clearSnapshot();
        if (this.nowLevel == 0) {//引导关卡直接下一关
            this.scheduleOnce(() => {
                this.onEventWinNextLevel();
            }, 0.8)
            return;
        }
        LayerManager.instance.showUI('win', this.elapsedTime);
    }

    private failLevel(reason: string) {
        if (this.gameState !== 'playing') return;
        this.gameState = 'fail';
        this.clearIdleTips();
        // 上报关卡失败事件
        SDKManager.instance.report({ event: SDKEvent.level, type: 2, level: this.nowLevel, reason });

        // 槽位满了 -> 弹失败界面，由玩家选 继续/重开。其余原因(死局/时间到)按旧流程自动重开
        if (reason === '槽位满了') {
            const allUnlocked = this.targetBoxes.every((b) => b.unlocked);
            // opentype 为空 = 还有未解锁的槽位,"继续游戏" 帮玩家解锁一个槽位
            // opentype 非空 = 所有槽位都解锁了,"继续游戏" 清空底部 slot
            const opentype = allUnlocked ? 'clearSlot' : null;
            LayerManager.instance.showUI('failure', opentype, this.slotNode);
            return;
        }

        this.showToast(`${reason}，重开本关`);
        ProgressManager.clearSnapshot();
        this.scheduleOnce(() => this.startLevel(this.nowLevel), 1.5);
    }

    private onEventFailureRestart() {
        // startLevel 走 fresh 分支会自己 clearSnapshot,这里不重复调
        this.startLevel(this.nowLevel);
    }

    private onEventWinNextLevel() {
        this.startLevel(this.nowLevel + 1);
    }

    private onEventFailureContinue(opentype: string | null) {
        if (this.gameState !== 'fail') return;
        this.gameState = 'playing';
        if (opentype) {
            this.clearBottomSlot();
        } else {
            this.unlockNextSlotForContinue();
        }
        this.updateHud();
    }

    // 失败弹窗"继续游戏(还有锁着的槽位)":解锁下一个槽位,并在动画结束后给它分配新目标
    private unlockNextSlotForContinue() {
        const box = this.targetBoxes.find((b) => !b.unlocked);
        if (!box) return;
        box.unlocked = true;
        box.refreshing = true;
        director.emit(Constants.eventNames.EventShowSlotUnlock, this.getTargetBoxSlotID(box));
        this.scheduleOnce(() => {
            box.refreshing = false;
            if (this.gameState !== 'playing' || !box.unlocked) return;
            this.assignNewTarget(box);
            this.collectStoredTargets();
            this.updateHud();
            this.saveProgressDeferred();
        }, Constants.slotAnim.UnlockWait);
    }

    // 失败弹窗"继续游戏(所有槽位已解锁)":把底部 slot 里的牌先挂起、不销毁,
    // 等后续 box 拿到匹配 type 时 collectStoredTargets 会把它们捞回去飞向目标槽
    private clearBottomSlot() {
        const discardedSet = new Set(this.slots);
        for (const tile of this.slots) {
            // 重新让这张牌可被目标槽接收(moveTileToTarget 会再把 collected/removed 置 true)
            tile.collected = false;
            if (tile.node?.isValid) tile.node.active = false;
            this.discardedTiles.push(tile);
        }
        this.slots = [];
        // 丢进回收站的牌不再能被撤回
        this.actionHistory = this.actionHistory.filter((t) => !discardedSet.has(t));
        this.refreshUndoButtonStatus();
        // 当前目标若已经能消化这些牌(例如本次失败前的 refresh 已给出新 type),立即试一次回收
        this.collectStoredTargets();
        this.saveProgressDeferred();
    }

    // ==========================================
    // 遮挡判断与表现
    // ==========================================

    private updatePlayableStates() {
        this.updateBoardTileShadows();
        for (const tile of this.tiles) {
            if (!tile.collected && !tile.removed) {
                tile.item.setPlayable(!this.isTileBlocked(tile));
            }
        }
    }

    private isTileBlocked(tile: TileRecord): boolean {
        return this.findBlockerTile(tile) !== null;
    }

    private findBlockerTile(tile: TileRecord): TileRecord | null {
        for (const other of this.tiles) {
            if (other === tile || other.collected || other.removed || other.layer <= tile.layer) continue;
            // 判断是否在同层级上方遮挡 (物理碰撞盒检查)
            if (Math.abs(other.boardPos.x - tile.boardPos.x) < Constants.MahjongBoard.TileStepX * this.boardFitRatio * 0.82 &&
                Math.abs(other.boardPos.y - tile.boardPos.y) < Constants.MahjongBoard.TileStepY * this.boardFitRatio * 0.82) {
                return other;
            }
        }
        return null;
    }

    private updateBoardTileShadows() {
        // 委托给每张牌自己的 updateShadowStatus —— 它会按"同层四方向是否有邻居"判断显示
        // 这里负责在棋盘状态变化（收牌/撤回）后统一触发邻居重算，避免某张牌的阴影
        // 因周围被消除/撤回而陈旧
        for (const tile of this.tiles) {
            if (tile.collected || tile.removed) continue;
            tile.item.updateShadowStatus();
        }
    }

    private playDealAnimation() {
        if (this.tiles.length === 0) return;
        this.dealingTiles = true;

        // ==========================================
        // 按照原版参数配置飞入动画节奏
        // ==========================================
        const startDelayTime = 0.1;      // m_startDelayTime: 开局等待 0.1s 后开始发牌
        const startAddMoveTime = 0.013;  // m_startAddMoveTime: 每张牌之间的启动间隔错峰
        const startMoveTime = 0.3;       // m_startMoveTime: 单张牌飞行耗时 0.3s

        // 开局发牌音效:延时到首张牌真正起飞的瞬间再响,避免画面还没动声音就先到
        this.scheduleOnce(() => {
            AudioManager.instance.playOneShot(AudioClipNames.game_start);
        }, startDelayTime);

        // 计算所有麻将落位完成的总耗时
        const totalDuration = startDelayTime + startMoveTime + (this.tiles.length > 0 ? (this.tiles.length - 1) * startAddMoveTime : 0);

        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i];
            const boardScale = this.getBoardTileScale();
            // 计算当前这张牌的启动延迟
            const delay = startDelayTime + i * startAddMoveTime;

            // 【修改点】判断最终位置在左边还是右边，决定初始起飞的 X 坐标
            // 假设 900 已经足够处于屏幕可见区域之外（你可以根据实际设计分辨率微调这个值，如 800 或 1000）
            const startX = tile.boardPos.x < 0 ? -900 : 900;

            // 初始状态：放置在屏幕左右两侧，Y 轴保持与目标一致，稍微缩小
            tile.node.setPosition(startX, tile.boardPos.y, tile.boardPos.z);
            tile.node.setScale(boardScale * 0.92, boardScale * 0.92, 1);

            // 执行横向飞入缓动
            tween(tile.node)
                .delay(delay)
                .to(startMoveTime, {
                    position: tile.boardPos,
                    scale: new Vec3(boardScale, boardScale, 1)
                }, {}) // 横向飞入配合 backOut 会有一种发牌“急停撞击”的干脆手感，如果不喜欢可以改为 'quadOut'
                .start();
        }

        // 依据精确计算的总耗时，在全部落位后解除遮罩并初始化目标
        this.scheduleOnce(() => {
            this.dealingTiles = false;
            this.updatePlayableStates();
            this.initializeTargetsAfterDeal();
            this.saveProgressDeferred();
        }, totalDuration);
    }

    // ==========================================
    // 目标收集系统 (Target Box)
    // ==========================================

    private initializeTargetsAfterDeal() {
        if (this.gameState !== 'playing' || this.targetsInitialized) return;
        this.targetsInitialized = true;
        this.pickTargets();
        this.updateHud();
    }

    private pickTargets() {
        for (const box of this.targetBoxes) {
            if (!box.unlocked) { this.emitRenderSlot(box); continue; }
            this.assignNewTarget(box);
        }
        this.fillEmptyTargetBoxes();
        this.lockUnavailableTargetBoxes();
        this.collectStoredTargets();
    }

    private resetTargetBoxes() {
        if (this.targetBoxes.length === 0) {
            const rootSlotNode = Utils.findChildDeep(this.node, 'slotNode');
            this.setupTargetSlot(rootSlotNode);
        }
        const unlockedCount = this.config?.unlockedSlotCount ?? 2;
        // 1) 先把每个槽位的状态/旧节点清掉
        for (let i = 0; i < this.targetBoxes.length; i++) {
            const box = this.targetBoxes[i];
            this.emitClearSlot(box);
            box.unlocked = i < unlockedCount;
            box.type = '';
            box.progress = 0;
            box.pending = 0;
            box.refreshing = false;
            box.movedOut = false;
            box.movingIn = false;
            box.required = 3; // 三消
        }
        // 2) UI 层一次性把所有槽位 transform/box_2 复位（包含底部存牌槽）
        director.emit(Constants.eventNames.EventResetSlots, {
            targetBoxStates: this.targetBoxes.map(b => ({
                slotID: this.getTargetBoxSlotID(b),
                unlocked: b.unlocked,
            })),
        });
        // 3) 渲染初始状态
        for (const box of this.targetBoxes) {
            this.emitRenderSlot(box);
        }
    }

    // 严格按 task[] 顺序出队:队列空了 box.type='' 返回 false,上层会把槽位标记 movedOut
    private assignNewTarget(box: TargetBox): boolean {
        const type = this.taskQueue.shift() || '';
        this.emitClearSlot(box);
        box.type = type;
        box.progress = 0;
        box.pending = 0;
        this.emitRenderSlot(box);
        if (type) this.attachDiscardedTilesToBox(box);
        return !!type;
    }

    // 失败弹窗"清空后备栏"后挂起的 discardedTiles,在新目标生成时按 type 立即归位到目标槽,
    // 不走飞行动画 —— 直接 reparent 到 box.node 并摆到 itemNodes[1..] 位置,
    // 由槽位的 MoveIn 动画带着一起回到屏幕
    private attachDiscardedTilesToBox(box: TargetBox) {
        if (this.discardedTiles.length === 0) return;
        const matched: TileRecord[] = [];
        for (const tile of this.discardedTiles) {
            if (matched.length + box.progress >= box.required) break;
            if (!tile.node?.isValid) continue;
            if (tile.type !== box.type) continue;
            matched.push(tile);
        }
        if (matched.length === 0) return;

        for (const tile of matched) {
            const idx = this.discardedTiles.indexOf(tile);
            if (idx >= 0) this.discardedTiles.splice(idx, 1);

            tile.collected = true;
            tile.removed = true;
            tile.node.name = `targetTile_${tile.uid}`;

            const targetIndex = Utils.clamp(box.progress + 1, 1, Math.max(1, box.required));
            const targetCell = box.itemNodes[targetIndex] || box.iconNode;
            const targetBoxPosition = targetCell ? targetCell.position.clone() : Vec3.ZERO.clone();

            tile.node.active = true;
            tile.node.setParent(box.node);
            tile.node.setPosition(targetBoxPosition);
            tile.node.setScale(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1);
            tile.node.setSiblingIndex(Constants.MahjongBoard.TargetBoxSiblingBase + box.progress + 1);
            tile.item.disableTileTouch();

            box.progress = Math.min(box.required, box.progress + 1);
        }

        this.emitRenderSlot(box);

        // 全部归位后若刚好达成目标,触发 refresh 流程(MoveOut → 生成新目标 → MoveIn)
        if (box.progress >= box.required) {
            this.scheduleOnce(() => {
                if (this.gameState === 'playing') this.refreshTargetBoxWithAnimation(box);
            }, 0.18);
        }
    }

    private fillEmptyTargetBoxes() {
        for (const box of this.targetBoxes) {
            if (!box.unlocked || box.type || box.refreshing) continue;
            this.assignNewTarget(box);
            if (!box.type) continue;
            // 如果这个槽位之前因为没目标停在屏幕外，现在补到了新目标，把它移入回原位
            if (box.movedOut) {
                box.movedOut = false;
                this.startSlotMoveIn(box);
            }
        }
    }

    // 队列模式下不再"丢弃 type 让下次重新分配",否则会把队列里那一项直接吞掉导致总数错位。
    // 这里仅作为死局判定的入口之一。
    private lockUnavailableTargetBoxes() {
        // no-op
    }

    private refreshTargetBoxWithAnimation(box: TargetBox) {
        if (box.refreshing) return;
        box.refreshing = true;
        box.pending = 0;

        const slotID = this.getTargetBoxSlotID(box);

        // 触发槽位移出动画：整个槽位带着收集到的麻将牌一起飞出屏幕
        director.emit(Constants.eventNames.EventShowSlotMoveOut, slotID);

        // MoveOut 动画约 0.6333s，等其结束后再清理旧资源、生成新目标并回弹
        this.scheduleOnce(() => {
            // assignNewTarget 内部会清理旧的 collectedNodes 与 previewNode，并生成新预览
            const assigned = this.assignNewTarget(box);

            if (assigned) {
                // 有新目标：把槽位从屏幕外带回原位
                this.startSlotMoveIn(box);
                box.movedOut = false;
            } else {
                // 没新目标可发：让槽位继续停在屏幕外，等后续 fillEmptyTargetBoxes 补上目标时再 MoveIn
                box.movedOut = true;
            }

            box.refreshing = false;
            this.fillEmptyTargetBoxes();
            this.collectStoredTargets();
            this.updatePlayableStates();
            this.updateHud();
            this.checkEndState();
            this.saveProgressDeferred();
        }, Constants.slotAnim.MoveOutWait);
    }

    private findMatchingTargetBox(type: string): TargetBox | null {
        return this.targetBoxes.find((b) => b.unlocked && !b.refreshing && !b.movingIn && b.type === type && b.progress + b.pending < b.required) || null;
    }

    // 触发槽位回到原位的动画。期间标记 movingIn=true,findMatchingTargetBox 会跳过此槽,
    // 避免 slot 里的牌按半路位置算飞行目标。动画结束后再补一次 collectStoredTargets,
    // 把等候的牌按已落位的真实坐标飞过去
    private startSlotMoveIn(box: TargetBox) {
        box.movingIn = true;
        director.emit(Constants.eventNames.EventShowSlotMoveIn, this.getTargetBoxSlotID(box));
        this.scheduleOnce(() => {
            box.movingIn = false;
            if (this.gameState !== 'playing') return;
            this.collectStoredTargets();
        }, Constants.slotAnim.MoveInWait);
    }

    // ==========================================
    // UI 初始化与更新
    // ==========================================

    private initSceneRefs() {
        this.mahjongPnode = this.mahjongPnode || this.node.getChildByName('pNode') || Utils.findChildDeep(this.node, 'pNode')!;
        this.levelLabel = this.levelLabel || this.node.getChildByName('levelLabel')?.getComponent(Label)!;

        const rootSlotNode = this.node.getChildByName('slotNode') || Utils.findChildDeep(this.node, 'slotNode');
        this.slotNode = rootSlotNode?.getChildByName('slot') || rootSlotNode!;

        this.captureSlotPositions();
        this.setupTargetSlot(rootSlotNode);
    }

    private ensureFlyLayer(): Node {
        const parent = this.node.parent || this.node;
        if (this.flyLayer?.isValid) {
            if (this.flyLayer.parent !== parent) this.flyLayer.setParent(parent);
            this.flyLayer.setSiblingIndex(parent.children.length - 1);
            return this.flyLayer;
        }

        const node = new Node('flyLayer');
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        node.setSiblingIndex(parent.children.length - 1);
        this.flyLayer = node;
        return node;
    }

    private captureSlotPositions() {
        this.slotPositions = [];
        if (!this.slotNode) return;

        // 按 item1, item2, item3... 编号顺序读取底部存牌槽的锚点节点。
        // 不依赖 .active —— item 通常只是占位用的隐藏节点，能取到 position 就够了。
        for (let i = 1; ; i++) {
            const itemNode = this.slotNode.getChildByName(`item${i}`);
            if (!itemNode) break;
            this.slotPositions.push(itemNode.position.clone());
        }
        if (this.slotPositions.length > 0) return;

        // 兜底：场景没放 item 锚点，按 UITransform 宽度等分 7 格
        const transform = this.slotNode.getComponent(UITransform);
        if (!transform) return;

        const step = transform.contentSize.width / 7;
        const startX = -transform.contentSize.width * 0.5 + step * 0.5;
        for (let i = 0; i < 7; i++) this.slotPositions.push(new Vec3(startX + i * step, 0, 0));
    }

    private setupTargetSlot(rootSlotNode: Node | null) {
        if (!rootSlotNode) return;
        this.targetBoxes = [];
        for (let i = 1; i <= 4; i++) {
            const node = rootSlotNode.getChildByName(`slot${i}`);
            if (!node) continue;
            node.active = true;

            const itemNodes: Node[] = [];
            for (let j = 1; j <= 4; j++) {
                const itemNode = node.getChildByName(`item${j}`);
                if (!itemNode) continue;
                itemNodes.push(itemNode);
            }

            this.targetBoxes.push({
                node,
                itemNodes,
                iconNode: itemNodes[0] || null,
                unlocked: i <= 2,
                refreshing: false,
                movedOut: false,
                movingIn: false,
                type: '',
                progress: 0,
                pending: 0,
                required: 3,
            });
        }
    }

    // private ensureTargetProgressLabel(parent: Node): Label {
    //     let node = parent.getChildByName('progressLabel');
    //     if (!node) {
    //         node = new Node('progressLabel');
    //         node.layer = parent.layer;
    //         parent.addChild(node);
    //         node.setPosition(0, -46, 0);
    //     }
    //     const label = node.getComponent(Label) || node.addComponent(Label);
    //     label.fontSize = 24;
    //     label.color = new Color(255, 240, 150, 255);
    //     return label;
    // }

    private updateHud() {
        if (!this.config) return;
        if (this.levelLabel) this.levelLabel.string = `关卡${this.nowLevel}`;

        const remain = this.tiles.filter((t) => !t.removed).length;
        const failThreshold = Math.max(1, this.slotCapacity - 1);
        const hasTimer = this.config.levelTime > 0;
        const comboActive = this.comboTimes > 1 && this.lastComboAt > 0 && Date.now() - this.lastComboAt <= 5000;

        director.emit(Constants.eventNames.EventHudUpdate, {
            remain,
            total: this.tiles.length,
            slots: this.slots.length,
            slotCap: failThreshold,
            hasTimer,
            timeSec: Math.ceil(this.remainTime),
            comboTimes: this.comboTimes,
            comboActive,
        });
    }

    private updateCombo() {
        if (!this.shouldUseCombo()) {
            this.comboTimes = 0;
            this.lastComboAt = 0;
            this.comboEmitPending = false;
            return;
        }

        const now = Date.now();
        this.comboTimes = (now - this.lastComboAt <= 5000) ? this.comboTimes + 1 : 1;
        this.lastComboAt = now;
        // 0.18s 延迟跟槽位 MoveOut 起手对齐:让 combo 口号/进度条出现在"砸完→飞走"那一刻,
        // 而不是飞行落位那一帧。同时 collectStoredTargets 一次让多个 box 完成时,
        // 0.18s 内的多次 updateCombo 只 emit 一次,避免口号文字/音效互相覆盖到只剩最后一档。
        if (this.comboEmitPending) return;
        this.comboEmitPending = true;
        this.scheduleOnce(() => {
            this.comboEmitPending = false;
            if (this.gameState !== 'playing' || this.comboTimes < 1) return;
            director.emit(Constants.eventNames.EventComboUpdate, this.comboTimes);
            this.updateHud();
        }, 0.18);
    }

    private showToast(message: string, seconds = 1.1) {
        console.log('GameCtrl: show toast', message);
        //director.emit(Constants.eventNames.EventShowToast, { msg: message, seconds });
    }

    // ==========================================
    // 原版地图生成逻辑及工具函数
    // ==========================================

    private preloadMahjongFrames(done: () => void) {
        const bundle = assetManager.getBundle('game');
        this.iconFrames.clear();
        this.iconIds = [];

        if (!bundle) {
            console.warn('GameCtrl: game bundle not found');
            done();
            return;
        }

        bundle.loadDir(Constants.MahjongBoard.ResourceDir, SpriteFrame, (err, frames) => {
            if (err || !frames?.length) {
                console.warn('GameCtrl: load mahjong frames failed', err);
                done();
                return;
            }
            for (const frame of frames) {
                const id = this.normalizeMahjongFrameName(frame.name);
                if (id) this.iconFrames.set(id, frame);
            }
            this.iconIds = Array.from(this.iconFrames.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            done();
        });
    }

    private normalizeMahjongFrameName(name: string): string {
        if (Constants.MahjongBoard.ExcludedFrames.indexOf(name) >= 0) return '';
        return /^\d+$/.test(name) ? name : '';
    }

    private clearBoard() {
        if (this.mahjongPnode) this.mahjongPnode.removeAllChildren();
        if (this.flyLayer?.isValid) this.flyLayer.removeAllChildren();
        if (this.slotNode) {
            for (const child of this.slotNode.children.slice()) {
                if (child.name.startsWith('slotTile_')) child.destroy();
            }
        }
    }

    private createLevelConfig(level: number): RuntimeLevelConfig {
        const json = getLevelJson(level);
        if (!json) {
            console.warn(`GameCtrl: no level JSON for level ${level}`);
        }
        this.levelJson = json as LevelJson;
        const play = getLevelPlayConfig(level);
        const baseDiff = json?.index_config?.base_diff ?? json?.summary?.hard ?? 0;
        return {
            ...play,
            baseDiff,
        };
    }

    // 取(或新建)某个 z 层的容器节点。所有同层的牌身 + 阴影都挂在这里,
    // 容器按 layer 升序排列,层间渲染顺序由容器自身位置保证,层内只需排 row/col
    private getOrCreateLayerContainer(layer: number): Node {
        const name = `_layer_${layer}_`;
        let container = this.mahjongPnode.getChildByName(name);
        if (container) return container;

        container = new Node(name);
        container.layer = this.mahjongPnode.layer;
        container.addComponent(UITransform);
        this.mahjongPnode.addChild(container);

        // 按 layer 数字升序插到正确位置:数出已存在的、layer 比自己小的容器个数
        let targetIndex = 0;
        for (const child of this.mahjongPnode.children) {
            if (child === container) continue;
            const m = child.name.match(/^_layer_(\d+)_$/);
            if (!m) continue;
            if (parseInt(m[1], 10) < layer) targetIndex++;
        }
        container.setSiblingIndex(targetIndex);
        return container;
    }

    private refreshLayerDisplayOrder(layerContainer: Node) {
        MahjongItem.refreshLayerDisplayOrder(layerContainer);
    }

    private onBtnUndoClick(event) {
        AudioManager.instance.playClick();
        if (this.gameState !== 'playing' || this.resolvingMatch) return;

        // 次数用完:点击=看广告补充次数(refill only,不撤回、不动 actionHistory)
        if (this.undoCount <= 0) {
            SDKManager.instance.showVideoAd(() => {
                this.setUndoCount(this.undoCount + 3);
            }, () => {
                LayerManager.instance.showToast("视频播放未完成！")
            }, 'undo');
            return;
        }

        let tile: TileRecord | null = null;
        while (this.actionHistory.length > 0) {
            const candidate = this.actionHistory.pop()!;
            if (!candidate.removed && this.slots.indexOf(candidate) >= 0 && candidate.node?.isValid) {
                tile = candidate;
                break;
            }
        }
        if (!tile) {
            LayerManager.instance.showToast('无可撤回');
            this.refreshUndoButtonStatus();
            return;
        }

        //if (!tile) return LayerManager.instance.showToast('无可撤回');

        const index = this.slots.indexOf(tile);
        if (index < 0) return LayerManager.instance.showToast('无可撤回');
        if (index < 0) {
            this.refreshUndoButtonStatus();
            return;
        }

        // 有次数:消耗 1 次并直接撤回(不再看广告)
        this.setUndoCount(this.undoCount - 1);
        this.executeUndo(tile, index);
    }

    private executeUndo(tile: TileRecord, index: number) {
        this.slots.splice(index, 1);
        // 注意:collected 此处先保留 true,等飞回 tween 跑完再置 false。
        // 否则飞行 0.16s 期间用户点击会触发 GameCtrl 的 TOUCH_END → onTileTap → moveTileToSlot,
        // 撤回 tween 跟入槽 tween 抢同一个 scale 属性,最终 scale 错乱
        tile.node.name = `tile_${tile.uid}`;

        const worldPosition = tile.node.worldPosition.clone();
        const layerContainer = this.getOrCreateLayerContainer(tile.layer);
        tile.node.setParent(layerContainer);
        tile.node.setWorldPosition(worldPosition);
        // 飞行期间先顶到本层容器末尾(同层最上面),避免被同层兄弟遮住
        tile.node.setSiblingIndex(layerContainer.children.length - 1);

        // 撤回飞回棋盘的飞行声,跟 tween 起手对齐
        AudioManager.instance.playOneShot(AudioClipNames.taskFly);

        const boardScale = this.getBoardTileScale();
        tween(tile.node)
            .to(0.16, { position: tile.boardPos, scale: new Vec3(boardScale, boardScale, 1) })
            .call(() => {
                // 撤回落定后再标记可点击 + 重新启用触摸
                tile.collected = false;
                tile.item.enableTileTouch();
                // 容器化后:层间顺序由 _layer_<N>_ 容器位置保证,落地后统一重排本层。
                this.refreshLayerDisplayOrder(layerContainer);
                this.updatePlayableStates();
                this.updateHud();
                this.checkEndState();
                Utils.onVibrationShort();
                this.saveProgressDeferred();
            })
            .start();
        this.arrangeSlotTiles(0.12 + 0.1);
        this.updateHud();
        this.refreshUndoButtonStatus();
    }

    // actionHistory 变动后调用,通知 UI 撤回按钮该置灰还是恢复彩色
    private refreshUndoButtonStatus() {
        const empty = this.actionHistory.length === 0;
        director.emit(Constants.eventNames.EventSetUndoButtonStatus, empty);
    }

    // 从本地存储读取两个道具的剩余次数(首次默认 1)
    private loadPropCounts() {
        this.undoCount = ProgressManager.loadUndoCount();
        this.switchCount = ProgressManager.loadSwitchCount();
    }

    // 通知 UI 刷新道具次数显示(di+countLabel / ad1)
    private emitPropCounts() {
        director.emit(Constants.eventNames.EventSetPropCount, { undo: this.undoCount, switch: this.switchCount });
    }

    private setUndoCount(v: number) {
        this.undoCount = Math.max(0, v);
        ProgressManager.saveUndoCount(this.undoCount);
        this.emitPropCounts();
    }

    private setSwitchCount(v: number) {
        this.switchCount = Math.max(0, v);
        ProgressManager.saveSwitchCount(this.switchCount);
        this.emitPropCounts();
    }

    private onBtnUnlockClick(event) {
        if (this.gameState !== 'playing') return;
        const box = this.targetBoxes.find((i) => !i.unlocked);
        if (!box) return this.showToast('槽位已满', 0.8);

        // 看视频广告
        SDKManager.instance.showVideoAd(() => {
            this.executeUnlock(box);
        }, () => {
            LayerManager.instance.showToast("视频播放未完成！")
        }, 'unlock');
    }

    private executeUnlock(box: TargetBox) {
        box.unlocked = true;
        // 用 refreshing 当锁，挡住 fillEmptyTargetBoxes 在动画期间抢先塞目标
        box.refreshing = true;

        // 触发解锁动画：盖子飞出 + 槽位回弹，box_2 由动画自行处理显示与隐藏
        director.emit(Constants.eventNames.EventShowSlotUnlock, this.getTargetBoxSlotID(box));

        this.updateHud();
        this.showToast('槽位+1', 0.8);

        // 解锁动画约 0.5667s，等盖子飞完再生成新目标，
        // 避免预览图在盖子还没飞走的时候提前露脸
        this.scheduleOnce(() => {
            box.refreshing = false;
            if (this.gameState !== 'playing' || !box.unlocked) return;
            this.assignNewTarget(box);
            this.collectStoredTargets();
            this.updateHud();
            this.saveProgressDeferred();
        }, Constants.slotAnim.UnlockWait);
    }

    // private onBtnShuffleBoardClick() {
    //     if (this.gameState !== 'playing') return;
    //     const activeTiles = this.tiles.filter((t) => !t.collected && !t.removed);
    //     if (activeTiles.length < 2) return;

    //     // 换牌道具的提示音
    //     AudioManager.instance.playOneShot(AudioClipNames.prop_tips);

    //     const random = Utils.createRandom(Date.now() + activeTiles.length * 31);
    //     const types = Utils.shuffle(activeTiles.map((t) => t.type), random);
    //     for (let i = 0; i < activeTiles.length; i++) {
    //         const tile = activeTiles[i]; tile.type = types[i];
    //         tile.item.setData(tile.type, tile.row, tile.col, tile.layer, this.iconFrames.get(tile.type) || null);
    //     }
    //     this.repairTargetBoxes(); this.collectStoredTargets(); this.updatePlayableStates(); this.showToast('已换牌', 0.8);
    // }

    private onBtnShuffleBoardClick() {
        if (this.gameState !== 'playing' || this.shuffleAnimating) return;

        // 次数用完:点击=看广告补充次数(refill only,不换牌)
        if (this.switchCount <= 0) {
            SDKManager.instance.showVideoAd(() => {
                this.setSwitchCount(this.switchCount + 3);
            }, () => {
                LayerManager.instance.showToast("视频播放未完成！")
            }, 'shuffle');
            return;
        }

        const activeTiles = this.tiles.filter((t) => !t.collected && !t.removed);
        if (activeTiles.length === 0) return;

        const topCandidates = activeTiles.filter((t) => !this.isTileBlocked(t));
        if (topCandidates.length === 0) return;

        // 有次数:消耗 1 次并直接换牌(不再看广告)
        this.setSwitchCount(this.switchCount - 1);
        this.executeShuffle(activeTiles, topCandidates);
    }

    private executeShuffle(activeTiles: TileRecord[], topCandidates: TileRecord[]) {
        // 换牌道具的提示音
        AudioManager.instance.playOneShot(AudioClipNames.prop_tips);

        const random = Utils.createRandom(Date.now() + activeTiles.length * 31);

        // 优化：优先选择当前目标类型的牌进行交换
        const currentTargetTypes = new Set(this.targetBoxes.map(box => box.type));

        // 1. 找出被压在下层的目标牌（被阻挡的目标牌）
        const blockedTargetTiles = activeTiles.filter((t) =>
            currentTargetTypes.has(t.type) && this.isTileBlocked(t)
        );

        // 2. 找出可点击的非目标牌（用于和目标牌交换）
        const topNonTargetTiles = topCandidates.filter((t) => !currentTargetTypes.has(t.type));

        let topTile: TileRecord;
        let lowerTile: TileRecord | null = null;

        // 优先策略：如果有被阻挡的目标牌，将其与上层的非目标牌交换
        if (blockedTargetTiles.length > 0 && topNonTargetTiles.length > 0) {
            // 随机选一个被阻挡的目标牌
            lowerTile = blockedTargetTiles[Math.floor(random() * blockedTargetTiles.length)];
            // 随机选一个可点击的非目标牌
            topTile = topNonTargetTiles[Math.floor(random() * topNonTargetTiles.length)];
        } else {
            // 降级策略：如果没有合适的目标牌交换，使用原有逻辑
            topTile = topCandidates[Math.floor(random() * topCandidates.length)];
            const lowerTiles = activeTiles.filter((t) => t.layer < topTile.layer);
            lowerTile = lowerTiles.length > 0 ? lowerTiles[Math.floor(random() * lowerTiles.length)] : null;
        }

        const duration = Constants.shuffleAnim.Duration;
        const swapAt = Math.min(Constants.shuffleAnim.SwapAt, duration);
        const shuffleSeq = ++this.shuffleSeq;

        this.shuffleAnimating = true;
        director.emit(Constants.eventNames.EventShowShuffleTileEffect, {
            worldPosition: topTile.node.worldPosition.clone(),
            scale: this.getBoardTileScale(),
            duration,
        });

        this.scheduleOnce(() => {
            if (shuffleSeq !== this.shuffleSeq) return;
            if (this.gameState !== 'playing') return;
            if (!topTile.node?.isValid || topTile.collected || topTile.removed) return;
            if (!lowerTile || !lowerTile.node?.isValid || lowerTile.collected || lowerTile.removed) return;

            const topType = topTile.type;
            topTile.type = lowerTile.type;
            lowerTile.type = topType;
            topTile.item.setData(topTile.type, topTile.row, topTile.col, topTile.layer, this.iconFrames.get(topTile.type) || null);
            lowerTile.item.setData(lowerTile.type, lowerTile.row, lowerTile.col, lowerTile.layer, this.iconFrames.get(lowerTile.type) || null);
        }, swapAt);
        this.scheduleOnce(() => {
            if (shuffleSeq !== this.shuffleSeq) return;
            this.shuffleAnimating = false;
            if (this.gameState !== 'playing') return;
            this.repairTargetBoxes();
            this.collectStoredTargets();
            this.updatePlayableStates();
            this.updateHud();
            this.showToast('已换牌', 0.8);
            this.saveProgressDeferred();
        }, duration);
    }

    // 队列模式下: shuffle 只是把"哪个位置放哪个 type"的映射换了一下,每种 type 的总数不变,
    // 所以 box.type / taskQueue 都仍然成立。这里只需要重渲染 box 状态,不要再去抢占队列。
    private repairTargetBoxes() {
        for (const box of this.targetBoxes) {
            this.emitRenderSlot(box);
        }
    }

    private onUpDateUiInit() {
        director.emit(Constants.eventNames.EventCleanSlotContainers);
        this.resetTargetBoxes();
    }

    // ==========================================
    // 关卡进度持久化
    // ==========================================

    private tileKey(tile: TileRecord): TileKey {
        return { layer: tile.layer, row: tile.row, col: tile.col };
    }

    private buildSnapshot(): ProgressSnapshot {
        // 反向索引: Node -> TileRecord,buildSnapshot 内部反复用,避免每张 box 牌都 tiles.find 全表扫
        const tileByNode = new Map<Node, TileRecord>();
        this.tiles.forEach((t) => tileByNode.set(t.node, t));

        const slotIndexByTile = new Map<TileRecord, number>();
        this.slots.forEach((t, i) => slotIndexByTile.set(t, i));
        const discardedSet = new Set(this.discardedTiles);
        const tileToBoxIndex = new Map<TileRecord, number>();
        this.targetBoxes.forEach((box, boxIdx) => {
            for (const child of box.node.children) {
                if (!child.name.startsWith('targetTile_')) continue;
                const tile = tileByNode.get(child);
                if (tile) tileToBoxIndex.set(tile, boxIdx);
            }
        });

        const tileSnaps: TileSnap[] = this.tiles.map((tile) => {
            let location: TileSnap['location'] = 'board';
            if (slotIndexByTile.has(tile)) location = 'slot';
            else if (discardedSet.has(tile)) location = 'discarded';
            else if (tileToBoxIndex.has(tile)) location = 'target';
            return {
                layer: tile.layer,
                row: tile.row,
                col: tile.col,
                type: tile.type,
                collected: tile.collected,
                removed: tile.removed,
                location,
            };
        });

        // box.tileKeys 按 siblingIndex 升序导出 — 落入越早 siblingIndex 越小,恢复时按同样顺序写回 itemNodes[1..progress]
        const boxes: BoxSnap[] = this.targetBoxes.map((box) => {
            const tileKeys: TileKey[] = box.node.children
                .filter((c) => c.name.startsWith('targetTile_'))
                .slice()
                .sort((a, b) => a.getSiblingIndex() - b.getSiblingIndex())
                .map((c) => tileByNode.get(c))
                .filter((t): t is TileRecord => !!t)
                .map((t) => this.tileKey(t));
            return {
                type: box.type,
                progress: box.progress,
                unlocked: box.unlocked,
                required: box.required,
                tileKeys,
            };
        });

        return {
            version: 1,
            level: this.nowLevel,
            taskQueue: this.taskQueue.slice(),
            tiles: tileSnaps,
            slotKeys: this.slots.map((t) => this.tileKey(t)),
            discardedKeys: this.discardedTiles.map((t) => this.tileKey(t)),
            actionHistoryKeys: this.actionHistory.map((t) => this.tileKey(t)),
            boxes,
            remainTime: this.remainTime,
            elapsedTime: this.elapsedTime,
        };
    }

    private applySnapshot(snap: ProgressSnapshot) {
        // 建索引: (layer,row,col) -> snap / tile,后续多步反复用
        const snapByKey = new Map<string, TileSnap>();
        for (const s of snap.tiles) snapByKey.set(`${s.layer}|${s.row}|${s.col}`, s);
        const tileByKey = new Map<string, TileRecord>();
        for (const tile of this.tiles) tileByKey.set(`${tile.layer}|${tile.row}|${tile.col}`, tile);
        const lookup = (k: TileKey): TileRecord | null => tileByKey.get(`${k.layer}|${k.row}|${k.col}`) || null;

        // 1. 只把仍留在棋盘上的 tile 复位到 boardPos。
        //    其它(slot/target/discarded) 在 step 3-5 里会 setParent + setPosition,
        //    在这之前它们停在 generateBoard 的 y+760 起飞坐标也无妨 — 同帧内被覆盖,无视觉闪烁
        const boardScale = this.getBoardTileScale();
        for (const tile of this.tiles) {
            const s = snapByKey.get(`${tile.layer}|${tile.row}|${tile.col}`);
            if (s && s.location !== 'board') continue;
            tile.node.setPosition(tile.boardPos);
            tile.node.setScale(boardScale, boardScale, 1);
        }

        // 2. 覆盖 taskQueue (buildTaskQueue 已先填了原始队列)
        this.taskQueue = snap.taskQueue.slice();

        // 3. 还原每张牌的 type/collected/removed (type 可能被 shuffle 改过)
        for (const snapTile of snap.tiles) {
            const tile = lookup(snapTile);
            if (!tile) continue;
            if (snapTile.type !== tile.type) {
                tile.type = snapTile.type;
                tile.item.setData(snapTile.type, tile.row, tile.col, tile.layer, this.iconFrames.get(snapTile.type) || null);
            }
            tile.collected = snapTile.collected;
            tile.removed = snapTile.removed;
            // 异常情况:被标 removed 但 location 还在 board → 隐藏防呆
            if (snapTile.removed && snapTile.location === 'board') {
                tile.node.active = false;
            }
        }

        // 4. 底部 slot
        this.slots = [];
        const slotTileScale = Constants.MahjongBoard.SlotTileScale;
        for (let i = 0; i < snap.slotKeys.length; i++) {
            const tile = lookup(snap.slotKeys[i]);
            if (!tile) continue;
            this.slots.push(tile);
            tile.node.name = `slotTile_${tile.uid}`;
            tile.node.setParent(this.slotNode);
            tile.node.setPosition(this.getSlotTargetPosition(i));
            tile.node.setScale(slotTileScale, slotTileScale, 1);
            tile.node.setSiblingIndex(Constants.MahjongBoard.BottomSlotSiblingBase + i);
            tile.item.disableTileTouch();
        }

        // 5. 目标槽 + 落入的 tiles
        for (let i = 0; i < this.targetBoxes.length && i < snap.boxes.length; i++) {
            const box = this.targetBoxes[i];
            const boxSnap = snap.boxes[i];
            box.type = boxSnap.type;
            box.progress = boxSnap.progress;
            box.unlocked = boxSnap.unlocked;
            box.required = boxSnap.required;
            box.pending = 0;
            box.refreshing = false;
            box.movedOut = false;
            box.movingIn = false;

            for (let j = 0; j < boxSnap.tileKeys.length; j++) {
                const tile = lookup(boxSnap.tileKeys[j]);
                if (!tile) continue;
                tile.node.name = `targetTile_${tile.uid}`;
                const targetCell = box.itemNodes[j + 1] || box.iconNode;
                const cellPos = targetCell ? targetCell.position.clone() : new Vec3();
                tile.node.setParent(box.node);
                tile.node.setPosition(cellPos);
                tile.node.setScale(Constants.MahjongBoard.SlotScale, Constants.MahjongBoard.SlotScale, 1);
                tile.node.setSiblingIndex(Constants.MahjongBoard.TargetBoxSiblingBase + j + 1);
                tile.item.disableTileTouch();
            }
            // 同步 UI(预览图/锁状态),覆盖 resetTargetBoxes 写入的初始状态
            this.emitRenderSlot(box);
        }

        // 6. 失败弹窗清空后备栏后挂起的牌
        this.discardedTiles = [];
        for (const key of snap.discardedKeys) {
            const tile = lookup(key);
            if (!tile) continue;
            this.discardedTiles.push(tile);
            tile.node.setParent(this.slotNode);
            tile.node.active = false;
            tile.item.disableTileTouch();
        }

        // 7. 撤回栈:只保留确实在 slots 里的(防御性 - clearBottomSlot 可能已过滤过,但 snapshot 跨会话防呆)
        const slotSet = new Set(this.slots);
        this.actionHistory = snap.actionHistoryKeys
            .map((k) => lookup(k))
            .filter((t): t is TileRecord => !!t && slotSet.has(t));

        // 8. 计时与状态
        this.remainTime = snap.remainTime;
        this.elapsedTime = snap.elapsedTime;
        this.lastTickSecond = -1;
        this.comboTimes = 0;
        this.lastComboAt = 0;
        this.targetsInitialized = true;
        this.dealingTiles = false;
        this.gameState = 'playing';

        // 9. 板上 shadow 需重算(slot/target 上的牌 MahjongItem.start 已被守卫,不会误挂)
        this.refreshUndoButtonStatus();
        // 板上所有 layer 容器重排一次,保证渲染顺序
        const layers = new Set<number>();
        for (const tile of this.tiles) layers.add(tile.layer);
        layers.forEach((layer) => this.refreshLayerDisplayOrder(this.getOrCreateLayerContainer(layer)));
        this.updateBoardTileShadows();

        // 10. 若恢复的 slot 牌刚好匹配某个 box.type,立刻飞过去补单
        this.collectStoredTargets();
    }

    private saveProgressDeferred() {
        if (this.isGuideLevel()) return;
        this.snapshotDirty = true;
        if (this.snapshotFlushScheduled) return;
        this.snapshotFlushScheduled = true;
        this.scheduleOnce(() => {
            this.snapshotFlushScheduled = false;
            this.flushSnapshot();
        }, 0);
    }

    private flushSnapshot() {
        if (!this.snapshotDirty) return;
        if (this.gameState !== 'playing') return;
        if (this.resolvingMatch || this.dealingTiles || this.shuffleAnimating) return;
        if (this.targetBoxes.some((b) => b.pending > 0 || b.refreshing || b.movingIn || b.movedOut)) return;
        if (this.flyLayer?.isValid && this.tiles.some((t) => t.node?.parent === this.flyLayer)) return;
        ProgressManager.saveSnapshot(this.buildSnapshot());
        this.snapshotDirty = false;
    }
}
