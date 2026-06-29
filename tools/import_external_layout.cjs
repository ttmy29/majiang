#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function usage() {
  const script = path.basename(process.argv[1]);
  console.error([
    `Usage: node tools/${script} <external-layout.json> <template-level.json> <output-level.json>`,
    '',
    'Converts Mahjong Triple Club style layers[].stones[].x/y layouts into this project\'s',
    'positions + decoded_config.data/task/taskNum + summary format.',
  ].join('\n'));
}

function asFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return number;
}

function convertExternalLayout(external) {
  if (!Array.isArray(external.layers)) {
    throw new Error('External layout must contain layers[]');
  }

  const rawPositions = [];
  for (const layer of external.layers) {
    const z = Math.trunc(asFiniteNumber(layer.index, 'layer.index'));
    if (!Array.isArray(layer.stones)) {
      throw new Error(`External layer ${z} must contain stones[]`);
    }

    for (let i = 0; i < layer.stones.length; i++) {
      const stone = layer.stones[i];
      rawPositions.push({
        z_layer: z,
        source_x: asFiniteNumber(stone.x, `layers[${z}].stones[${i}].x`),
        source_y: asFiniteNumber(stone.y, `layers[${z}].stones[${i}].y`),
      });
    }
  }

  if (rawPositions.length === 0) {
    throw new Error('External layout contains no stones');
  }

  const minX = Math.min(...rawPositions.map((item) => item.source_x));
  const minY = Math.min(...rawPositions.map((item) => item.source_y));

  const positions = rawPositions.map((item) => {
    const x_col = Math.round((item.source_x - minX) * 2);
    const y_row = Math.round((item.source_y - minY) * 2);
    const expectedX = minX + x_col / 2;
    const expectedY = minY + y_row / 2;
    if (Math.abs(expectedX - item.source_x) > 1e-6 || Math.abs(expectedY - item.source_y) > 1e-6) {
      throw new Error(`External coordinate (${item.source_x}, ${item.source_y}) is not aligned to a half-cell grid`);
    }
    return {
      z_layer: item.z_layer,
      y_row,
      x_col,
      tile_id: 0,
    };
  });

  const occupied = new Set();
  for (const position of positions) {
    const key = `${position.z_layer}|${position.y_row}|${position.x_col}`;
    if (occupied.has(key)) {
      throw new Error(`Duplicate converted position ${key}`);
    }
    occupied.add(key);
  }

  return positions;
}

function getTemplateTask(template) {
  const task = template?.decoded_config?.task?.[0];
  if (Array.isArray(task) && task.length > 0) {
    return task.map((id) => Math.trunc(asFiniteNumber(id, 'decoded_config.task id')));
  }

  const counts = new Map();
  const positions = Array.isArray(template.positions) ? template.positions : [];
  for (const position of positions) {
    const id = Math.trunc(asFiniteNumber(position.tile_id, 'template position tile_id'));
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const out = [];
  for (const [id, count] of Array.from(counts.entries()).sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < Math.floor(count / 3); i++) out.push(id);
  }
  return out;
}

function buildTaskForTileCount(template, tileCount) {
  if (tileCount % 3 !== 0) {
    throw new Error(`Converted layout has ${tileCount} tiles; tile count must be divisible by 3`);
  }

  const groupCount = tileCount / 3;
  const templateTask = getTemplateTask(template);
  if (templateTask.length < groupCount) {
    throw new Error(`Template only has ${templateTask.length} task groups, but converted layout needs ${groupCount}`);
  }

  return templateTask.slice(0, groupCount);
}

function assignTileIds(positions, task) {
  const ids = [];
  for (const id of task) {
    ids.push(id, id, id);
  }

  const placementOrder = positions
    .map((position, index) => ({ position, index }))
    .sort((a, b) => {
      return b.position.z_layer - a.position.z_layer ||
        a.position.y_row - b.position.y_row ||
        a.position.x_col - b.position.x_col ||
        a.index - b.index;
    });

  for (let i = 0; i < placementOrder.length; i++) {
    positions[placementOrder[i].index].tile_id = ids[i];
  }
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

  for (const item of positions) {
    data[item.z_layer][item.y_row][item.x_col] = item.tile_id;
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

function buildSummary(positions, counts, task, hard, chainCount) {
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
  for (const [id, count] of Array.from(counts.entries()).sort((a, b) => a[0] - b[0])) {
    tile_counts[String(id)] = count;
  }

  return {
    data_layers: layers.length,
    rows_per_layer: rowsPerLayer,
    cols_per_row_minmax: colsPerRowMinmax,
    non_zero_tiles: positions.length,
    tile_counts,
    hard,
    task_count: task.length,
    chain_count: chainCount,
  };
}

function rebuildLevel(externalLayout, template) {
  const positions = convertExternalLayout(externalLayout);
  const task = buildTaskForTileCount(template, positions.length);
  assignTileIds(positions, task);

  positions.sort((a, b) => {
    return a.z_layer - b.z_layer ||
      a.y_row - b.y_row ||
      a.x_col - b.x_col ||
      a.tile_id - b.tile_id;
  });

  const counts = getTileCounts(positions);
  for (const [id, count] of counts.entries()) {
    if (count % 3 !== 0) {
      throw new Error(`Tile ${id} count ${count} is not divisible by 3`);
    }
  }

  const hard = Number.isFinite(template?.decoded_config?.hard)
    ? template.decoded_config.hard
    : Number.isFinite(template?.summary?.hard)
      ? template.summary.hard
      : 4;
  const next = JSON.parse(JSON.stringify(template));
  next.positions = positions;
  next.decoded_config = {
    ...(next.decoded_config || {}),
    data: buildDataArray(positions),
    task: [task],
    taskNum: [task.map(() => 3)],
    hard,
    chain: [],
  };
  delete next.decoded_config.ironData;
  next.summary = {
    ...(next.summary || {}),
    ...buildSummary(positions, counts, task, hard, 0),
  };

  return next;
}

function main() {
  const [, , externalPath, templatePath, outputPath] = process.argv;
  if (!externalPath || !templatePath || !outputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const externalLayout = readJson(externalPath);
  const template = readJson(templatePath);
  const level = rebuildLevel(externalLayout, template);
  writeJson(outputPath, level);

  const taskCount = level.decoded_config.task[0].length;
  console.log(`Wrote ${outputPath}`);
  console.log(`Converted ${level.positions.length} tiles across ${level.summary.data_layers} layers, ${taskCount} task groups`);
}

main();
