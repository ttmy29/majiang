#!/usr/bin/env node
/*
 * generate.cjs — 扫描全部关卡配置 → 跑难度引擎 → 写 data/levels.js → 拷贝真实牌图
 *
 * 用法 (在本目录):  node generate.cjs
 * 重新生成关卡或改了 engine.js 后重跑即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('./engine.js');

const HERE = __dirname;                                  // build-templates/web-mobile/level-atlas
const PROJECT_ROOT = path.resolve(HERE, '..', '..', '..'); // e:/work/mahjong_match
const ASSETS = path.join(PROJECT_ROOT, 'assets');
const MAHJONG_DIR = path.join(ASSETS, 'game', 'resources', 'mahjong');
const OUT_DATA = path.join(HERE, 'data', 'levels.js');
const OUT_TILES = path.join(HERE, 'tiles');
const USER_EVENTS_CSV = path.join(HERE, '..', '自定义事件.csv');
const PRIOR_SAMPLE_SIZE = 80;
const OBSERVED_BLEND_WEIGHT = 0.85;
const RIDGE_LAMBDA = 1.5;

const VARIANTS = [
  { key: 'default', dir: 'level_json' },
  { key: 'retry', dir: 'level_json2' },
  { key: 'ad', dir: 'level_json3' },
];

const ADVANCED_VARIANTS = [
  { key: 'default', dir: 'level_easy' },
  { key: 'retry', dir: 'level_hard' },
  { key: 'ad', dir: 'level_normal' },
];

function listAdvancedVariantDirs() {
  const root = path.join(ASSETS, 'config_levels_advanced');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const dirs = ADVANCED_VARIANTS
    .map((variant) => ({ ...variant, path: path.join(root, variant.dir) }))
    .filter((variant) => fs.existsSync(variant.path) && fs.statSync(variant.path).isDirectory());

  return dirs.length ? dirs : [];
}

function listSegmentDirs() {
  return fs.readdirSync(ASSETS)
    .filter((n) => /^config_levels_\d+_\d+$/.test(n))
    .map((n) => path.join(ASSETS, n))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => {
      const ax = Number(path.basename(a).match(/^config_levels_(\d+)_/)?.[1] || 0);
      const bx = Number(path.basename(b).match(/^config_levels_(\d+)_/)?.[1] || 0);
      return ax - bx || a.localeCompare(b);
    });
}

function levelNoFromFile(file) {
  const m = file.match(/pure_level(\d+)_config\.json$/);
  return m ? Number(m[1]) : null;
}

function collectLevelFile(levels, variant, filePath) {
  const f = path.basename(filePath);
  if (!/pure_level\d+_config\.json$/.test(f)) return false;

  const no = levelNoFromFile(f);
  if (no == null) return false;

  let json;
  try { json = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { console.warn('瑙ｆ瀽澶辫触', f, e.message); return false; }

  const v = extractVariant(json);
  let analyzed;
  try { analyzed = analyzeVariant(v); }
  catch (e) { console.warn('寮曟搸鍒嗘瀽澶辫触 level', no, variant.key, e.message); return false; }

  if (!levels.has(no)) levels.set(no, { no });
  levels.get(no)[variant.key] = analyzed;
  return true;
}

// 从 config JSON 提炼引擎输入 + 展示字段
function extractVariant(json) {
  const dc = json.decoded_config || {};
  // positions：优先用配置自带，缺失时从 data 三维数组重建
  let positions = [];
  if (Array.isArray(json.positions) && json.positions.length) {
    positions = json.positions.map((p) => [p.z_layer, p.y_row, p.x_col, p.tile_id]);
  } else if (Array.isArray(dc.data)) {
    for (let z = 0; z < dc.data.length; z++) {
      const layer = dc.data[z] || [];
      for (let y = 0; y < layer.length; y++) {
        const rowArr = layer[y] || [];
        for (let x = 0; x < rowArr.length; x++) {
          const t = rowArr[x];
          if (t && t !== 0) positions.push([z, y, x, t]);
        }
      }
    }
  }

  const task = Array.isArray(dc.task) && Array.isArray(dc.task[0]) ? dc.task[0].map(Number) : [];
  const chain = Array.isArray(dc.chain) ? dc.chain.filter((c) => Array.isArray(c) && c.length >= 6) : [];
  const iron = Array.isArray(dc.ironData) ? dc.ironData.filter((c) => Array.isArray(c) && c.length >= 3) : [];

  const summary = json.summary || {};
  const baseDiff = (json.index_config && json.index_config.base_diff != null)
    ? json.index_config.base_diff
    : (summary.hard != null ? summary.hard : null);

  return {
    positions, task, chain, iron,
    baseDiff,
    hard: summary.hard != null ? summary.hard : (dc.hard != null ? dc.hard : null),
    summary: {
      data_layers: summary.data_layers != null ? summary.data_layers : null,
      non_zero_tiles: summary.non_zero_tiles != null ? summary.non_zero_tiles : positions.length,
      task_count: summary.task_count != null ? summary.task_count : task.length,
      chain_count: summary.chain_count != null ? summary.chain_count : chain.length,
    },
  };
}

function analyzeVariant(v) {
  const res = Engine.analyze({ positions: v.positions, task: v.task, chain: v.chain, iron: v.iron });
  return {
    positions: v.positions,
    task: v.task,
    chain: v.chain,
    iron: v.iron,
    baseDiff: v.baseDiff,
    hard: v.hard,
    summary: v.summary,
    difficulty: res.difficulty,    // {score, band, label}
    metrics: res.metrics,          // {tiles, layers, peak, forced, ...}
    actions: res.actions,          // 求解线，供浏览器演示回放
  };
}

function copyTiles() {
  if (!fs.existsSync(OUT_TILES)) fs.mkdirSync(OUT_TILES, { recursive: true });
  if (!fs.existsSync(MAHJONG_DIR)) {
    console.warn('!! 找不到牌图目录:', MAHJONG_DIR);
    return 0;
  }
  let n = 0;
  for (const f of fs.readdirSync(MAHJONG_DIR)) {
    if (!f.toLowerCase().endsWith('.png')) continue;
    fs.copyFileSync(path.join(MAHJONG_DIR, f), path.join(OUT_TILES, f));
    n++;
  }
  return n;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function toNumber(v, fallback = null) {
  if (v == null) return fallback;
  const n = Number(String(v).trim().replace(/%$/, ''));
  return Number.isFinite(n) ? n : fallback;
}

function percentileScores(items, valueKey, scoreKey) {
  const sorted = items
    .map((item, index) => ({ item, index, value: item[valueKey] }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  if (sorted.length <= 1) {
    for (const row of sorted) row.item[scoreKey] = sorted.length ? 50 : 0;
    return;
  }
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    const avgRank = (i + j - 1) / 2;
    const score = Math.round((avgRank / (sorted.length - 1)) * 100);
    for (let k = i; k < j; k++) sorted[k].item[scoreKey] = score;
    i = j;
  }
}

function loadUserStats() {
  if (!fs.existsSync(USER_EVENTS_CSV)) {
    console.warn('!! 找不到用户事件 CSV，跳过真实通关压力校准:', path.relative(PROJECT_ROOT, USER_EVENTS_CSV));
    return { map: new Map(), rows: [], priorFailRate: 0, source: path.relative(PROJECT_ROOT, USER_EVENTS_CSV) };
  }

  const lines = fs.readFileSync(USER_EVENTS_CSV, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return { map: new Map(), rows: [], priorFailRate: 0, source: path.relative(PROJECT_ROOT, USER_EVENTS_CSV) };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rawRows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] != null ? cols[i].trim() : ''; });

    const level = toNumber(row['关卡名称']);
    const entries = toNumber(row['关卡进入-人数'], 0);
    const rawPassRate = toNumber(row['通关率(%)']);
    if (!Number.isFinite(level) || !Number.isFinite(entries) || entries <= 0 || !Number.isFinite(rawPassRate)) continue;

    const passRate = clamp(rawPassRate, 0, 100);
    const failRate = 1 - passRate / 100;
    const videoCount = toNumber(row['关卡视频解锁答案（提示+答案）'], 0) || 0;
    rawRows.push({
      level: Math.trunc(level),
      entries: Math.max(0, Math.round(entries)),
      rawPassRate: round(rawPassRate),
      passRate: round(passRate),
      failRate,
      failRatePct: round(failRate * 100),
      timeSec: round(toNumber(row['关卡耗时-时长（S）'], 0) || 0),
      videoCount: Math.max(0, Math.round(videoCount)),
      videoRate: round(entries > 0 ? videoCount / entries : 0, 3),
      ipu: round(toNumber(row['IPU'], 0) || 0, 3),
    });
  }

  const totalEntries = rawRows.reduce((s, r) => s + r.entries, 0);
  const priorFailRate = totalEntries > 0
    ? rawRows.reduce((s, r) => s + r.failRate * r.entries, 0) / totalEntries
    : 0;

  for (const row of rawRows) {
    const smoothedFailRate = (row.failRate * row.entries + priorFailRate * PRIOR_SAMPLE_SIZE)
      / (row.entries + PRIOR_SAMPLE_SIZE);
    row.smoothedFailRate = smoothedFailRate;
    row.smoothedFailRatePct = round(smoothedFailRate * 100);
    row.confidence = round(row.entries / (row.entries + PRIOR_SAMPLE_SIZE), 3);
  }
  percentileScores(rawRows, 'smoothedFailRate', 'pressureScore');

  const map = new Map();
  for (const row of rawRows) {
    map.set(row.level, {
      entries: row.entries,
      rawPassRate: row.rawPassRate,
      passRate: row.passRate,
      failRate: row.failRatePct,
      smoothedFailRate: row.smoothedFailRatePct,
      pressureScore: row.pressureScore,
      confidence: row.confidence,
      timeSec: row.timeSec,
      videoCount: row.videoCount,
      videoRate: row.videoRate,
      ipu: row.ipu,
    });
  }

  return { map, rows: rawRows, priorFailRate, source: path.relative(PROJECT_ROOT, USER_EVENTS_CSV) };
}

function corr(pairs) {
  const clean = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = clean.length;
  if (n < 3) return NaN;
  const mx = clean.reduce((s, p) => s + p[0], 0) / n;
  const my = clean.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (const [x, y] of clean) {
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : NaN;
}

const CALIBRATION_FEATURES = [
  'simScore',
  'peak',
  'avgSlot',
  'peakShare',
  'forced',
  'tiles',
  'layers',
  'types',
  'coveredRatio',
  'topTiles',
  'queueLen',
  'interleave',
  'chainCount',
  'ironCount',
  'unsolvable',
];

function featureVector(d) {
  const m = d.metrics || {};
  const sim = d.simDifficulty || d.difficulty || {};
  return {
    simScore: sim.score || 0,
    peak: m.peak || 0,
    avgSlot: m.avgSlot || 0,
    peakShare: m.peakShare || 0,
    forced: m.forced || 0,
    tiles: m.tiles || 0,
    layers: m.layers || 0,
    types: m.types || 0,
    coveredRatio: m.coveredRatio || 0,
    topTiles: m.topTiles || 0,
    queueLen: m.queueLen || 0,
    interleave: m.interleave || 0,
    chainCount: m.chainCount || 0,
    ironCount: m.ironCount || 0,
    unsolvable: m.solvable ? 0 : 1,
  };
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => row.concat(b[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) continue;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => Number.isFinite(row[n]) ? row[n] : 0);
}

function fitCalibrationModel(samples) {
  const yMean = samples.length ? samples.reduce((s, r) => s + r.y, 0) / samples.length : 50;
  if (samples.length < 12) {
    return {
      features: CALIBRATION_FEATURES,
      means: Object.fromEntries(CALIBRATION_FEATURES.map((f) => [f, 0])),
      stds: Object.fromEntries(CALIBRATION_FEATURES.map((f) => [f, 1])),
      beta: [yMean].concat(CALIBRATION_FEATURES.map(() => 0)),
      fallback: true,
    };
  }

  const means = {};
  const stds = {};
  for (const f of CALIBRATION_FEATURES) {
    means[f] = samples.reduce((s, row) => s + (row.x[f] || 0), 0) / samples.length;
    const variance = samples.reduce((s, row) => s + ((row.x[f] || 0) - means[f]) ** 2, 0) / samples.length;
    stds[f] = Math.sqrt(variance) || 1;
  }

  const p = CALIBRATION_FEATURES.length + 1;
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (const row of samples) {
    const x = [1].concat(CALIBRATION_FEATURES.map((f) => ((row.x[f] || 0) - means[f]) / stds[f]));
    for (let i = 0; i < p; i++) {
      b[i] += x[i] * row.y;
      for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += RIDGE_LAMBDA;
  return { features: CALIBRATION_FEATURES, means, stds, beta: solveLinearSystem(A, b), fallback: false };
}

function predictCalibration(model, d) {
  const x = featureVector(d);
  let y = model.beta[0] || 0;
  for (let i = 0; i < model.features.length; i++) {
    const f = model.features[i];
    y += (model.beta[i + 1] || 0) * ((x[f] || 0) - model.means[f]) / model.stds[f];
  }
  return clamp(y, 0, 100);
}

function quantile(sortedScores, p) {
  return sortedScores.length ? sortedScores[Math.min(sortedScores.length - 1, Math.floor(p * sortedScores.length))] : 0;
}

function bandForThresholds(score, thresholds) {
  if (score <= thresholds.easy) return { band: 'easy', label: '简单' };
  if (score <= thresholds.normal) return { band: 'normal', label: '普通' };
  if (score <= thresholds.hard) return { band: 'hard', label: '困难' };
  return { band: 'very-hard', label: '极难' };
}

function buildBandOutput(thresholds) {
  return [
    { band: 'easy', label: '简单', max: thresholds.easy },
    { band: 'normal', label: '普通', max: thresholds.normal },
    { band: 'hard', label: '困难', max: thresholds.hard },
    { band: 'very-hard', label: '极难', max: null },
  ];
}

function applySimBands(list) {
  const UNSOLV = Engine.CONFIG.unsolvableBase;
  const scores = [];
  for (const lv of list) {
    const d = lv.default; if (!d) continue;
    if (d.metrics.solvable && d.difficulty.score < UNSOLV) scores.push(d.difficulty.score);
  }
  scores.sort((a, b) => a - b);
  const thresholds = { easy: quantile(scores, 0.20), normal: quantile(scores, 0.62), hard: quantile(scores, 0.90) };
  for (const lv of list) {
    for (const key of ['default', 'retry', 'ad']) {
      const d = lv[key]; if (!d) continue;
      const band = d.difficulty.score >= UNSOLV ? { band: 'very-hard', label: '极难' } : bandForThresholds(d.difficulty.score, thresholds);
      d.difficulty.band = band.band;
      d.difficulty.label = band.label;
      d.simDifficulty = { score: d.difficulty.score, band: d.difficulty.band, label: d.difficulty.label };
    }
  }
  return { thresholds: { ...thresholds, unsolvable: UNSOLV }, bands: buildBandOutput({ ...thresholds, hard: UNSOLV }) };
}

function applyUserCalibration(list) {
  const userStats = loadUserStats();
  for (const lv of list) lv.userStats = userStats.map.get(lv.no) || null;

  const samples = [];
  for (const lv of list) {
    if (!lv.default || !lv.userStats) continue;
    samples.push({ x: featureVector(lv.default), y: lv.userStats.pressureScore, level: lv.no });
  }
  const model = fitCalibrationModel(samples);

  const observedPairsBefore = [];
  const observedPairsAfter = [];
  for (const lv of list) {
    const defaultPrediction = lv.default ? predictCalibration(model, lv.default) : null;
    for (const key of ['default', 'retry', 'ad']) {
      const d = lv[key]; if (!d) continue;
      const predictedScore = predictCalibration(model, d);
      const stats = lv.userStats;
      const observedScore = stats ? stats.pressureScore : null;
      const observedWeight = stats ? OBSERVED_BLEND_WEIGHT * stats.confidence : 0;
      const rawScore = stats
        ? observedScore * observedWeight + predictedScore * (1 - observedWeight)
        : predictedScore;
      const score = Math.round(clamp(rawScore, 0, 100));
      d.difficulty = { score, band: 'normal', label: '普通' };
      d.calibration = {
        source: stats ? 'observed-blend' : 'model-predicted',
        predictedScore: round(predictedScore),
        defaultPredictedScore: defaultPrediction == null ? null : round(defaultPrediction),
        observedScore,
        observedWeight: round(observedWeight, 3),
        baseObservedWeight: stats ? OBSERVED_BLEND_WEIGHT : 0,
        confidence: stats ? stats.confidence : 0,
      };
    }
    if (lv.default && lv.userStats) {
      observedPairsBefore.push([lv.default.simDifficulty.score, lv.userStats.smoothedFailRate]);
      observedPairsAfter.push([lv.default.difficulty.score, lv.userStats.smoothedFailRate]);
    }
  }

  const scores = list.map((lv) => lv.default && lv.default.difficulty.score).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const thresholds = { easy: quantile(scores, 0.20), normal: quantile(scores, 0.62), hard: quantile(scores, 0.90) };
  for (const lv of list) {
    for (const key of ['default', 'retry', 'ad']) {
      const d = lv[key]; if (!d) continue;
      const band = bandForThresholds(d.difficulty.score, thresholds);
      d.difficulty.band = band.band;
      d.difficulty.label = band.label;
    }
  }

  return {
    enabled: userStats.rows.length > 0,
    source: userStats.source,
    observedLevels: userStats.map.size,
    priorSampleSize: PRIOR_SAMPLE_SIZE,
    priorFailRate: round(userStats.priorFailRate * 100),
    observedBlendWeight: OBSERVED_BLEND_WEIGHT,
    ridgeLambda: RIDGE_LAMBDA,
    features: CALIBRATION_FEATURES,
    modelFallback: model.fallback,
    correlationBefore: round(corr(observedPairsBefore), 3),
    correlationAfter: round(corr(observedPairsAfter), 3),
    bandThresholds: thresholds,
    bands: buildBandOutput(thresholds),
  };
}

function main() {
  const t0 = Date.now();
  console.log('项目根:', PROJECT_ROOT);

  // 收集 level -> { default?, retry?, ad? }
  const levels = new Map();
  const advancedDirs = listAdvancedVariantDirs();
  const segs = advancedDirs.length ? [] : listSegmentDirs();
  console.log('关卡分段目录:', segs.length);

  let fileCount = 0;
  if (advancedDirs.length) {
    console.log('config_levels_advanced variant dirs:', advancedDirs.map((v) => v.dir).join(', '));
    for (const variant of advancedDirs) {
      for (const f of fs.readdirSync(variant.path)) {
        if (collectLevelFile(levels, variant, path.join(variant.path, f))) fileCount++;
      }
    }
  } else {
  for (const seg of segs) {
    for (const variant of VARIANTS) {
      const dir = path.join(seg, variant.dir);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/pure_level\d+_config\.json$/.test(f)) continue;
        const no = levelNoFromFile(f);
        if (no == null) continue;
        let json;
        try { json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch (e) { console.warn('解析失败', f, e.message); continue; }
        fileCount++;
        const v = extractVariant(json);
        let analyzed;
        try { analyzed = analyzeVariant(v); }
        catch (e) { console.warn('引擎分析失败 level', no, variant.key, e.message); continue; }
        if (!levels.has(no)) levels.set(no, { no });
        levels.get(no)[variant.key] = analyzed;
      }
    }
  }

  }

  const list = Array.from(levels.values()).sort((a, b) => a.no - b.no);

  const simBanding = applySimBands(list);
  const calibration = applyUserCalibration(list);

  // 统计输出
  const bandCount = { easy: 0, normal: 0, 'very-hard': 0, hard: 0 };
  let withRetry = 0, withAd = 0, unsolvable = 0;
  const pairs = []; // [ourScore, baseDiff] 用于相关性 sanity
  for (const lv of list) {
    if (lv.retry) withRetry++;
    if (lv.ad) withAd++;
    const d = lv.default || lv.retry || lv.ad;
    if (d) {
      bandCount[d.difficulty.band] = (bandCount[d.difficulty.band] || 0) + 1;
      if (!d.metrics.solvable) unsolvable++;
      if (d.baseDiff != null) pairs.push([d.difficulty.score, d.baseDiff]);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    engineVersion: Engine.VERSION,
    tileStep: { x: 80, y: 98 },           // Constants.MahjongBoard.TileStepX/Y (半格 = /2)
    tileAspect: 149 / 186,                 // 牌身 root 宽高比
    slotCapacity: Engine.CONFIG.slotCapacity,
    slotFailThreshold: Engine.CONFIG.slotFailThreshold,
    unlockedBoxes: Engine.CONFIG.unlockedBoxes,
    requiredPerBox: Engine.CONFIG.requiredPerBox,
    bands: calibration.bands,
    bandThresholds: calibration.bandThresholds,
    simBands: simBanding.bands,
    simBandThresholds: simBanding.thresholds,
    calibration,
    levels: list,
  };

  if (!fs.existsSync(path.dirname(OUT_DATA))) fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  const js = 'globalThis.MAHJONG_ATLAS = ' + JSON.stringify(payload) + ';\n';
  fs.writeFileSync(OUT_DATA, js, 'utf8');

  const tileN = copyTiles();

  // 相关性 (Pearson) sanity
  let corr = NaN;
  if (pairs.length > 2) {
    const n = pairs.length;
    const sx = pairs.reduce((s, p) => s + p[0], 0), sy = pairs.reduce((s, p) => s + p[1], 0);
    const mx = sx / n, my = sy / n;
    let cov = 0, vx = 0, vy = 0;
    for (const p of pairs) { cov += (p[0] - mx) * (p[1] - my); vx += (p[0] - mx) ** 2; vy += (p[1] - my) ** 2; }
    corr = (vx && vy) ? cov / Math.sqrt(vx * vy) : NaN;
  }

  console.log('--------------------------------------------------');
  console.log('关卡数:', list.length, '| 配置文件:', fileCount);
  console.log('含重开档(json2):', withRetry, '| 含广告档(json3):', withAd);
  console.log('默认档分档分布:', bandCount);
  console.log('默认档判定不可解(2槽cap5):', unsolvable);
  console.log('用户校准 CSV:', calibration.observedLevels, '关 | 旧分相关:', calibration.correlationBefore, '| 新分相关:', calibration.correlationAfter);
  console.log('我们的难度 vs base_diff 皮尔逊相关:', isNaN(corr) ? 'n/a' : corr.toFixed(3));
  console.log('拷贝牌图:', tileN, '张 →', path.relative(PROJECT_ROOT, OUT_TILES));
  console.log('数据写入:', path.relative(PROJECT_ROOT, OUT_DATA), '(' + (fs.statSync(OUT_DATA).size / 1024 / 1024).toFixed(2) + ' MB)');
  console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main();
