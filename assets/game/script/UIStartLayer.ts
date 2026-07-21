import { _decorator, Component, director, EventTouch, Label, Node, sp, Sprite, SpriteFrame, sys, tween, Tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { Constants } from './config/Constants';
import { GameMode, setCurrentGameMode } from './config/GameMode';
import { ensureActivityLevelJson, ensureLevelJson, warmupActivityForwardWindow, warmupForwardWindow } from './config/LevelJsonLoader';
import { ArchiveManager } from './manager/ArchiveManager';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { StorageKey, StorageManager } from './manager/StorageManager';
import { StreakManager } from './manager/StreakManager';
import { SDKManager } from '../../loading/SDKManager';

declare const wx: any;

const { ccclass, property } = _decorator;

const UI_FADE_DURATION = 1;
const UI_FADE_STAGGER = 0;
const RETURN_UI_FADE_DURATION = 0.25;
const LOGO_BOUNCE_DURATION = 0.36;
const LOGO_SETTLE_DURATION = 0.12;
const RETURN_LOGO_BOUNCE_DURATION = 0.18;
const RETURN_LOGO_SETTLE_DURATION = 0.06;
const LOGO_START_SCALE = 0.2;
const LOGO_OVERSHOOT_SCALE = 1.12;
const HOME_SKELETON_DESIGN_WIDTH = 1200;
const HOME_SKELETON_DESIGN_HEIGHT = 2665;
const START_UI_EXIT_FADE_DURATION = 0.2;
const HOME_INITIAL_APPEAR_ANIMATION = 'Appear';
const HOME_RETURN_APPEAR_ANIMATION = 'Appear2';
const HOME_DISAPPEAR_ANIMATION = 'Disappear';
const HOME_IDLE_ANIMATION = 'Idle';
const LEAF_LOOP_ANIMATION = 'Loop';
const ACTIVITY_UNLOCK_MAIN_LEVEL = 5;
const FAVORITE_REWARD_QUERY_KEY = 'favoriteReward';
const FAVORITE_REWARD_SCENES = new Set([1103, 1104]);
const FAVORITE_REWARD_TOAST_RETRY_LIMIT = 10;

@ccclass('UIStartLayer')
export class UIStartLayer extends Component {

    @property(Node)
    bgNode: Node = null!;
    @property(Node)
    bgNode2: Node = null!;
    @property(Node)
    gameClubButton: Node = null!;
    @property(Node)
    customerServiceButton: Node = null!;
    @property(Node)
    UINodeArray: Node[] = [];
    @property(Node)
    logoNode: Node = null!;
    @property(sp.Skeleton)
    homeSkeleton: sp.Skeleton = null!;
    @property(sp.Skeleton)
    leafSkeleton: sp.Skeleton = null!;
    @property(Node)
    activityBtn: Node = null!;
    @property(Node)
    signNode: Node = null!;
    @property(Node)
    startNode: Node = null!;
    @property(Sprite)
    tierIcon: Sprite = null!;
    @property({ type: [SpriteFrame] })
    tierSpriteArr: SpriteFrame[] = [];
    private enteringGame = false;
    private hasStarted = false;
    private logoOriginScale: Vec3 | null = null;
    private logoTargetOpacity = 255;
    private uiNodeTargetOpacity: Map<Node, number> = new Map();
    private wxGameClubBtn: any = null;
    private favoriteRewardToastRetryCount = 0;
    private dailySignPopupOpening = false;

    protected onLoad(): void {
        ProgressManager.initSignUserState();
        this.refreshSignNodeAnimationMembership();
        this.refreshSignNodeVisible();
        this.fitBackgroundToView();
        this.captureStartAnimationState();
        this.hideStartAnimationNodes();

        this.bgNode2.active = false;
        this.bgNode.active = true;
    }

    protected onEnable(): void {
        director.off("gameBack", this.onGameBack, this);
        director.on("gameBack", this.onGameBack, this);
        director.off(Constants.eventNames.EventLeafConutUpdate, this.onLeafConutUpdate, this);
        director.on(Constants.eventNames.EventLeafConutUpdate, this.onLeafConutUpdate, this);
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        director.on(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        director.off(Constants.eventNames.EventUIPrefabsReady, this.onUIPrefabsReady, this);
        director.on(Constants.eventNames.EventUIPrefabsReady, this.onUIPrefabsReady, this);
        director.off(Constants.eventNames.EventWinStreakStartGame, this.onEventWinStreakStartGame, this);
        director.on(Constants.eventNames.EventWinStreakStartGame, this.onEventWinStreakStartGame, this);
        this.enteringGame = false;
        this.refreshSignNodeVisible();
        this.refreshStartNodeState();
        this.refreshWarmupWindow();
        this.refreshActivityButtonVisible();
        this.refreshLeafConutLabel();

        if (this.hasStarted) {
            this.playStartLayerEnterAnimation(HOME_RETURN_APPEAR_ANIMATION, true);
        }

        if (this.wxGameClubBtn) this.wxGameClubBtn.show();
        if (this.hasStarted) this.scheduleFavoriteRewardCheck();
        this.tryShowDailySignPopup();
    }

    protected onDisable(): void {
        this.stopStartAnimation();
        this.clearHomeSkeletonListener();
        this.unschedule(this.tryGrantFavoriteRewardFromFavoriteEnter);
        this.unschedule(this.showFavoriteRewardToast);
        director.off("gameBack", this.onGameBack, this);
        director.off(Constants.eventNames.EventLeafConutUpdate, this.onLeafConutUpdate, this);
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        director.off(Constants.eventNames.EventWinStreakStartGame, this.onEventWinStreakStartGame, this);

        if (this.wxGameClubBtn) this.wxGameClubBtn.hide();
    }

    protected onDestroy(): void {
        this.stopStartAnimation();
        this.clearHomeSkeletonListener();
        this.unschedule(this.tryGrantFavoriteRewardFromFavoriteEnter);
        this.unschedule(this.showFavoriteRewardToast);
        director.off("gameBack", this.onGameBack, this);
        director.off(Constants.eventNames.EventLeafConutUpdate, this.onLeafConutUpdate, this);
        director.off(Constants.eventNames.EventSignInUpdate, this.onSignInUpdate, this);
        director.off(Constants.eventNames.EventUIPrefabsReady, this.onUIPrefabsReady, this);
        director.off(Constants.eventNames.EventWinStreakStartGame, this.onEventWinStreakStartGame, this);

        if (this.wxGameClubBtn) this.wxGameClubBtn.destroy();
    }

    private onGameBack = () => {
        this.scheduleFavoriteRewardCheck(0);
    };

    private onLeafConutUpdate = () => {
        this.refreshLeafConutLabel();
    };

    private onSignInUpdate = () => {
        this.refreshSignNodeVisible();
    };

    private onUIPrefabsReady = () => {
        this.tryShowDailySignPopup();
    };

    private onEventWinStreakStartGame = () => {
        if (this.enteringGame) return;
        void this.enterGame('main');
    };

    start() {
        this.hasStarted = true;
        this.refreshSignNodeVisible();
        this.refreshStartNodeState();
        this.refreshWarmupWindow();
        this.refreshActivityButtonVisible();
        this.refreshLeafConutLabel();
        this.playStartLayerEnterAnimation(HOME_INITIAL_APPEAR_ANIMATION);

        this.scheduleOnce(() => {
            window.dnSDK?.track?.('LOAD_FINISH', {});
        }, 0);

        if (sys.platform === sys.Platform.WECHAT_GAME && typeof wx !== 'undefined') {
            this.initWeChatButtons();
        }

        this.scheduleFavoriteRewardCheck();
        this.tryShowDailySignPopup();
    }

    update(deltaTime: number) {

    }

    private initWeChatButtons() {
        if (this.gameClubButton) {
            this.wxGameClubBtn = this.createTransparentWeChatBtn(this.gameClubButton, 'gameClub');
        }
    }

    private scheduleFavoriteRewardCheck(delay = 0.2) {
        if (!this.isWeChatGame()) return;
        this.unschedule(this.tryGrantFavoriteRewardFromFavoriteEnter);
        this.scheduleOnce(this.tryGrantFavoriteRewardFromFavoriteEnter, delay);
    }

    private tryGrantFavoriteRewardFromFavoriteEnter = () => {
        if (!this.node.activeInHierarchy || !this.isFavoriteEnter()) return;

        const today = this.getTodayString();
        if (StorageManager.instance.getItem(StorageKey.FavoriteRewardDate) === today) return;

        ProgressManager.saveUnlockCount(ProgressManager.loadUnlockCount() + 1);
        StorageManager.instance.setItem(StorageKey.FavoriteRewardDate, today);
        ArchiveManager.instance.scheduleUpload();

        window.dnSDK?.track?.('GET_ITEM', { item_source: 3 });
        director.emit(Constants.eventNames.EventFavoriteRewardClaimed, {
            unlock: 1,
        });

        this.favoriteRewardToastRetryCount = 0;
        this.showFavoriteRewardToast();
    };

    private showFavoriteRewardToast = () => {
        if (!this.node.activeInHierarchy) return;
        if (LayerManager.instance.showToast('获得了收藏奖励 解锁 * 1')) return;
        if (this.favoriteRewardToastRetryCount >= FAVORITE_REWARD_TOAST_RETRY_LIMIT) return;

        this.favoriteRewardToastRetryCount++;
        this.scheduleOnce(this.showFavoriteRewardToast, 0.2);
    };

    private isFavoriteEnter(): boolean {
        const options = this.getWeChatEnterOptions();
        if (!options) return false;

        const scene = Number(options.scene);
        if (FAVORITE_REWARD_SCENES.has(scene)) return true;

        return this.hasFavoriteRewardQuery(options.query);
    }

    private getWeChatEnterOptions(): any {
        if (!this.isWeChatGame()) return null;

        try {
            const enterOptions = wx.getEnterOptionsSync?.();
            if (enterOptions && (enterOptions.scene || enterOptions.query)) return enterOptions;
            return wx.getLaunchOptionsSync?.() || enterOptions || null;
        } catch (error) {
            console.warn('UIStartLayer: get enter options failed', error);
            return null;
        }
    }

    private hasFavoriteRewardQuery(query: any): boolean {
        if (!query || typeof query !== 'object') return false;

        const marker = query[FAVORITE_REWARD_QUERY_KEY] ?? query.favorite_reward;
        if (marker === true || marker === 1 || marker === '1' || marker === 'true') return true;

        return query.from === 'favorite';
    }

    private getTodayString(): string {
        const date = new Date();
        const year = date.getFullYear();
        const month = this.padDatePart(date.getMonth() + 1);
        const day = this.padDatePart(date.getDate());
        return `${year}-${month}-${day}`;
    }

    private padDatePart(value: number): string {
        return value < 10 ? `0${value}` : `${value}`;
    }

    private isWeChatGame(): boolean {
        return sys.platform === sys.Platform.WECHAT_GAME && typeof wx !== 'undefined';
    }

    private createTransparentWeChatBtn(targetNode: Node, type: 'gameClub') {
        const uiTrans = targetNode.getComponent(UITransform);
        if (!uiTrans) {
            console.warn(`UIStartLayer: targetNode ${targetNode.name} is missing UITransform`);
            return null;
        }

        const worldPos = uiTrans.convertToWorldSpaceAR(new Vec3(0, 0, 0));
        const width = uiTrans.contentSize.width;
        const height = uiTrans.contentSize.height;
        const anchorX = uiTrans.anchorPoint.x;
        const anchorY = uiTrans.anchorPoint.y;

        const visibleSize = view.getVisibleSize();
        const frameSize = view.getFrameSize();
        const ratioW = frameSize.width / visibleSize.width;
        const ratioH = frameSize.height / visibleSize.height;

        const left = (worldPos.x - width * anchorX) * ratioW;
        const top = frameSize.height - (worldPos.y + height * (1 - anchorY)) * ratioH;
        const btnWidth = width * ratioW;
        const btnHeight = height * ratioH;

        const style = {
            left: left,
            top: top,
            width: btnWidth,
            height: btnHeight,
            backgroundColor: '#00000000',
            color: '#00000000',
            textAlign: 'center'
        };

        if (type === 'gameClub') {
            return wx.createGameClubButton({
                type: 'text',
                text: '',
                style: style
            });
        }

        return null;
    }

    async onClickStartButton(event: EventTouch, data: any) {
        if (this.enteringGame) return;
        //this.uploadRankDataForStartButtonTest();
        await this.enterGame('main');
    }

    async onClickActivityButton(event: EventTouch, data: any) {
        if (this.enteringGame) return;
        //if (!this.isActivityUnlocked()) return;
        await this.enterGame('activity');
    }

    private async enterGame(mode: GameMode) {
        AudioManager.instance.playClick();
        if (!this.isActivityUnlocked() && mode === 'activity') {
            LayerManager.instance.showToast('通过第五关后解锁!');
            return;
        }
        this.enteringGame = true;
        setCurrentGameMode(mode);

        try {
            const exitAnimation = this.playExitAnimation();
            let json = null;
            let loadError: unknown = null;

            try {
                if (mode === 'activity') {
                    const level = ProgressManager.loadActivityLevel();
                    const boardId = ProgressManager.loadActivityBoardId(level);
                    json = await ensureActivityLevelJson(boardId);
                } else {
                    const level = ProgressManager.loadLevel();
                    const plan = await StreakManager.resolveLevelPlanForStart(level);
                    json = await ensureLevelJson(plan.boardId, plan.tier);
                }
            } catch (error) {
                loadError = error;
            }

            await exitAnimation;

            if (loadError) {
                this.playStartLayerEnterAnimation(HOME_RETURN_APPEAR_ANIMATION, true);
                throw loadError;
            }

            if (!json) {
                console.warn(`UIStartLayer: no ${mode} level JSON ready`);
                this.playStartLayerEnterAnimation(HOME_RETURN_APPEAR_ANIMATION, true);
                return;
            }
            LayerManager.instance.showGameLayer();
            this.tryShowDailySignPopup();
        } finally {
            this.enteringGame = false;
        }
    }

    private tryShowDailySignPopup() {
        if (this.dailySignPopupOpening) return;
        if (!ProgressManager.shouldAutoShowDailySignToday()) return;
        if (!LayerManager.instance.hasUI("signDaily")) return;

        this.dailySignPopupOpening = !!this.openSignDailyPopup();
    }

    private openSignDailyPopup(): Node | null {
        return LayerManager.instance.getOpenUI("signDaily")
            || LayerManager.instance.showUI("signDaily");
    }

    private uploadRankDataForStartButtonTest(): void {
        if (!this.isWeChatGame()) return;

        const levelScore = Math.max(0, Math.floor(ProgressManager.loadLevel()));
        const winStreakScore = Math.max(0, Math.floor(StreakManager.getStreak()));
        SDKManager.instance.uploadWechatRankScores(levelScore, winStreakScore);
        console.log('UIStartLayer: test upload rank scores', { levelScore, winStreakScore });
    }

    onClickRankButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("rank");
    }

    onClickSetButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("setting");
    }

    onClickAddDesktopButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("addDesktop");
    }

    onClickFavoriteRewardButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("favoriteReward");
    }

    onClickGameClubButton() {
        AudioManager.instance.playClick();
    }

    onClickFeedbackButton() {
        AudioManager.instance.playClick();
        if (sys.platform !== sys.Platform.WECHAT_GAME || typeof wx === 'undefined') return;

        wx.openCustomerServiceConversation({
            fail: (error: unknown) => {
                console.warn('UIStartLayer: openCustomerServiceConversation failed', error);
            }
        });
    }
    onClickSignButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("sign");
    }

    onClickSignDailyButton() {
        AudioManager.instance.playClick();
        this.openSignDailyPopup();
    }

    onClickWinStreakButton() {
        AudioManager.instance.playClick();
        LayerManager.instance.showUI("winStreak");
    }

    private refreshWarmupWindow() {
        const level = ProgressManager.loadLevel();
        void warmupForwardWindow(level, 10);
        const activityLevel = ProgressManager.loadActivityLevel();
        const activityBoardId = ProgressManager.loadActivityBoardId(activityLevel);
        void warmupActivityForwardWindow(activityBoardId, 10);
    }

    private refreshStartNodeState() {
        const levelRecord = ProgressManager.loadLevel();
        if (!this.startNode?.isValid) return;

        const hasLevelRecord = levelRecord > 0;

        const sprite1 = this.startNode.getChildByName('sprite1');
        const sprite2 = this.startNode.getChildByName('sprite2');
        const tierIcon = this.tierIcon || this.startNode.getChildByName('tierIcon')?.getComponent(Sprite);
        const label1 = this.startNode.getChildByName('label1');
        const label2 = this.startNode.getChildByName('label2');

        if (sprite1?.isValid) sprite1.active = !hasLevelRecord;
        if (sprite2?.isValid) sprite2.active = hasLevelRecord;
        if (tierIcon?.node?.isValid) {
            tierIcon.node.active = hasLevelRecord;
            if (hasLevelRecord) this.refreshTierIcon(levelRecord, tierIcon);
        }

        const levelText = hasLevelRecord ? `关卡 ${levelRecord}` : '';
        this.setStartLevelLabel(label1, levelText, hasLevelRecord);
        this.setStartLevelLabel(label2, levelText, hasLevelRecord);
    }

    private refreshTierIcon(level: number, tierIcon: Sprite) {
        const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
        const rankCount = Math.min(this.tierSpriteArr.length, Constants.rankStartLevels.length);
        if (rankCount <= 0) {
            tierIcon.node.active = false;
            return;
        }

        let rankIndex = 0;

        for (let i = rankCount - 1; i >= 0; i--) {
            if (normalizedLevel >= Constants.rankStartLevels[i]) {
                rankIndex = i;
                break;
            }
        }

        const spriteFrame = this.tierSpriteArr[rankIndex];
        if (!spriteFrame) {
            tierIcon.node.active = false;
            return;
        }

        tierIcon.sizeMode = Sprite.SizeMode.TRIMMED;
        tierIcon.spriteFrame = spriteFrame;
    }

    private refreshLeafConutLabel() {
        const label = this.findChildByName(this.signNode, 'label')?.getComponent(Label);
        if (!label) return;

        const raw = StorageManager.instance.getItem(StorageKey.LeafConut);
        if (raw === null) {
            const defaultCount = ProgressManager.loadLeafConut();
            ProgressManager.saveLeafConut(defaultCount);
            label.string = this.formatLeafConut(defaultCount);
            return;
        }

        const count = ProgressManager.loadLeafConut();
        if (raw !== `${count}`) {
            ProgressManager.saveLeafConut(count);
        }
        label.string = this.formatLeafConut(count);
    }

    private refreshSignNodeVisible() {
        if (!this.signNode?.isValid) return;

        this.signNode.active = !ProgressManager.isFirstSeenToday();
        this.refreshSignIconState();
        this.refreshSignRedPoint();
    }

    private refreshSignNodeAnimationMembership() {
        if (!this.signNode?.isValid || !ProgressManager.isFirstSeenToday()) return;
        this.UINodeArray = this.UINodeArray.filter((node) => node !== this.signNode);
    }

    private refreshSignRedPoint() {
        const redNode = this.signNode?.getChildByName('red') || this.findChildByName(this.signNode, 'red');
        if (redNode?.isValid) redNode.active = this.signNode.active && ProgressManager.hasClaimableSignReward();
    }

    private refreshSignIconState() {
        const signIcon1 = this.signNode?.getChildByName('signIcon1') || this.findChildByName(this.signNode, 'signIcon1');
        const signIcon2 = this.signNode?.getChildByName('signIcon2') || this.findChildByName(this.signNode, 'signIcon2');
        const hasSignedToday = ProgressManager.hasSignedToday();

        if (signIcon1?.isValid) signIcon1.active = hasSignedToday;
        if (signIcon2?.isValid) signIcon2.active = !hasSignedToday;
    }

    private formatLeafConut(count: number): string {
        const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        return `x${value}`;
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

    private setStartLevelLabel(node: Node | null | undefined, value: string, visible: boolean) {
        if (!node?.isValid) return;

        node.active = visible;
        const label = node.getComponent(Label);
        if (label) label.string = value;
    }

    private isActivityUnlocked(): boolean {

        //return true;
        return ProgressManager.loadLevel() >= ACTIVITY_UNLOCK_MAIN_LEVEL;
    }

    private refreshActivityButtonVisible() {
        if (!this.activityBtn?.isValid) return;
        this.activityBtn.active = false;
    }

    private fitBackgroundToView() {
        const visibleSize = view.getVisibleSize();

        if (this.bgNode?.isValid) {
            const bgTransform = this.bgNode.getComponent(UITransform);
            if (bgTransform) {
                const designSize = bgTransform.contentSize;
                const scaleX = visibleSize.width / designSize.width;
                const scaleY = visibleSize.height / designSize.height;
                const maxScale = Math.max(scaleX, scaleY);
                this.bgNode.setScale(new Vec3(maxScale, maxScale, 1));
                this.bgNode2.setScale(new Vec3(maxScale, maxScale, 1));
            }
        }

        if (this.homeSkeleton?.node?.isValid) {
            const scaleX = visibleSize.width / HOME_SKELETON_DESIGN_WIDTH;
            const scaleY = visibleSize.height / HOME_SKELETON_DESIGN_HEIGHT;
            const maxScale = Math.max(scaleX, scaleY);
            this.homeSkeleton.node.setScale(new Vec3(maxScale, maxScale, 1));
        }
    }

    private captureStartAnimationState() {
        if (this.logoNode?.isValid) {
            this.logoOriginScale = this.logoNode.scale.clone();
            const logoOpacity = this.logoNode.getComponent(UIOpacity);
            this.logoTargetOpacity = logoOpacity && logoOpacity.opacity > 0 ? logoOpacity.opacity : 255;
        }

        this.uiNodeTargetOpacity.clear();
        for (const node of this.UINodeArray) {
            if (!node?.isValid) continue;

            const opacity = node.getComponent(UIOpacity);
            this.uiNodeTargetOpacity.set(node, opacity && opacity.opacity > 0 ? opacity.opacity : 255);
        }
    }

    private hideStartAnimationNodes() {
        if (this.logoNode?.isValid) {
            this.logoNode.active = false;
        }

        for (const node of this.UINodeArray) {
            if (!node?.isValid) continue;
            node.active = false;
        }
    }

    private revealStartAnimationNodes = (fastRestore = false) => {
        if (this.logoNode?.isValid) {
            this.logoNode.active = true;
        }

        for (const node of this.UINodeArray) {
            if (!node?.isValid) continue;
            node.active = true;
        }

        this.refreshActivityButtonVisible();
        this.playStartAnimation(fastRestore);
    };

    private playStartLayerEnterAnimation(appearAnimation: string, fastRestore = false) {
        this.stopStartAnimation();
        this.clearHomeSkeletonListener();
        this.hideStartAnimationNodes();
        this.playHomeAppearAnimation(appearAnimation, () => {
            this.revealStartAnimationNodes(fastRestore);
        });
    }

    private playStartAnimation(fastRestore = false) {
        this.playUINodeFadeIn(fastRestore);
        this.playLogoBounceIn(fastRestore);
    }

    private playExitAnimation(): Promise<void> {
        this.stopStartAnimation();
        this.clearHomeSkeletonListener();
        return Promise.all([
            this.playStartNodesFadeOut(),
            this.playHomeDisappearAnimation()
        ]).then(() => undefined);
    }

    private playHomeAppearAnimation(appearAnimation: string, onComplete?: () => void) {
        this.playHomeAppearAudio();

        if (!this.homeSkeleton?.isValid) {
            this.playLeafLoopAnimation();
            this.playBackgroundMusic();
            onComplete?.();
            return;
        }

        this.clearHomeSkeletonListener();
        let completed = false;
        const finish = () => {
            if (completed) return;
            completed = true;
            this.clearHomeSkeletonListener();
            this.homeSkeleton.setAnimation(0, HOME_IDLE_ANIMATION, true);
            this.playLeafLoopAnimation();
            this.playBackgroundMusic();
            onComplete?.();
        };

        this.homeSkeleton.setCompleteListener((trackEntry: sp.spine.TrackEntry) => {
            const animationName = trackEntry.animation ? trackEntry.animation.name : '';
            if (animationName !== appearAnimation) return;
            finish();
        });

        const trackEntry = this.homeSkeleton.setAnimation(0, appearAnimation, false);
        if (!trackEntry) {
            finish();
        }
    }

    private playHomeAppearAudio() {
        AudioManager.instance.pause();
        AudioManager.instance.playOneShot(AudioClipNames.close_door);
    }

    private playBackgroundMusic() {
        AudioManager.instance.play();
    }

    private playLeafLoopAnimation() {
        if (!this.leafSkeleton?.isValid) return;
        this.leafSkeleton.setAnimation(0, LEAF_LOOP_ANIMATION, true);
    }

    private playHomeDisappearAnimation(): Promise<void> {
        this.playHomeDisappearAudio();

        if (!this.homeSkeleton?.isValid) {
            this.playBackgroundMusic();
            return Promise.resolve();
        }

        this.bgNode.active = false;
        this.bgNode2.active = true;
        return new Promise<void>((resolve) => {
            let completed = false;
            const finish = () => {
                if (completed) return;
                completed = true;
                this.clearHomeSkeletonListener();
                this.playBackgroundMusic();
                resolve();
            };

            this.homeSkeleton.setCompleteListener((trackEntry: sp.spine.TrackEntry) => {
                const animationName = trackEntry.animation ? trackEntry.animation.name : '';
                if (animationName !== HOME_DISAPPEAR_ANIMATION) return;
                finish();
            });

            const trackEntry = this.homeSkeleton.setAnimation(0, HOME_DISAPPEAR_ANIMATION, false);
            if (!trackEntry) {
                finish();
            }
        });
    }

    private playHomeDisappearAudio() {
        AudioManager.instance.pause();
        AudioManager.instance.playOneShot(AudioClipNames.open_door);
    }

    private clearHomeSkeletonListener() {
        if (!this.homeSkeleton?.isValid) return;
        this.homeSkeleton.setCompleteListener(null);
    }

    private playStartNodesFadeOut(): Promise<void> {
        if (this.logoNode?.isValid) {
            this.logoNode.active = true;
            const opacity = this.logoNode.getComponent(UIOpacity) || this.logoNode.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            opacity.opacity = this.logoTargetOpacity;
            tween(opacity)
                .to(START_UI_EXIT_FADE_DURATION, { opacity: 0 }, { easing: 'sineIn' })
                .start();
        }

        for (const node of this.UINodeArray) {
            if (!node?.isValid) continue;
            if (node === this.activityBtn) {
                node.active = false;
                continue;
            }

            node.active = true;
            const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            tween(opacity)
                .to(START_UI_EXIT_FADE_DURATION, { opacity: 0 }, { easing: 'sineIn' })
                .start();
        }

        return new Promise<void>((resolve) => {
            this.scheduleOnce(() => resolve(), START_UI_EXIT_FADE_DURATION);
        });
    }

    private playUINodeFadeIn(fastRestore = false) {
        const duration = fastRestore ? RETURN_UI_FADE_DURATION : UI_FADE_DURATION;

        for (let i = 0; i < this.UINodeArray.length; i++) {
            const node = this.UINodeArray[i];
            if (!node?.isValid) continue;
            if (node === this.activityBtn) {
                node.active = false;
                continue;
            }

            const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
            const targetOpacity = this.uiNodeTargetOpacity.get(node) ?? 255;

            Tween.stopAllByTarget(opacity);
            opacity.opacity = 0;

            tween(opacity)
                .delay(i * UI_FADE_STAGGER)
                .to(duration, { opacity: targetOpacity }, { easing: 'sineOut' })
                .start();
        }
    }

    private playLogoBounceIn(fastRestore = false) {
        if (!this.logoNode?.isValid) return;

        if (!this.logoOriginScale) {
            this.logoOriginScale = this.logoNode.scale.clone();
        }

        const originScale = this.logoOriginScale;
        const startScale = new Vec3(originScale.x * LOGO_START_SCALE, originScale.y * LOGO_START_SCALE, originScale.z);
        const overshootScale = new Vec3(originScale.x * LOGO_OVERSHOOT_SCALE, originScale.y * LOGO_OVERSHOOT_SCALE, originScale.z);
        const bounceDuration = fastRestore ? RETURN_LOGO_BOUNCE_DURATION : LOGO_BOUNCE_DURATION;
        const settleDuration = fastRestore ? RETURN_LOGO_SETTLE_DURATION : LOGO_SETTLE_DURATION;
        const fadeDuration = fastRestore ? RETURN_UI_FADE_DURATION : UI_FADE_DURATION;

        Tween.stopAllByTarget(this.logoNode);
        this.logoNode.setScale(startScale);

        const opacity = this.logoNode.getComponent(UIOpacity) || this.logoNode.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 0;

        tween(this.logoNode)
            .to(bounceDuration, { scale: overshootScale }, { easing: 'backOut' })
            .to(settleDuration, { scale: originScale.clone() }, { easing: 'sineInOut' })
            .start();

        tween(opacity)
            .to(fadeDuration, { opacity: this.logoTargetOpacity }, { easing: 'sineOut' })
            .start();
    }

    private stopStartAnimation() {
        if (this.logoNode?.isValid) {
            Tween.stopAllByTarget(this.logoNode);
            const logoOpacity = this.logoNode.getComponent(UIOpacity);
            if (logoOpacity) Tween.stopAllByTarget(logoOpacity);
        }

        for (const node of this.UINodeArray) {
            if (!node?.isValid) continue;

            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
        }
    }
}
