import { _decorator, assetManager, Button, Component, EventTouch, ImageAsset, instantiate, Label, Layout, Node, ScrollView, Sprite, SpriteFrame, SubContextView, sys, Texture2D, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
import { SDKManager } from '../../loading/SDKManager';
import type { JHRankBoard, JHRankEntry } from '../../loading/SDKManager';
import { ProgressManager } from './manager/ProgressManager';
import { StreakManager } from './manager/StreakManager';
const { ccclass, property } = _decorator;

interface RankItemData {
    rank: number;
    name: string;
    count: number;
    avatar?: string;
    isSelf?: boolean;
}

@ccclass('UIRankLayer')
export class UIRankLayer extends Component {
    @property(Node)
    viewNode: Node = null!;
    @property(Node)
    maskNode: Node = null!;
    @property(Node)
    contentNode: Node = null!;
    @property(Node)
    itemNode: Node = null!;
    @property(Node)
    closeButtonNode: Node = null!;
    @property(Node)
    tabNode1: Node = null!;
    @property(Node)
    tabNode2: Node = null!;
    @property(Node)
    tabNode3: Node = null!;
    @property(Node)
    scrollViewNode: Node = null!;

    private openedByInit = false;
    private isClosing = false;

    private nowIndex = 1;
    private tabDefaultSiblingIndexes: number[] = [];
    private friendRankNode: Node | null = null;
    private friendRankView: SubContextView | null = null;
    private rankRequestToken = 0;
    private requestingWechatProfile = false;
    private static readonly WECHAT_RANK_PROFILE_KEY = 'mahjong_match_rank_profile';
    private static readonly FALLBACK_RANK_NICKNAME_KEY = 'mahjong_match_rank_fallback_nickname';
    private static readonly SERVER_RANK_DISPLAY_LIMIT = 100;
    private static readonly AVATAR_HEAD_BG_INSET = 8;
    private static readonly VIRTUAL_RANK_BUFFER_ROWS = 2;
    private static readonly RANK_SCROLLING_EVENT = 'scrolling';
    private static readonly AVATAR_LOAD_DELAY_SECONDS = 0.08;
    private avatarFrameCache: Map<string, SpriteFrame> = new Map();
    private avatarFrameWaiters: Map<string, Array<(frame: SpriteFrame | null) => void>> = new Map();
    private rankData: RankItemData[] = [];
    private rankItemPool: Node[] = [];
    private visibleRankItems: Map<number, Node> = new Map();
    private virtualItemHeight = 0;
    private virtualItemSpacingY = 0;
    private virtualRowHeight = 1;
    private visibleStartIndex = -1;
    private visibleEndIndex = -1;
    private rankScrollDirty = false;
    private isRankScrolling = false;
    private rankScrollIdleSeconds = 0;
    private boundRankScrollView: ScrollView | null = null;

    protected onLoad(): void {
        this.initNodeRefs();
        this.recordTabDefaultSiblingIndexes();
        this.bindCloseButton();
        this.bindRankScrollView();
        if (this.itemNode) this.itemNode.active = false;
        this.switchRankTab(this.nowIndex);
    }

    start() {
        if (!this.openedByInit) {
            this.playOpenAnimation();
        }
    }

    init() {
        this.openedByInit = true;
        this.playOpenAnimation();
    }

    update(deltaTime: number) {
        if (this.rankScrollDirty) {
            this.rankScrollDirty = false;
            this.updateVisibleRankItems(false);
        }

        if (this.isRankScrolling) {
            this.rankScrollIdleSeconds -= deltaTime;
            if (this.rankScrollIdleSeconds <= 0) {
                this.isRankScrolling = false;
                this.refreshVisibleRankAvatars();
            }
        }
    }

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }
        this.unbindRankScrollView();
        this.resetVirtualRankItems(true);
        this.postOpenDataMessage({ type: 'clear' });
        this.avatarFrameWaiters.clear();
        this.stopPopupTweens();
    }

    close() {
        this.playCloseAnimation();
    }

    onButonCloseClick() {
        if (this.isClosing) return;
        AudioManager.instance.playClick();
        this.close();
    }

    onButtonCloseClick() {
        this.onButonCloseClick();
    }

    onButtonTabClick(event: EventTouch, data: any) {
        const index = this.normalizeTabIndex(data);
        if (index === 0) return;

        AudioManager.instance.playClick();
        this.switchRankTab(index);
    }

    private switchRankTab(index: number) {
        this.nowIndex = index;
        this.rankRequestToken++;
        this.updateTabSiblingOrder(this.getTabNode(index));

        if (index === 1 && this.showFriendRank()) {
            return;
        }

        this.hideFriendRank();
        this.refreshRankList(index);
    }

    private initNodeRefs() {
        this.viewNode = this.viewNode || this.node.getChildByName('view') || this.node;
        this.maskNode = this.maskNode || this.node.getChildByName('bg');
        this.contentNode = this.contentNode || this.findChildByName(this.node, 'content')!;
        this.itemNode = this.itemNode || this.findChildByName(this.node, 'item')!;
        this.closeButtonNode = this.closeButtonNode || this.findChildByName(this.node, 'close')!;
        this.tabNode1 = this.tabNode1 || this.findChildByName(this.node, 'tab1')!;
        this.tabNode2 = this.tabNode2 || this.findChildByName(this.node, 'tab2')!;
        this.tabNode3 = this.tabNode3 || this.findChildByName(this.node, 'tab3')!;
        this.scrollViewNode = this.scrollViewNode || this.viewNode.getChildByName('bg') || this.findChildByName(this.node, 'scrollView')!;
    }

    private normalizeTabIndex(data: any): number {
        const index = Math.floor(Number(data));
        if (index < 1 || index > 3) return 0;
        return index;
    }

    private refreshRankList(index: number) {
        if (!this.contentNode || !this.itemNode) return;

        const requestToken = ++this.rankRequestToken;
        this.contentNode.active = true;
        this.clearContentNode();
        this.itemNode.active = false;

        if (!this.isWechatGamePlatform()) {
            this.renderRankList(index, this.createFakeRankData(index));
            return;
        }

        const rankName = this.getServerRankName(index);
        SDKManager.instance.fetchJhRank(rankName)
            .then((board) => {
                if (requestToken !== this.rankRequestToken) return;
                const entries = this.resolveServerRankEntries(board);
                this.logServerRankResponse(index, rankName, board, entries);
                let rankData = this.limitServerRankData(index, this.toRankItemData(entries, board.myInfo));
                if (rankData.length <= 0) rankData = this.createDefaultSelfRankData(index);
                this.renderRankList(index, rankData);
            })
            .catch((err) => {
                if (requestToken !== this.rankRequestToken) return;
                console.warn('UIRankLayer: fetch JH rank failed', err);
                this.renderRankList(index, this.createDefaultSelfRankData(index));
            });
    }

    private renderRankList(index: number, rankData: RankItemData[]) {
        if (!this.contentNode || !this.itemNode) return;

        this.nowIndex = index;
        this.isRankScrolling = false;
        this.clearContentNode();
        this.itemNode.active = false;
        this.rankData = rankData;
        this.prepareVirtualRankList(rankData.length);
        this.resizeContentNode(rankData.length);

        const scrollView = this.getScrollViewComponent();
        if (scrollView) {
            scrollView.scrollToTop(0);
        }
        this.updateVisibleRankItems(true);
        this.scheduleOnce(() => this.updateVisibleRankItems(true));
    }

    private prepareVirtualRankList(itemCount: number) {
        const layout = this.contentNode?.getComponent(Layout);
        if (layout) layout.enabled = false;

        this.virtualItemHeight = this.getRankItemHeight();
        this.virtualItemSpacingY = layout?.spacingY ?? 0;
        this.virtualRowHeight = Math.max(1, this.virtualItemHeight + this.virtualItemSpacingY);
        this.ensureRankItemPool(this.getVirtualPoolSize(itemCount));
    }

    private onRankScroll() {
        this.isRankScrolling = true;
        this.rankScrollIdleSeconds = 0.15;
        this.rankScrollDirty = true;
    }

    private updateVisibleRankItems(force: boolean = false) {
        if (!this.contentNode?.active) return;

        const total = this.rankData.length;
        if (total <= 0) {
            this.resetVisibleRankItems();
            return;
        }

        if (this.virtualRowHeight <= 0) {
            this.virtualItemHeight = this.getRankItemHeight();
            this.virtualRowHeight = Math.max(1, this.virtualItemHeight + this.virtualItemSpacingY);
        }

        const scrollOffsetY = this.getRankScrollOffsetY();
        const viewHeight = this.getRankViewHeight();
        const startIndex = Math.max(0, Math.floor(scrollOffsetY / this.virtualRowHeight) - UIRankLayer.VIRTUAL_RANK_BUFFER_ROWS);
        const endIndex = Math.min(
            total - 1,
            Math.ceil((scrollOffsetY + viewHeight) / this.virtualRowHeight) + UIRankLayer.VIRTUAL_RANK_BUFFER_ROWS,
        );

        if (!force && startIndex === this.visibleStartIndex && endIndex === this.visibleEndIndex) return;

        this.visibleStartIndex = startIndex;
        this.visibleEndIndex = endIndex;
        this.ensureRankItemPool(endIndex - startIndex + 1);

        for (const [index, item] of this.visibleRankItems) {
            if (index < startIndex || index > endIndex || force) {
                this.recycleRankItem(item);
                this.visibleRankItems.delete(index);
            }
        }

        for (let index = startIndex; index <= endIndex; index++) {
            let item = this.visibleRankItems.get(index);
            if (!item?.isValid) {
                item = this.getAvailableRankItem();
                if (!item) continue;
                this.visibleRankItems.set(index, item);
                this.renderVirtualRankItem(item, index);
                this.positionVirtualRankItem(item, index);
                item.active = true;
                continue;
            }
        }
    }

    private renderVirtualRankItem(item: Node, dataIndex: number) {
        const data = this.rankData[dataIndex];
        if (!data) return;

        (item as any).__rankDataIndex = dataIndex;
        this.renderRankItem(item, data);
    }

    private positionVirtualRankItem(item: Node, dataIndex: number) {
        const y = -dataIndex * this.virtualRowHeight - this.virtualItemHeight * 0.5;
        item.setPosition(0, y, 0);
    }

    private ensureRankItemPool(count: number) {
        if (!this.contentNode || !this.itemNode) return;
        const targetCount = Math.max(0, Math.floor(count));

        while (this.rankItemPool.length < targetCount) {
            const item = instantiate(this.itemNode);
            item.name = `rankVirtualItem_${this.rankItemPool.length}`;
            item.active = false;
            item.setScale(new Vec3(1, 1, 1));
            this.prepareRankItemNode(item);
            this.contentNode.addChild(item);
            this.rankItemPool.push(item);
        }
    }

    private prepareRankItemNode(item: Node) {
        const labelNames = ['num', 'name', 'count'];
        for (const name of labelNames) {
            const label = item.getChildByName(name)?.getComponent(Label);
            if (label) label.cacheMode = Label.CacheMode.BITMAP;
        }
    }

    private getAvailableRankItem(): Node | null {
        for (const item of this.rankItemPool) {
            if (!item?.isValid) continue;
            if ((item as any).__rankDataIndex === undefined || (item as any).__rankDataIndex < 0) return item;
        }
        return null;
    }

    private recycleRankItem(item: Node) {
        if (!item?.isValid) return;
        item.active = false;
        (item as any).__rankDataIndex = -1;
        const avatarNode = item.getChildByName('avatar');
        if (avatarNode) {
            avatarNode.active = false;
            (avatarNode as any).__rankAvatarUrl = '';
            (avatarNode as any).__rankAvatarLoadToken = ((avatarNode as any).__rankAvatarLoadToken || 0) + 1;
        }

        const defaultHeadNode = item.getChildByName('defaultHead') || item.getChildByName('head');
        if (defaultHeadNode) defaultHeadNode.active = true;
    }

    private resetVisibleRankItems() {
        for (const item of this.visibleRankItems.values()) {
            this.recycleRankItem(item);
        }
        this.visibleRankItems.clear();
        this.visibleStartIndex = -1;
        this.visibleEndIndex = -1;
    }

    private resetVirtualRankItems(destroyItems: boolean) {
        this.resetVisibleRankItems();
        this.rankData = [];
        this.isRankScrolling = false;
        this.rankScrollDirty = false;
        this.rankScrollIdleSeconds = 0;

        if (destroyItems) {
            for (const item of this.rankItemPool) {
                if (item?.isValid) {
                    item.removeFromParent();
                    item.destroy();
                }
            }
            this.rankItemPool = [];
        }
    }

    private getVirtualPoolSize(itemCount: number): number {
        if (itemCount <= 0) return 0;

        const viewHeight = this.getRankViewHeight();
        const visibleCount = Math.ceil(viewHeight / Math.max(1, this.virtualRowHeight));
        return Math.min(itemCount, visibleCount + UIRankLayer.VIRTUAL_RANK_BUFFER_ROWS * 2 + 2);
    }

    private getRankItemHeight(): number {
        const itemTransform = this.itemNode?.getComponent(UITransform);
        return Math.max(1, itemTransform?.contentSize.height ?? 1);
    }

    private getRankViewHeight(): number {
        const scrollView = this.getActiveRankScrollView();
        return scrollView?.view?.contentSize.height
            ?? scrollView?.node.getComponent(UITransform)?.contentSize.height
            ?? this.contentNode?.parent?.getComponent(UITransform)?.contentSize.height
            ?? 0;
    }

    private getRankScrollOffsetY(): number {
        const scrollView = this.getActiveRankScrollView();
        if (!scrollView) return 0;

        const offsetY = scrollView.getScrollOffset().y;
        const maxOffsetY = scrollView.getMaxScrollOffset().y;
        return Math.max(0, Math.min(offsetY, Math.max(0, maxOffsetY)));
    }

    private getServerRankName(index: number): string {
        if (index === 2) return SDKManager.instance.getJhRankName('winStreak');
        return SDKManager.instance.getJhRankName('level');
    }

    private resolveServerRankEntries(board: JHRankBoard): JHRankEntry[] {
        const entries = (board?.topEntries || []).filter((entry) => !!entry && (entry.rank > 0 || entry.count > 0));
        if (entries.length > 0) return entries;
        return board?.myInfo ? [board.myInfo] : [];
    }

    private logServerRankResponse(index: number, rankName: string, board: JHRankBoard, entries: JHRankEntry[]) {
        const topEntries = board?.topEntries || [];
        console.log('UIRankLayer: JH rank response', {
            tabIndex: index,
            rankName,
            myInfo: board?.myInfo || null,
            topEntryCount: topEntries.length,
            topEntrySample: topEntries.slice(0, 3),
            renderCount: entries.length,
        });
    }

    private toRankItemData(entries: JHRankEntry[], selfEntry?: JHRankEntry | null): RankItemData[] {
        const selfUid = selfEntry?.uid || SDKManager.instance.getOpenid();
        const fallbackName = this.getFallbackRankName();
        return (entries || []).map((entry, index) => ({
            rank: entry.rank > 0 ? entry.rank : index + 1,
            name: (entry.name || '').trim() || fallbackName,
            count: entry.count,
            avatar: entry.avatar,
            isSelf: this.isSelfRankEntry(entry, selfEntry, selfUid),
        }));
    }

    private limitServerRankData(index: number, rankData: RankItemData[]): RankItemData[] {
        if (index !== 2 && index !== 3) return rankData;
        return rankData.slice(0, UIRankLayer.SERVER_RANK_DISPLAY_LIMIT);
    }

    private createDefaultSelfRankData(index: number): RankItemData[] {
        if (index !== 2 && index !== 3) return [];
        const profile = this.getCachedWechatRankProfile();
        return [{
            rank: 1,
            name: profile?.nickname || this.getFallbackRankName(),
            count: this.getLocalServerRankScore(index),
            avatar: profile?.avatarUrl || '',
            isSelf: true,
        }];
    }

    private getLocalServerRankScore(index: number): number {
        const rankName = this.getServerRankName(index);
        const value = rankName === SDKManager.instance.getJhRankName('winStreak')
            ? StreakManager.getStreak()
            : ProgressManager.loadLevel();
        return Math.max(0, Math.floor(value));
    }

    private isSelfRankEntry(entry: JHRankEntry, selfEntry?: JHRankEntry | null, selfUid: string = ''): boolean {
        if (!entry) return false;
        if (selfUid && entry.uid && entry.uid === selfUid) return true;
        if (selfEntry?.uid && entry.uid && entry.uid === selfEntry.uid) return true;
        return !!selfEntry
            && entry.rank > 0
            && selfEntry.rank > 0
            && entry.rank === selfEntry.rank
            && entry.count === selfEntry.count;
    }

    private showFriendRank(): boolean {
        if (!this.isWechatOpenDataAvailable()) return false;
        if (!this.ensureFriendRankView()) return false;

        if (this.contentNode) this.contentNode.active = false;
        if (this.friendRankNode) this.friendRankNode.active = true;

        const rankMessage = {
            type: 'rankData',
            key: 'level',
            title: '好友排行',
            scoreLabel: '通过关卡',
            emptyText: '暂无好友排行',
            fallbackSelf: {
                nickname: this.getCachedWechatRankProfile()?.nickname || '\u6211',
                avatarUrl: this.getCachedWechatRankProfile()?.avatarUrl || '',
                openid: SDKManager.instance.getOpenid(),
                uid: SDKManager.instance.getOpenid(),
                rankScore: Math.max(0, Math.floor(ProgressManager.loadLevel())),
            },
        };

        this.postOpenDataMessage(rankMessage);

        this.scheduleOnce(() => {
            this.postOpenDataMessage(rankMessage);
            this.friendRankView?.update();
        });

        this.requestWechatRankProfile((profile) => {
            if (!this.friendRankNode?.isValid || !this.friendRankNode.active) return;
            const updatedRankMessage = {
                ...rankMessage,
                fallbackSelf: {
                    ...rankMessage.fallbackSelf,
                    nickname: profile.nickname || rankMessage.fallbackSelf.nickname,
                    avatarUrl: profile.avatarUrl || rankMessage.fallbackSelf.avatarUrl,
                },
            };
            this.postOpenDataMessage(updatedRankMessage);
            this.friendRankView?.update();
        });

        return true;
    }

    private hideFriendRank() {
        if (this.friendRankNode?.isValid) {
            this.friendRankNode.active = false;
        }
        if (this.contentNode) {
            this.contentNode.active = true;
        }
        this.postOpenDataMessage({ type: 'clear' });
    }

    private getCachedWechatRankProfile(): { nickname?: string; avatarUrl?: string } | null {
        const raw = sys.localStorage.getItem(UIRankLayer.WECHAT_RANK_PROFILE_KEY);
        if (!raw) return null;
        try {
            const profile = JSON.parse(raw);
            if (!profile || typeof profile !== 'object') return null;
            return {
                nickname: typeof profile.nickname === 'string' ? profile.nickname : '',
                avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : '',
            };
        } catch (e) {
            return null;
        }
    }

    private saveWechatRankProfile(profile: { nickname?: string; avatarUrl?: string }) {
        if (!profile.nickname && !profile.avatarUrl) return;
        sys.localStorage.setItem(UIRankLayer.WECHAT_RANK_PROFILE_KEY, JSON.stringify({
            nickname: profile.nickname || '',
            avatarUrl: profile.avatarUrl || '',
        }));
        SDKManager.instance.setJhRankUploadProfile(profile.nickname, profile.avatarUrl);
    }

    private requestWechatRankProfile(onComplete: (profile: { nickname?: string; avatarUrl?: string }) => void) {
        if (!this.isWechatGamePlatform() || typeof wx === 'undefined' || this.requestingWechatProfile) return;
        const cached = this.getCachedWechatRankProfile();
        if (cached?.avatarUrl) return;

        const wxApi: any = wx;
        const finish = () => {
            this.requestingWechatProfile = false;
        };
        const handleUserInfo = (userInfo: any) => {
            const profile = {
                nickname: userInfo?.nickName || userInfo?.nickname || '',
                avatarUrl: userInfo?.avatarUrl || '',
            };
            this.saveWechatRankProfile(profile);
            onComplete(profile);
        };
        const tryGetUserProfile = () => {
            if (typeof wxApi.getUserProfile !== 'function') {
                finish();
                return;
            }
            wxApi.getUserProfile({
                desc: '\u7528\u4e8e\u5c55\u793a\u6392\u884c\u699c\u5934\u50cf\u6635\u79f0',
                success: (res: any) => {
                    finish();
                    handleUserInfo(res?.userInfo);
                },
                fail: finish,
            });
        };

        this.requestingWechatProfile = true;
        if (typeof wxApi.getUserInfo === 'function') {
            wxApi.getUserInfo({
                success: (res: any) => {
                    if (!res?.userInfo?.avatarUrl && typeof wxApi.getUserProfile === 'function') {
                        tryGetUserProfile();
                        return;
                    }
                    finish();
                    handleUserInfo(res?.userInfo);
                },
                fail: tryGetUserProfile,
            });
            return;
        }

        tryGetUserProfile();
    }

    private ensureFriendRankView(): boolean {
        if (this.friendRankNode?.isValid && this.friendRankView?.isValid) return true;

        const scrollView = this.getScrollViewComponent();
        const host = scrollView?.node || this.findChildByName(this.scrollViewNode, 'scrollView');
        const hostTransform = host?.getComponent(UITransform);
        if (!host || !hostTransform) return false;

        const friendRankNode = new Node('friendRankSubContext');
        friendRankNode.active = false;
        friendRankNode.layer = host.layer;
        host.addChild(friendRankNode);
        friendRankNode.setPosition(new Vec3(0, 0, 0));

        const friendTransform = friendRankNode.addComponent(UITransform);
        friendTransform.setAnchorPoint(0.5, 0.5);
        friendTransform.setContentSize(hostTransform.contentSize.width, hostTransform.contentSize.height);

        const friendRankView = friendRankNode.addComponent(SubContextView);
        friendRankView.fps = 30;

        const designSize = (friendRankView as any)._designResolutionSize;
        if (designSize && typeof designSize.set === 'function') {
            designSize.set(hostTransform.contentSize.width, hostTransform.contentSize.height);
        }

        this.friendRankNode = friendRankNode;
        this.friendRankView = friendRankView;
        friendRankNode.active = true;
        return true;
    }

    private isWechatGamePlatform(): boolean {
        return sys.platform === sys.Platform.WECHAT_GAME;
    }

    private isWechatOpenDataAvailable(): boolean {
        return this.isWechatGamePlatform()
            && typeof wx !== 'undefined'
            && typeof wx.getOpenDataContext === 'function';
    }

    private postOpenDataMessage(data: any) {
        if (!this.isWechatOpenDataAvailable()) return;
        try {
            wx.getOpenDataContext().postMessage(data);
        } catch (e) {
            console.warn('UIRankLayer: post open data message failed', e);
        }
    }

    private clearContentNode() {
        if (!this.contentNode) return;

        this.resetVisibleRankItems();
        this.rankData = [];

        for (const child of this.contentNode.children.slice()) {
            if (child === this.itemNode) continue;
            child.removeFromParent();
            child.destroy();
        }

        this.rankItemPool = [];
    }

    private resizeContentNode(itemCount: number) {
        const contentTransform = this.contentNode?.getComponent(UITransform);
        const itemTransform = this.itemNode?.getComponent(UITransform);
        if (!contentTransform || !itemTransform) return;

        const layout = this.contentNode.getComponent(Layout);
        const spacingY = this.virtualItemSpacingY > 0 ? this.virtualItemSpacingY : (layout?.spacingY ?? 0);
        const itemHeight = this.virtualItemHeight > 0 ? this.virtualItemHeight : itemTransform.contentSize.height;
        const listHeight = itemCount > 0 ? itemCount * itemHeight + Math.max(0, itemCount - 1) * spacingY : 0;
        const viewHeight = this.getRankViewHeight();
        contentTransform.setContentSize(contentTransform.contentSize.width, Math.max(listHeight, viewHeight));
    }

    private createFakeRankData(index: number): RankItemData[] {
        const names = [
            'Player A',
            'Player B',
            'Player C',
            'Player D',
            'Player E',
            'Player F',
            'Player G',
            'Player H',
            'Player I',
            'Player J',
        ];
        const countsByTab = [
            [9820, 9410, 9060, 8750, 8310, 7990, 7600, 7240, 6900, 6520],
            [128, 124, 119, 115, 109, 104, 98, 91, 85, 80],
            [56, 52, 49, 45, 41, 38, 34, 31, 28, 25],
        ];
        const counts = countsByTab[index - 1] || countsByTab[0];

        return names.map((name, i) => ({
            rank: i + 1,
            name,
            count: counts[i],
        }));
    }

    private renderRankItem(item: Node, data: RankItemData) {
        this.setRankBackground(item, !!data.isSelf);
        this.setRankIcon(item, data.rank);
        this.setAvatar(item, data.avatar);
        this.setLabelString(item.getChildByName('num'), `${data.rank}`);
        this.setLabelString(item.getChildByName('name'), data.name);
        this.setLabelString(item.getChildByName('count'), `${data.count}`);
    }

    private setRankBackground(item: Node, isSelf: boolean) {
        const selfBgNode = item.getChildByName('bg1');
        const otherBgNode = item.getChildByName('bg2');
        if (selfBgNode) selfBgNode.active = isSelf;
        if (otherBgNode) otherBgNode.active = !isSelf;
    }

    private setRankIcon(item: Node, rank: number) {
        for (let i = 1; i <= 3; i++) {
            const iconNode = item.getChildByName(`${i}`);
            if (iconNode) iconNode.active = rank === i;
        }

        const numNode = item.getChildByName('num');
        if (numNode) numNode.active = rank > 3;
    }

    private setLabelString(labelNode: Node | null, value: string) {
        const label = labelNode?.getComponent(Label);
        if (label) label.string = value;
    }

    private setAvatar(item: Node, avatarUrl?: string) {
        const headBgNode = item.getChildByName('headBg');
        if (headBgNode) headBgNode.active = true;

        const defaultHeadNode = item.getChildByName('defaultHead') || item.getChildByName('head');
        if (defaultHeadNode) defaultHeadNode.active = true;

        const url = this.normalizeRemoteAvatarUrl(avatarUrl);
        const existingAvatarNode = item.getChildByName('avatar');
        if (!url || this.isRankScrolling) {
            if (existingAvatarNode) {
                existingAvatarNode.active = false;
                (existingAvatarNode as any).__rankAvatarUrl = url;
                (existingAvatarNode as any).__rankAvatarLoadToken = ((existingAvatarNode as any).__rankAvatarLoadToken || 0) + 1;
            }
            return;
        }

        const defaultHeadSprite = defaultHeadNode?.getComponent(Sprite);
        const defaultFrame = defaultHeadSprite?.spriteFrame || null;
        const avatarNode = this.getOrCreateAvatarNode(item, headBgNode || defaultHeadNode, defaultFrame);
        const sprite = avatarNode?.getComponent(Sprite);
        if (!avatarNode || !sprite) return;

        (avatarNode as any).__rankAvatarUrl = url;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const cachedFrame = this.avatarFrameCache.get(url);
        if (cachedFrame) {
            if (defaultHeadNode) defaultHeadNode.active = false;
            avatarNode.active = true;
            sprite.spriteFrame = cachedFrame;
            return;
        }

        avatarNode.active = false;

        const loadToken = ((avatarNode as any).__rankAvatarLoadToken || 0) + 1;
        (avatarNode as any).__rankAvatarLoadToken = loadToken;
        this.scheduleOnce(() => {
            if (!avatarNode.isValid
                || (avatarNode as any).__rankAvatarLoadToken !== loadToken
                || (avatarNode as any).__rankAvatarUrl !== url) {
                return;
            }

            this.loadAvatarSpriteFrame(url, (frame) => {
                if (!frame
                    || !avatarNode.isValid
                    || (avatarNode as any).__rankAvatarLoadToken !== loadToken
                    || (avatarNode as any).__rankAvatarUrl !== url) {
                    return;
                }
                const currentSprite = avatarNode.getComponent(Sprite);
                if (!currentSprite) return;
                currentSprite.sizeMode = Sprite.SizeMode.CUSTOM;
                currentSprite.spriteFrame = frame;
                avatarNode.active = true;
                if (defaultHeadNode?.isValid) defaultHeadNode.active = false;
            });
        }, UIRankLayer.AVATAR_LOAD_DELAY_SECONDS);
    }

    private refreshVisibleRankAvatars() {
        for (const [index, item] of this.visibleRankItems.entries()) {
            if (!item?.isValid || !item.active) continue;
            const data = this.rankData[index];
            if (!data) continue;
            this.setAvatar(item, data.avatar);
        }
    }

    private getOrCreateAvatarNode(item: Node, referenceNode: Node | null, defaultFrame: SpriteFrame | null): Node {
        let avatarNode = item.getChildByName('avatar');
        if (!avatarNode) {
            avatarNode = new Node('avatar');
            avatarNode.layer = item.layer;
            item.addChild(avatarNode);
            avatarNode.addComponent(UITransform);
            avatarNode.addComponent(Sprite);
        }

        const avatarTransform = avatarNode.getComponent(UITransform) || avatarNode.addComponent(UITransform);
        const avatarSprite = avatarNode.getComponent(Sprite) || avatarNode.addComponent(Sprite);
        const referenceTransform = referenceNode?.getComponent(UITransform);
        const referenceSize = referenceTransform?.contentSize;
        const width = Math.max(1, (referenceSize?.width || 90) - UIRankLayer.AVATAR_HEAD_BG_INSET * 2);
        const height = Math.max(1, (referenceSize?.height || 90) - UIRankLayer.AVATAR_HEAD_BG_INSET * 2);

        avatarNode.active = true;
        avatarNode.layer = item.layer;
        if (referenceNode) {
            const position = referenceNode.position;
            avatarNode.setPosition(new Vec3(position.x, position.y, position.z));
            avatarNode.setSiblingIndex(referenceNode.getSiblingIndex() + 1);
        }
        avatarTransform.setAnchorPoint(0.5, 0.5);
        avatarTransform.setContentSize(width, height);
        avatarSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        avatarSprite.spriteFrame = defaultFrame;

        return avatarNode;
    }

    private loadAvatarSpriteFrame(url: string, onComplete: (frame: SpriteFrame | null) => void) {
        const cached = this.avatarFrameCache.get(url);
        if (cached) {
            onComplete(cached);
            return;
        }

        const waiters = this.avatarFrameWaiters.get(url);
        if (waiters) {
            waiters.push(onComplete);
            return;
        }

        this.avatarFrameWaiters.set(url, [onComplete]);
        assetManager.loadRemote<ImageAsset>(url, { ext: this.getRemoteImageExt(url) }, (err, imageAsset) => {
            let frame: SpriteFrame | null = null;
            if (!err && imageAsset) {
                const texture = new Texture2D();
                texture.image = imageAsset;
                frame = new SpriteFrame();
                frame.texture = texture;
                this.avatarFrameCache.set(url, frame);
            } else {
                console.warn('UIRankLayer: load avatar failed', url, err);
            }

            const callbacks = this.avatarFrameWaiters.get(url) || [];
            this.avatarFrameWaiters.delete(url);
            callbacks.forEach((callback) => callback(frame));
        });
    }

    private normalizeRemoteAvatarUrl(avatarUrl?: string): string {
        const url = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return `https:${url}`;
        return '';
    }

    private getRemoteImageExt(url: string): string {
        const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
        const match = cleanUrl.match(/\.(png|jpg|jpeg|webp)$/);
        if (!match) return '.png';
        return match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`;
    }

    private getFallbackRankName(): string {
        const profile = this.getCachedWechatRankProfile();
        const cachedNickname = profile?.nickname?.trim();
        if (cachedNickname) return cachedNickname;

        const openid = `${SDKManager.instance.getOpenid() || ''}`.replace(/[^a-zA-Z0-9]/g, '');
        const shortId = openid ? openid.slice(-6) : '';
        if (shortId) return `\u73a9\u5bb6${shortId}`;

        const cached = sys.localStorage.getItem(UIRankLayer.FALLBACK_RANK_NICKNAME_KEY);
        if (cached) return cached;

        const nickname = `\u73a9\u5bb6${Math.floor(100000 + Math.random() * 900000)}`;
        sys.localStorage.setItem(UIRankLayer.FALLBACK_RANK_NICKNAME_KEY, nickname);
        return nickname;
    }

    private recordTabDefaultSiblingIndexes() {
        this.tabDefaultSiblingIndexes = this.getTabNodes().map(tab => tab ? tab.getSiblingIndex() : -1);
    }

    private updateTabSiblingOrder(activeTabNode: Node | null) {
        const tabs = this.getTabNodes();
        const scrollRenderNode = this.getScrollRenderNode();

        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            const defaultSiblingIndex = this.tabDefaultSiblingIndexes[i];
            if (!tab?.isValid || tab === activeTabNode || defaultSiblingIndex < 0) continue;
            tab.setSiblingIndex(defaultSiblingIndex);
        }

        if (!activeTabNode?.isValid || !scrollRenderNode?.isValid) return;
        if (activeTabNode.parent !== scrollRenderNode.parent) return;

        activeTabNode.setSiblingIndex(scrollRenderNode.getSiblingIndex() + 1);
    }

    private getTabNode(index: number): Node | null {
        return this.getTabNodes()[index - 1] || null;
    }

    private getTabNodes(): (Node | null)[] {
        return [this.tabNode1, this.tabNode2, this.tabNode3];
    }

    private getScrollRenderNode(): Node | null {
        const firstTabParent = this.tabNode1?.parent;
        if (this.scrollViewNode?.isValid && this.scrollViewNode.parent === firstTabParent) {
            return this.scrollViewNode;
        }

        return this.viewNode?.getChildByName('bg') || null;
    }

    private getScrollViewComponent(): ScrollView | null {
        return this.scrollViewNode?.getComponent(ScrollView)
            || this.findChildByName(this.scrollViewNode, 'scrollView')?.getComponent(ScrollView)
            || this.findChildByName(this.node, 'scrollView')?.getComponent(ScrollView)
            || null;
    }

    private getActiveRankScrollView(): ScrollView | null {
        return this.boundRankScrollView?.isValid ? this.boundRankScrollView : this.getScrollViewComponent();
    }

    private bindRankScrollView() {
        const scrollView = this.getScrollViewComponent();
        if (!scrollView || this.boundRankScrollView === scrollView) return;

        this.unbindRankScrollView();
        this.boundRankScrollView = scrollView;
        scrollView.node.off(UIRankLayer.RANK_SCROLLING_EVENT, this.onRankScroll, this);
        scrollView.node.on(UIRankLayer.RANK_SCROLLING_EVENT, this.onRankScroll, this);
    }

    private unbindRankScrollView() {
        if (this.boundRankScrollView?.node?.isValid) {
            this.boundRankScrollView.node.off(UIRankLayer.RANK_SCROLLING_EVENT, this.onRankScroll, this);
        }
        this.boundRankScrollView = null;
    }

    private bindCloseButton() {
        const closeButton = this.findChildByName(this.node, 'close') || this.findChildByName(this.node, 'Game_btn_guanbi');
        if (!closeButton) return;

        this.closeButtonNode = closeButton;
        const button = closeButton.getComponent(Button) || closeButton.addComponent(Button);
        closeButton.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        closeButton.on(Button.EventType.CLICK, this.onButonCloseClick, this);
        button.interactable = true;
    }

    private playOpenAnimation() {
        if (!this.node || this.isClosing) return;

        const target = this.getViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();

        if (maskOpacity) maskOpacity.opacity = 0;
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
        if (!this.node || this.isClosing) return;
        this.isClosing = true;

        const target = this.getViewNode();
        const maskOpacity = this.getMaskOpacity(true);

        this.stopPopupTweens();

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

    private getViewNode(): Node {
        return this.viewNode || this.node.getChildByName('view') || this.node;
    }

    private getMaskOpacity(createIfMissing: boolean): UIOpacity | null {
        const mask = this.maskNode || this.node.getChildByName('bg');
        if (!mask) return null;
        this.maskNode = mask;
        return mask.getComponent(UIOpacity) || (createIfMissing ? mask.addComponent(UIOpacity) : null);
    }

    private stopPopupTweens() {
        const target = this.getViewNode();
        if (target?.isValid) Tween.stopAllByTarget(target);

        const mask = this.maskNode || this.node.getChildByName('bg');
        const maskOpacity = mask?.isValid ? mask.getComponent(UIOpacity) : null;
        if (maskOpacity) Tween.stopAllByTarget(maskOpacity);
    }

    private findChildByName(parent: Node | null, name: string): Node | null {
        if (!parent) return null;
        if (parent.name === name) return parent;

        for (const child of parent.children) {
            const result = this.findChildByName(child, name);
            if (result) return result;
        }

        return null;
    }
}
