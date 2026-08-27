import { _decorator, assetManager, Component, director, Director, instantiate, Label, Layout, Node, ScrollView, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3, v3 } from 'cc';
import { Constants } from './config/Constants';
import { AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { SettlementRankManager, SettlementRankResult } from './manager/SettlementRankManager';
import { SDKManager } from '../../loading/SDKManager';

const { ccclass } = _decorator;

export interface UIWinLayerImportedInfo {
    level?: number;
    nextLevel?: number;
    elapsedMs?: number;
    isActivity?: boolean;
    /** 当前项目的 GameCtrl 以秒传递结算耗时。 */
    time?: number;
}

interface NormalizedWinInfo {
    level: number;
    nextLevel?: number;
    elapsedMs: number;
    isActivity: boolean;
}

interface RankRow {
    rank: number;
    name: string;
    progress: number;
    tierIndex: number;
    isSelf: boolean;
}

interface RankAnimationData {
    startRows: RankRow[];
    finalRows: RankRow[];
    selfStartRank: number;
    selfFinalRank: number;
}

interface RankPushNodeState {
    node: Node;
    row: RankRow;
    basePosition: Vec3;
    targetPosition: Vec3;
    rankUpdated: boolean;
}

interface RankScrollTargetInfo {
    targetPercent: number;
    maxOffset: number;
}

interface RankMoveProxy {
    ratio: number;
}

type VirtualRankNode = Node & {
    __virtualRank?: number;
};

@ccclass('UIWinLayerImported')
export class UIWinLayerImported extends Component {
    private static _current: UIWinLayerImported | null = null;
    private static _rankTimingSequence = 0;
    private static readonly VIRTUAL_RANK_BUFFER_ROWS = 2;
    private static readonly RANK_SCROLLING_EVENT = 'scrolling';
    private static readonly SELF_RANK_ANIM_DELAY = 0.25;
    private static readonly SELF_RANK_LIFT_SECONDS = 0.1;
    private static readonly SELF_RANK_MIN_MOVE_SECONDS = 0.32;
    private static readonly SELF_RANK_MOVE_SPEED = 1200;
    private static readonly SELF_RANK_SETTLE_SHRINK_SECONDS = 0.08;
    private static readonly SELF_RANK_SETTLE_OVERSHOOT_SECONDS = 0.08;
    private static readonly SELF_RANK_SETTLE_RESTORE_SECONDS = 0.06;
    private static readonly PROMOTION_RESOURCE_DIR = 'resources/win/UIWinLayer/settlementRank';
    private static readonly PROMOTION_DIGIT_SPACING = -6;
    private static readonly PROMOTION_TIER_ASSETS = [
        'tier_1_bronze',
        'tier_2_silver',
        'tier_3_gold',
        'tier_4_platinum',
        'tier_5_diamond',
        'tier_6_star',
        'tier_7_king',
        'tier_8_peerless',
        'tier_9_glory',
        'tier_10_supreme',
    ];
    private static readonly RANK_TIER_RESOURCE_DIR = 'resources/rank';
    private static readonly RANK_TIER_ASSETS = [
        'tier1',
        'tier2',
        'tier3',
        'tier4',
        'tier5',
        'tier6',
        'tier7',
        'tier8',
        'tier9',
        'tier10',
    ];
    private static readonly RANK_TIER_FRAME_CACHE = new Map<number, SpriteFrame>();
    private static readonly RANK_TIER_FRAME_WAITERS = new Map<
        number,
        Array<(frame: SpriteFrame | null) => void>
    >();
    private static readonly RANK_NAME_PREFIXES = [
        '糖豆', '小羊', '云朵', '西瓜', '晴天',
        '星星', '阿布', '小猪', '风车', '猫爪',
    ];
    private static readonly RANK_NAME_SUFFIXES = [
        '师傅', '快跑', '玩家', '很甜', '搬家',
        '泡泡', '冲鸭', '少年', '布丁', '团子',
    ];

    static async show(_parent: Node, info: UIWinLayerImportedInfo): Promise<UIWinLayerImported | null> {
        const node = LayerManager.instance.showUI('UIWinLayer', info);
        if (!node) return null;
        return node.getComponent(UIWinLayerImported);
    }

    private _info: NormalizedWinInfo = { level: 1, elapsedMs: 0, isActivity: false };
    private _leaving = false;
    private _continueAvailable = false;
    private _onContinue: (() => void) | null = null;
    private _bound: Array<{ node: Node; handler: () => void }> = [];
    private _rankMoveProxy: RankMoveProxy | null = null;
    private _activeRankFloatItem: Node | null = null;
    private _rankScrollView: ScrollView | null = null;
    private _rankLayout: Node | null = null;
    private _rankSelfTemplate: Node | null = null;
    private _rankNormalTemplate: Node | null = null;
    private _rankRows: RankRow[] = [];
    private _rankVirtualNormalNodes: VirtualRankNode[] = [];
    private _rankVirtualSelfNode: VirtualRankNode | null = null;
    private _rankVirtualWindowStart = -1;
    private _rankVirtualWindowEnd = -1;
    private _rankVirtualEnabled = false;
    private _rankItemHeight = 1;
    private _rankItemSpacingY = 0;
    private _rankRowHeight = 1;
    private _rankPaddingTop = 0;
    private _rankPaddingBottom = 0;
    private _rankItemX = 0;
    private _rankItemZ = 0;
    private _rankTimingLabel = '';
    private _rankTimingStartedAt = 0;
    private _rankTimingActive = false;
    private _rankDisplayLogScheduled = false;
    private _promotionCountRequestId = 0;
    private _rankSettlement: SettlementRankResult = {
        tierIndex: 0,
        progress: 0,
        startRank: SettlementRankManager.PLAYER_COUNT,
        finalRank: SettlementRankManager.PLAYER_COUNT,
        generation: 0,
        promoted: false,
        advanced: false,
    };


    init(info?: UIWinLayerImportedInfo, onContinue?: () => void): void {
        const nextLevel = info?.nextLevel;
        const inferredLevel = nextLevel == null ? 1 : nextLevel - 1;
        this._info = {
            level: Math.max(1, Math.floor(info?.level ?? inferredLevel)),
            nextLevel,
            elapsedMs: Math.max(0, info?.elapsedMs ?? (info?.time ?? 0) * 1000),
            isActivity: !!info?.isActivity,
        };
        this._rankSettlement = SettlementRankManager.settle(
            this._info.level,
            !this._info.isActivity,
        );
        this._onContinue = typeof onContinue === 'function' ? onContinue : null;
        UIWinLayerImported._current = this;
    }

    protected start(): void {
        this.setupTimeLabel();
        this.setupPromotionHint();
        this.setupRankList();
        this.bindButtons();
        this.playEntrance();
        this.playWinEffect();
    }

    protected onDestroy(): void {
        if (UIWinLayerImported._current === this) UIWinLayerImported._current = null;
        this._promotionCountRequestId += 1;
        if (this._rankTimingActive) {
            this.logRankTiming('排行榜销毁，计时提前结束');
            this.endRankTiming();
        }
        this.stopVirtualRankList();
        this.stopRankUpRuntimeTweens();
        for (const { node, handler } of this._bound) {
            if (node?.isValid) node.off(Node.EventType.TOUCH_END, handler, this);
        }
        this._bound = [];
        this._onContinue = null;
    }

    private setupTimeLabel(): void {
        const label = this.node.getChildByName('view')?.getChildByName('Label')?.getComponent(Label);
        if (label) label.string = this.formatTime(this._info.elapsedMs);
    }

    private setupPromotionHint(): void {
        const view = this.node.getChildByName('view');
        const hint = view?.getChildByName('promotionHint');
        const tierNode = view?.getChildByName('promotionTier');
        const splash = view?.getChildByName('SpriteSplash');

        // The redesigned layout uses SpriteSplash as its top banner and keeps the
        // legacy promotion nodes only for prefab compatibility. Do not override
        // their inactive state when that banner is present.
        if (splash) {
            if (hint) hint.active = false;
            if (tierNode) tierNode.active = false;
            return;
        }

        const countNode = hint?.getChildByName('promotionCount');
        if (!hint || !tierNode || !countNode) return;

        const rankCount = Math.min(
            Constants.rankNames.length,
            UIWinLayerImported.PROMOTION_TIER_ASSETS.length,
        );
        const targetTierIndex = this._rankSettlement.tierIndex + 1;
        if (targetTierIndex >= rankCount) {
            hint.active = false;
            tierNode.active = false;
            return;
        }

        hint.active = true;
        tierNode.active = true;
        const promotionCount = Math.max(
            0,
            SettlementRankManager.PROGRESS_COUNT - this._rankSettlement.progress,
        );
        this.loadPromotionCountSprites(countNode, promotionCount);
        this.loadPromotionTierSprite(tierNode, targetTierIndex);
    }

    private loadPromotionCountSprites(countNode: Node, count: number): void {
        const legacyLabel = countNode.getComponent(Label);
        const countText = `${Math.max(0, Math.floor(count))}`;
        if (legacyLabel) {
            legacyLabel.string = '';
            legacyLabel.enabled = false;
        }
        this.clearPromotionDigitNodes(countNode);

        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.warn('[UIWinLayerImported] 游戏资源包未加载，无法显示晋级图片数字');
            return;
        }

        const requestId = ++this._promotionCountRequestId;
        const frames: Array<SpriteFrame | null> = countText.split('').map(() => null);
        let remaining = frames.length;
        let failed = false;

        countText.split('').forEach((digit, index) => {
            const path = `${UIWinLayerImported.PROMOTION_RESOURCE_DIR}/digit_${digit}/spriteFrame`;
            bundle.load(path, SpriteFrame, (err, frame) => {
                if (requestId !== this._promotionCountRequestId) return;
                if (err || !frame) {
                    failed = true;
                    console.warn(`[UIWinLayerImported] 晋级数字素材加载失败: ${path}`, err);
                } else {
                    frames[index] = frame;
                }

                remaining -= 1;
                if (remaining > 0 || !this.node.isValid || !countNode.isValid) return;
                if (failed || frames.some((item) => !item)) return;
                this.renderPromotionDigitSprites(countNode, frames as SpriteFrame[]);
            });
        });
    }

    private renderPromotionDigitSprites(countNode: Node, frames: SpriteFrame[]): void {
        this.clearPromotionDigitNodes(countNode);
        const sizes = frames.map((frame) => frame.originalSize);
        const spacing = UIWinLayerImported.PROMOTION_DIGIT_SPACING;
        const totalWidth = sizes.reduce((sum, size) => sum + size.width, 0)
            + Math.max(0, sizes.length - 1) * spacing;
        const maxHeight = sizes.reduce((height, size) => Math.max(height, size.height), 0);
        const countTransform = countNode.getComponent(UITransform) || countNode.addComponent(UITransform);
        countTransform.setContentSize(totalWidth, maxHeight);

        let cursorX = -totalWidth / 2;
        frames.forEach((frame, index) => {
            const size = sizes[index];
            const digitNode = new Node(`promotionDigit_${index}`);
            digitNode.layer = countNode.layer;
            countNode.addChild(digitNode);

            const transform = digitNode.addComponent(UITransform);
            transform.setContentSize(size.width, size.height);
            const sprite = digitNode.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
            digitNode.setPosition(cursorX + size.width / 2, 0, 0);
            cursorX += size.width + spacing;
        });
    }

    private clearPromotionDigitNodes(countNode: Node): void {
        for (const child of [...countNode.children]) {
            if (!child.name.startsWith('promotionDigit_')) continue;
            child.removeFromParent();
            child.destroy();
        }
    }

    private loadPromotionTierSprite(tierNode: Node, tierIndex: number): void {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        const assetName = UIWinLayerImported.PROMOTION_TIER_ASSETS[tierIndex];
        if (!bundle || !assetName) return;

        const path = `${UIWinLayerImported.PROMOTION_RESOURCE_DIR}/${assetName}/spriteFrame`;
        bundle.load(path, SpriteFrame, (err, frame) => {
            if (err || !frame) {
                console.warn(`[UIWinLayerImported] 段位素材加载失败: ${path}`, err);
                return;
            }
            if (!this.node.isValid || !tierNode.isValid) return;
            const sprite = tierNode.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = frame;
        });
    }

    private setupRankList(): void {
        this.beginRankTiming();
        this.setContinueAvailable(false);
        this.unscheduleAllCallbacks();
        this.stopVirtualRankList();
        this.stopRankUpRuntimeTweens();

        const view = this.node.getChildByName('view');
        const layout = this.findChildDeep(view, 'Layout');
        if (!layout) {
            this.setContinueAvailable(true);
            this.logRankTiming('排行榜未显示：找不到 Layout');
            this.endRankTiming();
            return;
        }

        const templateItems = layout.children.filter((child) => child.name === 'item');
        if (templateItems.length === 0) {
            this.setContinueAvailable(true);
            this.logRankTiming('排行榜未显示：找不到 item 模板');
            this.endRankTiming();
            return;
        }

        const layoutComp = layout.getComponent(Layout);
        this.clearRenderedRankItems(layout);

        const oldFloatLayer = this.findChildDeep(view, 'selfRankFloatLayer');
        if (oldFloatLayer) {
            Tween.stopAllByTarget(oldFloatLayer);
            oldFloatLayer.removeFromParent();
            oldFloatLayer.destroy();
        }

        const finalRows = this.createRankRows();
        const animationData = this.createRankAnimationData(
            finalRows,
            this._rankSettlement.startRank,
        );
        for (const item of templateItems) item.active = false;
        this._rankLayout = layout;
        this._rankSelfTemplate = templateItems[0];
        this._rankNormalTemplate = templateItems[1] ?? templateItems[0];
        this._rankRows = finalRows;
        this.prepareVirtualRankLayout(layout, layoutComp, templateItems[0], finalRows.length);
        const scrollView = this.configureRankScrollView(layout);

        if (!scrollView) {
            this.setContinueAvailable(true);
            this.logRankTiming('排行榜未显示：找不到 ScrollView');
            this.endRankTiming();
            return;
        }

        if (!animationData) {
            const selfRank = finalRows.find((row) => row.isSelf)?.rank ?? 1;
            this.activateVirtualRankList(scrollView, selfRank);
            scrollView.enabled = true;
            this.setContinueAvailable(true);
            this.logRankDisplayedAfterDraw(false);
            return;
        }

        const rankNodes = this.renderRankAnimationWindow(
            layout,
            scrollView,
            animationData.startRows,
            animationData.selfFinalRank,
            animationData.selfStartRank,
        );
        const finalRankPositions = new Map<number, Vec3>();
        for (let rank = animationData.selfFinalRank; rank <= animationData.selfStartRank + 1; rank++) {
            finalRankPositions.set(rank, this.getRankItemPosition(rank));
        }
        const selfSourceItem = rankNodes.get(animationData.selfStartRank);
        const targetItem = rankNodes.get(animationData.selfFinalRank);
        const finalTargetPosition = finalRankPositions.get(animationData.selfFinalRank);
        if (!selfSourceItem || !targetItem || !finalTargetPosition) {
            this.activateVirtualRankList(scrollView, animationData.selfFinalRank);
            scrollView.enabled = true;
            this.setContinueAvailable(true);
            this.logRankDisplayedAfterDraw(false);
            return;
        }

        this.scrollToRankPosition(scrollView, animationData.selfStartRank, 0);
        this.logRankDisplayedAfterDraw(true);
        this.scheduleOnce(() => {
            this.playSelfRankUpAnimation(
                layout,
                scrollView,
                animationData,
                selfSourceItem,
                rankNodes,
                finalRankPositions,
            );
        }, UIWinLayerImported.SELF_RANK_ANIM_DELAY);
    }

    private beginRankTiming(): void {
        if (this._rankTimingActive) this.endRankTiming();
        const sequence = ++UIWinLayerImported._rankTimingSequence;
        this._rankTimingLabel = `[UIWinLayerImported][排行榜][关卡${this._info.level}][#${sequence}]`;
        this._rankTimingStartedAt = Date.now();
        this._rankTimingActive = true;
        this._rankDisplayLogScheduled = false;
        console.log(this._rankTimingLabel, '0ms', '排行榜开始加载');
    }

    private logRankTiming(message: string): void {
        if (!this._rankTimingActive) return;
        console.log(this._rankTimingLabel, `${Date.now() - this._rankTimingStartedAt}ms`, message);
    }

    private logRankDisplayedAfterDraw(hasAnimation: boolean): void {
        if (!this._rankTimingActive || this._rankDisplayLogScheduled) return;
        this._rankDisplayLogScheduled = true;
        director.once(Director.EVENT_AFTER_DRAW, () => {
            if (!this._rankTimingActive || !this.node.isValid || !this.node.activeInHierarchy) return;
            this.logRankTiming('排行榜已显示（首帧绘制完成）');
            if (!hasAnimation) {
                this.logRankTiming('排行榜动画结束（本次无动画）');
                this.endRankTiming();
            }
        });
    }

    private endRankTiming(): void {
        if (!this._rankTimingActive) return;
        console.log(
            this._rankTimingLabel,
            `${Date.now() - this._rankTimingStartedAt}ms`,
            '排行榜计时结束',
        );
        this._rankTimingActive = false;
        this._rankDisplayLogScheduled = false;
    }

    private findChildDeep(root: Node | null | undefined, name: string): Node | null {
        if (!root) return null;
        const direct = root.getChildByName(name);
        if (direct) return direct;

        for (const child of root.children) {
            const found = this.findChildDeep(child, name);
            if (found) return found;
        }
        return null;
    }

    private setChildLabel(parent: Node, childName: string, value: string): void {
        const label = parent.getChildByName(childName)?.getComponent(Label);
        if (label) label.string = value;
    }

    private clearRenderedRankItems(layout: Node): void {
        for (const child of [...layout.children]) {
            if (child.name !== 'rankItem' && child.name !== 'selfRankFloat') continue;
            Tween.stopAllByTarget(child);
            child.removeFromParent();
            child.destroy();
        }
    }

    private prepareVirtualRankLayout(
        layout: Node,
        layoutComp: Layout | null,
        sampleItem: Node,
        rowCount: number,
    ): void {
        const sampleTransform = sampleItem.getComponent(UITransform);
        const layoutTransform = layout.getComponent(UITransform);
        this._rankItemHeight = Math.max(1, sampleTransform?.contentSize.height ?? 1);
        this._rankItemSpacingY = layoutComp?.spacingY ?? 0;
        this._rankRowHeight = Math.max(1, this._rankItemHeight + this._rankItemSpacingY);
        this._rankPaddingTop = layoutComp?.paddingTop ?? 0;
        this._rankPaddingBottom = layoutComp?.paddingBottom ?? 0;
        this._rankItemX = sampleItem.position.x;
        this._rankItemZ = sampleItem.position.z;

        if (layoutComp) layoutComp.enabled = false;
        if (!layoutTransform) return;
        const contentHeight = this._rankPaddingTop
            + this._rankPaddingBottom
            + rowCount * this._rankItemHeight
            + Math.max(0, rowCount - 1) * this._rankItemSpacingY;
        layoutTransform.setContentSize(layoutTransform.contentSize.width, contentHeight);
    }

    private getRankItemPosition(rank: number): Vec3 {
        const normalizedRank = Math.max(1, Math.floor(rank));
        return v3(
            this._rankItemX,
            -this._rankPaddingTop
                - this._rankItemHeight * 0.5
                - (normalizedRank - 1) * this._rankRowHeight,
            this._rankItemZ,
        );
    }

    private prepareRankItemNode(item: Node): void {
        item.name = 'rankItem';
        item.setScale(1, 1, 1);
        this.setNodeOpacity(item, 255);
        for (const name of ['count', 'label1', 'label2', 'tierLabel']) {
            const label = item.getChildByName(name)?.getComponent(Label);
            if (label) label.cacheMode = Label.CacheMode.BITMAP;
        }
    }

    private createRankItem(template: Node, parent: Node): VirtualRankNode {
        const item = instantiate(template) as VirtualRankNode;
        this.prepareRankItemNode(item);
        item.parent = parent;
        item.setSiblingIndex(parent.children.length - 1);
        item.active = true;
        return item;
    }

    private renderRankAnimationWindow(
        layout: Node,
        scrollView: ScrollView,
        rows: RankRow[],
        firstPathRank: number,
        lastPathRank: number,
    ): Map<number, Node> {
        this.clearRenderedRankItems(layout);
        const viewHeight = this.getRankViewHeight(scrollView);
        const halfVisibleRows = Math.ceil(viewHeight / this._rankRowHeight / 2);
        const firstRank = Math.max(1, firstPathRank - halfVisibleRows);
        const lastRank = Math.min(rows.length, lastPathRank + halfVisibleRows);
        const rowsByRank = new Map(rows.map((row) => [row.rank, row]));
        const rankNodes = new Map<number, Node>();

        for (let rank = firstRank; rank <= lastRank; rank++) {
            const row = rowsByRank.get(rank);
            if (!row || !this._rankSelfTemplate || !this._rankNormalTemplate) continue;
            const item = this.createRankItem(
                row.isSelf ? this._rankSelfTemplate : this._rankNormalTemplate,
                layout,
            );
            item.__virtualRank = rank;
            item.setPosition(this.getRankItemPosition(rank));
            this.applyRankRowData(item, row);
            rankNodes.set(rank, item);
        }
        return rankNodes;
    }

    private activateVirtualRankList(scrollView: ScrollView, focusRank: number): void {
        const layout = this._rankLayout;
        const selfTemplate = this._rankSelfTemplate;
        const normalTemplate = this._rankNormalTemplate;
        if (!layout || !selfTemplate || !normalTemplate || this._rankRows.length === 0) return;

        this.stopVirtualRankList();
        this.clearRenderedRankItems(layout);
        this.scrollToRankPosition(scrollView, focusRank, 0);

        const poolSize = this.getVirtualRankPoolSize(scrollView, this._rankRows.length);
        this._rankVirtualSelfNode = this.createRankItem(selfTemplate, layout);
        this._rankVirtualSelfNode.active = false;
        this._rankVirtualNormalNodes = [];
        for (let index = 0; index < poolSize; index++) {
            const item = this.createRankItem(normalTemplate, layout);
            item.active = false;
            this._rankVirtualNormalNodes.push(item);
        }

        this._rankVirtualEnabled = true;
        scrollView.node.on(UIWinLayerImported.RANK_SCROLLING_EVENT, this.onVirtualRankScroll, this);
        this.refreshVirtualRankRows(true, focusRank);
        this.scheduleOnce(() => this.refreshVirtualRankRows(true), 0);
    }

    private stopVirtualRankList(): void {
        if (this._rankScrollView?.node?.isValid) {
            this._rankScrollView.node.off(
                UIWinLayerImported.RANK_SCROLLING_EVENT,
                this.onVirtualRankScroll,
                this,
            );
        }
        this._rankVirtualEnabled = false;
        this._rankVirtualWindowStart = -1;
        this._rankVirtualWindowEnd = -1;
        this._rankVirtualNormalNodes = [];
        this._rankVirtualSelfNode = null;
    }

    private onVirtualRankScroll = (): void => {
        this.refreshVirtualRankRows(false);
    };

    private refreshVirtualRankRows(force = false, focusRank?: number): void {
        const scrollView = this._rankScrollView;
        const total = this._rankRows.length;
        if (!this._rankVirtualEnabled || !scrollView || total === 0) return;

        const viewHeight = this.getRankViewHeight(scrollView);
        let startRank: number;
        let endRank: number;
        if (focusRank != null) {
            const poolSize = this.getVirtualRankPoolSize(scrollView, total);
            startRank = Math.floor(focusRank) - Math.floor(poolSize / 2);
            startRank = Math.max(1, Math.min(startRank, Math.max(1, total - poolSize + 1)));
            endRank = Math.min(total, startRank + poolSize - 1);
        } else {
            const offsetY = this.getRankScrollOffsetY(scrollView);
            startRank = Math.max(
                1,
                Math.floor(offsetY / this._rankRowHeight) + 1
                    - UIWinLayerImported.VIRTUAL_RANK_BUFFER_ROWS,
            );
            endRank = Math.min(
                total,
                Math.ceil((offsetY + viewHeight) / this._rankRowHeight)
                    + UIWinLayerImported.VIRTUAL_RANK_BUFFER_ROWS,
            );
        }

        if (
            !force
            && startRank === this._rankVirtualWindowStart
            && endRank === this._rankVirtualWindowEnd
        ) return;

        this._rankVirtualWindowStart = startRank;
        this._rankVirtualWindowEnd = endRank;
        const selfNode = this._rankVirtualSelfNode;
        const normalNodes = this._rankVirtualNormalNodes;
        let normalIndex = 0;
        let selfVisible = false;

        for (let rank = startRank; rank <= endRank; rank++) {
            const row = this._rankRows[rank - 1];
            if (!row) continue;
            const item = row.isSelf ? selfNode : normalNodes[normalIndex++];
            if (!item?.isValid) continue;

            item.active = true;
            item.setPosition(this.getRankItemPosition(rank));
            if (force || item.__virtualRank !== rank) {
                item.__virtualRank = rank;
                this.applyRankRowData(item, row);
            }
            if (row.isSelf) selfVisible = true;
        }

        for (; normalIndex < normalNodes.length; normalIndex++) {
            const item = normalNodes[normalIndex];
            if (!item?.isValid) continue;
            item.active = false;
            item.__virtualRank = -1;
        }
        if (selfNode?.isValid && !selfVisible) {
            selfNode.active = false;
            selfNode.__virtualRank = -1;
        }
    }

    private getVirtualRankPoolSize(scrollView: ScrollView, total: number): number {
        const visibleRows = Math.ceil(this.getRankViewHeight(scrollView) / this._rankRowHeight);
        return Math.min(
            total,
            visibleRows + UIWinLayerImported.VIRTUAL_RANK_BUFFER_ROWS * 2 + 1,
        );
    }

    private getRankViewHeight(scrollView: ScrollView): number {
        // The content parent is the node carrying the Mask, so its height is the
        // actual visible viewport. The ScrollView node can be taller after a
        // layout-only resize and must not inflate virtual-list calculations.
        return scrollView.content?.parent?.getComponent(UITransform)?.contentSize.height
            ?? scrollView.view?.contentSize.height
            ?? scrollView.node.getComponent(UITransform)?.contentSize.height
            ?? 0;
    }

    private getRankScrollOffsetY(scrollView: ScrollView): number {
        const offsetY = scrollView.getScrollOffset().y;
        const maxOffsetY = scrollView.getMaxScrollOffset().y;
        return Math.max(0, Math.min(offsetY, Math.max(0, maxOffsetY)));
    }

    private applyRankRowData(item: Node, row: RankRow): void {
        const head = item.getChildByName('head');
        if (head) head.active = true;
        this.setChildLabel(item, 'count', `${row.rank}`);
        this.setChildLabel(item, 'label1', row.name);
        this.setChildLabel(item, 'label2', `${row.progress}`);
        this.applyRankTierIcon(item, row.tierIndex);
    }

    private applyRankTierIcon(item: Node, rankTierIndex: number): void {
        const tierIcon = item.getChildByName('tierIcon');
        const tierSprite = tierIcon?.getComponent(Sprite);
        const tierTransform = tierIcon?.getComponent(UITransform);
        const tierIndex = Math.max(
            0,
            Math.min(
                UIWinLayerImported.RANK_TIER_ASSETS.length - 1,
                Math.floor(Number(rankTierIndex) || 0),
            ),
        );
        const tierLabel = item.getChildByName('tierLabel');
        if (tierLabel) tierLabel.active = true;
        this.setChildLabel(item, 'tierLabel', Constants.rankNames[tierIndex] || '');
        const assetName = UIWinLayerImported.RANK_TIER_ASSETS[tierIndex];
        if (!tierIcon || !tierSprite || !tierTransform || !assetName) {
            if (tierIcon) tierIcon.active = false;
            return;
        }

        tierIcon.active = true;
        const requestKey = `${tierIndex}:${assetName}`;
        const runtimeIcon = tierIcon as Node & {
            __winRankTierRequest?: string;
            __winRankTierMaxSize?: { width: number; height: number };
        };
        if (runtimeIcon.__winRankTierRequest === requestKey && tierSprite.spriteFrame) return;

        runtimeIcon.__winRankTierRequest = requestKey;
        runtimeIcon.__winRankTierMaxSize ??= {
            width: tierTransform.contentSize.width,
            height: tierTransform.contentSize.height,
        };
        tierSprite.spriteFrame = null;

        this.loadRankTierFrame(tierIndex, assetName, (frame) => {
            if (!frame) {
                if (tierIcon.isValid) tierIcon.active = false;
                return;
            }
            if (
                !this.node.isValid
                || !tierIcon.isValid
                || runtimeIcon.__winRankTierRequest !== requestKey
            ) return;

            const maxSize = runtimeIcon.__winRankTierMaxSize;
            if (!maxSize) return;
            const sourceSize = frame.originalSize;
            const sourceWidth = Math.max(1, sourceSize.width);
            const sourceHeight = Math.max(1, sourceSize.height);
            const fitScale = Math.min(maxSize.width / sourceWidth, maxSize.height / sourceHeight);

            tierSprite.spriteFrame = frame;
            tierSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            tierTransform.setContentSize(sourceWidth * fitScale, sourceHeight * fitScale);
        });
    }

    private loadRankTierFrame(
        tierIndex: number,
        assetName: string,
        callback: (frame: SpriteFrame | null) => void,
    ): void {
        const cached = UIWinLayerImported.RANK_TIER_FRAME_CACHE.get(tierIndex);
        if (cached?.isValid) {
            callback(cached);
            return;
        }

        const waiting = UIWinLayerImported.RANK_TIER_FRAME_WAITERS.get(tierIndex);
        if (waiting) {
            waiting.push(callback);
            return;
        }

        UIWinLayerImported.RANK_TIER_FRAME_WAITERS.set(tierIndex, [callback]);
        const path = `${UIWinLayerImported.RANK_TIER_RESOURCE_DIR}/${assetName}/spriteFrame`;
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            this.finishRankTierFrameLoad(tierIndex, null);
            return;
        }

        bundle.load(path, SpriteFrame, (err, frame) => {
            if (err || !frame) {
                console.warn(`[UIWinLayerImported] 排行段位素材加载失败: ${path}`, err);
                this.finishRankTierFrameLoad(tierIndex, null);
                return;
            }
            UIWinLayerImported.RANK_TIER_FRAME_CACHE.set(tierIndex, frame);
            this.finishRankTierFrameLoad(tierIndex, frame);
        });
    }

    private finishRankTierFrameLoad(tierIndex: number, frame: SpriteFrame | null): void {
        const callbacks = UIWinLayerImported.RANK_TIER_FRAME_WAITERS.get(tierIndex) ?? [];
        UIWinLayerImported.RANK_TIER_FRAME_WAITERS.delete(tierIndex);
        for (const callback of callbacks) callback(frame);
    }

    private createRankRows(): RankRow[] {
        const settlement = this._rankSettlement;
        const random = this.createSeededRandom(
            (settlement.tierIndex + 1) * 1000003 + (settlement.generation + 1) * 7919,
        );
        const botNames = this.createRankBotNames(random);
        const selfRank = Math.max(
            1,
            Math.min(SettlementRankManager.PLAYER_COUNT, settlement.finalRank),
        );
        const rows: RankRow[] = [];

        for (let rank = 1; rank <= SettlementRankManager.PLAYER_COUNT; rank++) {
            const isSelf = rank === selfRank;
            const botIndex = rank < selfRank ? rank - 1 : rank - 2;
            rows.push({
                rank,
                name: isSelf ? '我' : botNames[Math.max(0, botIndex) % botNames.length],
                progress: isSelf
                    ? Math.max(1, settlement.progress)
                    : SettlementRankManager.getProgressForRank(rank),
                tierIndex: settlement.tierIndex,
                isSelf,
            });
        }
        return rows;
    }

    private createRankAnimationData(
        finalRows: RankRow[],
        requestedStartRank: number,
    ): RankAnimationData | null {
        const sortedFinalRows = [...finalRows]
            .sort((a, b) => a.rank - b.rank)
            .map((row) => ({ ...row }));
        const selfFinalRow = sortedFinalRows.find((row) => row.isSelf);
        if (!selfFinalRow || selfFinalRow.rank <= 0) return null;

        const selfStartRank = Math.max(
            1,
            Math.min(sortedFinalRows.length, Math.floor(requestedStartRank)),
        );
        const selfFinalRank = selfFinalRow.rank;
        if (selfFinalRank >= selfStartRank) return null;

        const finalByRank = new Map(sortedFinalRows.map((row) => [row.rank, row]));
        const startRows: RankRow[] = [];
        for (let rank = 1; rank <= sortedFinalRows.length; rank++) {
            if (rank < selfFinalRank || rank > selfStartRank) {
                const row = finalByRank.get(rank);
                if (row) startRows.push({ ...row });
                continue;
            }

            if (rank === selfStartRank) {
                startRows.push({ ...selfFinalRow, rank: selfStartRank });
                continue;
            }

            const row = finalByRank.get(rank + 1);
            if (row) startRows.push({ ...row, rank });
        }

        if (startRows.length !== sortedFinalRows.length) return null;
        return {
            startRows,
            finalRows: sortedFinalRows,
            selfStartRank,
            selfFinalRank,
        };
    }

    private createRankBotNames(random: () => number): string[] {
        const names: string[] = [];
        for (const prefix of UIWinLayerImported.RANK_NAME_PREFIXES) {
            for (const suffix of UIWinLayerImported.RANK_NAME_SUFFIXES) {
                names.push(`${prefix}${suffix}`);
            }
        }
        for (let index = names.length - 1; index > 0; index--) {
            const target = Math.floor(random() * (index + 1));
            [names[index], names[target]] = [names[target], names[index]];
        }
        return names.slice(0, SettlementRankManager.PLAYER_COUNT - 1);
    }

    private createSeededRandom(seed: number): () => number {
        let state = Math.max(1, seed >>> 0);
        return () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 0x100000000;
        };
    }

    private playSelfRankUpAnimation(
        layout: Node,
        scrollView: ScrollView,
        animationData: RankAnimationData,
        selfSourceItem: Node,
        rankNodes: Map<number, Node>,
        finalRankPositions: Map<number, Vec3>,
    ): void {
        if (
            !this.node.isValid ||
            !this.node.activeInHierarchy ||
            !layout.isValid ||
            !selfSourceItem.isValid ||
            animationData.selfFinalRank >= animationData.selfStartRank
        ) {
            if (scrollView.isValid) scrollView.enabled = true;
            this.setContinueAvailable(true);
            this.logRankTiming('排行榜动画结束（未满足播放条件）');
            this.endRankTiming();
            return;
        }

        const selfFinalRow = animationData.finalRows.find((row) => row.isSelf);
        const finalTargetPosition = finalRankPositions.get(animationData.selfFinalRank);
        if (!finalTargetPosition || !selfFinalRow) {
            scrollView.enabled = true;
            this.setContinueAvailable(true);
            this.logRankTiming('排行榜动画结束（动画数据不完整）');
            this.endRankTiming();
            return;
        }

        const startPosition = selfSourceItem.position.clone();
        const targetPosition = finalTargetPosition.clone();
        const floatItem = instantiate(selfSourceItem);
        floatItem.name = 'selfRankFloat';
        floatItem.parent = layout;
        floatItem.setSiblingIndex(layout.children.length - 1);
        floatItem.setPosition(startPosition);
        floatItem.active = true;
        this.setNodeOpacity(floatItem, 255);
        this.applyRankRowData(floatItem, { ...selfFinalRow, rank: animationData.selfStartRank });

        selfSourceItem.active = false;
        this._activeRankFloatItem = floatItem;

        const originalScale = floatItem.scale.clone();
        const liftScale = v3(originalScale.x * 1.1, originalScale.y * 1.1, originalScale.z);
        const pushStates = this.collectRankPushNodeStates(animationData, rankNodes, finalRankPositions);
        const moveDuration = this.getRankUpAnimDuration(Math.abs(startPosition.y - targetPosition.y));
        const selfItemHeight = selfSourceItem.getComponent(UITransform)?.contentSize.height ?? 0;
        const targetScrollInfo = this.getRankScrollTargetInfo(
            scrollView,
            animationData.selfFinalRank,
            rankNodes,
            targetPosition,
            selfItemHeight,
        );
        const startScrollPercent = targetScrollInfo
            ? this.getCurrentScrollPercent(scrollView, targetScrollInfo.maxOffset)
            : 1;
        let displayedRank = animationData.selfStartRank;

        const playMove = (): void => {
            if (!floatItem.isValid || !this.node.activeInHierarchy) return;
            scrollView.stopAutoScroll();

            const moveProxy: RankMoveProxy = { ratio: 0 };
            this._rankMoveProxy = moveProxy;
            tween(moveProxy)
                .to(moveDuration, { ratio: 1 }, {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (!floatItem.isValid || !this.node.activeInHierarchy) return;
                        const ratio = moveProxy.ratio;
                        const x = startPosition.x + (targetPosition.x - startPosition.x) * ratio;
                        const y = startPosition.y + (targetPosition.y - startPosition.y) * ratio;
                        const z = startPosition.z + (targetPosition.z - startPosition.z) * ratio;
                        floatItem.setPosition(x, y, z);

                        if (targetScrollInfo) {
                            const scrollPercent = startScrollPercent
                                + (targetScrollInfo.targetPercent - startScrollPercent) * ratio;
                            scrollView.scrollToPercentVertical(this.clamp01(scrollPercent), 0, false);
                        }

                        this.updateRankPushNodePositions(pushStates, y);
                        const currentRank = this.calculateSelfRankDuringMove(
                            pushStates,
                            animationData.selfStartRank,
                            animationData.selfFinalRank,
                            y,
                        );
                        if (currentRank !== displayedRank) {
                            displayedRank = currentRank;
                            this.setChildLabel(floatItem, 'count', `${displayedRank}`);
                        }
                    },
                })
                .call(() => {
                    if (this._rankMoveProxy === moveProxy) this._rankMoveProxy = null;
                    if (!floatItem.isValid || !this.node.activeInHierarchy) return;

                    floatItem.setPosition(targetPosition);
                    this.updateRankPushNodePositions(pushStates, targetPosition.y, true);
                    this.setChildLabel(floatItem, 'count', `${animationData.selfFinalRank}`);
                    if (targetScrollInfo) {
                        scrollView.scrollToPercentVertical(targetScrollInfo.targetPercent, 0, false);
                    }

                    tween(floatItem)
                .to(UIWinLayerImported.SELF_RANK_SETTLE_SHRINK_SECONDS, {
                            scale: v3(originalScale.x * 0.95, originalScale.y * 0.95, originalScale.z),
                        }, { easing: 'quadOut' })
                .to(UIWinLayerImported.SELF_RANK_SETTLE_OVERSHOOT_SECONDS, {
                            scale: v3(originalScale.x * 1.03, originalScale.y * 1.03, originalScale.z),
                        }, { easing: 'quadInOut' })
                .to(UIWinLayerImported.SELF_RANK_SETTLE_RESTORE_SECONDS, {
                            scale: originalScale,
                        }, { easing: 'quadOut' })
                        .call(() => {
                            this.finishRankUpAnimation(
                                layout,
                                scrollView,
                                animationData,
                                selfSourceItem,
                                floatItem,
                                pushStates,
                                targetPosition,
                                targetScrollInfo,
                            );
                        })
                        .start();
                })
                .start();
        };

        Tween.stopAllByTarget(floatItem);
        tween(floatItem)
            .to(UIWinLayerImported.SELF_RANK_LIFT_SECONDS, { scale: liftScale }, { easing: 'quadOut' })
            .call(playMove)
            .start();
    }

    private collectRankPushNodeStates(
        animationData: RankAnimationData,
        rankNodes: Map<number, Node>,
        finalRankPositions: Map<number, Vec3>,
    ): RankPushNodeState[] {
        const rowsByRank = new Map(animationData.startRows.map((row) => [row.rank, row]));
        const states: RankPushNodeState[] = [];
        for (let rank = animationData.selfFinalRank; rank < animationData.selfStartRank; rank++) {
            const node = rankNodes.get(rank);
            const targetPosition = finalRankPositions.get(rank + 1);
            const row = rowsByRank.get(rank);
            if (!node?.isValid || !targetPosition || !row) continue;
            states.push({
                node,
                row: { ...row },
                basePosition: node.position.clone(),
                targetPosition: targetPosition.clone(),
                rankUpdated: false,
            });
        }
        return states;
    }

    private updateRankPushNodePositions(states: RankPushNodeState[], selfY: number, force = false): void {
        for (const state of states) {
            if (!state.node.isValid) continue;
            const distance = state.basePosition.y - state.targetPosition.y;
            const ratio = force || Math.abs(distance) < 0.001
                ? 1
                : this.clamp01((selfY - state.targetPosition.y) / distance);
            const x = state.basePosition.x + (state.targetPosition.x - state.basePosition.x) * ratio;
            const y = state.basePosition.y + (state.targetPosition.y - state.basePosition.y) * ratio;
            const z = state.basePosition.z + (state.targetPosition.z - state.basePosition.z) * ratio;
            state.node.setPosition(x, y, z);

            if (!state.rankUpdated && ratio >= 1) {
                this.applyRankRowData(state.node, { ...state.row, rank: state.row.rank + 1 });
                state.rankUpdated = true;
            }
        }
    }

    private calculateSelfRankDuringMove(
        states: RankPushNodeState[],
        startRank: number,
        finalRank: number,
        selfY: number,
    ): number {
        const passedCount = states.reduce((count, state) => {
            const distance = state.basePosition.y - state.targetPosition.y;
            const ratio = Math.abs(distance) < 0.001
                ? 1
                : this.clamp01((selfY - state.targetPosition.y) / distance);
            return count + (ratio >= 1 ? 1 : 0);
        }, 0);
        return Math.max(finalRank, startRank - passedCount);
    }

    private getRankUpAnimDuration(distance: number): number {
        return Math.max(
            UIWinLayerImported.SELF_RANK_MIN_MOVE_SECONDS,
            Math.max(0, distance) / UIWinLayerImported.SELF_RANK_MOVE_SPEED,
        );
    }

    private finishRankUpAnimation(
        layout: Node,
        scrollView: ScrollView,
        animationData: RankAnimationData,
        selfSourceItem: Node,
        floatItem: Node,
        pushStates: RankPushNodeState[],
        targetPosition: Vec3,
        targetScrollInfo: RankScrollTargetInfo | null,
    ): void {
        if (!this.node.isValid || !layout.isValid || !floatItem.isValid) return;

        this.updateRankPushNodePositions(pushStates, targetPosition.y, true);
        if (selfSourceItem.isValid) {
            selfSourceItem.removeFromParent();
            selfSourceItem.destroy();
        }

        const selfFinalRow = animationData.finalRows.find((row) => row.isSelf);
        floatItem.name = 'rankItem';
        floatItem.active = true;
        floatItem.setPosition(targetPosition);
        if (selfFinalRow) this.applyRankRowData(floatItem, selfFinalRow);
        this._activeRankFloatItem = null;

        if (targetScrollInfo) {
            scrollView.scrollToPercentVertical(targetScrollInfo.targetPercent, 0, false);
        }
        this.activateVirtualRankList(scrollView, animationData.selfFinalRank);
        scrollView.enabled = true;
        this.setContinueAvailable(true);
        this.logRankTiming('排行榜动画结束（晋级动画播放完成）');
        this.endRankTiming();
    }

    private stopRankUpRuntimeTweens(): void {
        if (this._rankMoveProxy) {
            Tween.stopAllByTarget(this._rankMoveProxy);
            this._rankMoveProxy = null;
        }
        if (this._activeRankFloatItem?.isValid) {
            Tween.stopAllByTarget(this._activeRankFloatItem);
            this._activeRankFloatItem.removeFromParent();
            this._activeRankFloatItem.destroy();
        }
        this._activeRankFloatItem = null;
        if (this._rankScrollView?.isValid) {
            this._rankScrollView.stopAutoScroll();
            this._rankScrollView.enabled = true;
        }
        this._rankScrollView = null;
    }

    private findScrollViewForContent(content: Node): ScrollView | null {
        for (let node: Node | null = content.parent; node; node = node.parent) {
            const scrollView = node.getComponent(ScrollView);
            if (scrollView) return scrollView;
        }
        return null;
    }

    private configureRankScrollView(layout: Node): ScrollView | null {
        const mask = layout.parent;
        if (!mask) return null;

        const scrollView = this.findScrollViewForContent(layout) ?? mask.addComponent(ScrollView);
        scrollView.stopAutoScroll();
        scrollView.content = layout;
        scrollView.vertical = true;
        scrollView.horizontal = false;
        scrollView.inertia = true;
        scrollView.brake = 0.5;
        scrollView.bounceDuration = 0.23;
        scrollView.enabled = false;
        this._rankScrollView = scrollView;
        return scrollView;
    }

    private getRankScrollTargetInfo(
        scrollView: ScrollView,
        rank: number,
        rankNodes: Map<number, Node> | null,
        rankPosition?: Vec3,
        rankItemHeight?: number,
    ): RankScrollTargetInfo | null {
        const content = scrollView.content;
        const rankNode = rankNodes?.get(rank);
        const contentTransform = content?.getComponent(UITransform);
        if (!content || !contentTransform || (!rankNode?.isValid && !rankPosition)) return null;

        const viewHeight = this.getRankViewHeight(scrollView);
        const contentHeight = contentTransform.contentSize.height;
        const maxOffset = Math.max(0, contentHeight - viewHeight);
        if (maxOffset <= 0) return { targetPercent: 1, maxOffset };

        const itemHeight = rankItemHeight
            ?? rankNode?.getComponent(UITransform)?.contentSize.height
            ?? this._rankItemHeight;
        const itemY = rankPosition?.y ?? rankNode!.position.y;
        const desiredOffset = contentHeight * (1 - contentTransform.anchorPoint.y)
            - itemY
            - (viewHeight - itemHeight) / 2;
        const offset = Math.min(maxOffset, Math.max(0, desiredOffset));
        return {
            targetPercent: this.clamp01(1 - offset / maxOffset),
            maxOffset,
        };
    }

    private getCurrentScrollPercent(scrollView: ScrollView, maxOffset: number): number {
        if (maxOffset <= 0) return 1;
        const offset = Math.min(maxOffset, Math.max(0, scrollView.getScrollOffset().y));
        return this.clamp01(1 - offset / maxOffset);
    }

    private scrollToRankPosition(scrollView: ScrollView, rank: number, duration: number): void {
        const targetInfo = this.getRankScrollTargetInfo(
            scrollView,
            rank,
            null,
            this.getRankItemPosition(rank),
            this._rankItemHeight,
        );
        if (!targetInfo) return;
        scrollView.stopAutoScroll();
        scrollView.scrollToPercentVertical(targetInfo.targetPercent, duration, true);
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private setNodeOpacity(node: Node, opacity: number): void {
        const uiOpacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        uiOpacity.opacity = opacity;
    }

    private bindButtons(): void {
        const buttonView = this.node.getChildByName('buttonView');
        if (!buttonView) return;
        this.bindTap(buttonView, () => this.onNext());
    }

    private bindTap(node: Node | null, fn: () => void): void {
        if (!node) return;
        const handler = () => {
            AudioManager.instance.playClick();
            fn();
        };
        node.on(Node.EventType.TOUCH_END, handler, this);
        this._bound.push({ node, handler });
    }

    private onNext(): void {
        if (!this._continueAvailable) return;
        this.setContinueAvailable(false);
        const onContinue = this._onContinue;
        this._onContinue = null;
        this.leave(onContinue ?? (() => director.emit(Constants.eventNames.EventWinNextLevel)));
    }

    private setContinueAvailable(available: boolean): void {
        this._continueAvailable = available;
        const buttonView = this.node.getChildByName('buttonView');
        if (buttonView) buttonView.active = available;
    }

    private leave(action: () => void): void {
        if (this._leaving) return;
        this._leaving = true;
        if (this.node.isValid) {
            this.node.active = false;
            this.node.removeFromParent();
            this.node.destroy();
        }
        action();
    }

    private playEntrance(): void {
        const view = this.node.getChildByName('view');
        if (!view) return;
        const target = view.scale.clone();
        view.setScale(target.x * 0.2, target.y * 0.2, target.z);
        tween(view)
            .to(0.2, { scale: v3(target.x * 1.1, target.y * 1.1, target.z) })
            .to(0.1, { scale: target })
            .start();
    }

    private playWinEffect(): void {
        const effect = this.node.getChildByName('view')?.getChildByName('effect');
        if (!effect) return;
        effect.active = true;
        effect.angle = 0;
        tween(effect).repeatForever(tween().by(8, { angle: 360 })).start();
    }

    private formatTime(ms: number): string {
        return `通关用时：${this.formatClock(ms)}`;
    }

    private formatClock(ms: number): string {
        const totalCs = Math.max(0, Math.floor(ms / 10));
        const cs = totalCs % 100;
        const totalSec = Math.floor(totalCs / 100);
        const sec = totalSec % 60;
        const min = Math.floor(totalSec / 60);
        const p2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
        //return `${p2(min)}:${p2(sec)}:${p2(cs)}`;
        return `${p2(min)}:${p2(sec)}`;
    }

    private formatRankClock(ms: number): string {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const hour = Math.floor(totalSec / 3600);
        const min = Math.floor((totalSec % 3600) / 60);
        const sec = totalSec % 60;
        const p2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
        return `${p2(hour)}:${p2(min)}:${p2(sec)}`;
    }

    private onClickShare() {
        AudioManager.instance.playClick();
        if (typeof wx === 'undefined') return;
        wx.shareAppMessage({
            title: SDKManager.sharData.string,
            imageUrl: SDKManager.sharData.getRandomImageUrl(),
        });
    }

}
