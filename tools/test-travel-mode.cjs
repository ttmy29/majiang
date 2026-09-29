/* Headless regression of the real travel component with deterministic Cocos timers.
 * node tools/test-travel-mode.cjs <path-to-cocos-typescript> [web-build-directory]
 * This checks gameplay/state and authored layout; it does not replace engine visual testing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '..');
const webBuild = process.argv[3] && path.resolve(process.argv[3]);
const ccSetters = [];
let now = 0;
let tasks = [];
const sounds = [];
const storage = new Map();
const popups = [];
const emitted = [];
const videoRequests = [];
const analyticsReports = [];
const dnTracks = [];
const mockWindow = { dnSDK: { track: (name, data) => dnTracks.push({ name, data }) } };
let homeCount = 0;
function schedule(owner, delay, fn) { tasks.push({ owner, at: now + delay, fn }); }
function advance(seconds) {
    const end = now + seconds;
    let iterations = 0;
    for (;;) {
        tasks.sort((a, b) => a.at - b.at);
        if (!tasks.length || tasks[0].at > end + 1e-9) break;
        assert.ok(++iterations < 10000, 'timer loop');
        const task = tasks.shift();
        now = task.at;
        task.fn();
    }
    now = end;
}
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
}
class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) { Object.assign(this, { r, g, b, a }); }
    clone() { return new Color(this.r, this.g, this.b, this.a); }
}
class Component {
    scheduleOnce(fn, delay = 0) { schedule(this, delay, () => fn.call(this)); }
    unscheduleAllCallbacks() { tasks = tasks.filter(task => task.owner !== this); }
}
class UITransform extends Component {
    width = 100; height = 100;
    anchorPoint = { x: 0.5, y: 0.5 };
    setAnchorPoint(x, y) { this.anchorPoint = { x, y }; }
    get contentSize() { return { width: this.width, height: this.height }; }
    setContentSize(w, h) { this.width = w.width ?? w; this.height = w.height ?? h; }
    convertToWorldSpaceAR(p) { const w = this.node.worldPosition; return new Vec3(w.x + p.x, w.y + p.y, 0); }
    convertToNodeSpaceAR(p) { const w = this.node.worldPosition; return new Vec3(p.x - w.x, p.y - w.y, 0); }
}
class Label extends Component {
    color = new Color(); outlineColor = new Color(); string = ''; enableOutline = false; outlineWidth = 0;
    static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 };
}
class Sprite extends Component { fillRange = 1; }
class Button extends Component { interactable = true; clickEvents = []; static EventType = { CLICK: 'click' }; }
class UIOpacity extends Component { opacity = 255; }
class Animation extends Component { play(name) { this.played = name; } stop() {} }
class MotionStreak extends Component { reset() { this.resetCount = (this.resetCount || 0) + 1; } }
class Graphics extends Component { rect() {} roundRect() {} fill() {} }
class Widget extends Component { enabled = true; }
class Node {
    static EventType = { TOUCH_END: 'touch-end' };
    constructor(name = '') {
        Object.assign(this, { name, children: [], components: [], events: new Map(), active: true,
            isValid: true, position: new Vec3(), scale: new Vec3(1, 1, 1), parent: null });
    }
    addChild(node) { node.removeFromParent(); node.parent = this; this.children.push(node); }
    removeFromParent() {
        if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent = null;
    }
    setParent(parent, preserve = false) {
        const world = this.worldPosition;
        parent.addChild(this);
        if (preserve) this.setPosition(world.x - parent.worldPosition.x, world.y - parent.worldPosition.y, 0);
    }
    setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? new Vec3(x.x, x.y, x.z) : new Vec3(x, y, z); }
    setScale(x, y, z = 1) { this.scale = typeof x === 'object' ? new Vec3(x.x, x.y, x.z) : new Vec3(x, y, z); }
    get worldPosition() { const p = this.parent?.worldPosition || new Vec3(); return new Vec3(p.x + this.position.x, p.y + this.position.y, 0); }
    get worldScale() { const p = this.parent?.worldScale || new Vec3(1, 1, 1); return new Vec3(p.x * this.scale.x, p.y * this.scale.y, p.z * this.scale.z); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    setSiblingIndex(index) {
        if (!this.parent) return;
        const siblings = this.parent.children;
        siblings.splice(siblings.indexOf(this), 1);
        siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, this);
    }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); return c; }
    getComponent(Type) { return this.components.find(c => c instanceof Type) || null; }
    getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean); }
    getChildByName(name) { return this.children.find(n => n.name === name) || null; }
    getChildByPath(name) { return name.split('/').reduce((n, part) => n?.getChildByName(part), this); }
    on(name, fn, owner) { this.events.set(name, () => fn.call(owner)); }
    emit(name) { this.events.get(name)?.(); }
    destroy() {
        this.isValid = false;
        tasks = tasks.filter(t => t.owner !== this && t.owner?.node !== this);
        for (const child of [...this.children]) child.destroy();
        this.removeFromParent();
    }
}
class FakeThreePopup extends Component {
    close() { this.node.emit('closed'); this.node.destroy(); }
}
class MahjongItem extends Component {
    static refreshLayerDisplayOrder(layer) { layer.orderRefreshes = (layer.orderRefreshes || 0) + 1; }
    motionStreakEnabled = false;
    setBoardScale() {} setTravelBoardStep(stepX, stepY) { this.travelBoardStepX = stepX; this.travelBoardStepY = stepY; }
    setData(type, row, col, layer, frame) {
        this.type = type;
        this.row = row; this.col = col; this.layer = layer;
        if (this.iconNode) this.iconNode.getComponent(Sprite).spriteFrame = frame;
    } playTapFeedback() {}
    disableTileTouch() { this.touchEnabled = false; } enableTileTouch() { this.touchEnabled = true; }
    setMotionStreakEnabled(enabled) { this.motionStreakEnabled = enabled; }
    setPlayable(value) { this.playable = value; }
}
const cc = new Proxy({ Vec3, Color, Component, Node, UITransform, Label, Sprite, Button, UIOpacity, Animation, MotionStreak, Graphics, Widget,
    cclegacy: { _RF: { push() {}, pop() {} } },
    Prefab: class {}, SpriteFrame: class {}, BlockInputEvents: class {},
    sp: { Skeleton: class {} },
    sys: { isBrowser: true, platform: 'WEB_DESKTOP', Platform: { WECHAT_GAME: 'WECHAT_GAME' } },
    _decorator: { ccclass: () => Type => Type, property: () => () => {} },
    director: { emit: (...args) => emitted.push(args) },
    game: { on() {}, off() {} }, Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' },
    view: { getVisibleSize: () => ({ width: 750, height: 1334 }) },
    Tween: { stopAllByTarget(target) { tasks = tasks.filter(t => t.owner !== target); } },
    tween(target) {
        let delay = 0;
        const steps = [];
        const chain = {
            to(duration, props) { delay += duration; steps.push({ at: delay, fn: () => Object.assign(target, props) }); return chain; },
            delay(duration) { delay += duration; return chain; },
            call(fn) { steps.push({ at: delay, fn }); return chain; },
            start() { steps.forEach(step => schedule(target, step.at, step.fn)); return chain; },
        };
        return chain;
    },
    instantiate: name => deserializePrefab(name),
}, { set(target, key, value) {
    target[key] = value;
    // System.register captures imports in setters; keep test doubles live when replaced.
    ccSetters.forEach(setter => setter(cc));
    return true;
} });
function deserializePrefab(name) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/game/prefab', `${name}.prefab`)));
    const nodes = new Map(data.map((value, index) => [index, value.__type__ === 'cc.Node' ? new Node(value._name) : null]));
    for (const [index, node] of nodes) {
        if (!node) continue;
        const value = data[index];
        node.active = value._active; node.setPosition(value._lpos); node.setScale(value._lscale);
        for (const child of value._children || []) node.addChild(nodes.get(child.__id__));
        for (const ref of value._components || []) {
            const record = data[ref.__id__];
            const Type = cc[record.__type__.replace('cc.', '')];
            if (!Type) continue;
            const component = node.addComponent(Type);
            if (record._contentSize) component.setContentSize(record._contentSize);
            if (record._enabled != null) component.enabled = record._enabled;
        }
    }
    const node = nodes.get(data[0].data.__id__);
    if (name === 'mahjongItem') node.addComponent(MahjongItem);
    return node;
}
const StorageKey = { TravelFaceCycles: 'travelFaceCycles', TravelSnapshot: 'travelSnapshot', TravelLevel: 'travelLevel', TravelReplayMode: 'travelReplayMode',
    TravelDailyUsage: 'travelDailyUsage', CurrentLevel: 'currentLevel', GlobalAdCount: 'globalAdCount' };
const AudioClipNames = new Proxy({}, { get: (_, key) => key });
const layerManager = {
    showToast() {}, showStartLayer() { homeCount++; },
    showUI(name, ...args) {
        const node = name === 'failureThree' ? deserializePrefab(name) : new Node(name);
        if (name === 'failureThree') node.addComponent(FakeThreePopup);
        popups.push({ name, args, node }); return node;
    },
};
const imports = {
    cc,
    './config/Constants': { Constants: { MahjongBoard: { BoardScale: 1 }, eventNames: { EventWinNextLevel: 'main-next', EventSetIQLabelVisible: 'iq-visible', EventMainLevelGiveUp: 'main-give-up' } } },
    './config/TravelLevelLoader': { ensureTravelLevel: async level => {
        const filename = fs.readdirSync(path.join(root, 'assets/config_levels_travel')).find(file => {
            const m = /^levels_(\d+)_(\d+)\.json$/.exec(file);
            return m && level >= +m[1] && level <= +m[2];
        });
        const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/config_levels_travel', filename)));
        return data.levels.find(plan => plan.level === level);
    } },
    './MahjongItem': { MahjongItem },
    './manager/ArchiveManager': { ArchiveManager: { instance: { scheduleUpload() {} } } },
    './manager/DesktopShortcutManager': { DesktopShortcutManager: { instance: { initialize() {}, shouldShowRedPoint() { return false; } } } },
    './manager/AudioManager': { AudioClipNames, AudioManager: { instance: {
        playClick() {}, playOneShot(name) { sounds.push(name); },
        playOneShotDuckingBgm(name) { sounds.push(name); }, pause() {}, play() {},
    } } },
    './manager/LayerManager': { LayerManager: { instance: layerManager }, LayerType: { Start: 'startLayer' } },
    './manager/SliderBarManager': { SliderBarManager: { instance: { initialize() {}, isKwai() { return false; } } } },
    './UigmLayer': { UigmLayer: { show() { return null; } } },
    './UIThreePopup': { ThreePopupEvent: { Closed: 'closed', ReviveRequested: 'revive-requested' }, UIThreePopup: FakeThreePopup },
    './manager/StorageManager': { StorageKey, StorageManager: { instance: {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    } } },
    '../../loading/SDKManager': { SDKEvent: { level: 'level', prop: 'prop' }, SDKManager: { instance: {
        showVideoAd: (success, failure, key) => videoRequests.push({ success, failure, key }),
        report: data => analyticsReports.push(data),
    } } },
    './manager/StreakManager': {},
    './util/Utils': {},
    './config/GameMode': { getCurrentGameMode: () => 'main' },
    './config/LevelJsonLoader': {},
};
function loadWebTravel() {
    const modules = new Map();
    const cache = new Map();
    const context = vm.createContext({ console, window: mockWindow, System: { register(name, deps, factory) {
        if (typeof name !== 'string') {
            // Creator wraps shared chunk registrations in an anonymous package.
            deps(() => {}, {}).execute();
        } else modules.set(name, { deps, factory });
    } } });
    for (const directory of ['src/chunks', 'assets/game']) {
        for (const name of fs.readdirSync(path.join(webBuild, directory)).filter(name => /^(bundle|index).*\.js$/.test(name))) {
            vm.runInContext(fs.readFileSync(path.join(webBuild, directory, name), 'utf8'), context, { filename: name });
        }
    }
    // ES5 bundles invoke Component.call(this), unlike native ES2017 subclasses.
    const CompiledComponent = function () {};
    CompiledComponent.prototype = Component.prototype;
    cc.Component = CompiledComponent;
    function instantiateModule(name) {
        if (cache.has(name)) return cache.get(name);
        const record = modules.get(name);
        assert.ok(record, `missing built module ${name}`);
        const exports = {};
        cache.set(name, exports);
        const module = record.factory((key, value) => {
            if (typeof key === 'object') Object.assign(exports, key);
            else exports[key] = value;
            return typeof key === 'object' ? key : value;
        }, {});
        record.deps.forEach((dependency, index) => {
            const setter = module.setters[index];
            if (dependency === 'cc') {
                ccSetters.push(setter);
                setter(cc);
            } else if (dependency.includes('BabelHelpers')) {
                setter(instantiateModule(`chunks:///_virtual/${path.basename(dependency)}`));
            } else {
                const basename = path.basename(dependency, '.ts');
                const key = Object.keys(imports).find(key => path.basename(key) === basename);
                assert.ok(key, `unmocked built import ${dependency}`);
                setter(imports[key]);
            }
        });
        module.execute();
        return exports;
    }
    return instantiateModule('chunks:///_virtual/UITravelLayer.ts');
}
function load(file) {
    if (webBuild && file === 'assets/game/script/UITravelLayer.ts') return loadWebTravel();
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } });
    const exports = {};
    vm.runInNewContext(result.outputText, { exports, console, window: mockWindow, require(name) {
        assert.ok(imports[name], `unmocked import ${name}`); return imports[name];
    } }, { filename: file });
    return exports;
}
imports['../config/Constants'] = imports['./config/Constants'];
imports['./ArchiveManager'] = imports['./manager/ArchiveManager'];
imports['./StorageManager'] = imports['./manager/StorageManager'];
imports['./config/TravelLevels'] = load('assets/game/script/config/TravelLevels.ts');
imports['./manager/ProgressManager'] = load('assets/game/script/manager/ProgressManager.ts');
const { ProgressManager } = imports['./manager/ProgressManager'];
// UI entrance integration; the real popup-ad pipeline is tested in test-travel-recovery.cjs.
let openRecovery = null;
imports['./manager/TravelRecoveryManager'] = { TravelRecoveryManager: { show(onRecovered) {
    if (openRecovery?.isValid) return openRecovery;
    const node = layerManager.showUI('recoverCount');
    openRecovery = node;
    let pending = false;
    node.request = () => {
        if (pending || !node.isValid) return;
        pending = true;
        imports['../../loading/SDKManager'].SDKManager.instance.showVideoAd(() => {
            if (!pending || !node.isValid) return;
            pending = false;
            ProgressManager.refillTravelAttempts();
            node.destroy(); openRecovery = null;
            onRecovered?.();
        }, () => {
            if (!pending || !node.isValid) return;
            pending = false;
        }, 'travel_attempts');
    };
    return node;
} } };

const { MAX_TRAVEL_LEVEL, TRAVEL_DATA_VERSION, isTravelBlocked } = imports['./config/TravelLevels'];
const { UITravelLayer } = load('assets/game/script/UITravelLayer.ts');
function create(types = ['1', '1', '1', '2', '2', '2', '3', '3', '3']) {
    tasks = []; now = 0; sounds.length = 0; popups.length = 0; storage.clear();
    const game = new UITravelLayer();
    game.node = deserializePrefab('gameLayerThree'); game.onLoad();
    game.plan = { width: 7, height: 6, difficulty: 'normal', tiles: types.map((type, id) => ({ id, type, row: Math.floor(id / 7), col: id % 7, layer: 0, faceDown: false })) };
    game.tiles = game.plan.tiles.map(tile => ({ ...tile, state: 'board', node: null, item: null }));
    game.frames = new Map(['1', '2', '3', '4', '5', '6', '7', '8'].map(type => [type, {}]));
    game.baseFrames = new Map(game.frames);
    game.tilePrefab = 'mahjongItem'; game.state = 'playing';
    game.effectPrefabs = new Map(['glow', 'huaban', 'addIQCount'].map(name => [name, name]));
    game.renderBoard(); game.refreshHud(); game.saveSnapshot();
    return game;
}
function tap(game, id) { game.tapTile(game.tiles[id]); advance(3); }

async function main() {
    let game = create();
    const larger = create(['1', '2', '3']);
    larger.plan.width = 3; larger.plan.height = 3;
    larger.plan.centerCol = 1; larger.plan.centerRow = 1;
    larger.tiles.forEach((tile, index) => { tile.row = index; });
    larger.renderBoard();
    const originalStepX = larger.boardStepX, originalStepY = larger.boardStepY;
    const enlargedPrefab = deserializePrefab('mahjongItem');
    const visualWidth = 149 * 1.3, visualHeight = 186 * 1.3;
    enlargedPrefab.getChildByName('bg').getComponent(UITransform).setContentSize(visualWidth, visualHeight);
    larger.tilePrefab = { data: enlargedPrefab };
    const originalInstantiate = cc.instantiate;
    cc.instantiate = () => {
        const node = deserializePrefab('mahjongItem');
        node.getChildByName('bg').getComponent(UITransform).setContentSize(visualWidth, visualHeight);
        return node;
    };
    larger.renderBoard();
    cc.instantiate = originalInstantiate;
    assert.ok(larger.boardStepX > originalStepX, 'enlarging the visual spreads horizontal positions');
    assert.ok(larger.boardStepY > originalStepY, 'enlarging the visual spreads vertical positions');
    assert.equal(larger.tiles[0].node.position.x, -larger.boardStepX);
    assert.equal(larger.tiles[2].node.position.x, larger.boardStepX);
    assert.equal(larger.tiles[0].node.position.y, -larger.boardStepY);
    assert.equal(larger.tiles[2].node.position.y, larger.boardStepY);
    const bodyWidth = visualWidth * 146 / 155, bodyHeight = visualHeight * 180 / 188;
    const horizontalPitch = larger.boardStepX / (bodyWidth * larger.boardTileScale);
    const verticalPitch = larger.boardStepY / (bodyHeight * larger.boardTileScale);
    assert.ok(Math.abs(horizontalPitch - 1) < 1e-9, 'horizontal faces meet with no added gap');
    assert.ok(Math.abs(verticalPitch - 174 / 180) < 1e-9, 'lower faces cover the upper body bevel without stretching the image');
    for (const tile of larger.tiles) {
        const hitArea = tile.node.getComponent(UITransform);
        assert.ok(Math.abs(hitArea.width - bodyWidth) < 1e-9, 'the touch rect excludes transparent image padding');
        assert.ok(Math.abs(hitArea.height - bodyHeight) < 1e-9);
        assert.ok(Math.abs(hitArea.width * hitArea.anchorPoint.x - visualWidth * 74.5 / 155) < 1e-9,
            'touch bounds start at the visible left edge instead of transparent padding');
        assert.ok(Math.abs(hitArea.height * hitArea.anchorPoint.y - visualHeight * 88 / 188) < 1e-9,
            'touch bounds start at the visible bottom edge instead of transparent padding');
        const body = tile.node.getChildByName('bg').getComponent(UITransform);
        assert.equal(body.width, visualWidth, 'tight spacing must not stretch the original card image');
        assert.equal(body.height, visualHeight);
        assert.equal(tile.item.travelBoardStepX, larger.boardStepX);
        assert.equal(tile.item.travelBoardStepY, larger.boardStepY);
    }
    console.log('PASS enlarged faces update board spacing and touch bounds together');
    const packed = new UITravelLayer();
    packed.node = new Node('packedTravel');
    const packedFaces = ['1', '2', '3', 'flip'].map(() => ({ name: 'spriteFrame' }));
    const packedPaths = ['1', '2', '3', 'flip'].map(id => `resources/mahjong/${id}/spriteFrame`);
    const alternate = ['mahjong1', 'mahjong2'].map(folder => ({
        frame: { name: 'spriteFrame', folder }, path: `resources/${folder}/2/spriteFrame`,
    }));
    cc.assetManager = { getBundle: () => ({
        load(_path, _type, done) { done(null, 'mahjongItem'); },
        loadDir(resourcePath, _type, done) {
            if (resourcePath === 'resources/mahjong') done(null, packedFaces, packedPaths);
            else {
                const folder = alternate.find(value => resourcePath === `resources/${value.frame.folder}`);
                assert.ok(folder, 'travel only loads both alternate face folders');
                done(null, [folder.frame], [folder.path]);
            }
        },
    }) };
    imports['./config/Constants'].Constants.GameBundleName = 'game';
    imports['./config/Constants'].Constants.MahjongBoard.ResourceDir = 'resources/mahjong';
    let enteredPackedLevel = false;
    packed.startLevel = async () => { enteredPackedLevel = true; };
    await packed.loadResources();
    assert.equal(enteredPackedLevel, true, 'packed frame names must not block travel entry');
    assert.equal(packed.frames.get('1'), packedFaces[0]);
    assert.equal(packed.frames.get('3'), packedFaces[2]);
    assert.equal(packed.frames.get('flip'), packedFaces[3]);
    assert.equal(packed.alternateFrames.get('mahjong1').get('2'), alternate[0].frame);
    assert.equal(packed.alternateFrames.get('mahjong2').get('2'), alternate[1].frame);
    cc.assetManager = undefined;
    console.log('PASS packaged sprite-frame names are indexed by resource path');
    {
        storage.clear();
        const base = new Map(packed.frames);
        packed.baseFrames = base;
        // 一个五关循环只生成一次方案，但每关独立从默认/mahjong1/mahjong2 中选择。
        const samples = [0, 0.4, 0.8, 0.1, 0.7];
        let roll = 0;
        const first = packed.faceCycleForLevel(1, () => samples[roll++]);
        assert.deepEqual(Array.from(first.choices), ['default', 'mahjong1', 'mahjong2', 'default', 'mahjong2']);
        assert.equal(roll, 5, 'five choices are drawn once for each cycle');
        const facePlan = { tiles: ['1', '2', '3', '2'].map(type => ({ type })) };
        const frameFor = { default: base.get('2'), mahjong1: alternate[0].frame, mahjong2: alternate[1].frame };
        for (let level = 1; level <= 5; level++) {
            assert.deepEqual(Array.from(packed.faceCycleForLevel(level).choices), Array.from(first.choices));
            packed.applyFaceCycle(level, facePlan, () => 0);
            assert.equal(packed.frames.get('2'), frameFor[first.choices[level - 1]]);
            assert.equal(packed.frames.get('1'), base.get('1'), 'unselected tile types retain their own art');
            assert.equal(packed.frames.get('flip'), base.get('flip'), 'card back never changes');
        }
        assert.equal(Object.keys(packed.faceCycleForLevel(2).faceMappings[1]).length, 1,
            'even a small board replaces at least one distinct tile type');
        const savedCycles = storage.get(StorageKey.TravelFaceCycles);
        const reopened = new UITravelLayer();
        reopened.baseFrames = base;
        reopened.alternateFrames = packed.alternateFrames;
        assert.deepEqual(Array.from(reopened.faceCycleForLevel(1, () => { throw new Error('should not redraw'); }).choices),
            Array.from(first.choices), 'reentry/retry keeps all five choices');
        assert.equal(storage.get(StorageKey.TravelFaceCycles), savedCycles, 'retry does not rewrite the cycle');
        const second = reopened.faceCycleForLevel(6, () => 0.99);
        assert.deepEqual(Array.from(second.choices), Array(5).fill('mahjong2'), 'next cycle draws five new choices');
        for (let level = 6; level <= 10; level++) {
            reopened.applyFaceCycle(level, facePlan, () => 0);
            assert.equal(reopened.frames.get('2'), alternate[1].frame);
        }
        reopened.alternateFrames.set('mahjong2', new Map());
        reopened.applyFaceCycle(6, facePlan);
        assert.equal(reopened.frames.get('2'), base.get('2'), 'missing alternative image falls back to base');
        storage.set(StorageKey.TravelFaceCycles, '{invalid');
        assert.equal(reopened.faceCycleForLevel(1).choices.length, 5, 'corrupt selection is recoverable');
        storage.set(StorageKey.TravelFaceCycles, JSON.stringify({ 0: { folder: 'mahjong1', offsets: [0, 1, 2] } }));
        assert.equal(reopened.faceCycleForLevel(1, () => 0).choices[0], 'default', 'older saved selection is regenerated');

        // 十种实际牌型抽取两种；不同牌型不能使用同一张替换图。
        const diverse = new UITravelLayer();
        const types = Array.from({ length: 10 }, (_, index) => String(index + 1));
        diverse.baseFrames = new Map(types.map(type => [type, { type }]));
        diverse.baseFrames.set('flip', base.get('flip'));
        diverse.alternateFrames.set('mahjong1', new Map(Array.from({ length: 4 }, (_, index) => {
            const id = String(5001 + index); return [id, { id }];
        })));
        const diversePlan = { tiles: [...types, ...types].map(type => ({ type })) };
        storage.set(StorageKey.TravelFaceCycles, JSON.stringify({ 0: { choices: ['mahjong1', 'default', 'default', 'default', 'default'] } }));
        diverse.applyFaceCycle(1, diversePlan, () => 0);
        const mapping = diverse.faceCycleForLevel(1).faceMappings[0];
        assert.equal(Object.keys(mapping).length, 2, 'one fifth of ten distinct types is replaced');
        assert.equal(new Set(Object.values(mapping)).size, 2, 'the replacement images are not reused');
        for (const type of types) {
            const sourceId = mapping[type];
            assert.equal(diverse.frames.get(type), sourceId
                ? diverse.alternateFrames.get('mahjong1').get(sourceId) : diverse.baseFrames.get(type));
        }
        const reentered = new UITravelLayer();
        reentered.baseFrames = diverse.baseFrames;
        reentered.alternateFrames = diverse.alternateFrames;
        reentered.applyFaceCycle(1, diversePlan, () => { throw new Error('saved face mapping must not redraw'); });
        assert.deepEqual({ ...reentered.faceCycleForLevel(1).faceMappings[0] }, { ...mapping });
        assert.equal(reentered.frames.get(Object.keys(mapping)[0]), diverse.frames.get(Object.keys(mapping)[0]));
        reentered.applyFaceCycle(2, diversePlan);
        assert.ok(types.every(type => reentered.frames.get(type) === diverse.baseFrames.get(type)),
            'the default choice does not replace any tile type');
        storage.clear();
    }
    console.log('PASS five-level choices and per-level one-fifth distinct face mapping persist without reuse');
    const loaded = new UITravelLayer();
    loaded.node = new Node('loadedTravel');
    const faceIds = [
        ...Array.from({ length: 9 }, (_, i) => `${1001 + i}`),
        ...Array.from({ length: 9 }, (_, i) => `${2001 + i}`),
        ...Array.from({ length: 9 }, (_, i) => `${3001 + i}`),
        ...Array.from({ length: 7 }, (_, i) => `${4001 + i}`),
        ...Array.from({ length: 4 }, (_, i) => `${5001 + i}`),
        ...Array.from({ length: 4 }, (_, i) => `${6001 + i}`),
        'flip', 'chain', 'iron1', 'iron2', 'motionStreak', 'yinying',
    ];
    const loadedFaces = faceIds.map(name => ({ name }));
    assert.equal(loadedFaces.length, 48);
    cc.assetManager = { getBundle: () => ({
        load(_path, _type, done) { done(null, 'mahjongItem'); },
        loadDir(_path, _type, done) { done(null, loadedFaces); },
    }) };
    let enteredLoadedLevel = false;
    loaded.startLevel = async () => { enteredLoadedLevel = true; };
    await loaded.loadResources();
    assert.equal(loaded.frames.size, 43, '42 numeric faces and the flip face are indexed');
    assert.equal(enteredLoadedLevel, true, 'empty loadDir paths do not indicate missing faces');
    // Creator 的 web-mobile 宽松展开曾将 [...map.keys()] 变成 [].concat(map.keys())，误判为 0 张牌。
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/game/script/UITravelLayer.ts'), 'utf8'),
        /\[\s*\.\.\.this\.frames\.keys\(\)\s*\]/, 'resource gate must not spread a Map iterator');
    cc.assetManager = undefined;
    console.log('PASS 48 loaded faces with 43 indexed faces enter travel level');
    const authored = deserializePrefab('gameLayerThree');
    const boardArea = game.board.parent;
    const slotArea = game.node.getChildByName('slotNode');
    const downArea = game.node.getChildByName('down');
    const boardHalfHeight = boardArea.getComponent(UITransform).height / 2;
    const topGap = slotArea.position.y - slotArea.getComponent(UITransform).height / 2
        - (boardArea.position.y + boardHalfHeight);
    const bottomGap = boardArea.position.y - boardHalfHeight
        - (downArea.position.y + downArea.getComponent(UITransform).height / 2);
    assert.ok(topGap >= 25 && bottomGap >= 25, 'the travel board keeps clearance from tray and buttons');
    assert.ok(Math.abs(topGap - bottomGap) < 2, 'board area is centered between top and bottom UI');
    for (const name of ['slotNode', 'slotNode/slotNode', 'pNode', 'pNode/pNode', 'down', 'iqLabel', 'levelLabel', 'Game_btn_shezhi']) {
        const actual = game.node.getChildByPath(name), expected = authored.getChildByPath(name);
        assert.deepEqual(actual.position, expected.position, `${name} position`);
        assert.deepEqual(actual.scale, expected.scale, `${name} scale`);
        const expectedSize = name === 'pNode/pNode'
            ? authored.getChildByPath('pNode').getComponent(UITransform).contentSize
            : expected.getComponent(UITransform).contentSize;
        assert.deepEqual(actual.getComponent(UITransform).contentSize, expectedSize, `${name} size`);
        assert.equal(actual.active, expected.active, `${name} visibility`);
    }
    const down = game.node.getChildByName('down');
    assert.equal(down.getChildByName('button4').active, false);
    assert.deepEqual(down.children.filter(n => n.name === 'button').map(n => n.position.x), [-200, 0, 200]);
    assert.equal(game.node.getChildByName('iqLabel').getChildByName('icon').active, true);
    assert.equal(game.node.getChildByName('iqLabel').getComponent(Label).string, '40');
    console.log('PASS authored layout, three-button arrangement and IQ icon');
    // 五格默认开放；两个占位按钮必须按顺序完成视频后才能使用第六、第七格。
    assert.equal(game.capacity, 5);
    const lock1 = game.node.getChildByPath('slotNode/lock1');
    const lock2 = game.node.getChildByPath('slotNode/lock2');
    assert.equal(lock1.active, true); assert.equal(lock2.active, true);
    assert.equal(lock1.getComponent(Button).interactable, true);
    assert.equal(lock2.getComponent(Button).interactable, false);
    lock2.events.get(Button.EventType.CLICK)();
    assert.equal(videoRequests.length, 0, 'second lock cannot skip the first');
    lock1.events.get(Button.EventType.CLICK)();
    assert.equal(videoRequests.length, 1);
    assert.equal(videoRequests[0].key, 'travel_slot_unlock');
    lock1.events.get(Button.EventType.CLICK)();
    assert.equal(videoRequests.length, 1, 'pending video cannot be duplicated');
    videoRequests[0].failure();
    assert.equal(sounds.filter(sound => sound === 'pageOpen').length, 0, 'failed video has no unlock sound');
    assert.equal(game.capacity, 5); assert.equal(lock1.active, true);
    assert.equal(analyticsReports.filter(event => event.cid === 'travel_prop_use').length, 0,
        'failed ad does not report item use');
    assert.equal(ProgressManager.loadGlobalAdCount(), 0, 'failed ad does not count');
    videoRequests[0].success();
    assert.equal(game.capacity, 5, 'a late success from a failed ad cannot unlock a slot');
    assert.equal(lock1.getComponent(Button).interactable, true);
    lock1.events.get(Button.EventType.CLICK)();
    videoRequests[1].success();
    assert.equal(sounds.filter(sound => sound === 'pageOpen').length, 1, 'first unlock plays slot sound');
    assert.equal(game.capacity, 6); assert.equal(lock1.active, false);
    assert.equal(lock2.getComponent(Button).interactable, true);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).capacity, 6);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).adCount, 1);
    assert.equal(ProgressManager.loadGlobalAdCount(), 1);
    assert.ok(analyticsReports.some(event => event.cid === 'travel_prop_use' && event.propName === 'slot_unlock'
        && event.level === 10001 && event.type === 2 && event.remaining === 1));
    assert.ok(analyticsReports.some(event => event.event === 'level' && event.type === 4 && event.level === 10001));
    assert.equal(dnTracks.filter(event => event.name === 'USE_ITEM').length, 1);
    lock2.events.get(Button.EventType.CLICK)();
    videoRequests[2].success();
    assert.equal(sounds.filter(sound => sound === 'pageOpen').length, 2, 'second unlock plays slot sound');
    assert.equal(game.capacity, 7); assert.equal(lock2.active, false);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).capacity, 7);
    assert.equal(ProgressManager.loadGlobalAdCount(), 2);
    assert.equal(analyticsReports.filter(event => event.cid === 'travel_prop_use' && event.propName === 'slot_unlock').length, 2);
    const unlockedSave = storage.get(StorageKey.TravelSnapshot);
    game = create(); storage.set(StorageKey.TravelSnapshot, unlockedSave); game.restoreSnapshot();
    game.refreshHud();
    assert.equal(game.capacity, 7);
    assert.equal(game.adCount, 2, 'restored run keeps its completed video count');
    assert.equal(game.slotLocks[0].active, false); assert.equal(game.slotLocks[1].active, false);
    const reportsBeforeDuplicateUnlock = analyticsReports.length;
    videoRequests[2].success();
    assert.equal(game.capacity, 7, 'duplicate SDK success does not over-expand tray');
    assert.equal(analyticsReports.length, reportsBeforeDuplicateUnlock, 'duplicate SDK success does not report twice');
    game = create();
    assert.equal(game.capacity, 5); assert.equal(game.slotLocks[0].active, true);
    assert.equal(game.slotLocks[1].getComponent(Button).interactable, false);
    game = create(['1', '2', '3', '4', '5', '6', '7', '8']);
    for (let id = 0; id < 5; id++) tap(game, id);
    assert.equal(game.slots.length, 5); assert.equal(game.state, 'fail', 'five slots trigger failure by default');
    console.log('PASS sequential video unlock, failure retry, duplicate guard and saved capacity');
    analyticsReports.length = 0;
    game = create();
    assert.equal(game.undo(), false, 'empty tray cannot consume undo');
    assert.equal(analyticsReports.length, 0, 'failed item action has no report');
    tap(game, 0);
    assert.equal(game.undo(), true);
    game = create(); game.shuffle();
    game = create(); game.magnet();
    assert.deepEqual(analyticsReports.filter(event => event.cid === 'travel_prop_use').map(event =>
        [event.propName, event.count, event.remaining, event.level]), [
        ['undo', 1, 1, 10001], ['shuffle', 1, 0, 10001], ['magnet', 1, 0, 10001],
    ], 'successful travel props report one consumption with remaining count');
    console.log('PASS travel item use reports only after a successful action');
    game = create();


    tap(game, 0);
    assert.equal(game.busy, false, 'first collected tile releases the input lock');
    assert.equal(game.tiles[0].node.parent, game.tray, 'first tile reaches the tray');
    assert.equal(game.canPlay(), true, 'tiles and props respond after collection');
    tap(game, 1);
    const snapshotBefore = storage.get(StorageKey.TravelSnapshot);
    game.tapTile(game.tiles[2]);
    assert.equal(game.busy, true);
    game.tapTile(game.tiles[3]); game.magnet(); game.shuffle(); game.undo();
    assert.equal(game.tiles[3].state, 'board');
    assert.equal(game.magnetLeft, 1); assert.equal(game.shuffleLeft, 1); assert.equal(game.undoLeft, 2);
    game.onGameHide();
    assert.equal(storage.get(StorageKey.TravelSnapshot), snapshotBefore, 'no half-animated save');
    game.onGameShow();
    advance(0.22);
    assert.equal(game.slots.length, 3, 'three tiles still visible before impact');
    assert.equal(game.iqValue, 40);
    advance(0.22);
    assert.equal(game.slots.length, 3, 'clear effect precedes tile removal');
    assert.equal(game.iqValue, 40.4);
    assert.ok(sounds.includes('mahjong_merge_sd'));
    assert.ok([...game.effects].some(node => ['glow', 'huaban'].includes(node.name)));
    advance(0.12);
    assert.equal(game.slots.length, 0);
    advance(0.16);
    assert.equal(game.busy, false);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).iq, 40.4);
    tap(game, 3); tap(game, 4); tap(game, 5);
    assert.equal(game.iqValue, 41.1);
    assert.equal(game.comboTimes, 2);
    tap(game, 6); tap(game, 7);
    game.elapsedTime = 21.5; game.tapTile(game.tiles[8]);
    advance(0.72);
    assert.equal(game.iqValue, 42.1); assert.equal(game.comboTimes, 3);
    assert.ok(sounds.includes('combo_level1'));
    assert.equal(popups.length, 0, 'wait for final effect before win');
    assert.ok(JSON.parse(storage.get(StorageKey.TravelSnapshot)).tiles.every(tile => tile.state === 'removed'));
    advance(0.65);
    assert.equal(popups[0].name, 'win');
    assert.equal(popups[0].args[0].iq, 42.1);
    assert.equal(popups[0].args[0].time, 21.5);
    assert.equal(popups[0].args[0].comboTimes, 3);
    assert.ok(dnTracks.some(event => event.name === 'LEVEL_PASS' && event.data.level_id === 10001
        && event.data.duration === 22 && event.data.ad_cnt === 0));
    assert.equal(storage.get(StorageKey.TravelLevel), 2);
    assert.equal(storage.has(StorageKey.TravelSnapshot), false);
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'finishing level 1 does not consume an attempt');
    game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'duplicate settlement cannot consume an attempt');
    game.frames = new Map(['1', '2', '3', ...Array.from({ length: 40 }, (_, i) => `${i}`)].map(type => [type, {}]));
    let nextLevel = 0;
    game.startLevel = () => { nextLevel = game.level; };
    popups[0].args[1](); assert.equal(nextLevel, 2);
    console.log('PASS animation phases, input lock, merge sound, IQ, combo and win data/continuation');
    game = create();
    for (let i = 0; i < 5; i++) ProgressManager.consumeTravelAttempt();
    assert.equal(ProgressManager.loadTravelRemaining(), 0);
    game.level = 1;
    game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 0, 'finishing free level 1 at zero attempts stays at zero');
    assert.equal(storage.get(StorageKey.TravelLevel), 2, 'free completion advances to level 2');
    assert.equal(popups[0].name, 'win');
    console.log('PASS first travel level is free even when all daily attempts are spent');


    game = create(['1', '1', '1', '2', '3', '4', '5', '6']);
    game.capacity = 6; game.refreshHud();
    tap(game, 0); tap(game, 1);
    game.tapTile(game.tiles[2]);
    advance(0.22);
    assert.equal(game.resolvingTileIds.size, 3, 'the matched tiles are protected once elimination starts');
    assert.equal(game.canTapTile(), true, 'tile input reopens during elimination while the tray has room');
    for (let id = 3; id <= 6; id++) game.tapTile(game.tiles[id]);
    assert.equal(game.slots.length, game.capacity, 'rapid taps reserve every available tray position immediately');
    game.tapTile(game.tiles[7]);
    assert.equal(game.tiles[7].state, 'board', 'a tile cannot enter after all tray positions are reserved');
    advance(0.34);
    assert.equal(game.slots.length, 3, 'the matched triple frees its tray positions before the settle animation ends');
    assert.equal(game.canTapTile(), true, 'tile input stays open while the remaining tray tiles settle');
    game.tapTile(game.tiles[7]);
    assert.equal(game.tiles[7].state, 'slot', 'a newly freed tray position can be used immediately');
    advance(1);
    assert.equal(game.slots.length, 4, 'newly collected tiles remain after the earlier triple is removed');
    assert.equal(game.tiles[3].node.parent, game.tray, 'a tile tapped during elimination finishes rising into the tray');
    assert.equal(game.state, 'playing');
    assert.equal(game.busy, false);
    console.log('PASS elimination keeps tile input open until all tray positions are reserved');

    game = create();
    game.magnet(); advance(3);
    assert.equal(game.magnetLeft, 0); assert.equal(game.clearCount, 1);
    assert.equal(game.slots.length, 0); assert.equal(game.busy, false);
    const saved = storage.get(StorageKey.TravelSnapshot);
    game = create(); storage.set(StorageKey.TravelSnapshot, saved); game.restoreSnapshot();
    assert.equal(game.iqValue, 40.4); assert.equal(game.comboTimes, 1); assert.equal(game.magnetLeft, 0);
    const legacy = JSON.parse(saved); delete legacy.iq; delete legacy.clearCount; delete legacy.comboTimes;
    game = create(); storage.set(StorageKey.TravelSnapshot, JSON.stringify(legacy)); game.restoreSnapshot();
    assert.equal(game.iqValue, 40.4); assert.equal(game.comboTimes, 1);
    legacy.slotIds = [3, 3]; legacy.tiles[3].state = 'slot';
    game = create(); storage.set(StorageKey.TravelSnapshot, JSON.stringify(legacy)); game.restoreSnapshot();
    assert.equal(game.slots.length, 0); assert.equal(game.clearCount, 0);
    console.log('PASS magnet uses shared pipeline, current/legacy save restoration, malformed save rejection');

    game = create(['1', '2', '3', '4', '5', '6', '7', '8']);
    for (let i = 0; i < 5; i++) tap(game, i);
    assert.equal(game.state, 'fail'); assert.equal(game.clearCount, 0);
    assert.equal(game.dialog.name, 'failureThree', 'full tray uses the new failure popup');
    assert.ok(sounds.includes('game_lose'), 'new failure popup plays the loss sound');
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'failure does not consume an attempt');
    const failedPopup = game.dialog;
    assert.ok(failedPopup.getChildByPath('view/close').getComponent(Button), 'close image is clickable');
    videoRequests.length = 0;
    failedPopup.emit('revive-requested');
    assert.equal(videoRequests.length, 1);
    assert.equal(videoRequests[0].key, 'travel_revive');
    failedPopup.emit('revive-requested');
    assert.equal(videoRequests.length, 1, 'pending revive ad cannot queue twice');
    videoRequests[0].failure();
    assert.equal(game.state, 'fail'); assert.equal(game.dialog, failedPopup);
    assert.equal(ProgressManager.loadGlobalAdCount(), 0, 'failed revive video is not counted');
    assert.equal(failedPopup.getChildByPath('view/reviveButton').getComponent(Button).interactable, true);
    videoRequests[0].success();
    assert.equal(game.state, 'fail', 'late completion of a failed ad cannot revive');
    failedPopup.emit('revive-requested');
    assert.equal(videoRequests.length, 2);
    videoRequests[1].success();
    assert.equal(game.state, 'playing'); assert.equal(game.dialog, null);
    assert.equal(ProgressManager.loadGlobalAdCount(), 1, 'successful revive video is counted');
    assert.equal(game.slots.length, 0, 'revive returns the stored tiles to the board');
    assert.ok(game.tiles.slice(0, 5).every(tile => tile.state === 'board'));
    assert.equal(game.capacity, 6, 'first revive unlocks the sixth slot');
    assert.equal(game.slotLocks[0].active, false);
    assert.equal(game.slotLocks[1].active, true);
    assert.equal(game.slotLocks[1].getComponent(Button).interactable, true);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).capacity, 6);
    assert.equal(game.undoLeft, 2); assert.equal(game.iqValue, 40);
    videoRequests[1].success();
    assert.equal(game.state, 'playing', 'duplicate ad callback cannot revive again');
    assert.equal(ProgressManager.loadGlobalAdCount(), 1, 'duplicate revive callback is not counted twice');
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'revive does not consume an attempt');
    for (let i = 0; i < 6; i++) tap(game, i);
    assert.equal(game.state, 'fail');
    assert.equal(game.capacity, 6, 'previously unlocked slot persists across failures');
    videoRequests.length = 0;
    game.dialog.emit('revive-requested');
    videoRequests[0].success();
    assert.equal(game.state, 'playing');
    assert.equal(game.slots.length, 0);
    assert.equal(game.capacity, 7, 'second revive unlocks the seventh slot');
    assert.equal(game.slotLocks[0].active, false);
    assert.equal(game.slotLocks[1].active, false);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelSnapshot)).capacity, 7);
    for (let i = 0; i < 7; i++) tap(game, i);
    assert.equal(game.state, 'fail');
    videoRequests.length = 0;
    game.dialog.emit('revive-requested');
    videoRequests[0].success();
    assert.equal(game.state, 'playing');
    assert.equal(game.capacity, 7, 'revive at max capacity only withdraws the tray tiles');
    assert.equal(game.slots.length, 0);
    assert.ok(game.tiles.slice(0, 7).every(tile => tile.state === 'board'));
    const maxedSave = storage.get(StorageKey.TravelSnapshot);
    game = create(['1', '2', '3', '4', '5', '6', '7', '8']);
    storage.set(StorageKey.TravelSnapshot, maxedSave);
    assert.equal(game.restoreSnapshot(), true);
    game.refreshHud();
    assert.equal(game.capacity, 7, 'saved revive unlocks survive reopening');
    assert.equal(game.slotLocks[0].active, false);
    assert.equal(game.slotLocks[1].active, false);
    game = create(['1', '2', '3', '4', '5', '6', '7', '8']);
    for (let i = 0; i < 5; i++) tap(game, i);
    const homeBeforeClose = homeCount;
    const closedPopup = game.dialog;
    videoRequests.length = 0;
    closedPopup.emit('revive-requested');
    assert.equal(videoRequests.length, 1);
    closedPopup.getChildByPath('view/close').emit(Button.EventType.CLICK);
    assert.equal(homeCount, homeBeforeClose + 1, 'close returns home');
    assert.equal(game.node.isValid, false);
    assert.equal(storage.has(StorageKey.TravelSnapshot), false, 'close discards failed board snapshot');
    assert.equal(closedPopup.isValid, false);
    videoRequests[0].success();
    assert.equal(homeCount, homeBeforeClose + 1, 'late ad result cannot revive after exit');
    console.log('PASS failureThree withdraws stored tiles, unlocks 5→6→7, persists unlocks, and close returns home');

    game = create();
    game.update(5); game.openSettings(); game.update(7);
    assert.equal(game.elapsedTime, 5);
    const previousHome = homeCount;
    popups[0].args[1](); assert.equal(homeCount, previousHome + 1);
    assert.equal(game.node.isValid, false);
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'leaving does not consume an attempt');
    game = create(); game.level = MAX_TRAVEL_LEVEL; game.randomReplayLevel = () => 100;
    game.finishLevel();
    assert.notEqual(popups[0].args[0].travelCompleted, true);
    assert.equal(popups[0].args[0].nextLevel, 100);
    assert.equal(storage.get(StorageKey.TravelLevel), 100);
    assert.equal(storage.get(StorageKey.TravelReplayMode), 'true');
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'settlement does not consume an attempt');
    game.startLevel = () => {};
    popups[0].args[1](); assert.equal(game.level, 100);
    assert.equal(game.node.isValid, true, 'last authored level continues into a replay');
    console.log('PASS settings exit and last authored level continues into a replay');

    game = create();
    const today = new Date(2026, 8, 18);
    const tomorrow = new Date(2026, 8, 19);
    for (let i = 4; i >= 0; i--) {
        assert.equal(ProgressManager.consumeTravelAttempt(today), i);
    }
    assert.equal(ProgressManager.consumeTravelAttempt(today), 0, 'attempts cannot go negative');
    assert.equal(ProgressManager.loadTravelRemaining(today), 0);
    assert.equal(ProgressManager.refillTravelAttempts(today), 5, 'completed ad restores five attempts');
    assert.equal(ProgressManager.refillTravelAttempts(today), 5, 'duplicate grant cannot exceed the cap');
    assert.equal(ProgressManager.consumeTravelAttempt(today), 4);
    assert.equal(ProgressManager.refillTravelAttempts(today), 4, 'partial attempts are not refilled');
    assert.equal(ProgressManager.loadTravelRemaining(tomorrow), 5, 'next day restores five attempts');
    assert.equal(ProgressManager.consumeTravelAttempt(tomorrow), 4);
    assert.equal(JSON.parse(storage.get(StorageKey.TravelDailyUsage)).date, '2026-09-19');
    storage.set(StorageKey.TravelDailyUsage, '{broken');
    assert.equal(ProgressManager.loadTravelRemaining(tomorrow), 5, 'malformed save resets safely');
    console.log('PASS daily travel attempts decrement, cap and next-day reset');

    storage.clear(); popups.length = 0;
    storage.set(StorageKey.CurrentLevel, 11);
    const { UIStartLayer } = load('assets/game/script/UIStartLayer.ts');
    const home = new UIStartLayer();
    home.node = new Node('startLayer');
    const homeUi = new Node('ui'), homeDown = new Node('down'), homeTravel = new Node('buttonGame1');
    const homeTravelLabel = new Node('Label');
    homeTravelLabel.addComponent(Label);
    home.node.addChild(homeUi); homeUi.addChild(homeDown); homeDown.addChild(homeTravel);
    homeTravel.addChild(homeTravelLabel);
    home.refreshTravelRemainingLabel();
    assert.equal(homeTravelLabel.getComponent(Label).string, '5/5');
    layerManager.hasUI = () => true;
    const startLayer = { active: true };
    layerManager.getLayer = () => startLayer;
    home.bgNode = new Node('bg'); home.bgNode2 = new Node('bg2');
    const door = { isValid: true, animation: '', listener: null,
        setCompleteListener(listener) { this.listener = listener; },
        setAnimation(track, name) { this.animation = name; return { animation: { name } }; } };
    home.homeSkeleton = door;
    const originalShowToast = layerManager.showToast;
    let gateToast = '';
    layerManager.showToast = message => { gateToast = message; };
    cc.sys.isBrowser = false;
    storage.set(StorageKey.CurrentLevel, 10);
    await home.onClickTravelButton();
    assert.equal(gateToast, '通关第十关后解锁', 'travel stays locked until main level 10 is cleared');
    assert.equal(door.animation, '', 'a locked travel button never starts the door animation');
    assert.equal(popups.length, 0, 'a locked travel button never opens an ad or the travel level');
    cc.sys.isBrowser = true;
    storage.set(StorageKey.CurrentLevel, 0);
    gateToast = '';
    await home.onClickTravelButton();
    assert.equal(gateToast, '通关第十关后解锁', 'web preview uses the same level gate');
    assert.equal(door.animation, '', 'a locked web preview never starts the door animation');
    storage.set(StorageKey.CurrentLevel, 11);
    const firstOpening = home.onClickTravelButton();
    assert.equal(door.animation, 'Disappear', 'travel plays the same door animation as main mode');
    assert.ok(sounds.includes('open_door'), 'travel plays the main-mode door sound');
    assert.equal(popups.length, 0, 'travel is not shown before the door opens');
    home.onClickTravelButton();
    assert.equal(popups.length, 0, 'repeated taps cannot skip the door');
    advance(0.2);
    assert.equal(popups.length, 0, 'fading out alone is not enough to open travel');
    door.listener({ animation: { name: 'Disappear' } });
    await firstOpening;
    assert.equal(popups.at(-1).name, 'gameLayerThree');
    assert.equal(startLayer.active, false, 'web preview enters travel after completing main level 10');
    cc.sys.isBrowser = false;
    storage.set(StorageKey.CurrentLevel, 11);
    layerManager.showToast = originalShowToast;
    for (let i = 0; i < 5; i++) ProgressManager.consumeTravelAttempt();
    home.refreshTravelRemainingLabel();
    assert.equal(homeTravelLabel.getComponent(Label).string, '0/5');
    popups.length = 0; videoRequests.length = 0;
    storage.set(StorageKey.TravelLevel, 1);
    const freeOpening = home.onClickTravelButton();
    advance(0.2);
    door.listener({ animation: { name: 'Disappear' } });
    await freeOpening;
    assert.equal(popups.at(-1).name, 'gameLayerThree', 'level 1 is enterable with zero attempts');
    assert.equal(videoRequests.length, 0);
    assert.equal(ProgressManager.loadTravelRemaining(), 0);
    startLayer.active = true;
    storage.set(StorageKey.TravelLevel, 2);
    popups.length = 0;
    home.onClickTravelButton();
    assert.equal(popups.length, 1, 'home opens recoverCount at zero attempts from level 2');
    assert.equal(popups[0].name, 'recoverCount');
    assert.equal(videoRequests.length, 0, 'opening the dialog does not request video');
    home.onClickTravelButton();
    assert.equal(popups.length, 1, 'repeated taps reuse the recovery dialog');
    openRecovery.request();
    assert.equal(videoRequests.length, 1);
    assert.equal(videoRequests[0].key, 'travel_attempts');
    openRecovery.request();
    assert.equal(videoRequests.length, 1, 'repeated recover taps cannot queue ads');
    videoRequests[0].failure();
    assert.equal(ProgressManager.loadTravelRemaining(), 0, 'closing the ad early gives no attempts');
    openRecovery.request();
    assert.equal(videoRequests.length, 2);
    videoRequests[1].success();
    assert.equal(ProgressManager.loadTravelRemaining(), 5);
    assert.equal(homeTravelLabel.getComponent(Label).string, '5/5');
    videoRequests[1].success();
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'duplicate success cannot grant over five');
    const secondOpening = home.onClickTravelButton();
    advance(0.2);
    door.listener({ animation: { name: 'Disappear' } });
    await secondOpening;
    assert.equal(popups.at(-1).name, 'gameLayerThree', 'rewarded attempts permit entry');
    console.log('PASS home counter, rewarded refill, incomplete ad and duplicate-click protection');

    game = create();
    for (let i = 0; i < 12; i++) game.addClearScore(new Vec3());
    assert.equal(game.iqValue, 63.7); assert.equal(game.clearCount, 12);
    assert.equal(game.node.getChildByName('IQ_effect').active, true);
    console.log('PASS original IQ increment cap and enhanced IQ visual');

    const { UIWinLayer } = load('assets/game/script/UIWinLayer.ts');
    const { UISetingLayer } = load('assets/game/script/UISetingLayer.ts');
    const makeWin = (data, onNext, onExit) => {
        const win = new UIWinLayer(); win.node = new Node('win');
        win.playOpenAnimation = win.playLightBurst = win.initWinStreak = () => {};
        win.init(data, onNext, onExit);
        win.playCloseAnimation = callback => { win.isClosing = true; callback?.(); };
        return win;
    };
    let travelNext = 0, travelExit = 0;
    emitted.length = 0;
    makeWin({ isTravel: true }, () => travelNext++, () => travelExit++).onButtonNextLevelClick();
    makeWin({ isTravel: true }, () => travelNext++, () => travelExit++).onButonCloseClick();
    makeWin({ isTravel: true }, () => travelNext++, () => travelExit++).OnBtoonGoHomeClick();
    assert.equal(travelNext, 1); assert.equal(travelExit, 2); assert.equal(emitted.length, 0);
    makeWin({}).onButtonNextLevelClick();
    assert.ok(emitted.some(event => event[0] === 'main-next'), 'main win still uses original next-level event');
    emitted.length = 0;
    const settings = new UISetingLayer();
    settings.onQuit = () => travelExit++;
    settings.playCloseAnimation = callback => { settings.isClosing = true; callback?.(); };
    settings.onButtonQuitClick(); settings.onButtonQuitClick();
    assert.equal(travelExit, 3); assert.equal(emitted.length, 0);
    console.log('PASS shared win/settings callbacks isolate travel and retain main next-level behavior');

    game = create(); videoRequests.length = 0;
    for (let i = 0; i < 5; i++) ProgressManager.consumeTravelAttempt();
    game.level = 2;
    game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 0);
    const homesBeforeExhaustion = homeCount;
    let continuedLevel = 0;
    game.startLevel = () => { continuedLevel = game.level; };
    const winArgs = popups[0].args;
    const exhaustedWin = makeWin(winArgs[0], winArgs[1], winArgs[2]);
    exhaustedWin.onButtonNextLevelClick();
    assert.equal(popups.at(-1).name, 'recoverCount');
    assert.equal(videoRequests.length, 0, 'next button only opens recoverCount');
    assert.equal(exhaustedWin.isClosing, false, 'win remains open while recovering');
    exhaustedWin.onButtonNextLevelClick();
    assert.equal(popups.filter(item => item.name === 'recoverCount').length, 1, 'next button reuses the dialog');
    openRecovery.request();
    assert.equal(videoRequests.length, 1);
    assert.equal(videoRequests[0].key, 'travel_attempts');
    videoRequests[0].failure();
    assert.equal(ProgressManager.loadTravelRemaining(), 0);
    assert.equal(exhaustedWin.isClosing, false, 'incomplete ad leaves win open for retry');
    assert.equal(continuedLevel, 0);
    openRecovery.request();
    assert.equal(videoRequests.length, 2);
    videoRequests[1].success();
    assert.equal(ProgressManager.loadTravelRemaining(), 5);
    assert.equal(continuedLevel, 3, 'completed ad advances the travel level');
    assert.equal(homeCount, homesBeforeExhaustion, 'successful ad does not return home');
    videoRequests[1].success();
    assert.equal(continuedLevel, 3, 'duplicate ad callback cannot advance twice');
    console.log('PASS next level prompts ad at zero, failure keeps win open and success refills then advances');

    game = create(); videoRequests.length = 0;
    for (let i = 0; i < 5; i++) ProgressManager.consumeTravelAttempt();
    game.level = MAX_TRAVEL_LEVEL; game.randomReplayLevel = () => 321; game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 0);
    const finalWinArgs = popups[0].args;
    assert.equal(finalWinArgs[0].nextLevel, 321);
    assert.equal(finalWinArgs[0].travelCompleted, undefined);
    game.startLevel = () => {};
    const homesBeforeFinal = homeCount;
    makeWin(finalWinArgs[0], finalWinArgs[1], finalWinArgs[2]).onButtonNextLevelClick();
    assert.equal(popups.at(-1).name, 'recoverCount');
    assert.equal(videoRequests.length, 0, 'exhausted replay first opens the recovery dialog');
    openRecovery.request();
    assert.equal(videoRequests.length, 1, 'replay requests an ad only after tapping recover');
    videoRequests[0].success();
    assert.equal(game.level, 321);
    assert.equal(homeCount, homesBeforeFinal);
    assert.equal(storage.get(StorageKey.TravelLevel), 321);
    assert.equal(game.loadLevel(), 321);
    assert.equal(game.replayMode, true, 'replay mode survives re-entering the game');
    game.randomReplayLevel = () => 456; game.level = 321; game.winSettled = false; game.winNode = null;
    game.finishLevel();
    assert.equal(storage.get(StorageKey.TravelLevel), 456, 'replay wins keep choosing random levels');
    assert.equal(popups.at(-1).args[0].nextLevel, 456);
    storage.set(StorageKey.TravelLevel, MAX_TRAVEL_LEVEL + 1);
    game.randomReplayLevel = () => 100;
    assert.equal(game.loadLevel(), 100, 'old out-of-range saves migrate into replay levels');
    assert.equal(storage.get(StorageKey.TravelLevel), 100);
    game.randomReplayLevel = UITravelLayer.prototype.randomReplayLevel;
    for (let i = 0; i < 100; i++) {
        const replay = game.randomReplayLevel();
        assert.ok(replay >= 100 && replay <= MAX_TRAVEL_LEVEL);
    }
    console.log('PASS max level replays from 100..max and exhausted attempts still require an ad');

    const loadSource = async (level, settleIntro = true, entranceMode = 'fly') => {
        const game = create();
        const plan = await imports['./config/TravelLevelLoader'].ensureTravelLevel(level);
        game.frames = new Map(plan.tiles.map(tile => [tile.type, {}]));
        game.baseFrames = new Map(game.frames);
        game.level = level;
        game.selectEntranceMode = () => entranceMode;
        await game.startLevel(false);
        if (level === 1) {
            const guide = game.gameplayGuide;
            assert.ok(guide?.isValid, 'first travel level opens gameplayGuide automatically');
            assert.equal(popups.at(-1).name, 'gameplayGuide');
            assert.equal(game.canTapTile(), false, 'guide blocks tile input');
            assert.equal(game.canPlay(), false, 'guide blocks prop input');
            game.update(1);
            assert.equal(game.elapsedTime, 0, 'guide pauses the level timer');
            guide.events.get('closed')();
            guide.destroy();
            assert.equal(game.gameplayGuide, null, 'closing guide releases gameplay');
            game.showFirstLevelGuide();
            assert.equal(game.gameplayGuide, null, 'guide does not reopen during this level');
        } else {
            assert.equal(game.gameplayGuide, null, 'later travel levels do not show the first-level guide');
        }
        if (settleIntro) advance(1.5);
        return game;
    };
    // Attempts are charged on entry, not at victory; first level is free and revival stays in the same run.
    game = await loadSource(1);
    assert.ok(dnTracks.some(event => event.name === 'LEVEL_ENTER' && event.data.level_id === 10001));
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'first level entry is free');
    game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 5, 'first level victory is free');
    game = await loadSource(2);
    assert.equal(ProgressManager.loadTravelRemaining(), 4, 'level 2 entry consumes one attempt');
    game.showFailure();
    assert.equal(ProgressManager.loadTravelRemaining(), 4, 'failure does not consume another attempt');
    game.continueAfterFailure();
    assert.equal(ProgressManager.loadTravelRemaining(), 4, 'revival does not re-enter or charge again');
    game.finishLevel();
    assert.equal(ProgressManager.loadTravelRemaining(), 4, 'victory does not charge again');
    game = await loadSource(2);
    assert.equal(ProgressManager.loadTravelRemaining(), 4);
    game.backHome(true);
    assert.equal(ProgressManager.loadTravelRemaining(), 4, 'quitting does not refund the entry');
    game = await loadSource(3);
    assert.equal(ProgressManager.loadTravelRemaining(), 4);
    await game.startLevel(true);
    assert.equal(ProgressManager.loadTravelRemaining(), 3, 're-entering a saved level charges once');
    game.retry();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ProgressManager.loadTravelRemaining(), 2, 'starting a new run charges once');
    console.log('PASS attempts charge on each non-first-level entry, not on failure, revival or victory');

    const randomChoice = create();
    assert.equal(randomChoice.selectEntranceMode(0.1), 'expand');
    assert.equal(randomChoice.selectEntranceMode(0.9), 'fly');
    for (const level of [1, 2, 3, 5, 13, 100, 101, 900, 901, MAX_TRAVEL_LEVEL]) {
        game = await loadSource(level, false);
        assert.equal(game.state, 'playing');
        assert.equal(game.entranceMode, 'fly');
        assert.equal(game.boardEntering, true, 'new level begins with the entrance animation');
        assert.equal(game.busy, true);
        assert.equal(game.plan.groups, undefined);
        assert.equal(game.tiles.length, game.plan.source.tileCount);
        if (level === 13) assert.equal(game.plan.source.originalLevel, 14, 'original tower level 13 skipped completely');
        const size = game.board.getComponent(UITransform);
        if (level === 13) {
            const oldScale = 130 * 1.24 / 186;
            const oldStepX = 149 * oldScale + 4, oldStepY = 186 * oldScale + 4;
            const oldBoardHeight = size.height - 88;
            const oldFit = Math.min(1,
                (size.width - 24) / ((game.plan.width - 1) * oldStepX + 149 * oldScale),
                (oldBoardHeight - 24) / ((game.plan.height - 1) * oldStepY + 186 * oldScale));
            assert.ok(game.boardTileScale > oldScale * oldFit * 1.08,
                'the taller board keeps dense faces large and readable');
        }
        const firstTile = game.tiles[0];
        assert.ok(Math.abs(firstTile.node.position.x) > size.width / 2, 'tile begins beyond the board edge');
        assert.equal(firstTile.item.motionStreakEnabled, false, 'side flight has no motion trail');
        assert.equal(firstTile.item.touchEnabled, false, 'tile touch feedback is disabled during entrance');
        const firstAvailable = game.tiles.find(tile => !game.isBlocked(tile));
        game.tapTile(firstAvailable);
        assert.equal(firstAvailable.state, 'board', 'tile taps are ignored during entrance');
        game.update(0.5);
        assert.equal(game.elapsedTime, 0, 'intro time does not count toward gameplay');
        advance(0.25);
        assert.equal(firstTile.item.motionStreakEnabled, false, 'motion trail stays hidden throughout the entrance');
        advance(1.25);
        assert.equal(game.boardEntering, false);
        assert.equal(game.busy, false);
        assert.equal(firstTile.item.touchEnabled, true, 'touch feedback resumes when every tile settles');
        if (level === 2) {
            // Screenshot reference: three diagonals descend to the right, with the middle card on top.
            for (const [topLeftId, middleId, bottomRightId] of [[3, 6, 0], [4, 7, 1], [5, 8, 2]]) {
                const [topLeft, middle, bottomRight] = [topLeftId, middleId, bottomRightId].map(id => game.tiles[id]);
                assert.ok(topLeft.node.position.x < middle.node.position.x && middle.node.position.x < bottomRight.node.position.x);
                assert.ok(topLeft.node.position.y > middle.node.position.y && middle.node.position.y > bottomRight.node.position.y,
                    'level 2 must descend from upper left to lower right as in the original screenshot');
                assert.ok(Math.abs((bottomRight.node.position.x - topLeft.node.position.x) / game.boardStepX
                    - (topLeft.node.position.y - bottomRight.node.position.y) / game.boardStepY) < 1e-6,
                    'level 2 diagonals retain the source row and column offsets on the rectangular grid');
                assert.equal(middle.layer, 1);
                assert.equal(middle.item.playable, true);
                assert.equal(topLeft.item.playable, false);
                assert.equal(bottomRight.item.playable, false);
            }
        }
        for (const tile of game.tiles) {
            assert.equal(tile.node.position.x, (tile.col - game.plan.centerCol) * game.boardStepX);
            assert.equal(tile.node.position.y, (tile.row - game.plan.centerRow) * game.boardStepY);
            assert.equal(tile.item.row, -tile.row * 2, 'display depth increases toward the bottom of the screen');
            assert.equal(tile.item.col, tile.col * 2);
            const touch = tile.node.getComponent(UITransform);
            assert.equal(tile.node.scale.x, tile.node.scale.y, 'travel preserves the original Mahjong proportions');
            const face = tile.node.getChildByName('bg').getComponent(UITransform);
            assert.equal(face.width, 149, 'travel must not widen the original rectangular body');
            assert.equal(face.height, 186);
            assert.ok(Math.abs(tile.node.position.x) + face.width * tile.node.scale.x / 2 <= size.width / 2);
            assert.ok(Math.abs(tile.node.position.y) + face.height * tile.node.scale.y / 2 <= size.height / 2);
            assert.ok(Math.abs(touch.width * tile.node.scale.x - game.boardStepX) < 1e-9,
                'the visible and touch width fills exactly one horizontal cell');
            assert.ok(Math.abs(touch.height * tile.node.scale.y - face.height * tile.node.scale.y * 180 / 188) < 1e-9,
                'the touch area retains the full visible body including its bottom edge');
            assert.ok(Math.abs(touch.height * tile.node.scale.y - game.boardStepY
                - face.height * tile.node.scale.y * 6 / 188) < 1e-9,
                'adjacent rows overlap only the bottom bevel of the original artwork');
            assert.ok(Math.abs(tile.node.position.x) + touch.width * tile.node.scale.x / 2 <= size.width / 2);
            assert.ok(Math.abs(tile.node.position.y) + touch.height * tile.node.scale.y / 2 <= size.height / 2);
            assert.equal(tile.node.parent.name, `_layer_${tile.layer}_`);
            assert.ok(tile.node.parent.orderRefreshes > 0, 'initial board explicitly refreshes the tile draw order');
            assert.equal(tile.item.playable, !isTravelBlocked(tile, game.tiles));
        }
        if (level === 5) {
            const top = Math.max(...game.tiles.map(tile => tile.node.position.y
                + tile.node.getComponent(UITransform).height * tile.node.scale.y / 2));
            const bottom = Math.min(...game.tiles.map(tile => tile.node.position.y
                - tile.node.getComponent(UITransform).height * tile.node.scale.y / 2));
            assert.ok(Math.abs(top + bottom) < 1, 'level 5 top and bottom rows center symmetrically');
            for (let i = 0; i < game.tiles.length; i++) {
                const a = game.tiles[i];
                for (let j = i + 1; j < game.tiles.length; j++) {
                    const b = game.tiles[j];
                    if (a.layer !== b.layer || a.col !== b.col || Math.abs(a.row - b.row) !== 1) continue;
                    const aHeight = a.node.getComponent(UITransform).height * a.node.scale.y;
                    const bHeight = b.node.getComponent(UITransform).height * b.node.scale.y;
                    const overlap = (aHeight + bHeight) / 2 - Math.abs(a.node.position.y - b.node.position.y);
                    assert.ok(Math.abs(overlap - aHeight * 6 / 180) < 1e-9,
                        `level 5 same-layer tiles ${a.id}/${b.id} cover the upper tile's bottom bevel`);
                }
            }
        }
        const front = game.tiles.find(tile => !game.isBlocked(tile));
        const originalPosition = front.node.position.clone();
        const originalLayer = front.node.parent;
        const previousOrderRefreshes = originalLayer.orderRefreshes;
        tap(game, front.id); assert.equal(front.state, 'slot');
        assert.equal(game.undo(), true);
        assert.equal(front.state, 'board'); assert.deepEqual(front.node.position, originalPosition);
        assert.ok(originalLayer.orderRefreshes > previousOrderRefreshes, 'undo restores the draw order instead of leaving the returned tile on top');
        const facesBefore = game.tiles.map(tile => tile.type).sort();
        game.shuffle();
        assert.equal(game.shuffleLeft, 0);
        assert.deepEqual(game.tiles.map(tile => tile.type).sort(), facesBefore, 'shuffle preserves all tile types/counts');
        assert.equal(front.node.position.x, originalPosition.x, 'shuffle does not alter source coordinates');
        assert.equal(front.node.position.y, originalPosition.y);
        assert.equal(front.item.row, -front.row * 2, 'shuffle preserves the display row direction');
    }
    console.log('PASS real layouts, skipped original level 13, uniform fit, occlusion, chunk boundaries, undo and shuffle');

    game = await loadSource(13, false, 'expand');
    const expandingTile = game.tiles[0];
    const finalX = (expandingTile.col - game.plan.centerCol) * game.boardStepX;
    assert.equal(game.entranceMode, 'expand');
    assert.equal(expandingTile.node.position.x, finalX, 'expanding cards remain in their final slots');
    assert.equal(expandingTile.node.scale.x, 0, 'cards are completely hidden before their reveal');
    assert.equal(expandingTile.item.motionStreakEnabled, false, 'in-place expansion has no flight trail');
    assert.equal(expandingTile.item.touchEnabled, false);
    advance(0.04);
    assert.equal(expandingTile.node.scale.x, 0, 'no tiny cards linger during the stagger');
    advance(0.03);
    assert.ok(expandingTile.node.scale.x >= game.boardTileScale * 0.5, 'tile reveals at a readable size');
    advance(1.43);
    assert.equal(expandingTile.node.scale.x, game.boardTileScale);
    assert.equal(game.boardEntering, false);
    assert.equal(expandingTile.item.touchEnabled, true);
    console.log('PASS first video style expands cards in place, distinct from side flight');

    game = await loadSource(13, false, 'expand');
    const interruptedTile = game.tiles[0].node;
    game.selectEntranceMode = () => 'fly';
    await game.startLevel(false);
    assert.equal(interruptedTile.isValid, false, 'restarting removes the previous animated board');
    assert.equal(game.boardEntering, true);
    assert.equal(game.entranceMode, 'fly', 'a new entry selects one mode for the whole board');
    assert.ok(Math.abs(game.tiles[0].node.position.x) > game.board.getComponent(UITransform).width / 2);
    advance(1.5);
    assert.equal(game.boardEntering, false);
    assert.equal(game.busy, false, 'old entrance callbacks cannot leave the restarted board locked');
    console.log('PASS restarting during entrance cancels old board tweens');

    game = await loadSource(13);
    const selected = game.tiles.find(tile => !game.isBlocked(tile));
    tap(game, selected.id); game.update(4.5); game.saveSnapshot();
    const savedSource = storage.get(StorageKey.TravelSnapshot);
    assert.equal(JSON.parse(savedSource).version, TRAVEL_DATA_VERSION);
    game = await loadSource(13);
    storage.set(StorageKey.TravelSnapshot, savedSource); game.restoreSnapshot(); game.renderBoard();
    assert.equal(game.tiles[selected.id].state, 'slot'); assert.equal(game.elapsedTime, 4.5);
    await game.startLevel(true);
    assert.equal(game.boardEntering, false, 'resuming a saved board does not replay the intro');
    assert.equal(game.tiles[selected.id].state, 'slot');
    assert.equal(game.tiles[0].node.position.x, (game.tiles[0].col - game.plan.centerCol) * game.boardStepX);
    for (const mutation of [{ version: 1 }, { version: 2 }, { levelKey: 'different-source-layout' }]) {
        game = await loadSource(13);
        storage.set(StorageKey.TravelSnapshot, JSON.stringify({ ...JSON.parse(savedSource), ...mutation }));
        game.restoreSnapshot();
        assert.ok(game.tiles.every(tile => tile.state === 'board'));
        assert.equal(game.slots.length, 0); assert.equal(game.elapsedTime, 0);
    }
    console.log('PASS imported save restoration, old synthetic/special schema rejection and source hash isolation');

    // Synthetic flip fixture tests support only; no flip markers are added to imported source data.
    game = create();
    const hidden = game.tiles[0]; hidden.faceDown = true;
    hidden.item.iconNode = new Node('icon'); hidden.item.iconNode.addComponent(Sprite);
    const backFrame = {}; game.frames.set('flip', backFrame); game.setFaceDownImage(hidden);
    assert.equal(hidden.item.iconNode.getComponent(Sprite).spriteFrame, backFrame);
    tap(game, hidden.id);
    assert.equal(hidden.faceDown, false); assert.equal(hidden.state, 'slot');
    assert.equal(hidden.item.row, -hidden.row * 2, 'revealing a face retains the display row direction');
    assert.equal(hidden.item.iconNode.getComponent(Sprite).spriteFrame, game.frames.get(hidden.type));
    assert.equal(game.undo(), true); assert.equal(hidden.faceDown, false);
    console.log('PASS face-down tile reveals and enters tray on the same click; undo retains revealed face');

    const { MahjongItem: RealMahjongItem } = load('assets/game/script/MahjongItem.ts');
    const depthLayer = new Node('_layer_1_');
    const lowerCard = new Node('lower'), upperCard = new Node('upper');
    depthLayer.addChild(lowerCard); depthLayer.addChild(upperCard);
    const lowerDepth = lowerCard.addComponent(RealMahjongItem), upperDepth = upperCard.addComponent(RealMahjongItem);
    lowerDepth.row = 2; lowerDepth.col = 0;
    upperDepth.row = 0; upperDepth.col = 4;
    RealMahjongItem.refreshLayerDisplayOrder(depthLayer);
    assert.deepEqual(depthLayer.children.map(node => node.name), ['lower', 'upper'], 'main mode retains its diagonal depth order');
    lowerDepth.setTravelBoardStep(130, 160); upperDepth.setTravelBoardStep(130, 160);
    RealMahjongItem.refreshLayerDisplayOrder(depthLayer);
    assert.deepEqual(depthLayer.children.map(node => node.name), ['upper', 'lower'], 'travel draws lower cards after upper cards regardless of column');
    upperCard.setSiblingIndex(1);
    RealMahjongItem.refreshLayerDisplayOrder(depthLayer);
    assert.deepEqual(depthLayer.children.map(node => node.name), ['upper', 'lower'], 'travel restores depth after a card was raised for touch feedback');
    console.log('PASS travel draws lower cards in front and preserves main-mode depth sorting');
    game = await loadSource(2);
    for (const [topLeftId, bottomRightId] of [[3, 0], [4, 1], [5, 2]]) {
        const a = game.tiles[topLeftId].item, b = game.tiles[bottomRightId].item;
        assert.ok(RealMahjongItem.compareBoardDisplayOrderRC(a.row, a.col, b.row, b.col) < 0,
            'shared Mahjong depth ordering draws the lower-right card after the upper-left card');
    }
    const overlapBoard = new Node('pNode');
    const lowerLayer = new Node('_layer_0_'), upperLayer = new Node('_layer_1_');
    overlapBoard.addChild(lowerLayer); overlapBoard.addChild(upperLayer);
    const lowerNode = new Node('lower'), upperNode = new Node('upper');
    lowerLayer.addChild(lowerNode); upperLayer.addChild(upperNode);
    const lowerItem = lowerNode.addComponent(RealMahjongItem);
    upperNode.addComponent(RealMahjongItem);
    lowerItem.setTravelBoardStep(130, 160);
    upperNode.setPosition(65, 0, 0);
    assert.equal(lowerItem.isBlockedByUpperMahjong(), true, 'touch feedback recognizes half-step overlap');
    upperNode.setPosition(130, 0, 0);
    assert.equal(lowerItem.isBlockedByUpperMahjong(), false, 'a full step does not count as covering');
    upperNode.setPosition(0, 80, 0);
    assert.equal(lowerItem.isBlockedByUpperMahjong(), true, 'vertical half-step uses the taller tile spacing');
    upperNode.setPosition(0, -80, 0);
    assert.equal(lowerItem.isBlockedByUpperMahjong(), true, 'reflected vertical half-steps also block touch feedback');
    upperNode.setPosition(0, 160, 0);
    assert.equal(lowerItem.isBlockedByUpperMahjong(), false);
    console.log('PASS touch occlusion follows travel board spacing');
    const tornDownItem = new RealMahjongItem();
    tornDownItem.node = null;
    assert.doesNotThrow(() => tornDownItem.setMotionStreakEnabled(false), 'a detached tile cannot look up its streak');
    const destroyingGame = create();
    destroyingGame.tiles[0].item.node = null;
    destroyingGame.tiles[0].item.setMotionStreakEnabled = () => { throw new Error('tile already torn down'); };
    assert.doesNotThrow(() => destroyingGame.onDestroy(), 'travel cleanup never calls a torn-down tile component');
    console.log('PASS travel teardown tolerates MahjongItem.node already being null');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
