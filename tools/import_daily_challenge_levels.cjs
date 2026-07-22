#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../assets/config_levels_activity');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function coordKey(layer, row, col) {
  return `${layer}|${row}|${col}`;
}

function buildPositions(data, sourceName) {
  assert(Array.isArray(data), `${sourceName}: data must be an array`);

  const positions = [];
  for (let layer = 0; layer < data.length; layer++) {
    assert(Array.isArray(data[layer]), `${sourceName}: data[${layer}] must be an array`);
    for (let row = 0; row < data[layer].length; row++) {
      assert(Array.isArray(data[layer][row]), `${sourceName}: data[${layer}][${row}] must be an array`);
      for (let col = 0; col < data[layer][row].length; col++) {
        const tileId = Number(data[layer][row][col]);
        assert(Number.isFinite(tileId), `${sourceName}: invalid tile at ${layer},${row},${col}`);
        if (tileId === 0) continue;
        assert(Number.isInteger(tileId) && tileId > 0, `${sourceName}: invalid tile id ${tileId}`);
        positions.push({
          z_layer: layer,
          y_row: row,
          x_col: col,
          tile_id: tileId,
        });
      }
    }
  }

  assert(positions.length > 0, `${sourceName}: level contains no tiles`);
  assert(positions.length % 3 === 0, `${sourceName}: tile count ${positions.length} is not divisible by 3`);
  return positions;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function validateTasks(decoded, positions, sourceName) {
  const task = decoded.task?.[0];
  const taskNum = decoded.taskNum?.[0];
  assert(Array.isArray(task), `${sourceName}: task[0] must be an array`);
  assert(Array.isArray(taskNum), `${sourceName}: taskNum[0] must be an array`);
  assert(task.length === positions.length / 3, `${sourceName}: task count does not match tile count`);
  assert(taskNum.length === task.length && taskNum.every((count) => Number(count) === 3), `${sourceName}: taskNum must contain one 3 per task`);

  const tileCounts = countValues(positions.map((position) => position.tile_id));
  const taskCounts = countValues(task.map((tileId) => Number(tileId)));
  for (const [tileId, count] of tileCounts) {
    assert((taskCounts.get(tileId) || 0) * 3 === count, `${sourceName}: tile ${tileId} does not match its task count`);
  }
  for (const tileId of taskCounts.keys()) {
    assert(tileCounts.has(tileId), `${sourceName}: task references missing tile ${tileId}`);
  }
}

function validateMechanicCoordinates(decoded, positions, sourceName) {
  const occupied = new Set(positions.map((position) => coordKey(position.z_layer, position.y_row, position.x_col)));

  for (const chain of decoded.chain || []) {
    assert(Array.isArray(chain) && chain.length >= 6, `${sourceName}: invalid chain entry`);
    assert(occupied.has(coordKey(chain[0], chain[1], chain[2])), `${sourceName}: missing first chain tile`);
    assert(occupied.has(coordKey(chain[3], chain[4], chain[5])), `${sourceName}: missing second chain tile`);
  }

  for (const key of ['ironData', 'flipData']) {
    for (const item of decoded[key] || []) {
      assert(Array.isArray(item) && item.length >= 3, `${sourceName}: invalid ${key} entry`);
      assert(occupied.has(coordKey(item[0], item[1], item[2])), `${sourceName}: missing ${key} tile`);
    }
  }
}

function buildSummary(decoded, positions) {
  const tileCounts = countValues(positions.map((position) => position.tile_id));
  const sortedCounts = Array.from(tileCounts.entries()).sort((a, b) => a[0] - b[0]);
  const rowsPerLayer = decoded.data.map((layer) => layer.length);
  const colsPerRowMinmax = decoded.data.map((layer) => {
    const widths = layer.map((row) => row.length);
    return [Math.min(...widths), Math.max(...widths)];
  });

  return {
    data_layers: decoded.data.length,
    rows_per_layer: rowsPerLayer,
    cols_per_row_minmax: colsPerRowMinmax,
    non_zero_tiles: positions.length,
    tile_counts: Object.fromEntries(sortedCounts.map(([tileId, count]) => [String(tileId), count])),
    hard: Number(decoded.hard) || 0,
    task_count: decoded.task[0].length,
    chain_count: Array.isArray(decoded.chain) ? decoded.chain.length : 0,
  };
}

function buildLevel(entry, decoded, sourceName) {
  const levelNo = Number(entry.level_no);
  assert(Number.isInteger(levelNo) && levelNo > 0, `${sourceName}: invalid level_no`);

  const positions = buildPositions(decoded.data, sourceName);
  validateTasks(decoded, positions, sourceName);
  validateMechanicCoordinates(decoded, positions, sourceName);

  const levelName = `activity_level_${levelNo}`;
  return {
    level_no: levelNo,
    level_json: levelName,
    index_config: {
      level_json: levelName,
      level_json2: '',
      level_json3: '',
      base_diff: Number(entry.base_diff) || 0,
      type: 0,
      typeNum: 0,
      guideType: 0,
      leveltipsTrigger: 0,
    },
    summary: buildSummary(decoded, positions),
    positions,
    decoded_config: decoded,
  };
}

function buildMeta() {
  return {
    ver: '2.0.1',
    importer: 'json',
    imported: true,
    uuid: crypto.randomUUID(),
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
}

function main() {
  const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT_DIR;
  assert(sourceDir, 'Usage: node tools/import_daily_challenge_levels.cjs <sourceDir> [outputDir]');
  assert(fs.existsSync(sourceDir), `Source directory does not exist: ${sourceDir}`);
  assert(path.basename(outputDir) === 'config_levels_activity', `Refusing unexpected output directory: ${outputDir}`);

  const indexPath = path.join(sourceDir, 'index.json');
  const index = readJson(indexPath);
  assert(Array.isArray(index.files) && index.files.length > 0, 'index.json must contain files[]');
  assert(!index.errors || index.errors.length === 0, 'index.json reports extraction errors');

  const levels = index.files.map((entry) => {
    assert(typeof entry.level_json === 'string' && /^[A-Za-z0-9_]+$/.test(entry.level_json), 'index.json contains an invalid level_json');
    const sourceName = `${entry.level_json}.json`;
    const decoded = readJson(path.join(sourceDir, sourceName));
    return buildLevel(entry, decoded, sourceName);
  }).sort((a, b) => a.level_no - b.level_no);

  const levelNumbers = levels.map((level) => level.level_no);
  assert(new Set(levelNumbers).size === levels.length, 'index.json contains duplicate level numbers');
  for (let index = 0; index < levels.length; index++) {
    assert(levels[index].level_no === index + 1, `Expected contiguous levels 1-${levels.length}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const existingFiles = fs.readdirSync(outputDir).filter((name) => /^pure_level\d+_config\.json(?:\.meta)?$/.test(name));
  for (const name of existingFiles) fs.rmSync(path.join(outputDir, name));

  for (const level of levels) {
    const outputPath = path.join(outputDir, `pure_level${level.level_no}_config.json`);
    writeJson(outputPath, level);
    writeJson(`${outputPath}.meta`, buildMeta());
  }

  const tileCounts = levels.map((level) => level.positions.length);
  console.log(JSON.stringify({
    sourceDir,
    outputDir,
    removedFiles: existingFiles.length,
    importedLevels: levels.length,
    range: [levels[0].level_no, levels[levels.length - 1].level_no],
    minTiles: Math.min(...tileCounts),
    maxTiles: Math.max(...tileCounts),
  }, null, 2));
}

main();
