// Node 24+: import actual Tile Explorer layouts, never synthesize substitute boards.
// node tools/generate-travel-levels.cjs [--source E:/wx/tile_explorer_analysis/json] [--check]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { assignTravelFaces, isTravelBlocked, MAX_TRAVEL_LEVEL, TRAVEL_DATA_VERSION } = require('../assets/game/script/config/TravelLevels.ts');
const root = path.resolve(__dirname, '..');
const sourceArg = process.argv.indexOf('--source');
if (sourceArg >= 0) assert.ok(process.argv[sourceArg + 1] && !process.argv[sourceArg + 1].startsWith('--'), '--source needs a directory');
const sourceDir = path.resolve(sourceArg < 0 ? 'E:/wx/tile_explorer_analysis/json' : process.argv[sourceArg + 1]);
const outputDir = path.join(root, 'assets/config_levels_travel');
const checkOnly = process.argv.includes('--check');
const read = file => JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const main = read('tables/mainlevel.json');
const data = read('tables/leveldata.json');
const layouts = new Map(Object.values(read('tables/levelbyte.json')).map(row => [row.LevelByte, row]));
const boardCache = new Map();
const types = fs.readdirSync(path.join(root, 'assets/game/resources/mahjong'))
    .filter(name => /^\d+\.png$/.test(name)).map(name => name.slice(0, -4)).sort((a, b) => +a - +b);
assert.ok(types.length >= 20, 'Need at least 20 existing Mahjong face sprites');
const summary = { sourceLevels: 0, retained: 0, skipped: 0, fixedFlipTiles: 0, tiles: 0 };
const report = { source: 'Tile Explorer 1.97.0 Android default mainline', version: TRAVEL_DATA_VERSION, summary, kept: [], skipped: [] };

function resolveSource(originalLevel) {
    const order = main[originalLevel];
    const config = data[order?.AndroidLevelID];
    const layout = layouts.get(config?.LevelByte);
    assert.ok(layout, `Missing source mapping for original level ${originalLevel}`);
    const boardFile = `level${Math.floor((layout.ID - 1) / 100)}.json`;
    const boardIndex = (layout.ID - 1) % 100;
    if (!boardCache.has(boardFile)) boardCache.set(boardFile, read(`boards/${boardFile}`));
    const board = boardCache.get(boardFile).levels?.[boardIndex];
    assert.ok(Array.isArray(board?.levelLayers), `Undecoded source board: ${boardFile} #${boardIndex}`);
    return { originalLevel, order, config, layout, board, boardFile, boardIndex };
}

// Empty link-mode border defaults are not a mechanism. Nonempty collections are.
function hasContent(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.values(value).some(hasContent);
    if (typeof value === 'string') return value !== '' && value !== 'false' && Number(value) !== 0;
    return !!value;
}

function exclusionReasons(board) {
    const reasons = [];
    // Fail closed on any nonempty extra board mechanism, including future decoded fields.
    for (const [key, value] of Object.entries(board)) {
        if (key !== 'levelLayers' && hasContent(value)) reasons.push(key);
    }
    for (const layer of board.levelLayers) {
        for (const tile of layer.tileInfos || []) {
            for (const flag of ['isFalling', 'isTransfer', 'isMirrorGenerated']) {
                if (tile[flag]) reasons.push(flag);
            }
            if (tile.type !== 0) reasons.push(`tileType:${tile.type}`);
            // isFlipTile is deliberately allowed; never invent flip tiles when absent.
        }
    }
    return [...new Set(reasons)].sort();
}

function importLevel(source, level) {
    const { originalLevel, order, config, layout, board, boardFile, boardIndex } = source;
    const tiles = [];
    for (const [layer, layerInfo] of board.levelLayers.entries()) {
        for (const tile of layerInfo.tileInfos || []) {
            const col = Number(tile.x), row = -Number(tile.y) || 0;
            assert.ok(Number.isFinite(col) && Number.isFinite(row), `Invalid source coordinate: ${originalLevel}`);
            tiles.push({ id: tiles.length, layer, row, col, type: '', faceDown: !!tile.isFlipTile, sourceType: tile.type });
        }
    }
    assert.equal(tiles.length, layout.TileNum, `Source tile total mismatch: ${originalLevel}`);
    assert.ok(tiles.length > 0 && tiles.length % 3 === 0, `Invalid source tile total: ${originalLevel}`);
    const bounds = {
        minCol: Math.min(...tiles.map(tile => tile.col)), maxCol: Math.max(...tiles.map(tile => tile.col)),
        minRow: Math.min(...tiles.map(tile => tile.row)), maxRow: Math.max(...tiles.map(tile => tile.row)),
    };
    assert.ok(['N', 'H', 'SH'].includes(order.AndroidLevelHardTag), `Unknown difficulty: ${originalLevel}`);
    const plan = {
        level, layoutId: layout.ID,
        difficulty: order.AndroidLevelHardTag === 'SH' ? 'superHard' : order.AndroidLevelHardTag === 'H' ? 'hard' : 'normal',
        title: config.LevelByte, width: bounds.maxCol - bounds.minCol + 1, height: bounds.maxRow - bounds.minRow + 1,
        centerCol: (bounds.minCol + bounds.maxCol) / 2, centerRow: (bounds.minRow + bounds.maxRow) / 2,
        bounds,
        source: { game: 'Tile Explorer', version: '1.97.0', platform: 'Android', originalLevel, levelId: config.ID,
            layoutName: config.LevelByte, boardFile, boardIndex, boardHash: hash(board), dataHash: hash(config),
            tileCount: layout.TileNum, typeTag: layout.TypeTag },
        deal: { tileTypes: config.TileTypes, typeWeight: config.TypeWeight, difficulty: config.Difficulty,
            createRule: config.CreateRule, algorithm: 'weighted-solvable-adaptation-v1' },
        tiles,
    };
    const solution = assignTravelFaces(plan, types);
    const remaining = tiles.slice();
    for (const [step, id] of solution.entries()) {
        const tile = tiles[id];
        assert.ok(!isTravelBlocked(tile, remaining), `Unreachable dealt tile ${level}:${id}`);
        assert.equal(tile.type, tiles[solution[Math.floor(step / 3) * 3]].type);
        remaining.splice(remaining.indexOf(tile), 1);
    }
    assert.equal(remaining.length, 0);
    summary.tiles += tiles.length;
    summary.fixedFlipTiles += tiles.filter(tile => tile.faceDown).length;
    report.kept.push({ level, originalLevel, levelId: config.ID, layoutId: layout.ID });
    return plan;
}

// Validate every source first. Missing/undecoded layouts abort without substituting fake boards.
const sourceLevels = Object.keys(main).map(Number).sort((a, b) => a - b);
assert.equal(sourceLevels.length, 2160, 'Unexpected source mainline size');
const allLevels = [];
for (const [index, originalLevel] of sourceLevels.entries()) {
    assert.equal(originalLevel, index + 1, 'Missing source progression entry');
    const source = resolveSource(originalLevel);
    const reasons = exclusionReasons(source.board);
    if (reasons.length) report.skipped.push({ originalLevel, levelId: source.config.ID, layoutId: source.layout.ID, reasons });
    else allLevels.push(importLevel(source, allLevels.length + 1));
}
Object.assign(summary, { sourceLevels: sourceLevels.length, retained: allLevels.length, skipped: report.skipped.length });
assert.equal(summary.retained, MAX_TRAVEL_LEVEL);
assert.equal(summary.skipped, 1189);
const expectedNames = [];
for (let first = 1; first <= MAX_TRAVEL_LEVEL; first += 100) {
    const last = Math.min(first + 99, MAX_TRAVEL_LEVEL);
    const name = `levels_${String(first).padStart(4, '0')}_${String(last).padStart(4, '0')}.json`;
    expectedNames.push(name);
    const target = path.join(outputDir, name);
    const content = ['{', `  "version": ${TRAVEL_DATA_VERSION},`, `  "startLevel": ${first},`, `  "endLevel": ${last},`,
        '  "levels": [', allLevels.slice(first - 1, last).map(level => `    ${JSON.stringify(level)}`).join(',\n'), '  ]', '}', ''].join('\n');
    if (checkOnly) assert.equal(fs.readFileSync(target, 'utf8'), content, `Changed import: ${name}`);
    else fs.writeFileSync(target, content, 'utf8'); // Generated data; existing asset UUIDs stay unchanged.
    if (!checkOnly && !fs.existsSync(`${target}.meta`)) {
        fs.writeFileSync(`${target}.meta`, JSON.stringify({ ver: '2.0.1', importer: 'json', imported: true,
            uuid: crypto.randomUUID(), files: ['.json'], subMetas: {}, userData: {} }, null, 2) + '\n');
    }
    assert.ok(fs.existsSync(`${target}.meta`), `Missing asset metadata: ${name}`);
}
const reportPath = path.join(__dirname, 'travel-import-report.json');
const reportContent = JSON.stringify(report, null, 2) + '\n';
if (checkOnly) {
    assert.equal(fs.readFileSync(reportPath, 'utf8'), reportContent, 'Changed import report');
    assert.deepEqual(fs.readdirSync(outputDir).filter(name => name.endsWith('.json')).sort(), expectedNames.sort(), 'Stale bundle chunks');
} else fs.writeFileSync(reportPath, reportContent);
console.log(`${checkOnly ? 'Verified' : 'Imported'} Tile Explorer: ${JSON.stringify(summary)}; ${expectedNames.length} chunks`);
