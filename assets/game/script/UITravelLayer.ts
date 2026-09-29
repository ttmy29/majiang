import { _decorator, Animation, assetManager, Button, Color, Component, game, Game, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import { Constants } from './config/Constants';
import { ensureTravelLevel } from './config/TravelLevelLoader';
import { isTravelBlocked, MAX_TRAVEL_LEVEL, TRAVEL_DATA_VERSION, TravelLevelPlan, TravelTilePlan } from './config/TravelLevels';
import { MahjongItem } from './MahjongItem';
import { ArchiveManager } from './manager/ArchiveManager';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { LayerManager } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { StorageKey, StorageManager } from './manager/StorageManager';
import { SDKEvent, SDKManager } from '../../loading/SDKManager';
import { UigmLayer } from './UigmLayer';
import { ThreePopupEvent, UIThreePopup } from './UIThreePopup';

const { ccclass } = _decorator;
const TRAVEL_LEVEL_ID_START = 10001;
const TRAVEL_FACE_CYCLE_LENGTH = 5;
type TravelFaceFolder = 'mahjong1' | 'mahjong2';
type TravelFaceChoice = 'default' | TravelFaceFolder;
interface TravelFaceCycle {
    choices: TravelFaceChoice[];
    /** offset -> 本关牌型 ID -> 替换素材 ID；重进后仍显示相同的牌面。 */
    faceMappings?: Record<string, Record<string, string>>;
}

// mahjongItem 牌身尺寸；阴影不计入牌身占位。
const TILE_WIDTH = 149;
const TILE_HEIGHT = 186;
const BOARD_MAX_STEP = 130;
const BOARD_TILE_HEIGHT_RATIO = 1.4;
// 牌身单独留出放大倍率，格距和命中框随最终牌身尺寸一起缩放。
const BOARD_TILE_FACE_SCALE = 1.12;
// 原牌图 155×188 的实心牌身约为 146×180；透明边缘不参与触摸。
const TILE_BODY_WIDTH_RATIO = 146 / 155;
const TILE_BODY_HEIGHT_RATIO = 180 / 188;
// 白色牌面纵向约 164 像素；下一行覆盖上张牌的 16 像素厚底边，保持原图比例。
// 命中框仍覆盖完整牌身，重叠部分由靠下、后绘制的牌优先接收触摸。
const TILE_ROW_PITCH_RATIO = 174 / 188;
const TRAY_TILE_GAP = 2;
const TRAY_TILE_OFFSET_Y = 8;
// 旅行模式默认开放 5 格，lock1 / lock2 看广告后依次开放第 6 / 7 格。
const NORMAL_CAPACITY = 5;
const UNLOCKED_CAPACITY = 7;
const LEGACY_EXPANDED_CAPACITY = 9;
const ENTRANCE_LAYER_STAGGER = 0.12;
const ENTRANCE_MAX_STAGGER = 0.72;
const ENTRANCE_FLY_DURATION = 0.42;
const ENTRANCE_EXPAND_DURATION = 0.44;
const ENTRANCE_EXPAND_REVEAL_DELAY = 0.06;
const ENTRANCE_EXPAND_REVEAL_SCALE = 0.52;
const MOVE_DURATION = 0.22;
const COLLISION_SPREAD = 0.12;
const COLLISION_IMPACT = 0.1;
const COLLISION_REBOUND = 0.12;
const COMBO_AUDIOS = [
    AudioClipNames.combo_level1, AudioClipNames.combo_level2, AudioClipNames.combo_level3,
    AudioClipNames.combo_level4, AudioClipNames.combo_level5, AudioClipNames.combo_level6,
    AudioClipNames.combo_level7,
];

type TileState = 'board' | 'slot' | 'removed';
type TravelEntranceMode = 'expand' | 'fly';
interface TravelTile extends TravelTilePlan {
    state: TileState;
    node: Node | null;
    item: MahjongItem | null;
}

interface TravelSnapshot {
    version: number;
    levelKey?: string;
    level: number;
    tiles: { id: number; type: string; faceDown: boolean; state: TileState }[];
    slotIds: number[];
    undoLeft: number;
    shuffleLeft: number;
    magnetLeft: number;
    boxLeft: number;
    capacity: number;
    iq?: number;
    clearCount?: number;
    comboTimes?: number;
    elapsedTime?: number;
    adCount?: number;
}

/** gameLayerThree 预制体上的独立三消玩法，不使用主线的目标牌盒或主线快照。 */
@ccclass('UITravelLayer')
export class UITravelLayer extends Component {
    private board!: Node;
    private tray!: Node;
    private slotLocks: (Node | null)[] = [];
    private slotUnlockPending = false;
    private slotUnlockRequestId = 0;
    private flyLayer: Node | null = null;
    private plan!: TravelLevelPlan;
    private tilePrefab: Prefab | null = null;
    private frames = new Map<string, SpriteFrame>();
    private baseFrames = new Map<string, SpriteFrame>();
    private alternateFrames = new Map<TravelFaceFolder, Map<string, SpriteFrame>>();
    private effectPrefabs = new Map<string, Prefab>();
    private effects = new Set<Node>();
    private tiles: TravelTile[] = [];
    private slots: TravelTile[] = [];
    private level = 1;
    private replayMode = false;
    private capacity = NORMAL_CAPACITY;
    private undoLeft = 2;
    private shuffleLeft = 1;
    private magnetLeft = 1;
    private boxLeft = 1;
    private dialog: Node | null = null;
    private gameplayGuide: Node | null = null;
    private firstLevelGuideShown = false;
    private state: 'loading' | 'playing' | 'fail' | 'win' = 'loading';
    private loadToken = 0;
    private busy = false;
    private activeCollections = 0;
    private resolvingTileIds = new Set<number>();
    private boardEntering = false;
    private entranceMode: TravelEntranceMode | null = null;
    private suspended = false;
    private settings: Node | null = null;
    private gmPanel: Node | null = null;
    private winNode: Node | null = null;
    private winSettled = false;
    private iqValue = 40;
    private clearCount = 0;
    private comboTimes = 0;
    private elapsedTime = 0;
    private adCount = 0;
    private boardStepX = BOARD_MAX_STEP;
    private boardStepY = BOARD_MAX_STEP;
    private boardTileScale = BOARD_MAX_STEP * BOARD_TILE_HEIGHT_RATIO / TILE_HEIGHT;
    private tileVisualWidth = TILE_WIDTH;
    private tileVisualHeight = TILE_HEIGHT;
    private comboScale = new Vec3(1, 1, 1);
    private iqStyle: { color: Color; enableOutline: boolean; outlineColor: Color; outlineWidth: number } | null = null;

    protected onLoad(): void {
        const boardRoot = this.node.getChildByPath('pNode/pNode');
        const trayRoot = this.node.getChildByName('slotNode');
        if (!boardRoot || !trayRoot) throw new Error('gameLayerThree: missing board or tray');
        this.board = boardRoot;
        // 预制体的两个按钮依次占据第 6 / 7 格；点击事件在代码里绑定。
        this.slotLocks = ['lock1', 'lock2'].map((name, index) => {
            const lock = trayRoot.getChildByName(name);
            this.bindButton(lock, () => this.unlockSlot(index));
            return lock;
        });
        // 保留预制体的 Widget、牌盒/棋盘位置和底部三按钮排布。
        const trayBackground = trayRoot.getChildByName('slotNode');
        const trayWidth = (trayBackground?.getComponent(UITransform)?.width || 974) * (trayBackground?.scale.x || 0.62);
        this.tray = new Node('slot');
        this.tray.layer = trayRoot.layer;
        this.tray.addComponent(UITransform).setContentSize(trayWidth - 24, 120);
        trayRoot.addChild(this.tray);
        this.tray.setPosition(trayBackground?.position || new Vec3());

        const bg = this.node.getChildByName('bg');
        const size = bg?.getComponent(UITransform)?.contentSize;
        if (bg && size?.width && size.height) {
            const visible = view.getVisibleSize();
            const scale = Math.max(visible.width / size.width, visible.height / size.height);
            bg.setScale(scale, scale, 1);
        }
        const iq = this.node.getChildByName('iqLabel')?.getComponent(Label);
        if (iq) this.iqStyle = {
            color: iq.color.clone(), enableOutline: iq.enableOutline,
            outlineColor: iq.outlineColor.clone(), outlineWidth: iq.outlineWidth,
        };

        this.bindButton(this.node.getChildByName('Game_btn_shezhi'), () => this.openSettings());
        this.bindButton(this.node.getChildByName('gm'), () => this.openGmPanel());

        const down = this.node.getChildByName('down')!;
        const buttons = down.children.filter(child => child.name === 'button');
        const actions = [() => this.shuffle(), () => this.magnet(), () => this.undo()];
        buttons.forEach((button, index) => this.bindButton(button, () => {
            AudioManager.instance.playClick();
            actions[index]?.();
        }));
        // 可选第四按钮沿用编辑器的显隐设置，不再强制打开或替换美术。
        this.bindButton(down.getChildByName('button4'), () => this.expandTray());
        const combo = this.node.getChildByName('comboNode');
        if (combo) this.comboScale = combo.scale.clone();
        this.resetFeedback();
        game.on(Game.EVENT_HIDE, this.onGameHide, this);
        game.on(Game.EVENT_SHOW, this.onGameShow, this);
    }

    protected onDestroy(): void {
        this.loadToken++;
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        game.off(Game.EVENT_SHOW, this.onGameShow, this);
        this.unscheduleAllCallbacks();
        for (const tile of this.tiles) {
            if (tile.node?.isValid) Tween.stopAllByTarget(tile.node);
        }
        this.resetFeedback();
        this.settings?.destroy();
        this.gmPanel?.destroy();
        this.winNode?.destroy();
        this.gameplayGuide?.destroy();
        this.closeDialog();
        this.clearFlyLayer();
    }

    protected update(dt: number): void {
        if (this.state !== 'playing' || this.boardEntering || this.suspended
            || this.settings?.isValid || this.gmPanel?.isValid || this.gameplayGuide?.isValid) return;
        this.elapsedTime += dt;
    }

    private onGameHide(): void {
        this.suspended = true;
        this.saveSnapshot();
    }

    private onGameShow(): void {
        this.suspended = false;
    }

    private openSettings(): void {
        if (this.state !== 'playing' || this.busy || this.settings?.isValid || this.gmPanel?.isValid
            || this.gameplayGuide?.isValid) return;
        AudioManager.instance.playClick();
        this.saveSnapshot();
        this.settings = LayerManager.instance.showUI('setting', 1, () => this.backHome(true));
    }

    private openGmPanel(): void {
        if (this.state !== 'playing' || this.busy || this.boardEntering
            || this.settings?.isValid || this.gmPanel?.isValid || this.gameplayGuide?.isValid) return;

        AudioManager.instance.playClick();
        this.saveSnapshot();
        const panel = UigmLayer.show({
            getLevel: () => this.level,
            minLevel: 1,
            maxLevel: MAX_TRAVEL_LEVEL,
            resetLabel: '重置旅行',
            levelLabel: '旅行关卡',
            reset: () => this.gmJumpToLevel(1),
            jump: (level) => this.gmJumpToLevel(level),
            complete: () => this.gmCompleteLevel(),
            onClose: () => {
                this.gmPanel = null;
                if (!this.node?.isValid) return;
                this.syncBoardTileTouch();
                this.refreshHud();
            },
        });
        this.gmPanel = panel?.node || null;
        if (!this.gmPanel) {
            LayerManager.instance.showToast('GM 面板打开失败');
            return;
        }
        this.syncBoardTileTouch();
    }

    private async gmJumpToLevel(level: number): Promise<boolean> {
        if (!this.node?.isValid || !Number.isSafeInteger(level) || level < 1 || level > MAX_TRAVEL_LEVEL) {
            return false;
        }

        this.level = level;
        this.replayMode = false;
        StorageManager.instance.setItem(StorageKey.TravelLevel, level);
        StorageManager.instance.removeItem(StorageKey.TravelReplayMode);
        StorageManager.instance.removeItem(StorageKey.TravelSnapshot);
        ArchiveManager.instance.scheduleUpload();
        await this.startLevel(false);
        return this.node.isValid && this.state === 'playing' && this.level === level;
    }

    private gmCompleteLevel(): boolean {
        if (!this.node?.isValid || this.state !== 'playing' || this.busy || this.winSettled) return false;
        this.finishLevel();
        return this.winSettled;
    }

    /** LayerManager.showUI 在预制体加入 uiLayer 后调用。 */
    public init(): void {
        void this.loadResources();
    }

    private bindButton(node: Node | null, action: () => void): void {
        if (!node) return;
        const button = node.getComponent(Button);
        if (button) button.clickEvents = []; // 清除从主线复制来的旧事件。
        node.on(Button.EventType.CLICK, action, this);
    }

    private async loadResources(): Promise<void> {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            LayerManager.instance.showToast('旅行资源尚未就绪');
            this.backHome();
            return;
        }
        const token = ++this.loadToken;
        const tilePrefab = await new Promise<Prefab | null>(resolve =>
            bundle.load('prefab/mahjongItem', Prefab, (err, asset) => resolve(err ? null : asset)));
        const { faces, paths } = await new Promise<{ faces: SpriteFrame[]; paths: string[] }>(resolve =>
            bundle.loadDir(Constants.MahjongBoard.ResourceDir, SpriteFrame, (err, assets, urls?: string[]) => {
                if (err) console.error('UITravelLayer: load mahjong frames failed', err);
                resolve({ faces: err ? [] : assets, paths: urls || [] });
            }));
        // 替换素材加载失败不阻断关卡，仍使用基础牌面。
        const faceFolders: TravelFaceFolder[] = ['mahjong1', 'mahjong2'];
        const alternateFaces = await Promise.all(faceFolders.map(folder =>
            new Promise<{ faces: SpriteFrame[]; paths: string[] }>(resolve =>
                bundle.loadDir(`resources/${folder}`, SpriteFrame, (err, assets, urls?: string[]) => {
                    if (err) console.warn(`UITravelLayer: load ${folder} frames failed`, err);
                    resolve({ faces: err ? [] : assets || [], paths: urls || [] });
                }))));
        const effectNames = ['glow', 'huaban', 'addIQCount'];
        const effects = await Promise.all(effectNames.map(name => new Promise<Prefab | null>(resolve =>
            bundle.load(`prefab/${name}`, Prefab, (err, asset) => resolve(err ? null : asset)))));
        if (!this.node.isValid || token !== this.loadToken) return;
        this.tilePrefab = tilePrefab;
        this.baseFrames = this.indexTileFrames(faces, paths);
        this.frames = new Map(this.baseFrames);
        this.alternateFrames.clear();
        faceFolders.forEach((folder, index) => {
            this.alternateFrames.set(folder, this.indexTileFrames(alternateFaces[index].faces, alternateFaces[index].paths));
        });
        effects.forEach((prefab, index) => {
            if (prefab) this.effectPrefabs.set(effectNames[index], prefab);
        });
        // 构建器的宽松展开会把 Map.keys() 迭代器当成单个元素，需先显式转换为数组。
        if (!tilePrefab || Array.from(this.frames.keys()).filter(name => /^\d+$/.test(name)).length < 3) {
            console.error('UITravelLayer: tile resources incomplete', {
                hasPrefab: !!tilePrefab, loadedFaces: faces.length, indexedFaces: this.frames.size,
                sampleNames: faces.slice(0, 3).map(frame => frame.name), samplePaths: paths.slice(0, 3),
            });
            LayerManager.instance.showToast('旅行牌面加载失败');
            this.backHome();
            return;
        }
        this.level = this.loadLevel();
        void this.startLevel(true);
    }

    private indexTileFrames(faces: SpriteFrame[], paths: string[]): Map<string, SpriteFrame> {
        const result = new Map<string, SpriteFrame>();
        faces.forEach((frame, index) => {
            // 打包后 SpriteFrame.name 可能只是 "spriteFrame"，资源路径仍保留牌型文件名。
            const match = /(?:^|\/)([^/]+)\/spriteFrame$/.exec((paths[index] || '').replace(/\\/g, '/'));
            const id = match?.[1] || frame.name;
            if (/^\d+$/.test(id) || id === 'flip') result.set(id, frame);
        });
        return result;
    }

    private readFaceCycles(): Record<string, TravelFaceCycle> {
        try {
            const parsed = JSON.parse(StorageManager.instance.getItem(StorageKey.TravelFaceCycles) || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (_) { /* 损坏的本地记录重新抽取，不影响关卡。 */ }
        return {};
    }

    /** 每五关生成一次方案；五关各自从默认/两种替换牌面独立随机，方案存档保证续玩一致。 */
    private faceCycleForLevel(level: number, random: () => number = Math.random): TravelFaceCycle {
        const cycleIndex = Math.floor((level - 1) / TRAVEL_FACE_CYCLE_LENGTH);
        const cycles = this.readFaceCycles();
        const saved = cycles[cycleIndex];
        if (saved && Array.isArray(saved.choices) && saved.choices.length === TRAVEL_FACE_CYCLE_LENGTH
            && saved.choices.every(choice => choice === 'default' || choice === 'mahjong1' || choice === 'mahjong2')) {
            return saved;
        }
        const options: TravelFaceChoice[] = ['default', 'mahjong1', 'mahjong2'];
        const cycle: TravelFaceCycle = {
            choices: Array.from({ length: TRAVEL_FACE_CYCLE_LENGTH }, () =>
                options[Math.floor(random() * options.length)]),
        };
        cycles[cycleIndex] = cycle;
        StorageManager.instance.setItem(StorageKey.TravelFaceCycles, JSON.stringify(cycles));
        ArchiveManager.instance.scheduleUpload();
        return cycle;
    }

    private applyFaceCycle(level: number, plan: TravelLevelPlan, random: () => number = Math.random): void {
        const cycle = this.faceCycleForLevel(level);
        this.frames = new Map(this.baseFrames);
        const offset = (level - 1) % TRAVEL_FACE_CYCLE_LENGTH;
        const choice = cycle.choices[offset];
        if (choice === 'default') return;
        const replacements = this.alternateFrames.get(choice);
        if (!replacements) return;
        if (!cycle.faceMappings || typeof cycle.faceMappings !== 'object' || Array.isArray(cycle.faceMappings)) {
            cycle.faceMappings = {};
        }
        let mapping = cycle.faceMappings[offset];
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
            // 从本关实际出现的不同牌型中无放回抽样；同种牌仍显示同一张图。
            const types = Array.from(new Set(plan.tiles.map(tile => tile.type)))
                .filter(type => this.baseFrames.has(type));
            const sourceIds = Array.from(replacements.keys()).filter(id => /^\d+$/.test(id));
            const shuffle = (items: string[]) => {
                for (let i = items.length - 1; i > 0; i--) {
                    const j = Math.floor(random() * (i + 1));
                    [items[i], items[j]] = [items[j], items[i]];
                }
            };
            shuffle(types);
            shuffle(sourceIds);
            // 资源少于五分之一时以可用素材数为上限，绝不复用替换图。
            const count = Math.min(types.length, sourceIds.length, Math.max(1, Math.floor(types.length / 5)));
            mapping = {};
            for (let i = 0; i < count; i++) mapping[types[i]] = sourceIds[i];
            cycle.faceMappings[offset] = mapping;
            const cycles = this.readFaceCycles();
            cycles[Math.floor((level - 1) / TRAVEL_FACE_CYCLE_LENGTH)] = cycle;
            StorageManager.instance.setItem(StorageKey.TravelFaceCycles, JSON.stringify(cycles));
            ArchiveManager.instance.scheduleUpload();
        }
        Object.keys(mapping).forEach(type => {
            const frame = replacements.get(mapping[type]);
            if (frame && this.baseFrames.has(type)) this.frames.set(type, frame);
        });
    }

    private loadLevel(): number {
        const saved = Number(StorageManager.instance.getItem(StorageKey.TravelLevel));
        this.replayMode = StorageManager.instance.getItem(StorageKey.TravelReplayMode) === 'true';
        if (!Number.isSafeInteger(saved) || saved < 1) return 1;
        if (saved <= MAX_TRAVEL_LEVEL) return saved;
        // 兼容旧版最后一关通关后写入的越界关号，并持久进入随机循环。
        this.replayMode = true;
        const next = this.randomReplayLevel();
        StorageManager.instance.setItem(StorageKey.TravelReplayMode, 'true');
        StorageManager.instance.setItem(StorageKey.TravelLevel, next);
        ArchiveManager.instance.scheduleUpload();
        return next;
    }

    private randomReplayLevel(): number {
        const first = Math.min(100, MAX_TRAVEL_LEVEL);
        return first + Math.floor(Math.random() * (MAX_TRAVEL_LEVEL - first + 1));
    }

    private travelLevelId(): number {
        return TRAVEL_LEVEL_ID_START + this.level - 1;
    }

    private reportTravelPropUse(propName: 'undo' | 'shuffle' | 'magnet' | 'slot_unlock', remaining: number): void {
        // 每次实际生效才上报一次；剩余次数仍通过 TravelSnapshot 同步到云存档。
        const sdk = SDKManager.instance;
        if (typeof sdk?.report === 'function') sdk.report({
            event: SDKEvent.prop,
            cid: 'travel_prop_use',
            type: 2,
            level: this.travelLevelId(),
            propName,
            count: 1,
            remaining,
        });
    }

    private recordCompletedTravelAd(): void {
        this.adCount++;
        ProgressManager.addGlobalAdCount(1);
        ArchiveManager.instance.scheduleUpload();
        this.reportTravelLevel(4);
    }

    private reportTravelLevel(type: 1 | 2 | 3 | 4, reason?: string): void {
        // 旅行关卡独立于主线和活动关卡，使用 10001 起的连续编号区分数据。
        const level = this.travelLevelId();
        const data: Record<string, unknown> = {
            event: SDKEvent?.level ?? 'level',
            type,
            level,
        };
        if (type === 2 && reason) data.reason = reason;
        if (type === 3) data.time = Math.ceil(this.elapsedTime);

        // 保持测试环境及旧构建中缺少 report 方法时的兼容性。
        const sdk = SDKManager.instance;
        if (typeof sdk?.report === 'function') sdk.report(data);
    }

    private async startLevel(resume: boolean): Promise<void> {
        const token = ++this.loadToken;
        this.state = 'loading';
        this.winSettled = false;
        this.busy = false;
        this.activeCollections = 0;
        this.resolvingTileIds.clear();
        this.boardEntering = false;
        this.entranceMode = null;
        this.resetFeedback();
        const label = this.node.getChildByName('levelLabel')?.getComponent(Label);
        if (label) label.string = `旅行 ${this.level} · 加载中`;
        let plan: TravelLevelPlan;
        try {
            plan = await ensureTravelLevel(this.level);
            if (!this.node.isValid || token !== this.loadToken) return;
            if (plan.tiles.some(tile => !this.frames.has(tile.type))) {
                throw new Error(`Travel level ${this.level}: missing tile frame`);
            }
        } catch (error) {
            if (!this.node.isValid || token !== this.loadToken) return;
            console.error('UITravelLayer: load level failed', error);
            LayerManager.instance.showToast('旅行关卡加载失败，请稍后重试');
            this.backHome();
            return;
        }
        // 每次实际进入关卡时消耗一次，首关（非重玩）免费；失败、退出和结算均不重复扣费。
        if (this.level !== 1 || this.replayMode) ProgressManager.consumeTravelAttempt();
        this.applyFaceCycle(this.level, plan);
        this.plan = plan;
        this.tiles = this.plan.tiles.map(tile => ({ ...tile, state: 'board', node: null, item: null }));
        this.slots = [];
        this.capacity = NORMAL_CAPACITY;
        this.slotUnlockPending = false;
        this.undoLeft = 2;
        this.shuffleLeft = 1;
        this.magnetLeft = 1;
        this.boxLeft = 1;
        this.iqValue = 40;
        this.clearCount = 0;
        this.comboTimes = 0;
        this.elapsedTime = 0;
        this.adCount = 0;
        const restored = resume && this.restoreSnapshot();
        this.dialog?.destroy();
        this.dialog = null;
        this.state = 'playing';
        this.reportTravelLevel(1);
        window.dnSDK?.track?.('LEVEL_ENTER', {
            enter_level_name: `旅行${this.level}`,
            level_id: this.travelLevelId(),
        });
        const iqLabel = this.node.getChildByName('iqLabel');
        if (iqLabel) iqLabel.active = true;
        this.renderBoard();
        this.refreshHud();
        if (this.tiles.every(tile => tile.state === 'removed')) this.finishLevel();
        else if (this.slots.length >= this.capacity) this.showFailure();
        this.saveSnapshot();
        if (!restored && this.state === 'playing') this.playBoardEntrance();
        if (this.state === 'playing') this.showFirstLevelGuide();
    }

    private showFirstLevelGuide(): void {
        if (this.level !== 1 || this.replayMode || this.firstLevelGuideShown || this.gameplayGuide?.isValid) return;
        const guide = LayerManager.instance.showUI('gameplayGuide');
        if (!guide) return;
        this.firstLevelGuideShown = true;
        this.gameplayGuide = guide;
        this.syncBoardTileTouch();
        this.refreshHud();
        guide.on(ThreePopupEvent.Closed, () => {
            if (this.gameplayGuide !== guide) return;
            this.gameplayGuide = null;
            if (!this.node.isValid) return;
            this.syncBoardTileTouch();
            this.refreshHud();
        });
    }

    private renderBoard(): void {
        this.clearFlyLayer();
        const transform = this.board.getComponent(UITransform)!;
        // 外层 pNode 已由预制体 Widget 留出上方槽位和下方按钮的空间。
        // 使用它的实际尺寸，不再受内层固定 610×610 的区域限制。
        const boardArea = this.board.parent?.getComponent(UITransform);
        if (boardArea && boardArea.width > 0 && boardArea.height > 0) {
            transform.setContentSize(boardArea.contentSize);
        }
        // 保留原长方形牌身：横向牌身贴合，纵向白色牌面贴合并遮住上一行的厚底边。
        // 原始行列坐标和层级不变，整盘与牌面一起等比适配，避免拉伸牌型。
        const prefabNode = this.tilePrefab?.data as Node | undefined;
        const visualSize = this.getTileVisualSize(prefabNode);
        this.tileVisualWidth = visualSize.width;
        this.tileVisualHeight = visualSize.height;
        const desiredScale = BOARD_MAX_STEP * BOARD_TILE_HEIGHT_RATIO / TILE_HEIGHT * BOARD_TILE_FACE_SCALE;
        const desiredStepX = visualSize.width * desiredScale * TILE_BODY_WIDTH_RATIO;
        const desiredStepY = visualSize.height * desiredScale * TILE_ROW_PITCH_RATIO;
        const fit = Math.min(1,
            (transform.width - 24) / ((this.plan.width - 1) * desiredStepX + visualSize.width * desiredScale),
            (transform.height - 24) / ((this.plan.height - 1) * desiredStepY + visualSize.height * desiredScale));
        this.boardStepX = desiredStepX * fit;
        this.boardStepY = desiredStepY * fit;
        this.boardTileScale = desiredScale * fit;
        for (const child of this.board.children.slice()) {
            for (const tileNode of child.children) Tween.stopAllByTarget(tileNode);
            child.removeFromParent();
            child.destroy();
        }
        for (const child of this.tray.children.slice()) {
            child.removeFromParent();
            child.destroy();
        }
        const layers: Node[] = [];
        const maxLayer = Math.max(...this.tiles.map(tile => tile.layer));
        for (let layer = 0; layer <= maxLayer; layer++) {
            const container = new Node(`_layer_${layer}_`);
            container.layer = this.board.layer;
            container.addComponent(UITransform).setContentSize(transform.contentSize);
            this.board.addChild(container);
            layers.push(container);
        }
        const drawOrder = this.tiles.slice().sort((a, b) => a.layer - b.layer || a.id - b.id);
        for (const tile of drawOrder) {
            if (tile.state === 'removed') continue;
            const node = instantiate(this.tilePrefab!);
            node.name = `travelTile_${tile.id}`;
            node.setPosition(this.boardPosition(tile));
            node.setScale(new Vec3(this.boardTileScale, this.boardTileScale, 1));
            layers[tile.layer].addChild(node);
            tile.node = node;
            tile.item = node.getComponent(MahjongItem);
            tile.item?.setBoardScale(this.boardTileScale);
            tile.item?.setTravelBoardStep(this.boardStepX, this.boardStepY);
            this.refreshTileFace(tile);
            this.syncTileTouchArea(node);
            node.on(Node.EventType.TOUCH_END, () => this.tapTile(tile), this);
            if (tile.state === 'slot') {
                node.setParent(this.tray);
                tile.item?.disableTileTouch();
            }
        }
        // 导入编号并非屏幕上下顺序；开局就按显示行列排序，不能等第一次触摸才恢复层级。
        for (const layer of layers) MahjongItem.refreshLayerDisplayOrder(layer);
        this.refreshTray();
        this.refreshBlocked();
    }

    private getTileVisualSize(node?: Node): { width: number; height: number } {
        const root = node?.getComponent(UITransform);
        const face = node?.getChildByName('bg');
        const faceTransform = face?.getComponent(UITransform);
        return {
            width: Math.max(root?.width || TILE_WIDTH,
                (faceTransform?.width || 0) * Math.abs(face?.scale.x || 1) + 2 * Math.abs(face?.position.x || 0)),
            height: Math.max(root?.height || TILE_HEIGHT,
                (faceTransform?.height || 0) * Math.abs(face?.scale.y || 1) + 2 * Math.abs(face?.position.y || 0)),
        };
    }

    private syncTileTouchArea(node: Node): void {
        const transform = node.getComponent(UITransform);
        if (!transform) return;
        const size = this.getTileVisualSize(node);
        transform.setContentSize(size.width * TILE_BODY_WIDTH_RATIO, size.height * TILE_BODY_HEIGHT_RATIO);
        // 透明边并不对称（左 3、右 6、上 2、下 6），命中框跟随可见牌身的中心。
        transform.setAnchorPoint(74.5 / 146, 88 / 180);
    }

    /** 两段参考视频分别是原地缩放铺牌和两侧飞入，每次新开局只随机选其中一种。 */
    private playBoardEntrance(): void {
        const entering = this.tiles.filter(tile => tile.state === 'board' && tile.node?.isValid);
        if (!entering.length) return;
        const mode = this.selectEntranceMode();
        this.entranceMode = mode;
        const boardWidth = this.board.getComponent(UITransform)!.width;
        const startEdge = boardWidth / 2 + this.tileVisualWidth * this.boardTileScale + 32;
        const token = this.loadToken;
        let endTime = 0;
        this.boardEntering = true;
        this.busy = true;
        this.refreshHud();

        for (const tile of entering) {
            const node = tile.node!;
            const target = node.position.clone();
            const side = target.x >= 0 ? 1 : -1;
            const outerRatio = Math.min(1, Math.abs(target.x) / Math.max(1, boardWidth / 2));
            const delay = Math.min(tile.layer * ENTRANCE_LAYER_STAGGER, ENTRANCE_MAX_STAGGER)
                + (mode === 'fly' ? (1 - outerRatio) * 0.1 : 0)
                + ((tile.id * 5) % 7) * 0.015
                + (mode === 'expand' ? ENTRANCE_EXPAND_REVEAL_DELAY : 0);
            const duration = mode === 'fly' ? ENTRANCE_FLY_DURATION : ENTRANCE_EXPAND_DURATION;
            const finalScale = new Vec3(this.boardTileScale, this.boardTileScale, 1);
            tile.item?.disableTileTouch();
            tile.item?.setMotionStreakEnabled(false);
            if (mode === 'expand') {
                // 第一段视频：未轮到的牌彻底不可见，出现时直接从可辨识大小逐层弹开。
                node.setPosition(target);
                node.setScale(0, 0, 1);
                tween(node)
                    .delay(delay)
                    .call(() => {
                        if (!node.isValid || token !== this.loadToken) return;
                        const revealScale = this.boardTileScale * ENTRANCE_EXPAND_REVEAL_SCALE;
                        node.setScale(revealScale, revealScale, 1);
                    })
                    .to(duration * 0.75, { scale: new Vec3(this.boardTileScale * 1.06, this.boardTileScale * 1.06, 1) }, { easing: 'cubicOut' })
                    .to(duration * 0.25, { scale: finalScale }, { easing: 'sineOut' })
                    .start();
            } else {
                // 第二段视频：完整大小的牌从棋盘左右两侧飞入；入场不显示拖尾。
                node.setPosition(side * startEdge, target.y, 0);
                node.setScale(finalScale);
                tween(node)
                    .delay(delay)
                    .to(duration, { position: target }, { easing: 'cubicOut' })
                    .start();
            }
            endTime = Math.max(endTime, delay + duration);
        }

        this.scheduleOnce(() => {
            if (!this.node.isValid || token !== this.loadToken) return;
            this.boardEntering = false;
            this.busy = false;
            this.syncBoardTileTouch();
            this.refreshBlocked();
            this.refreshHud();
        }, endTime + 0.02);
    }

    private selectEntranceMode(randomValue = Math.random()): TravelEntranceMode {
        return randomValue < 0.5 ? 'expand' : 'fly';
    }

    private boardPosition(tile: TravelTile): Vec3 {
        return this.localBoardPosition(tile.col, tile.row);
    }

    private localBoardPosition(col: number, row: number): Vec3 {
        // 导入时 row = -source.y，已经把原版向下的 Y 转成 Cocos 向上的 Y，不能再反转。
        return new Vec3((col - (this.plan.centerCol ?? (this.plan.width - 1) / 2)) * this.boardStepX,
            (row - (this.plan.centerRow ?? (this.plan.height - 1) / 2)) * this.boardStepY, 0);
    }

    private refreshTileFace(tile: TravelTile): void {
        // MahjongItem 用向下递增的半格行号排序；仅转换显示元数据，不改关卡/存档坐标。
        tile.item?.setData(tile.type, -tile.row * 2, tile.col * 2, tile.layer, this.frames.get(tile.type) || null);
        if (tile.faceDown) this.setFaceDownImage(tile);
    }

    private setFaceDownImage(tile: TravelTile): void {
        const flip = this.frames.get('flip');
        const sprite = tile.item?.iconNode?.getComponent(Sprite);
        if (sprite && flip) sprite.spriteFrame = flip;
    }

    private isBlocked(tile: TravelTile): boolean {
        return isTravelBlocked(tile, this.tiles.filter(other => other.state === 'board'));
    }

    private refreshBlocked(): void {
        const remaining = this.tiles.filter(tile => tile.state === 'board');
        for (const tile of this.tiles) {
            if (tile.state === 'board') tile.item?.setPlayable(!isTravelBlocked(tile, remaining));
        }
    }

    private tapTile(tile: TravelTile): void {
        if (!this.canTapTile() || tile.state !== 'board') return;
        if (this.isBlocked(tile)) {
            LayerManager.instance.showToast('先移开上层的牌');
            return;
        }
        if (tile.faceDown) {
            tile.faceDown = false;
            this.refreshTileFace(tile);
        }
        this.collectTiles([tile]);
    }

    private canPlay(): boolean {
        return this.state === 'playing' && !this.busy && !this.suspended
            && !this.settings?.isValid && !this.gmPanel?.isValid && !this.gameplayGuide?.isValid;
    }

    private canTapTile(): boolean {
        if (this.state !== 'playing' || this.boardEntering || this.suspended
            || this.settings?.isValid || this.gmPanel?.isValid || this.gameplayGuide?.isValid) return false;
        if (this.slots.length >= this.capacity) return false;
        // 普通入槽阶段仍保持串行；三张牌开始碰撞消除后，只按剩余槽位限制继续点牌。
        return !this.busy || this.resolvingTileIds.size > 0;
    }

    private syncBoardTileTouch(): void {
        const enabled = this.canTapTile();
        for (const tile of this.tiles) {
            if (tile.state !== 'board' || !tile.node?.isValid) continue;
            if (enabled) tile.item?.enableTileTouch();
            else tile.item?.disableTileTouch();
        }
    }

    /** 点击和磁铁共用入槽动画；消除碰撞开始后允许玩家继续填充未占用槽位。 */
    private collectTiles(queue: TravelTile[]): void {
        this.activeCollections++;
        this.busy = true;
        const token = this.loadToken;
        this.syncBoardTileTouch();
        this.refreshHud();
        let completed = false;
        const complete = () => {
            if (completed) return;
            completed = true;
            this.activeCollections = Math.max(0, this.activeCollections - 1);
            this.busy = this.activeCollections > 0;
            this.syncBoardTileTouch();
            this.refreshBlocked();
            this.refreshHud();
            if (this.activeCollections > 0) return;
            if (this.tiles.every(item => item.state === 'removed')) {
                // 等最后一组消除光效和 IQ 飘字结束后再弹原版 win。
                this.state = 'win';
                this.scheduleOnce(() => this.finishLevel(), 0.65);
                // 先写完整盘面，意外退出后也会恢复到通关结算。
                this.saveSnapshot(true);
            } else {
                if (this.slots.length >= this.capacity) this.showFailure();
                this.saveSnapshot();
            }
        };
        const next = () => {
            if (!this.node.isValid || token !== this.loadToken || this.state !== 'playing') return;
            let tile = queue.shift();
            while (tile && tile.state !== 'board') tile = queue.shift();
            if (!tile || this.slots.length >= this.capacity) {
                complete();
                return;
            }
            tile.item?.playTapFeedback();
            if (tile.node) Tween.stopAllByTarget(tile.node);
            tile.state = 'slot';
            this.slots.push(tile);
            tile.item?.setPlayable(true);
            tile.node?.setParent(this.ensureFlyLayer(), true);
            if (tile.node) tile.node.active = true;
            tile.item?.disableTileTouch();
            this.refreshTray(MOVE_DURATION, tile);
            this.refreshBlocked();
            this.syncBoardTileTouch();
            this.scheduleOnce(() => {
                if (token !== this.loadToken || !this.node.isValid) return;
                // Scheduler 与 Tween 的更新顺序可能不同，碰撞前固定最终落位。
                this.refreshTray();
                // 让 setParent/位置同步先完成一帧，再开始合并；合并中的牌必须已经在槽位节点下。
                this.scheduleOnce(() => this.resolveTriple(tile.type, next), 0);
            }, MOVE_DURATION);
        };
        next();
    }

    private resolveTriple(type: string, onComplete: () => void): void {
        // 状态切到 slot 的瞬间牌仍可能在飞行层。只有真正落到槽位的牌才能参与消除，
        // 避免飞行中的牌被提前销毁或在棋盘上看起来“凭空消失”。
        const unsettled = this.slots.some(tile => tile.state === 'slot'
            && tile.node?.isValid && tile.node.parent !== this.tray);
        if (unsettled) {
            this.refreshTray();
            this.scheduleOnce(() => this.resolveTriple(type, onComplete), 0);
            return;
        }
        const match = this.slots
            .filter(tile => tile.state === 'slot' && tile.type === type && !this.resolvingTileIds.has(tile.id)
                && tile.node?.isValid && tile.node.parent === this.tray)
            .slice(0, 3);
        if (match.length < 3) {
            onComplete();
            return;
        }
        for (const tile of match) this.resolvingTileIds.add(tile.id);
        this.syncBoardTileTouch();
        const nodes = match.map(tile => tile.node!).sort((a, b) => a.position.x - b.position.x);
        const center = nodes[1].position.clone();
        const worldCenter = this.tray.getComponent(UITransform)!.convertToWorldSpaceAR(center);
        const effectPosition = this.node.getComponent(UITransform)!.convertToNodeSpaceAR(worldCenter);
        const distance = Math.min(24, Math.max(10, Math.abs(nodes[1].position.x - nodes[0].position.x) * 0.35));
        nodes.forEach((node, index) => {
            const direction = index - 1;
            const origin = node.position.clone();
            const scale = node.scale.clone();
            Tween.stopAllByTarget(node);
            tween(node)
                .to(COLLISION_SPREAD, { position: new Vec3(origin.x + direction * distance, origin.y, 0) }, { easing: 'sineOut' })
                .to(COLLISION_IMPACT, {
                    position: new Vec3(origin.x - direction * distance, origin.y, 0),
                    scale: new Vec3(scale.x * 0.92, scale.y * 1.06, 1),
                }, { easing: 'quadIn' })
                .to(COLLISION_REBOUND, { position: origin, scale }, { easing: 'backOut' })
                .start();
        });
        this.scheduleOnce(() => {
            this.playMergeEffect(effectPosition);
            this.addClearScore(effectPosition);
            // 与主线相同：撞击时播放消除效果，0.12 秒后才移除牌。
            this.scheduleOnce(() => {
                for (const tile of match) {
                    tile.state = 'removed';
                    if (tile.node) Tween.stopAllByTarget(tile.node);
                    tile.node?.destroy();
                    tile.node = null;
                    tile.item = null;
                }
                this.slots = this.slots.filter(tile => tile.state === 'slot');
                this.refreshTray(0.16);
                this.syncBoardTileTouch();
                this.refreshHud();
                this.scheduleOnce(() => {
                    for (const tile of match) this.resolvingTileIds.delete(tile.id);
                    this.syncBoardTileTouch();
                    onComplete();
                }, 0.16);
            }, COLLISION_REBOUND);
        }, COLLISION_SPREAD + COLLISION_IMPACT);
    }

    private ensureFlyLayer(): Node {
        // 与 gameLayerThree 同级，并置于整个游戏界面之上，不受槽位/棋盘层级遮挡。
        const parent = this.node.parent || this.node;
        if (!this.flyLayer?.isValid) {
            this.flyLayer = new Node('travelFlyLayer');
            this.flyLayer.layer = this.node.layer;
            this.flyLayer.addComponent(UITransform);
            parent.addChild(this.flyLayer);
        } else if (this.flyLayer.parent !== parent) {
            this.flyLayer.setParent(parent, true);
        }
        this.flyLayer.setSiblingIndex(parent.children.length - 1);
        return this.flyLayer;
    }

    private clearFlyLayer(): void {
        if (this.flyLayer?.isValid) {
            for (const child of this.flyLayer.children) Tween.stopAllByTarget(child);
            this.flyLayer.destroy();
        }
        this.flyLayer = null;
    }

    private refreshTray(duration = 0, flyingTile: TravelTile | null = null): void {
        // 显示上把同类牌放在一起；slots 保留点击顺序，撤回仍取最后点入的牌。
        // Web 构建的宽松展开会把 Set 当作单个元素，必须先显式转成数组。
        const types = Array.from(new Set(this.slots.map(tile => tile.type)));
        const ordered: TravelTile[] = [];
        for (const type of types) ordered.push(...this.slots.filter(tile => tile.type === type));
        // 保持前五格与预制体占位锁对齐，解锁时已有牌不会重新分布。
        const count = Math.max(UNLOCKED_CAPACITY, this.capacity, ordered.length);
        const traySize = this.tray.getComponent(UITransform)!;
        const step = traySize.width / count;
        // 缩小牌间留白、放大槽内牌；高度上限为上移后的牌身预留空间。
        const scale = Math.min((step - TRAY_TILE_GAP) / this.tileVisualWidth,
            (traySize.height - TRAY_TILE_OFFSET_Y * 2) / this.tileVisualHeight);
        const token = this.loadToken;
        ordered.forEach((tile, index) => {
            const node = tile.node;
            // 新牌入槽会重排其他牌，但不能停止正在碰撞消除的三张牌动画。
            if (!node || this.resolvingTileIds.has(tile.id)) return;
            const position = new Vec3((index - (count - 1) / 2) * step, TRAY_TILE_OFFSET_Y, 0);
            const targetWorld = traySize.convertToWorldSpaceAR(position);
            const currentWorld = node.worldPosition;
            const moving = Math.abs(currentWorld.x - targetWorld.x) + Math.abs(currentWorld.y - targetWorld.y) > 0.5;
            Tween.stopAllByTarget(node);
            tile.item?.setMotionStreakEnabled(false);
            const settle = () => {
                if (!node.isValid || token !== this.loadToken || tile.state !== 'slot') return;
                tile.item?.setMotionStreakEnabled(false);
                if (node.parent !== this.tray) node.setParent(this.tray, true);
                node.setPosition(position);
                node.setScale(scale, scale, 1);
                node.setSiblingIndex(index);
            };
            if (duration > 0 && moving) {
                const flyLayer = this.ensureFlyLayer();
                if (node.parent !== flyLayer) node.setParent(flyLayer, true);
                node.setSiblingIndex(flyLayer.children.length - 1);
                const target = flyLayer.getComponent(UITransform)!.convertToNodeSpaceAR(targetWorld);
                // 跨层飞行时转换目标缩放，落回槽位不会突然变大或变小。
                const trayWorldScale = this.tray.worldScale;
                const flyWorldScale = flyLayer.worldScale;
                const targetScale = new Vec3(scale * trayWorldScale.x / (flyWorldScale.x || 1),
                    scale * trayWorldScale.y / (flyWorldScale.y || 1), 1);
                // 触摸继续保持禁用，只单独开启移动拖尾。
                tile.item?.setMotionStreakEnabled(true);
                tween(node)
                    .to(duration, { position: target, scale: targetScale }, { easing: 'quadOut' })
                    .call(settle)
                    .start();
            } else {
                settle();
            }
        });
        // 同时给槽内其他牌让位时，当前新收取的牌仍在最前面。
        const flyingNode = flyingTile?.node;
        if (flyingNode && this.flyLayer && flyingNode.parent === this.flyLayer) {
            flyingNode.setSiblingIndex(this.flyLayer.children.length - 1);
        }
    }

    private undo(fromFailure = false): boolean {
        if (this.busy || (fromFailure ? this.state !== 'fail' : !this.canPlay()) || !this.undoLeft || !this.slots.length) {
            if (!fromFailure) LayerManager.instance.showToast('暂无可撤回的牌');
            return false;
        }
        const tile = this.slots.pop()!;
        if (tile.node) Tween.stopAllByTarget(tile.node);
        AudioManager.instance.playOneShot(AudioClipNames.taskFly);
        tile.state = 'board';
        const parent = this.board.getChildByName(`_layer_${tile.layer}_`)!;
        tile.node?.setParent(parent);
        tile.node?.setPosition(this.boardPosition(tile));
        tile.node?.setScale(new Vec3(this.boardTileScale, this.boardTileScale, 1));
        tile.item?.enableTileTouch();
        MahjongItem.refreshLayerDisplayOrder(parent);
        this.undoLeft--;
        this.reportTravelPropUse('undo', this.undoLeft);
        this.state = 'playing';
        this.refreshTray();
        this.refreshBlocked();
        this.refreshHud();
        this.saveSnapshot();
        return true;
    }

    private shuffle(): void {
        if (!this.canPlay() || !this.shuffleLeft) return;
        const remaining = this.tiles.filter(tile => tile.state === 'board');
        if (remaining.length < 2) return;
        const counts = new Map<string, number>();
        for (const tile of remaining) counts.set(tile.type, (counts.get(tile.type) || 0) + 1);
        const pending = new Map<string, number>();
        for (const tile of this.slots) pending.set(tile.type, (pending.get(tile.type) || 0) + 1);
        const faces: string[] = [];
        // 先补齐暂存槽里未成组的牌，再安排完整的三张组。
        for (const [type, count] of pending) {
            const need = 3 - count;
            if ((counts.get(type) || 0) < need) return;
            for (let i = 0; i < need; i++) faces.push(type);
            counts.set(type, counts.get(type)! - need);
        }
        const groups: string[] = [];
        for (const [type, count] of counts) {
            if (count % 3 !== 0) return;
            for (let i = 0; i < count / 3; i++) groups.push(type);
        }
        for (let i = groups.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [groups[i], groups[j]] = [groups[j], groups[i]];
        }
        for (const type of groups) faces.push(type, type, type);
        const unassigned = remaining.slice();
        const removalOrder: TravelTile[] = [];
        while (unassigned.length) {
            const visible = unassigned.filter(tile => !isTravelBlocked(tile, unassigned));
            if (!visible.length) return;
            const layer = Math.max(...visible.map(tile => tile.layer));
            const top = visible.filter(tile => tile.layer === layer);
            const tile = top[Math.floor(Math.random() * top.length)];
            removalOrder.push(tile);
            unassigned.splice(unassigned.indexOf(tile), 1);
        }
        removalOrder.forEach((tile, index) => {
            tile.type = faces[index];
            this.refreshTileFace(tile);
        });
        this.shuffleLeft--;
        this.reportTravelPropUse('shuffle', this.shuffleLeft);
        this.refreshBlocked();
        this.refreshHud();
        this.saveSnapshot();
    }

    private magnet(): void {
        if (!this.canPlay() || !this.magnetLeft) return;
        const visible = this.tiles.filter(tile => tile.state === 'board' && !tile.faceDown && !this.isBlocked(tile));
        const types = Array.from(new Set([...this.slots, ...visible].map(tile => tile.type)));
        for (const type of types) {
            const needed = 3 - this.slots.filter(tile => tile.type === type).length;
            const candidates = visible.filter(tile => tile.type === type);
            if (needed < 1 || candidates.length < needed) continue;
            this.magnetLeft--;
            this.reportTravelPropUse('magnet', this.magnetLeft);
            this.collectTiles(candidates.slice(0, needed));
            return;
        }
        LayerManager.instance.showToast('当前露出的牌还凑不成一组');
    }

    private expandTray(): void {
        // 兼容可能启用的旧 button4，但同样必须看广告并逐格解锁。
        this.unlockSlot(this.capacity - NORMAL_CAPACITY);
    }

    private unlockSlot(index: number): void {
        if (!this.canPlay() || this.slotUnlockPending || this.capacity >= UNLOCKED_CAPACITY
            || index !== this.capacity - NORMAL_CAPACITY) return;
        AudioManager.instance.playClick();
        this.slotUnlockPending = true;
        this.refreshSlotLocks();
        const token = this.loadToken;
        const requestId = ++this.slotUnlockRequestId;
        SDKManager.instance.showVideoAd(() => {
            if (!this.node.isValid || token !== this.loadToken || !this.slotUnlockPending
                || requestId !== this.slotUnlockRequestId
                || this.capacity !== NORMAL_CAPACITY + index) return;
            this.slotUnlockPending = false;
            this.capacity++;
            this.boxLeft = 0;
            this.recordCompletedTravelAd();
            this.reportTravelPropUse('slot_unlock', UNLOCKED_CAPACITY - this.capacity);
            window.dnSDK?.track?.('USE_ITEM', { item_source: 2 });
            AudioManager.instance.playOneShot(AudioClipNames.pageOpen);
            this.refreshTray();
            this.refreshHud();
            this.saveSnapshot();
        }, () => {
            if (!this.node.isValid || token !== this.loadToken || !this.slotUnlockPending
                || requestId !== this.slotUnlockRequestId
                || this.capacity !== NORMAL_CAPACITY + index) return;
            this.slotUnlockPending = false;
            this.refreshSlotLocks();
            LayerManager.instance.showToast('视频播放未完成！');
        }, 'travel_slot_unlock');
    }

    private refreshHud(): void {
        this.refreshSlotLocks();
        const label = this.node.getChildByName('levelLabel')?.getComponent(Label);
        if (label) {
            const marker = this.plan.difficulty === 'superHard' ? ' · 超难' : this.plan.difficulty === 'hard' ? ' · 困难' : '';
            label.string = `旅行 ${this.level}${marker}`;
        }
        this.refreshIQ();
        const buttons = this.node.getChildByName('down')!.children.filter(child => child.name === 'button' || child.name === 'button4');
        const counts = [this.shuffleLeft, this.magnetLeft, this.undoLeft, this.boxLeft];
        buttons.forEach((button, index) => {
            const count = counts[index];
            const label = button.getChildByName('countLabel')?.getComponent(Label);
            if (label) {
                label.node.active = true;
                label.string = `${count}`;
            }
            for (const name of ['di', 'ad1', 'mask']) {
                const child = button.getChildByName(name);
                if (child) child.active = name === 'di' || (name === 'mask' && count === 0);
            }
            const control = button.getComponent(Button);
            if (control) control.interactable = this.canPlay() && count > 0 && (index !== 2 || this.slots.length > 0);
        });
    }

    private refreshSlotLocks(): void {
        this.slotLocks.forEach((lock, index) => {
            if (!lock?.isValid) return;
            lock.active = this.capacity <= NORMAL_CAPACITY + index;
            const button = lock.getComponent(Button);
            if (button) button.interactable = !this.slotUnlockPending
                && this.capacity === NORMAL_CAPACITY + index;
        });
    }

    private refreshIQ(): void {
        const label = this.node.getChildByName('iqLabel')?.getComponent(Label);
        const enhanced = this.iqValue >= 50;
        const effect = this.node.getChildByName('IQ_effect');
        if (effect) effect.active = enhanced && this.state !== 'win';
        if (!label) return;
        label.string = this.formatNumber(this.iqValue);
        if (enhanced) {
            label.color = new Color(0xf6, 0xdd, 0x11, 255);
            label.enableOutline = true;
            label.outlineColor = new Color(0x61, 0x24, 0x03, 255);
            label.outlineWidth = 2;
        } else if (this.iqStyle) {
            label.color = this.iqStyle.color.clone();
            label.enableOutline = this.iqStyle.enableOutline;
            label.outlineColor = this.iqStyle.outlineColor.clone();
            label.outlineWidth = this.iqStyle.outlineWidth;
        }
    }

    private formatNumber(value: number): string {
        return `${Math.round(value * 10) / 10}`;
    }

    private addClearScore(position: Vec3): void {
        // 与 GameCtrl.addIQ 完全相同：40 起始，+0.4/+0.7/...，单次最高 +3.1。
        const add = Math.round(Math.min(0.4 + this.clearCount * 0.3, 3.1) * 10) / 10;
        this.iqValue = Math.round((this.iqValue + add) * 10) / 10;
        this.clearCount++;
        this.comboTimes++;
        this.refreshIQ();
        this.playCombo();
        const prefab = this.effectPrefabs.get('addIQCount');
        if (!prefab) return;
        const node = this.addEffect(prefab, position);
        const label = node.getChildByName('label')?.getComponent(Label) || node.getComponentInChildren(Label);
        if (label) label.string = `+${this.formatNumber(add)}`;
        node.setScale(0.35, 0.35, 1);
        const opacity = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        opacity.opacity = 255;
        tween(node)
            .to(0.16, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
            .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .to(0.55, { position: new Vec3(position.x, position.y + 70, position.z) }, { easing: 'sineOut' })
            .call(() => this.removeEffect(node))
            .start();
        tween(opacity).delay(0.24).to(0.55, { opacity: 0 }, { easing: 'sineOut' }).start();
    }

    private playMergeEffect(position: Vec3): void {
        AudioManager.instance.playOneShot(AudioClipNames.mahjong_merge_sd);
        const names = ['glow', 'huaban'].filter(name => this.effectPrefabs.has(name));
        if (!names.length) return;
        const name = names[Math.floor(Math.random() * names.length)];
        const effect = this.addEffect(this.effectPrefabs.get(name)!, position);
        effect.getComponent(Animation)?.play(name);
        this.scheduleOnce(() => this.removeEffect(effect), 1.05);
    }

    private addEffect(prefab: Prefab, position: Vec3): Node {
        const node = instantiate(prefab);
        node.layer = this.node.layer;
        this.node.addChild(node);
        node.setPosition(position);
        this.effects.add(node);
        return node;
    }

    private removeEffect(node: Node): void {
        this.effects.delete(node);
        if (!node.isValid) return;
        Tween.stopAllByTarget(node);
        const opacity = node.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
        node.getComponent(Animation)?.stop();
        node.removeFromParent();
        node.destroy();
    }

    private resetCombo(): void {
        const combo = this.node.getChildByName('comboNode');
        if (!combo) return;
        Tween.stopAllByTarget(combo);
        const bar = combo.getChildByPath('ProgressBar/Bar')?.getComponent(Sprite);
        if (bar) Tween.stopAllByTarget(bar);
        for (let index = 1; index <= 7; index++) {
            const image = combo.getChildByName(`${index}`);
            if (image) image.active = false;
        }
        combo.setScale(this.comboScale);
        combo.active = false;
    }

    private resetFeedback(): void {
        this.resetCombo();
        for (const effect of Array.from(this.effects)) this.removeEffect(effect);
        const iqEffect = this.node.getChildByName('IQ_effect');
        if (iqEffect) iqEffect.active = false;
    }

    private playCombo(): void {
        // 原版口号只在第 3、6、9…21 次消除触发；显示超时不清空累计次数。
        if (this.comboTimes % 3 !== 0) return;
        const index = this.comboTimes / 3 - 1;
        if (!COMBO_AUDIOS[index]) return;
        this.resetCombo();
        const combo = this.node.getChildByName('comboNode');
        if (!combo) return;
        const count = combo.getChildByName('countLabel')?.getComponent(Label);
        if (count) count.string = `${this.comboTimes}`;
        const legacyLabel = combo.getChildByName('Label');
        if (legacyLabel) legacyLabel.active = false;
        const bar = combo.getChildByPath('ProgressBar/Bar')?.getComponent(Sprite);
        if (bar) bar.fillRange = 1;
        combo.active = true;
        const scale = this.comboScale;
        combo.setScale(scale.x * 0.78, scale.y * 0.78, scale.z);
        tween(combo)
            .to(0.12, { scale: new Vec3(scale.x * 1.08, scale.y * 1.08, scale.z) }, { easing: 'backOut' })
            .to(0.06, { scale: scale.clone() }, { easing: 'quadOut' })
            .call(() => {
                AudioManager.instance.playOneShot(COMBO_AUDIOS[index]);
                const image = combo.getChildByName(`${index + 1}`);
                if (image) {
                    image.active = true;
                    (image.getComponent(UIOpacity) || image.addComponent(UIOpacity)).opacity = 255;
                }
                if (bar) tween(bar).to(2, { fillRange: 0 }).start();
            })
            .delay(2)
            .call(() => this.resetCombo())
            .start();
    }

    private finishLevel(): void {
        if (!this.node.isValid || this.winSettled || this.winNode?.isValid) return;
        this.winSettled = true;
        this.state = 'win';
        this.reportTravelLevel(3);
        window.dnSDK?.track?.('LEVEL_PASS', {
            duration: Math.max(0, Math.ceil(this.elapsedTime)),
            level_id: this.travelLevelId(),
            ad_cnt: this.adCount,
        });
        this.resetFeedback();
        this.refreshHud();
        const iqLabel = this.node.getChildByName('iqLabel');
        if (iqLabel) iqLabel.active = false;
        if (this.level >= MAX_TRAVEL_LEVEL) this.replayMode = true;
        const nextLevel = this.replayMode ? this.randomReplayLevel() : this.level + 1;
        StorageManager.instance.removeItem(StorageKey.TravelSnapshot);
        if (this.replayMode) StorageManager.instance.setItem(StorageKey.TravelReplayMode, 'true');
        StorageManager.instance.setItem(StorageKey.TravelLevel, nextLevel);
        ArchiveManager.instance.scheduleUpload();
        this.winNode = LayerManager.instance.showUI('win', {
            time: this.elapsedTime,
            iq: this.iqValue,
            nextLevel,
            comboTimes: this.comboTimes,
            isTravel: true,
        }, () => {
            this.winNode = null;
            if (!this.node.isValid) return;
            if (ProgressManager.loadTravelRemaining() === 0) this.backHome();
            else {
                this.level = nextLevel;
                void this.startLevel(false);
            }
        }, () => {
            this.winNode = null;
            if (this.node.isValid) this.backHome();
        });
        if (!this.winNode) {
            LayerManager.instance.showToast('已通关，结算资源未就绪');
            this.backHome();
        }
    }

    private retry(): void {
        StorageManager.instance.removeItem(StorageKey.TravelSnapshot);
        this.closeDialog();
        void this.startLevel(false);
    }

    private showFailure(): void {
        if (this.dialog?.isValid) return;
        this.state = 'fail';
        this.reportTravelLevel(2, '槽位满了');
        this.resetCombo();
        for (const tile of this.tiles) tile.item?.disableTileTouch();
        this.refreshHud();
        // 新弹窗负责视图与遮罩，广告和关卡状态仍由旅行模式处理。
        const dialog = LayerManager.instance.showUI('failureThree');
        if (!dialog) {
            LayerManager.instance.showToast('失败弹窗资源未就绪，请重新进入');
            this.backHome();
            return;
        }
        this.dialog = dialog;
        AudioManager.instance.playOneShotDuckingBgm(AudioClipNames.game_lose);
        const popup = dialog.getComponent(UIThreePopup);
        const reviveButton = dialog.getChildByPath('view/reviveButton')?.getComponent(Button);
        const close = dialog.getChildByPath('view/close');
        if (!popup || !reviveButton || !close) {
            LayerManager.instance.showToast('失败弹窗组件未就绪，请重新进入');
            this.backHome();
            return;
        }
        // 美术预制体的 close 只有图，没有 Button；运行时补上可点击区域。
        const closeButton = close.getComponent(Button) || close.addComponent(Button);
        closeButton.node.on(Button.EventType.CLICK, () => {
            if (dialog.isValid) {
                AudioManager.instance.playClick();
                popup.close();
            }
        });
        dialog.on(ThreePopupEvent.Closed, () => {
            if (this.dialog !== dialog) return;
            this.dialog = null;
            if (this.node.isValid) this.backHome(true);
        });
        let adPending = false;
        let requestId = 0;
        dialog.on(ThreePopupEvent.ReviveRequested, () => {
            if (adPending || !dialog.isValid || this.dialog !== dialog || this.state !== 'fail') return;
            AudioManager.instance.playClick();
            adPending = true;
            reviveButton.interactable = false;
            const currentRequest = ++requestId;
            SDKManager.instance.showVideoAd(() => {
                if (!adPending || currentRequest !== requestId || !dialog.isValid
                    || !this.node.isValid || this.dialog !== dialog || this.state !== 'fail') return;
                adPending = false;
                this.dialog = null;
                popup.close();
                this.recordCompletedTravelAd();
                this.continueAfterFailure();
            }, () => {
                if (!adPending || currentRequest !== requestId || !dialog.isValid
                    || !this.node.isValid || this.dialog !== dialog || this.state !== 'fail') return;
                adPending = false;
                reviveButton.interactable = true;
                LayerManager.instance.showToast('视频播放未完成！');
            }, 'travel_revive');
        });
    }

    private continueAfterFailure(): void {
        if (!this.node.isValid || this.state !== 'fail') return;
        // 将暂存槽内的牌全部撤回棋盘，保留此前通过广告解锁的槽位。
        for (const tile of this.slots) tile.state = 'board';
        this.slots = [];
        if (this.capacity < UNLOCKED_CAPACITY) {
            this.capacity++;
            this.boxLeft = 0;
            AudioManager.instance.playOneShot(AudioClipNames.taskBoxMove);
        }
        this.busy = false;
        this.activeCollections = 0;
        this.resolvingTileIds.clear();
        this.state = 'playing';
        this.renderBoard();
        this.refreshHud();
        this.saveSnapshot();
    }

    private backHome(discardSnapshot = false): void {
        if (discardSnapshot) {
            // 设置里的“放弃”只清除本局快照，保留已解锁的旅行关号。
            // 不能再调用 saveSnapshot，否则退出时会把刚放弃的盘面写回。
            StorageManager.instance.removeItem(StorageKey.TravelSnapshot);
            ArchiveManager.instance.scheduleUpload();
        } else {
            this.saveSnapshot();
        }
        // 节点延迟销毁期间不再保存，避免切后台等回调恢复已放弃的快照。
        this.state = 'loading';
        this.loadToken++;
        this.unscheduleAllCallbacks();
        this.settings?.destroy();
        this.settings = null;
        this.gmPanel?.destroy();
        this.gmPanel = null;
        this.winNode?.destroy();
        this.winNode = null;
        this.closeDialog();
        this.clearFlyLayer();
        this.node.destroy();
        LayerManager.instance.showStartLayer();
    }

    private saveSnapshot(pendingWin = false): void {
        // 飞行/碰撞途中保留上一次完整盘面，避免恢复出三张未结算的牌。
        if (this.busy || this.state === 'loading' || (this.state === 'win' && !pendingWin)) return;
        const snapshot: TravelSnapshot = {
            version: TRAVEL_DATA_VERSION,
            levelKey: this.levelKey(),
            level: this.level,
            tiles: this.tiles.map(tile => ({ id: tile.id, type: tile.type, faceDown: tile.faceDown, state: tile.state })),
            slotIds: this.slots.map(tile => tile.id),
            undoLeft: this.undoLeft,
            shuffleLeft: this.shuffleLeft,
            magnetLeft: this.magnetLeft,
            boxLeft: this.boxLeft,
            capacity: this.capacity,
            iq: this.iqValue,
            clearCount: this.clearCount,
            comboTimes: this.comboTimes,
            elapsedTime: this.elapsedTime,
            adCount: this.adCount,
        };
        StorageManager.instance.setItem(StorageKey.TravelSnapshot, JSON.stringify(snapshot));
        ArchiveManager.instance.scheduleUpload();
    }

    private restoreSnapshot(): boolean {
        const raw = StorageManager.instance.getItem(StorageKey.TravelSnapshot);
        if (!raw) return false;
        try {
            const snap = JSON.parse(raw) as TravelSnapshot;
            if (snap.version !== TRAVEL_DATA_VERSION || snap.levelKey !== this.levelKey() || snap.level !== this.level
                || !Array.isArray(snap.tiles) || snap.tiles.length !== this.tiles.length
                || !Array.isArray(snap.slotIds)) return false;
            const byId = new Map(snap.tiles.map(tile => [tile.id, tile]));
            if (byId.size !== this.tiles.length || snap.slotIds.some(id => !byId.has(id))
                || new Set(snap.slotIds).size !== snap.slotIds.length) return false;
            for (const tile of this.tiles) {
                const saved = byId.get(tile.id);
                if (!saved || !this.frames.has(saved.type) || ['board', 'slot', 'removed'].indexOf(saved.state) < 0) return false;
            }
            const stored = snap.tiles.filter(tile => tile.state === 'slot');
            if (stored.length !== snap.slotIds.length || snap.slotIds.some(id => byId.get(id)!.state !== 'slot')
                || stored.some(tile => stored.filter(other => other.type === tile.type).length >= 3)) return false;
            const cleared = snap.tiles.filter(tile => tile.state === 'removed').length / 3;
            // 旧版 6/7 格及更早的 9 格快照继续按原容量读取；新局为 5/6/7 格。
            const snapshotCapacity = snap.capacity === LEGACY_EXPANDED_CAPACITY
                ? LEGACY_EXPANDED_CAPACITY
                : snap.capacity === UNLOCKED_CAPACITY ? UNLOCKED_CAPACITY
                    : snap.capacity === NORMAL_CAPACITY + 1 ? NORMAL_CAPACITY + 1 : NORMAL_CAPACITY;
            if (!Number.isInteger(cleared) || stored.length > snapshotCapacity) return false;
            for (const tile of this.tiles) {
                const saved = byId.get(tile.id)!;
                tile.type = saved.type;
                tile.faceDown = !!saved.faceDown;
                tile.state = saved.state;
            }
            this.slots = snap.slotIds.map(id => this.tiles.find(tile => tile.id === id)!);
            this.undoLeft = this.safeCount(snap.undoLeft, 2);
            this.shuffleLeft = this.safeCount(snap.shuffleLeft, 1);
            this.magnetLeft = this.safeCount(snap.magnetLeft, 1);
            this.boxLeft = this.safeCount(snap.boxLeft, 1);
            this.capacity = snapshotCapacity;
            // 兼容旧旅行快照：消除数可从盘面还原，分数也按原版公式补齐。
            this.clearCount = cleared;
            this.comboTimes = cleared;
            this.iqValue = 40;
            for (let i = 0; i < cleared; i++) this.iqValue += Math.min(0.4 + i * 0.3, 3.1);
            this.iqValue = Math.round(this.iqValue * 10) / 10;
            this.elapsedTime = Number.isFinite(snap.elapsedTime) ? Math.max(0, snap.elapsedTime!) : 0;
            this.adCount = Number.isSafeInteger(snap.adCount) ? Math.max(0, snap.adCount!) : 0;
            return true;
        } catch (error) {
            console.warn('UITravelLayer: invalid travel snapshot', error);
            this.tiles.forEach(tile => { tile.state = 'board'; tile.faceDown = this.plan.tiles[tile.id].faceDown; tile.type = this.plan.tiles[tile.id].type; });
            this.slots = [];
            return false;
        }
    }

    private safeCount(value: number, max: number): number {
        return Number.isInteger(value) ? Math.max(0, Math.min(max, value)) : max;
    }

    private levelKey(): string {
        return `${this.plan.source?.boardHash || this.plan.layoutId}:${this.plan.source?.dataHash || ''}:${this.plan.deal?.algorithm || ''}`;
    }

    private closeDialog(): void {
        this.dialog?.destroy();
        this.dialog = null;
    }
}
