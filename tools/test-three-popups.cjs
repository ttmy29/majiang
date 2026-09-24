const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const allMetas = new Map();
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (p.endsWith('.meta')) {
            const m = read(p);
            if (m.uuid) allMetas.set(m.uuid, { meta: m, path: p.slice(0, -5) });
        }
    }
}
scan(path.join(root, 'assets'));
const compress = uuid => {
    const hex = uuid.replace(/-/g, '');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const n = parseInt(hex.slice(i, i + 3), 16);
        result += alphabet[n >> 6] + alphabet[n & 63];
    }
    return result;
};
const scriptMeta = read(path.join(root, 'assets/game/script/UIThreePopup.ts.meta'));
const componentId = compress(scriptMeta.uuid);
const expectedActions = {
    recoverCount: ['recover'],
    failureThree: ['revive'],
    gameplayGuide: ['close', 'confirm'],
};
for (const [name, actions] of Object.entries(expectedActions)) {
    const p = path.join(root, 'assets/game/prefab', name + '.prefab');
    const objects = read(p);
    const prefabMeta = read(p + '.meta');
    assert.equal(prefabMeta.userData.syncNodeName, name);
    const rootNode = objects[objects[0].data.__id__];
    assert.equal(rootNode._name, name);
    const nodes = objects.filter(o => o.__type__ === 'cc.Node');
    const components = n => n._components.map(c => objects[c.__id__]);
    const comp = (n, type) => components(n).find(c => c.__type__ === type);
    const view = nodes.find(n => n._name === 'view');
    const bg = nodes.find(n => n._name === 'bg');
    const behavior = comp(rootNode, componentId);
    assert.ok(behavior, name + ': bound script');
    assert.equal(objects[behavior.viewNode.__id__], view);
    assert.equal(objects[behavior.maskNode.__id__], bg);
    assert.equal(comp(rootNode, 'cc.Widget')._alignFlags, 45);
    assert.ok(comp(rootNode, 'cc.BlockInputEvents'));
    assert.ok(comp(bg, 'cc.UIOpacity'));
    assert.ok(comp(view, 'cc.UIOpacity'));
    if (name === 'failureThree') {
        assert.equal(objects[behavior.observeNode.__id__]._name, 'observeButton');
    }
    function refs(o) {
        if (!o || typeof o !== 'object') return;
        if ('__id__' in o) assert.ok(Number.isInteger(o.__id__) && objects[o.__id__], name + ': valid internal reference');
        if ('__uuid__' in o) {
            const [uuid, suffix] = o.__uuid__.split('@');
            const asset = allMetas.get(uuid);
            assert.ok(asset || uuid === '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca', name + ': asset exists: ' + uuid);
            if (asset && suffix) assert.ok(asset.meta.subMetas[suffix], 'sprite subasset exists');
        }
        Object.values(o).forEach(refs);
    }
    objects.forEach(refs);
    const fileIds = objects.filter(o => o.fileId).map(o => o.fileId);
    assert.equal(fileIds.length, new Set(fileIds).size, name + ': unique prefab file IDs');
    for (const node of nodes) {
        assert.ok(comp(node, 'cc.UITransform'), node._name + ': UITransform');
        const info = objects[node._prefab.__id__];
        assert.equal(info.root.__id__, 1);
        assert.equal(info.asset.__id__, 0);
        for (const child of node._children) assert.equal(objects[child.__id__]._parent.__id__, objects.indexOf(node));
        for (const c of components(node)) assert.equal(c.node.__id__, objects.indexOf(node));
    }
    const events = objects.filter(o => o.__type__ === 'cc.ClickEvent');
    assert.deepEqual(events.map(e => e.customEventData).sort(), [...actions].sort());
    for (const event of events) {
        assert.equal(event.target.__id__, 1);
        assert.equal(event._componentId, componentId);
        assert.equal(event.handler, 'onAction');
        assert.ok(objects.some(o => o.__type__ === 'cc.Button' && o.clickEvents.some(r => objects[r.__id__] === event)));
    }
    const size = comp(view, 'cc.UITransform')._contentSize;
    for (const r of view._children) {
        const n = objects[r.__id__];
        const bounds = comp(n, 'cc.UITransform')._contentSize;
        assert.ok(Math.abs(n._lpos.x) + bounds.width / 2 <= size.width / 2 + 1, name + '/' + n._name + ': horizontal bounds');
        assert.ok(Math.abs(n._lpos.y) + bounds.height / 2 <= size.height / 2 + 1, name + '/' + n._name + ': vertical bounds');
    }
    for (const [w, h] of [[750, 1334], [750, 1666], [640, 960], [1334, 750]]) {
        const scale = Math.min(behavior.maxScale, (w - 24) / size.width, (h - 32) / size.height);
        assert.ok(size.width * scale <= w - 24 + 0.01);
        assert.ok(size.height * scale <= h - 32 + 0.01);
    }
    console.log(`PASS ${name}: ${nodes.length} nodes, ${events.length} button events; layout and references valid`);
}
const imagesDir = path.join(root, 'assets/game/resources/threePopups');
for (const filename of fs.readdirSync(imagesDir).filter(n => n.endsWith('.png'))) {
    const p = path.join(imagesDir, filename);
    const png = fs.readFileSync(p);
    const m = read(p + '.meta');
    const sf = m.subMetas.f9941.userData;
    assert.equal(sf.rawWidth, png.readUInt32BE(16));
    assert.equal(sf.rawHeight, png.readUInt32BE(20));
    assert.equal(sf.trimType, 'none');
    assert.equal(m.subMetas.f9941.uuid, m.uuid + '@f9941');
    assert.equal(m.subMetas['6c48a'].uuid, m.uuid + '@6c48a');
}
console.log('PASS imported sprite metadata matches all PNG dimensions');
