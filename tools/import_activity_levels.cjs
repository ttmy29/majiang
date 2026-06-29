#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_EXTERNAL_DIR = 'D:/Downloads/apk_config/Mahjong Triple Club_1.5.2_level_configs/levels';
const DEFAULT_OUTPUT_DIR = 'E:/work/mahjong_match/assets/config_levels_activity';
const DEFAULT_TILE_DIR = 'E:/work/mahjong_match/assets/game/resources/mahjong';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return number;
}

function listExternalFiles(externalDir) {
  return fs.readdirSync(externalDir)
    .map((name) => {
      const match = name.match(/^Level_(\d+)\.json$/);
      return match ? { name, level: Number(match[1]), filePath: path.join(externalDir, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.level - b.level);
}

function listTileIds(tileDir) {
  return fs.readdirSync(tileDir)
    .map((name) => {
      const match = name.match(/^(\d+)\.png$/);
      return match ? Number(match[1]) : null;
    })
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
}

function createRandom(seed) {
  let value = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }

  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function shuffleByWindow(items, random, windowSize) {
  const result = [];
  for (let i = 0; i < items.length; i += windowSize) {
    result.push(...shuffleInPlace(items.slice(i, i + windowSize), random));
  }
  return result;
}

function convertExternalLayout(external) {
  if (!Array.isArray(external.layers)) {
    throw new Error('External layout must contain layers[]');
  }

  const raw = [];
  for (const layer of external.layers) {
    const z = Math.trunc(toNumber(layer.index, 'layer.index'));
    if (!Array.isArray(layer.stones)) {
      throw new Error(`Layer ${z} must contain stones[]`);
    }
    for (let i = 0; i < layer.stones.length; i++) {
      raw.push({
        z_layer: z,
        source_x: toNumber(layer.stones[i].x, `layer ${z} stone ${i} x`),
        source_y: toNumber(layer.stones[i].y, `layer ${z} stone ${i} y`),
      });
    }
  }

  if (raw.length === 0) {
    throw new Error('External layout contains no stones');
  }

  const minX = Math.min(...raw.map((item) => item.source_x));
  const minY = Math.min(...raw.map((item) => item.source_y));
  const positions = raw.map((item, index) => {
    const x_col = Math.round((item.source_x - minX) * 2);
    const y_row = Math.round((item.source_y - minY) * 2);
    const expectedX = minX + x_col / 2;
    const expectedY = minY + y_row / 2;
    if (Math.abs(expectedX - item.source_x) > 1e-6 || Math.abs(expectedY - item.source_y) > 1e-6) {
      throw new Error(`Coordinate (${item.source_x}, ${item.source_y}) is not aligned to a half-cell grid`);
    }
    return {
      z_layer: item.z_layer,
      y_row,
      x_col,
      tile_id: 0,
      source_order: index,
    };
  });

  const occupied = new Set();
  for (const position of positions) {
    const key = positionKey(position);
    if (occupied.has(key)) {
      throw new Error(`Duplicate converted position ${key}`);
    }
    occupied.add(key);
  }

  return positions;
}

function positionKey(position) {
  return `${position.z_layer}|${position.y_row}|${position.x_col}`;
}

function isBlockedBy(upper, lower) {
  return upper.z_layer > lower.z_layer &&
    Math.abs(upper.x_col - lower.x_col) <= 1 &&
    Math.abs(upper.y_row - lower.y_row) <= 1;
}

function buildRemovalOrder(positions) {
  const alive = new Set(positions.map((_, index) => index));
  const order = [];

  while (alive.size > 0) {
    const accessible = [];
    for (const index of alive) {
      const position = positions[index];
      let blocked = false;
      for (const otherIndex of alive) {
        if (otherIndex === index) continue;
        if (isBlockedBy(positions[otherIndex], position)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) accessible.push(index);
    }

    if (accessible.length === 0) {
      throw new Error('Could not build a removal order for layout');
    }

    accessible.sort((a, b) => {
      const pa = positions[a];
      const pb = positions[b];
      return pb.z_layer - pa.z_layer ||
        pa.y_row - pb.y_row ||
        pa.x_col - pb.x_col ||
        pa.source_order - pb.source_order;
    });

    const next = accessible[0];
    alive.delete(next);
    order.push(next);
  }

  return order;
}

function buildTaskIds(levelNo, groupCount, tileIds, random) {
  const offset = (levelNo * 7) % tileIds.length;
  const task = [];
  for (let i = 0; i < groupCount; i++) {
    task.push(tileIds[(offset + i) % tileIds.length]);
  }
  return shuffleByWindow(task, random, 8);
}

function buildTaskQueue(groupTileIds, random, chunkSize) {
  const task = [];
  for (let start = 0; start < groupTileIds.length; start += chunkSize) {
    const end = Math.min(groupTileIds.length, start + chunkSize);
    const indexes = [];
    for (let i = start; i < end; i++) indexes.push(i);
    shuffleInPlace(indexes, random);
    for (const index of indexes) task.push(groupTileIds[index]);
  }
  return task;
}

function assignTileIds(positions, levelNo, tileIds) {
  if (positions.length % 3 !== 0) {
    throw new Error(`Level ${levelNo} has ${positions.length} tiles; tile count must be divisible by 3`);
  }

  const groupCount = positions.length / 3;
  const random = createRandom(`activity-level:${levelNo}:tiles:${positions.length}`);
  const groupTileIds = buildTaskIds(levelNo, groupCount, tileIds, random);
  const removalOrder = buildRemovalOrder(positions);
  const chunkSize = Math.min(3, groupCount);

  for (let start = 0; start < groupCount; start += chunkSize) {
    const count = Math.min(chunkSize, groupCount - start);
    const groupIndexes = [];
    for (let i = 0; i < count; i++) groupIndexes.push(start + i);

    const lanes = [
      shuffleInPlace(groupIndexes.slice(), random),
      shuffleInPlace(groupIndexes.slice(), random),
      shuffleInPlace(groupIndexes.slice(), random),
    ];

    for (let pass = 0; pass < lanes.length; pass++) {
      for (let offset = 0; offset < count; offset++) {
        const groupIndex = lanes[pass][offset];
        const positionIndex = removalOrder[start * 3 + pass * count + offset];
        positions[positionIndex].tile_id = groupTileIds[groupIndex];
      }
    }
  }

  const task = buildTaskQueue(groupTileIds, random, chunkSize);
  return task;
}

function buildDataArray(positions) {
  const maxLayer = Math.max(0, ...positions.map((item) => item.z_layer));
  const maxRow = Math.max(0, ...positions.map((item) => item.y_row));
  const maxCol = Math.max(0, ...positions.map((item) => item.x_col));
  const data = [];

  for (let z = 0; z <= maxLayer; z++) {
    const layer = [];
    for (let y = 0; y <= maxRow; y++) {
      layer.push(Array(maxCol + 1).fill(0));
    }
    data.push(layer);
  }

  for (const position of positions) {
    data[position.z_layer][position.y_row][position.x_col] = position.tile_id;
  }

  return data;
}

function getTileCounts(positions) {
  const counts = new Map();
  for (const position of positions) {
    counts.set(position.tile_id, (counts.get(position.tile_id) || 0) + 1);
  }
  return counts;
}

function buildSummary(positions, task) {
  const layers = Array.from(new Set(positions.map((item) => item.z_layer))).sort((a, b) => a - b);
  const rowsPerLayer = [];
  const colsPerRowMinmax = [];

  for (const layer of layers) {
    const layerItems = positions.filter((item) => item.z_layer === layer);
    rowsPerLayer.push(Math.max(...layerItems.map((item) => item.y_row)) + 1);
    const colCount = Math.max(...layerItems.map((item) => item.x_col)) + 1;
    colsPerRowMinmax.push([colCount, colCount]);
  }

  const tile_counts = {};
  for (const [id, count] of Array.from(getTileCounts(positions).entries()).sort((a, b) => a[0] - b[0])) {
    tile_counts[String(id)] = count;
  }

  return {
    data_layers: layers.length,
    rows_per_layer: rowsPerLayer,
    cols_per_row_minmax: colsPerRowMinmax,
    non_zero_tiles: positions.length,
    tile_counts,
    hard: 4,
    task_count: task.length,
    chain_count: 0,
  };
}

function buildLevelJson(levelNo, external, tileIds) {
  const positions = convertExternalLayout(external);
  const task = assignTileIds(positions, levelNo, tileIds);

  const sortedPositions = positions
    .map(({ source_order, ...position }) => position)
    .sort((a, b) => a.z_layer - b.z_layer || a.y_row - b.y_row || a.x_col - b.x_col || a.tile_id - b.tile_id);
  const name = `activity_level_${levelNo}`;

  return {
    level_no: levelNo,
    level_json: name,
    index_config: {
      level_json: name,
      level_json2: '',
      level_json3: '',
      base_diff: 7,
      type: 0,
      typeNum: 0,
      guideType: 0,
      leveltipsTrigger: 0,
    },
    summary: buildSummary(sortedPositions, task),
    positions: sortedPositions,
    decoded_config: {
      data: buildDataArray(sortedPositions),
      task: [task],
      taskNum: [task.map(() => 3)],
      hard: 4,
      chain: [],
      blockNum: [],
      iceData: [],
      boxData: [],
      flipData: [],
      ironData: [],
      iceFireId: [],
      magnetId: 0,
      magnetBoxData: [],
      shellData: [],
      woodenBoxData: [],
      crossChainData: [],
      foamData: [],
      scrollData: [],
    },
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

function ensureMeta(jsonPath) {
  const metaPath = `${jsonPath}.meta`;
  if (fs.existsSync(metaPath)) return;
  writeJson(metaPath, buildMeta());
}

function main() {
  const externalDir = process.argv[2] || DEFAULT_EXTERNAL_DIR;
  const outputDir = process.argv[3] || DEFAULT_OUTPUT_DIR;
  const tileDir = process.argv[4] || DEFAULT_TILE_DIR;
  const startLevel = process.argv[5] === undefined ? null : Number(process.argv[5]);
  const endLevel = process.argv[6] === undefined ? null : Number(process.argv[6]);

  if (startLevel !== null && (!Number.isInteger(startLevel) || startLevel < 0)) {
    throw new Error(`startLevel must be a non-negative integer, got ${JSON.stringify(process.argv[5])}`);
  }

  if (endLevel !== null && (!Number.isInteger(endLevel) || endLevel < 0)) {
    throw new Error(`endLevel must be a non-negative integer, got ${JSON.stringify(process.argv[6])}`);
  }

  if (startLevel !== null && endLevel !== null && startLevel > endLevel) {
    throw new Error(`startLevel ${startLevel} cannot be greater than endLevel ${endLevel}`);
  }

  const externalFiles = listExternalFiles(externalDir)
    .filter((entry) => startLevel === null || entry.level >= startLevel)
    .filter((entry) => endLevel === null || entry.level <= endLevel);
  if (externalFiles.length === 0) {
    throw new Error(`No Level_N.json files found in ${externalDir} for the requested range`);
  }

  const tileIds = listTileIds(tileDir);
  if (tileIds.length === 0) {
    throw new Error(`No numeric mahjong PNG files found in ${tileDir}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (const entry of externalFiles) {
    const external = readJson(entry.filePath);
    const levelJson = buildLevelJson(entry.level, external, tileIds);
    const outPath = path.join(outputDir, `pure_level${entry.level}_config.json`);
    writeJson(outPath, levelJson);
    ensureMeta(outPath);
    results.push({
      level: entry.level,
      tiles: levelJson.positions.length,
      layers: levelJson.summary.data_layers,
      task: levelJson.decoded_config.task[0].length,
    });
  }

  const tileCounts = results.map((item) => item.tiles);
  console.log(JSON.stringify({
    outputDir,
    levels: results.length,
    range: [results[0].level, results[results.length - 1].level],
    minTiles: Math.min(...tileCounts),
    maxTiles: Math.max(...tileCounts),
  }, null, 2));
}

main();
