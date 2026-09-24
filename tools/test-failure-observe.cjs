const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
class Component { scheduleOnce() {} unschedule() {} }
const animations = [];
const tween = target => {
    const steps = [];
    const chain = {
        to(duration, props, opts) { steps.push({ duration, props, opts }); return chain; },
        call(fn) { steps.push({ fn }); return chain; },
        start() { animations.push({ target, steps }); return chain; },
    };
    return chain;
};
const Tween = { stopAllByTarget(target) { for (let i = animations.length - 1; i >= 0; i--) if (animations[i].target === target) animations.splice(i, 1); } };
const v3 = (x, y, z) => ({ x, y, z });
const finishAnimations = () => { for (const { target, steps } of animations.splice(0)) for (const step of steps) { if (step.props) Object.assign(target, step.props); else step.fn(); } };
class UITransform { constructor() { this.contentSize = { width: 750, height: 1334 }; } get width() { return this.contentSize.width; } get height() { return this.contentSize.height; } setContentSize(size) { this.contentSize = size; } }
class UIOpacity { constructor() { this.opacity = 255; } }
class Widget { updateAlignment() {} }
class Node {
    static EventType = { SIZE_CHANGED: 'size', TOUCH_START: 'start', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' };
    constructor(name, parent = null) { this.name = name; this.parent = parent; this.isValid = true; this.scale = v3(1, 1, 1); this.events = new Map(); this.transform = new UITransform(); this.opacity = new UIOpacity(); }
    on(event, fn, owner) { this.events.set(event, touch => fn.call(owner, touch)); }
    off(event) { this.events.delete(event); }
    fire(event, touch) { this.events.get(event)?.(touch); }
    getComponent(type) { return type === UITransform ? this.transform : type === UIOpacity ? this.opacity : type === Widget ? new Widget() : null; }
    setScale(x, y, z) { this.scale = v3(x, y, z); }
}
const view = { on() {}, off() {} };
const cc = { tween, Tween, v3, _decorator: { ccclass: () => target => target, property: (...args) => (args.length >= 2 && typeof args[1] === 'string') ? undefined : () => {} }, Component, Node, UIOpacity, UITransform, Widget, view };
const file = path.resolve(__dirname, '../assets/game/script/UIThreePopup.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true } }).outputText;
const moduleExports = {};
vm.runInNewContext(output, { exports: moduleExports, require: name => { assert.equal(name, 'cc'); return cc; } });
const popup = new moduleExports.UIThreePopup();
popup.node = new Node('failureThree'); popup.viewNode = new Node('view', popup.node);
popup.maskNode = new Node('bg', popup.node); popup.observeNode = new Node('observeButton', popup.viewNode);
popup.maxScale = 0.7;
popup.viewNode.transform.contentSize = { width: 1036, height: 1960 };
popup.onEnable();
const fitted = (1334 - 32) / 1960;
assert.ok(Math.abs(popup.viewNode.scale.x - fitted * 0.3) < 1e-9, 'failure panel starts small');
assert.equal(popup.maskNode.opacity.opacity, 0, 'failure mask starts transparent');
const panelTween = animations.find(entry => entry.target === popup.viewNode);
const maskTween = animations.find(entry => entry.target === popup.maskNode.opacity);
assert.ok(panelTween && maskTween);
assert.equal(panelTween.steps[0].duration, 0.35);
assert.ok(Math.abs(panelTween.steps[0].props.scale.x - fitted * 1.05) < 1e-9);
assert.equal(panelTween.steps[1].duration, 0.15);
assert.ok(Math.abs(panelTween.steps[1].props.scale.x - fitted) < 1e-9);
assert.equal(maskTween.steps[0].duration, 0.5);
finishAnimations();
assert.ok(Math.abs(popup.viewNode.scale.x - fitted) < 1e-9, 'panel settles at fitted size');
assert.equal(popup.maskNode.opacity.opacity, 255, 'mask finishes fading in');
const touch = (id, target) => ({ getID: () => id, target });
popup.maskNode.fire('start', touch(1, popup.maskNode));
assert.equal(popup.viewNode.opacity.opacity, 0);
assert.equal(popup.maskNode.opacity.opacity, 0);
popup.maskNode.fire('end', touch(1, popup.maskNode));
assert.equal(popup.viewNode.opacity.opacity, 255);
assert.equal(popup.maskNode.opacity.opacity, 255);
popup.viewNode.fire('start', touch(2, new Node('panel', popup.viewNode)));
assert.equal(popup.viewNode.opacity.opacity, 0);
popup.viewNode.fire('cancel', touch(2, popup.viewNode));
assert.equal(popup.viewNode.opacity.opacity, 255);
popup.viewNode.fire('start', touch(3, new Node('close', popup.viewNode)));
assert.equal(popup.viewNode.opacity.opacity, 255, 'close button does not hide dialog');
popup.viewNode.fire('start', touch(4, new Node('reviveButton', popup.viewNode)));
assert.equal(popup.viewNode.opacity.opacity, 255, 'revive button does not hide dialog');
popup.observeNode.fire('start', touch(5, popup.observeNode));
assert.equal(popup.viewNode.opacity.opacity, 0);
popup.observeNode.fire('end', touch(5, popup.observeNode));
assert.equal(popup.viewNode.opacity.opacity, 255);
popup.onDisable();
console.log('PASS failureThree bounces and fades in; blank hold hides popup and release restores it');
