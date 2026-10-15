const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

class UITransform {
    constructor() { this.contentSize = { width: 0, height: 0 }; this.anchorPoint = { x: 0.5, y: 0.5 }; }
    setContentSize(width, height) { this.contentSize = { width, height }; }
    setAnchorPoint(x, y) { this.anchorPoint = { x, y }; }
    get height() { return this.contentSize.height; }
}
class Label {}
Label.HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
Label.Overflow = { SHRINK: 2 };
Label.CacheMode = { BITMAP: 1 };
class Sprite {}
Sprite.SizeMode = { CUSTOM: 0 };
class Layout {}
class Widget {}
class Node {
    constructor(name = '') { this.name = name; this.active = true; this.isValid = true; this.children = []; this.components = new Map(); this.position = { x: 0, y: 0, z: 0 }; }
    addChild(node) { this.children.push(node); node.parent = this; }
    getChildByName(name) { return this.children.find(node => node.name === name) || null; }
    getComponent(type) { return this.components.get(type) || null; }
    addComponent(type) { const component = new type(); component.node = this; this.components.set(type, component); return component; }
    getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }
    setSiblingIndex() {}
    setPosition(x, y, z) { this.position = typeof x === 'object' ? { ...x } : { x, y, z }; }
    setScale(x, y, z) { this.scale = { x, y, z }; }
}
function clone(node) {
    const result = new Node(node.name);
    result.position = { ...node.position };
    for (const [type, component] of node.components) result.components.set(type, Object.assign(new type(), JSON.parse(JSON.stringify(component))));
    node.children.forEach(child => result.addChild(clone(child)));
    return result;
}
const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/game/prefab/rank.prefab'), 'utf8'));
const footerMeta = JSON.parse(fs.readFileSync(path.join(root, 'assets/game/resources/rank/selfRankBg.png.meta'), 'utf8'));
assert.equal(prefab.find(node => node.selfRankBackground).selfRankBackground.__uuid__, footerMeta.subMetas.f9941.uuid);
assert.deepEqual(fs.readFileSync(path.join(root, 'assets/game/resources/rank/selfRankBg.png')), fs.readFileSync(path.join(root, 'build-templates/wechatgame/openDataContext/selfRankBg.png')), 'both renderers use the same original green artwork');
function loadNode(id) {
    const source = prefab[id];
    const node = new Node(source._name);
    node.position = { ...source._lpos };
    for (const ref of source._components || []) {
        const sourceComponent = prefab[ref.__id__];
        const type = { 'cc.UITransform': UITransform, 'cc.Label': Label, 'cc.Sprite': Sprite }[sourceComponent.__type__];
        if (!type) continue;
        const component = new type();
        if (type === UITransform) { component.contentSize = { ...sourceComponent._contentSize }; component.anchorPoint = { ...sourceComponent._anchorPoint }; }
        if (type === Label) { component.string = sourceComponent._string; component.fontSize = sourceComponent._fontSize; }
        node.components.set(type, component);
    }
    (source._children || []).forEach(ref => node.addChild(loadNode(ref.__id__)));
    return node;
}
const sdk = { getJhRankName: key => key, getOpenid: () => 'self' };
const cc = { _decorator: { ccclass: () => value => value, property: () => () => {} }, Component: class {}, Node, UITransform, Label, Sprite, Layout, Widget, instantiate: clone, Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } } };
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'assets/game/script/UIRankLayer.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText, {
    exports: exported,
    require: name => name === 'cc' ? cc : name.includes('SDKManager') ? { SDKManager: { instance: sdk } }
        : name.includes('ProgressManager') ? { ProgressManager: { loadLevel: () => 888 } }
        : name.includes('StreakManager') ? { StreakManager: { getStreak: () => 12 } } : {},
});

async function main() {
    const rank = new exported.UIRankLayer();
    rank.itemNode = loadNode(prefab.find(node => node.itemNode).itemNode.__id__);
    rank.viewNode = new Node('view');
    rank.contentNode = new Node('content');
    const widget = { bottom: 40, updateAlignment() {} };
    rank.getScrollViewComponent = () => ({ view: { node: { getComponent: type => type === Widget ? widget : null } } });
    rank.selfRankBackground = { name: 'original-green-footer' };
    rank.initSelfRankFooter();
    const name = rank.itemNode.getChildByName('name');
    const count = rank.itemNode.getChildByName('count');
    const avatar = rank.itemNode.getChildByName('headBg');
    assert.ok(avatar.position.x + avatar.getComponent(UITransform).contentSize.width / 2 < name.position.x, 'name starts after the avatar');
    assert.ok(name.position.x + name.getComponent(UITransform).contentSize.width < count.position.x - count.getComponent(UITransform).contentSize.width, 'name and score have separate columns');
    assert.equal(name.getComponent(Label).enableWrapText, false);
    assert.equal(name.getComponent(Label).overflow, Label.Overflow.SHRINK);
    assert.equal(rank.selfRankFooterNode.getChildByName('bg1').getComponent(Sprite).spriteFrame, rank.selfRankBackground);
    rank.nowIndex = 3;
    rank.renderSelfRankFooter({ rank: 1234, count: 888 });
    assert.equal(rank.selfRankFooterNode.getChildByName('num').getComponent(Label).string, '1234');
    assert.equal(rank.selfRankFooterNode.getChildByName('count').getComponent(Label).string, '888关');
    rank.renderSelfRankFooter(null);
    assert.equal(rank.selfRankFooterNode.getChildByName('num').getComponent(Label).string, '未上榜');
    rank.renderSelfRankFooter({ rank: 1, count: 888 });
    assert.equal(rank.selfRankFooterNode.getChildByName('1').active, true);
    assert.equal(rank.selfRankFooterNode.getChildByName('num').active, false);
    rank.clearContentNode = rank.renderTopRankItems = rank.logServerRankResponse = () => {};
    rank.isWechatGamePlatform = () => true;
    rank.getFallbackRankName = () => '玩家';
    sdk.fetchJhRank = async () => ({ topEntries: Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, uid: `other-${i}`, name: '玩家', count: 9000 - i })), myInfo: { rank: 1234, uid: 'self', name: '我', count: 888 } });
    let selfRank;
    rank.renderRankList = (index, data, self) => { assert.equal(data.length, 100); selfRank = self; };
    rank.refreshRankList(3);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(selfRank.rank, 1234, 'world footer uses myInfo even outside the top 100');
    sdk.fetchJhRank = async () => ({ topEntries: [], myInfo: { rank: 0, uid: 'self', name: '我', count: 888 } });
    rank.renderRankList = (index, data, self) => { selfRank = self; };
    rank.refreshRankList(3);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(selfRank.rank, 0, 'an unranked self is never reported as first place');
    assert.equal(rank.resolveServerRankEntries({ topEntries: [], myInfo: { rank: 0, count: 888 } }).length, 0, 'unranked self is not displayed on the first-place podium');

    const pendingBoards = new Map();
    sdk.fetchJhRank = name => new Promise(resolve => pendingBoards.set(name, resolve));
    const renders = [];
    rank.renderRankList = (index, data, self) => renders.push({ index, self });
    rank.refreshRankList(3);
    rank.refreshRankList(2);
    pendingBoards.get('level')({ topEntries: [], myInfo: { rank: 8, uid: 'self', name: '我', count: 888 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 0, 'old world response is ignored after switching tabs');
    pendingBoards.get('winStreak')({ topEntries: [], myInfo: { rank: 9, uid: 'self', name: '我', count: 12 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 1);
    assert.equal(renders[0].index, 2);
    rank.refreshRankList(3);
    rank.postOpenDataMessage = rank.stopPopupTweens = () => {};
    rank.onDestroy();
    pendingBoards.get('level')({ topEntries: [], myInfo: { rank: 8, uid: 'self', name: '我', count: 888 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 1, 'world requests are invalidated when the ranking popup closes');

    const avatars = new exported.UIRankLayer();
    const avatarItem = loadNode(prefab.find(node => node.itemNode).itemNode.__id__);
    avatars.prepareRankItemNode(avatarItem);
    const tasks = [];
    const downloads = [];
    avatars.scheduleOnce = callback => tasks.push(callback);
    avatars.loadAvatarSpriteFrame = (url, callback) => downloads.push({ url, callback });
    avatars.setAvatar(avatarItem, 'https://example.com/profile.png');
    tasks.shift()();
    avatars.setAvatar(avatarItem, 'https://example.com/1.jpg');
    downloads.shift().callback({ name: 'old-avatar' });
    assert.equal(avatarItem.getChildByName('avatar').active, false, 'a late download cannot replace the default avatar');
    assert.equal(avatarItem.getChildByName('defaultHead').active, true);
    assert.equal(tasks.length, 0, 'legacy default URLs do not trigger remote loads');
    avatars.setAvatar(avatarItem, 'https://example.com/profile.png');
    tasks.shift()();
    downloads.shift().callback({ name: 'real-avatar' });
    assert.equal(avatarItem.getChildByName('avatar').active, true, 'normal remote avatars still display');
    assert.equal(avatarItem.getChildByName('defaultHead').active, false);

    const texts = [];
    const requests = [];
    const context = { clearRect() { texts.length = 0; }, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, drawImage() {}, save() {}, restore() {}, rect() {}, clip() {}, strokeText() {}, fillText(text, x, y) { texts.push({ text, x, y }); }, measureText(text) { return { width: text.length * 22 }; } };
    const sharedCanvas = { width: 640, height: 1055, getContext: () => context };
    const friend = { wx: { getSharedCanvas: () => sharedCanvas, onMessage() {}, createImage: () => ({ set src(url) { requests.push(url); } }) }, console };
    vm.createContext(friend);
    vm.runInContext(fs.readFileSync(path.join(root, 'build-templates/wechatgame/openDataContext/index.js'), 'utf8'), friend);
    friend.rankViewActive = true;
    friend.currentFallbackSelf = { openid: 'self', nickname: '我', rankScore: 1 };
    const friends = Array.from({ length: 19 }, (_, i) => ({ openid: `other-${i}`, nickname: '长昵称玩家ABCDEFGHIJK', rankScore: 100 - i, avatarUrl: 'https://example.com/1.jpg' }));
    const list = friend.mergeFallbackSelf(friends);
    assert.equal(list.length, 10);
    assert.equal(friend.currentSelfRank.rank, 20, 'friend footer keeps the real rank outside the displayed list');
    assert.ok(!list.some(item => item.isSelf), 'a lower ranked self is not inserted into the top 10');
    friend.drawRankList(list);
    assert.ok(texts.some(item => item.text === '第97关'));
    assert.ok(texts.some(item => item.text === '我的排名'));
    assert.ok(texts.some(item => item.text === '20'));
    assert.ok(!requests.some(url => url.includes('1.jpg')), 'the legacy default avatar is never requested');
    const footerY = texts.find(item => item.text === '我的排名').y;
    friend.handleMessage({ type: 'scrollRank', deltaY: 10000 });
    assert.ok(friend.rankScrollOffset > 0, 'friend rows scroll above the footer');
    assert.equal(texts.find(item => item.text === '我的排名').y, footerY, 'footer stays fixed while scrolling');
    let pendingFriends;
    friend.wx.getFriendCloudStorage = options => { pendingFriends = options; };
    friend.handleMessage({ type: 'rankData', fallbackSelf: { openid: 'self', nickname: '我', rankScore: 888 } });
    friend.handleMessage({ type: 'clear' });
    pendingFriends.success({ data: [] });
    assert.equal(texts.length, 0, 'a late friend response cannot redraw a cleared board');
    friend.handleMessage({ type: 'engine' });
    assert.equal(texts.length, 0, 'canvas resize messages cannot revive a closed ranking');
    friend.handleMessage({ type: 'rankData', fallbackSelf: { openid: 'self', nickname: '我', rankScore: 888 } });
    pendingFriends.fail();
    assert.ok(texts.some(item => item.text === '未上榜'), 'failed friend requests do not invent first place');
    assert.ok(texts.some(item => item.text === '888关'), 'local progress remains visible on request failure');
    console.log('Rank layout, self-rank data, avatar fallback, tab switching and fixed-footer scrolling checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
