// Independently compare the shipped bundle against the extracted source JSON.
// node tools/test-travel-import.cjs [E:/wx/tile_explorer_analysis/json]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isTravelBlocked, assignTravelFaces, MAX_TRAVEL_LEVEL, TRAVEL_DATA_VERSION } = require('../assets/game/script/config/TravelLevels.ts');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] || 'E:/wx/tile_explorer_analysis/json';
const read = name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const main = read('tables/mainlevel.json');
const configs = read('tables/leveldata.json');
const layouts = new Map(Object.values(read('tables/levelbyte.json')).map(row => [row.LevelByte, row]));
const boards = new Map();
const types = fs.readdirSync(path.join(root, 'assets/game/resources/mahjong')).filter(file => /^\d+\.png$/.test(file))
    .map(file => file.slice(0, -4)).sort((a, b) => +a - +b);
const retained = [], skipped = [];
// Independent explicit whitelist: default empty link metadata is the only other permitted field.
for (let originalLevel = 1; originalLevel <= 2160; originalLevel++) {
    const order = main[originalLevel], config = configs[order.AndroidLevelID], layout = layouts.get(config.LevelByte);
    const filename = `level${Math.floor((layout.ID - 1) / 100)}.json`;
    if (!boards.has(filename)) boards.set(filename, read(`boards/${filename}`));
    const board = boards.get(filename).levels[(layout.ID - 1) % 100];
    assert.ok(board?.levelLayers, `Undecoded source level ${originalLevel}`);
    const special = ['levelTowers', 'levelFallings', 'levelTransfers', 'levelTransferRoadInfo', 'levelBoxes', 'levelMirrorInfos']
        .some(key => board[key]?.length > 0)
        || board.isStoneGameLevelConfig
        || board.linkGameInfo?.tilePairs?.length || board.linkGameInfo?.hintPaths?.length
        || Object.values(board.linkGameInfo?.borderInfo || {}).some(value => Number(value) !== 0)
        || board.levelLayers.some(layer => (layer.tileInfos || []).some(tile => tile.type !== 0 || tile.isFalling || tile.isTransfer || tile.isMirrorGenerated));
    if (special) skipped.push(originalLevel);
    else retained.push({ originalLevel, order, config, layout, filename, board });
}
assert.equal(retained.length, 971); assert.equal(retained.length, MAX_TRAVEL_LEVEL); assert.equal(skipped.length, 1189);
assert.deepEqual(retained.slice(0, 20).map(row => row.originalLevel), [1,2,3,4,5,6,7,8,9,10,11,12,14,16,18,20,23,25,26,28]);
assert.deepEqual(retained.slice(-5).map(row => row.originalLevel), [2150,2153,2154,2155,2159]);
const counts = { levels: 0, tiles: 0, flipTiles: 0 };
const expectedFiles = [];
for (let first = 1; first <= MAX_TRAVEL_LEVEL; first += 100) {
    const last = Math.min(first + 99, MAX_TRAVEL_LEVEL);
    const file = `levels_${String(first).padStart(4, '0')}_${String(last).padStart(4, '0')}.json`;
    expectedFiles.push(file, `${file}.meta`);
    const chunk = JSON.parse(fs.readFileSync(path.join(root, 'assets/config_levels_travel', file)));
    assert.equal(chunk.version, TRAVEL_DATA_VERSION); assert.equal(chunk.startLevel, first); assert.equal(chunk.endLevel, last);
    assert.equal(chunk.levels.length, last - first + 1);
    for (const [offset, plan] of chunk.levels.entries()) {
        assert.equal(plan.level, first + offset);
        const { originalLevel, order, config, layout, filename, board } = retained[plan.level - 1];
        assert.equal(plan.source.originalLevel, originalLevel);
        assert.equal(plan.source.game, 'Tile Explorer'); assert.equal(plan.source.version, '1.97.0');
        assert.equal(plan.source.platform, 'Android'); assert.equal(plan.source.levelId, config.ID);
        assert.equal(plan.layoutId, layout.ID); assert.equal(plan.source.layoutName, config.LevelByte);
        assert.equal(plan.title, config.LevelByte); assert.equal(plan.source.typeTag, layout.TypeTag);
        assert.equal(plan.source.boardFile, filename);
        assert.equal(plan.source.boardIndex, (layout.ID - 1) % 100);
        assert.equal(plan.source.boardHash, hash(board)); assert.equal(plan.source.dataHash, hash(config));
        assert.equal(plan.source.tileCount, layout.TileNum); assert.equal(plan.tiles.length, layout.TileNum);
        assert.equal(plan.tiles.length % 3, 0); assert.equal(plan.groups, undefined);
        assert.equal(plan.difficulty, ({ N: 'normal', H: 'hard', SH: 'superHard' })[order.AndroidLevelHardTag]);
        assert.deepEqual(plan.deal, { tileTypes: config.TileTypes, typeWeight: config.TypeWeight, difficulty: config.Difficulty,
            createRule: config.CreateRule, algorithm: 'weighted-solvable-adaptation-v1' });
        const expected = [];
        board.levelLayers.forEach((layer, layerIndex) => {
            for (const tile of layer.tileInfos || []) expected.push([layerIndex, +tile.x, -tile.y || 0, tile.type, !!tile.isFlipTile]);
        });
        assert.deepEqual(plan.tiles.map(tile => [tile.layer, tile.col, tile.row, tile.sourceType, tile.faceDown]), expected,
            `Unchanged layer/coordinate/source-type: ${plan.level}`);
        const bounds = { minCol: Math.min(...expected.map(tile => tile[1])), maxCol: Math.max(...expected.map(tile => tile[1])),
            minRow: Math.min(...expected.map(tile => tile[2])), maxRow: Math.max(...expected.map(tile => tile[2])) };
        assert.deepEqual(plan.bounds, bounds);
        assert.equal(plan.width, bounds.maxCol - bounds.minCol + 1); assert.equal(plan.height, bounds.maxRow - bounds.minRow + 1);
        assert.equal(plan.centerCol, (bounds.minCol + bounds.maxCol) / 2); assert.equal(plan.centerRow, (bounds.minRow + bounds.maxRow) / 2);
        const faceCounts = new Map();
        for (const [id, tile] of plan.tiles.entries()) {
            assert.equal(tile.id, id); assert.equal(tile.groupId, undefined); assert.ok(types.includes(tile.type));
            faceCounts.set(tile.type, (faceCounts.get(tile.type) || 0) + 1);
        }
        assert.ok([...faceCounts.values()].every(count => count % 3 === 0));
        const clone = JSON.parse(JSON.stringify(plan));
        const solution = assignTravelFaces(clone, types);
        assert.deepEqual(clone.tiles.map(tile => tile.type), plan.tiles.map(tile => tile.type));
        const remaining = plan.tiles.slice();
        for (const [step, id] of solution.entries()) {
            const tile = plan.tiles[id];
            assert.equal(tile.type, plan.tiles[solution[Math.floor(step / 3) * 3]].type);
            // Independently calculate upper-layer overlap for every step of the solution.
            const blocked = remaining.some(other => other.layer > tile.layer
                && Math.abs(other.col - tile.col) < 0.98 && Math.abs(other.row - tile.row) < 0.98);
            assert.equal(blocked, isTravelBlocked(tile, remaining));
            assert.equal(blocked, false, `Reachable source tile ${plan.level}:${id}`);
            remaining.splice(remaining.indexOf(tile), 1);
        }
        assert.equal(remaining.length, 0);
        counts.levels++; counts.tiles += plan.tiles.length; counts.flipTiles += plan.tiles.filter(tile => tile.faceDown).length;
    }
}
assert.deepEqual(fs.readdirSync(path.join(root, 'assets/config_levels_travel')).sort(), expectedFiles.sort(), 'Only ten filtered chunks + metas');
const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'travel-import-report.json')));
assert.deepEqual(report.kept.map(row => row.originalLevel), retained.map(row => row.originalLevel));
assert.deepEqual(report.skipped.map(row => row.originalLevel), skipped);
assert.deepEqual(counts, { levels: 971, tiles: 80184, flipTiles: 0 });
console.log(`PASS source filtering, original order/coordinates/layers, hashes, ten chunks and complete solution certificates: ${JSON.stringify(counts)}`);
