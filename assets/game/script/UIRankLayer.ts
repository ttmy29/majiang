import { _decorator, Button, Component, EventTouch, instantiate, Label, Layout, Node, ScrollView, SubContextView, sys, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { AudioManager } from './manager/AudioManager';
import { SDKManager } from '../../loading/SDKManager';
import type { JHRankEntry } from '../../loading/SDKManager';
import { ProgressManager } from './manager/ProgressManager';
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
    private static readonly SERVER_RANK_DISPLAY_LIMIT = 100;

    protected onLoad(): void {
        this.initNodeRefs();
        this.recordTabDefaultSiblingIndexes();
        this.bindCloseButton();
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

    }

    protected onDestroy(): void {
        if (this.closeButtonNode?.isValid) {
            this.closeButtonNode.off(Button.EventType.CLICK, this.onButonCloseClick, this);
        }
        this.postOpenDataMessage({ type: 'clear' });
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
                const rankData = this.toRankItemData(board.topEntries, board.myInfo);
                this.renderRankList(index, this.limitServerRankData(index, rankData));
            })
            .catch((err) => {
                if (requestToken !== this.rankRequestToken) return;
                console.warn('UIRankLayer: fetch JH rank failed', err);
                this.renderRankList(index, []);
            });
    }

    private renderRankList(index: number, rankData: RankItemData[]) {
        if (!this.contentNode || !this.itemNode) return;

        this.clearContentNode();
        this.itemNode.active = false;

        for (const data of rankData) {
            const item = instantiate(this.itemNode);
            item.name = `item_${index}_${data.rank}`;
            item.active = true;
            item.setScale(new Vec3(1, 1, 1));
            item.setPosition(0, 0, 0);
            this.contentNode.addChild(item);
            this.renderRankItem(item, data);
        }

        this.resizeContentNode(rankData.length);

        const layout = this.contentNode.getComponent(Layout);
        if (layout) layout.updateLayout(true);

        const scrollView = this.getScrollViewComponent();
        if (scrollView) {
            scrollView.scrollToTop(0);
        }
    }

    private getServerRankName(index: number): string {
        if (index === 3) return SDKManager.instance.getJhRankName('winStreak');
        return SDKManager.instance.getJhRankName('level');
    }

    private toRankItemData(entries: JHRankEntry[], selfEntry?: JHRankEntry | null): RankItemData[] {
        const selfUid = selfEntry?.uid || SDKManager.instance.getOpenid();
        return (entries || []).map((entry, index) => ({
            rank: entry.rank > 0 ? entry.rank : index + 1,
            name: entry.name || 'Player',
            count: entry.count,
            avatar: entry.avatar,
            isSelf: this.isSelfRankEntry(entry, selfEntry, selfUid),
        }));
    }

    private limitServerRankData(index: number, rankData: RankItemData[]): RankItemData[] {
        if (index !== 2 && index !== 3) return rankData;
        return rankData.slice(0, UIRankLayer.SERVER_RANK_DISPLAY_LIMIT);
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

        for (const child of this.contentNode.children.slice()) {
            if (child === this.itemNode) continue;
            child.removeFromParent();
            child.destroy();
        }
    }

    private resizeContentNode(itemCount: number) {
        const contentTransform = this.contentNode?.getComponent(UITransform);
        const itemTransform = this.itemNode?.getComponent(UITransform);
        if (!contentTransform || !itemTransform) return;

        const layout = this.contentNode.getComponent(Layout);
        const spacingY = layout?.spacingY ?? 0;
        const itemHeight = itemTransform.contentSize.height;
        const listHeight = itemCount * itemHeight + Math.max(0, itemCount - 1) * spacingY;
        const viewHeight = this.getScrollViewComponent()?.node.getComponent(UITransform)?.contentSize.height ?? 0;
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
