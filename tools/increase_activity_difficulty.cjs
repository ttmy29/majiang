const fs = require('fs');
const path = require('path');

const ACTIVITY_DIR = 'E:/work/mahjong_match/assets/config_levels_activity';
const TILE_DIR = 'E:/work/mahjong_match/assets/game/resources/mahjong';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
        a - b; // fallback to index
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
  return shuffleInPlace(task, random);
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
  const groupCount = positions.length / 3;
  const random = createRandom(`activity-level-harder:${levelNo}:tiles:${positions.length}`);
  const groupTileIds = buildTaskIds(levelNo, groupCount, tileIds, random);
  const removalOrder = buildRemovalOrder(positions);
  
  // To increase difficulty, we use maximum variety (chunkSize = 1) instead of Math.min(3, groupCount)
  const chunkSize = Math.min(10, groupCount);

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

  return buildTaskQueue(groupTileIds, random, chunkSize);
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

function main() {
  const tileIds = listTileIds(TILE_DIR);
  if (tileIds.length === 0) {
    console.error(`No numeric mahjong PNG files found in ${TILE_DIR}`);
    return;
  }

  const files = fs.readdirSync(ACTIVITY_DIR);
  let processed = 0;
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const filePath = path.join(ACTIVITY_DIR, file);
    const data = readJson(filePath);
    if (!data.positions || data.positions.length % 3 !== 0) continue;

    const levelNo = data.level_no || parseInt(file.replace(/[^0-9]/g, '')) || 1;
    
    // Re-assign tiles
    const task = assignTileIds(data.positions, levelNo, tileIds);
    
    // Update data array
    data.decoded_config.data = buildDataArray(data.positions);
    data.decoded_config.task = [task];
    data.decoded_config.taskNum = [task.map(() => 3)];
    
    // Update summary tile counts
    const tile_counts = {};
    for (const [id, count] of Array.from(getTileCounts(data.positions).entries()).sort((a, b) => a[0] - b[0])) {
      tile_counts[String(id)] = count;
    }
    data.summary.tile_counts = tile_counts;
    data.summary.task_count = task.length;
    
    writeJson(filePath, data);
    processed++;
  }
  
  console.log(`Processed and increased difficulty for ${processed} level configurations.`);
}

main();
