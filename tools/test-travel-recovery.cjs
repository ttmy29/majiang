const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '..');
const actions = [];
let remaining = 0;
let popup = null;
const videos = [];
let grantCalls = 0;
let adCount = 0;
class Button { constructor() { this.interactable = true; } }
class Node {
    static EventType = { TOUCH_END: 'touch-end' };
    constructor(name) { this.name = name; this.isValid = true; this.listeners = new Map(); this.children = new Map(); }
    getComponent(type) { return type === UIThreePopup ? this.popup : null; }
    getChildByName(name) { return this.children.get(name) || null; }
    getChildByPath(path) { return path.split('/').reduce((node, name) => node?.getChildByName(name), this); }
    on(event, callback) { this.listeners.set(event, callback); }
    emit(event) { this.listeners.get(event)?.(); }
    destroy() { this.isValid = false; }
}
const ThreePopupEvent = { RecoverRequested: 'recover-requested' };
class UIThreePopup { constructor(node) { this.node = node; } close() { this.node.destroy(); popup = null; } }
const layer = {
    getOpenUI(name) { return name === 'recoverCount' ? popup : null; },
    hasUI(name) { return name === 'recoverCount'; },
    showToast(message) { actions.push(message); },
    showUI(name) {
        assert.equal(name, 'recoverCount');
        const node = new Node(name);
        const view = new Node('view'), button = new Node('recoverButton');
        button.getComponent = type => type === Button ? button.button : null;
        button.button = new Button();
        view.children.set('recoverButton', button);
        node.children.set('view', view); node.children.set('bg', new Node('bg'));
        node.popup = new UIThreePopup(node);
        popup = node;
        return node;
    },
};
const mocks = {
    cc: { Button, Node },
    './AudioManager': { AudioManager: { instance: { playClick() { actions.push('click'); } } } },
    './LayerManager': { LayerManager: { instance: layer } },
    './ProgressManager': { ProgressManager: {
        addGlobalAdCount() { adCount++; },
        refillTravelAttempts() { grantCalls++; remaining = 5; },
    } },
    '../../../loading/SDKManager': { SDKManager: { instance: { showVideoAd(success, failure, key) {
        videos.push({ success, failure, key });
    } } } },
    '../UIThreePopup': { ThreePopupEvent, UIThreePopup },
};
const source = fs.readFileSync(path.join(root, 'assets/game/script/manager/TravelRecoveryManager.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } });
const moduleExports = {};
vm.runInNewContext(compiled.outputText, { exports: moduleExports, require: name => {
    assert.ok(mocks[name], `unexpected import: ${name}`);
    return mocks[name];
} });
const { TravelRecoveryManager } = moduleExports;
let recovered = 0;
const first = TravelRecoveryManager.show(() => recovered++);
assert.equal(TravelRecoveryManager.show(() => recovered++), first, 'one recovery popup at a time');
assert.equal(videos.length, 0, 'opening popup does not start video');
first.emit(ThreePopupEvent.RecoverRequested);
assert.equal(videos.length, 1);
assert.equal(videos[0].key, 'travel_attempts');
assert.equal(first.getChildByPath('view/recoverButton').button.interactable, false);
first.emit(ThreePopupEvent.RecoverRequested);
assert.equal(videos.length, 1, 'pending video cannot be queued twice');
videos[0].failure();
assert.equal(remaining, 0, 'early close does not reward');
assert.equal(adCount, 0, 'failed video does not count');
assert.equal(first.isValid, true, 'failed ad keeps popup open');
assert.equal(first.getChildByPath('view/recoverButton').button.interactable, true);
videos[0].success();
assert.equal(remaining, 0, 'late success from failed ad is ignored');
first.emit(ThreePopupEvent.RecoverRequested);
assert.equal(videos.length, 2);
videos[1].success();
assert.equal(remaining, 5);
assert.equal(adCount, 1, 'completed recovery video counts once');
assert.equal(first.isValid, false);
assert.equal(recovered, 1);
videos[1].success();
assert.equal(grantCalls, 1, 'duplicate success cannot grant twice');
assert.equal(adCount, 1, 'duplicate success cannot count twice');
assert.equal(recovered, 1);
remaining = 0;
const second = TravelRecoveryManager.show(() => recovered++);
second.getChildByName('bg').emit(Node.EventType.TOUCH_END);
assert.equal(second.isValid, false, 'mask tap closes idle popup');
assert.equal(recovered, 1);
console.log('PASS recoverCount opens once; button requests video; failure retries; success restores 5 once; mask closes');
