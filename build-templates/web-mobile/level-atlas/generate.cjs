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

const VARIANTS = [
  { key: 'default', dir: 'level_json' },
  { key: 'retry', dir: 'level_json2' },
  { key: 'ad', dir: 'level_json3' },
];

function listSegmentDirs() {
  return fs.readdirSync(ASSETS)
    .filter((n) => /^config_levels_\d{3}_\d{3}$/.test(n))
    .map((n) => path.join(ASSETS, n))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort();
}

function levelNoFromFile(file) {
  const m = file.match(/pure_level(\d+)_config\.json$/);
  return m ? Number(m[1]) : null;
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

function main() {
  const t0 = Date.now();
  console.log('项目根:', PROJECT_ROOT);

  // 收集 level -> { default?, retry?, ad? }
  const levels = new Map();
  const segs = listSegmentDirs();
  console.log('关卡分段目录:', segs.length);

  let fileCount = 0;
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

  const list = Array.from(levels.values()).sort((a, b) => a.no - b.no);

  // ---- 按全体默认关卡分布重设分档阈值，使四档都可用 ----
  // 引擎给的是连续真实分；这里按分位数划档 (相对难度)，不可解关 (>=unsolvableBase) 强制极难。
  const UNSOLV = Engine.CONFIG.unsolvableBase;
  const solvableScores = [];
  for (const lv of list) {
    const d = lv.default; if (!d) continue;
    if (d.metrics.solvable && d.difficulty.score < UNSOLV) solvableScores.push(d.difficulty.score);
  }
  solvableScores.sort((a, b) => a - b);
  const q = (p) => solvableScores.length ? solvableScores[Math.min(solvableScores.length - 1, Math.floor(p * solvableScores.length))] : 0;
  // easy: 底部 ~20% | normal: ~20-62% | hard: ~62-90% | very-hard: 顶部 ~10% 及全部不可解
  const TH = { easy: q(0.20), normal: q(0.62), hard: q(0.90) };
  const bandsOut = [
    { band: 'easy', label: '简单', max: TH.normal },          // 显示用阈值上界
    { band: 'normal', label: '普通', max: TH.hard },
    { band: 'hard', label: '困难', max: UNSOLV },
    { band: 'very-hard', label: '极难', max: null },
  ];
  function rebandScore(score) {
    if (score >= UNSOLV) return { band: 'very-hard', label: '极难' };
    if (score <= TH.easy) return { band: 'easy', label: '简单' };
    if (score <= TH.normal) return { band: 'normal', label: '普通' };
    if (score <= TH.hard) return { band: 'hard', label: '困难' };
    return { band: 'very-hard', label: '极难' };
  }
  for (const lv of list) {
    for (const key of ['default', 'retry', 'ad']) {
      const d = lv[key]; if (!d) continue;
      const rb = rebandScore(d.difficulty.score);
      d.difficulty.band = rb.band;
      d.difficulty.label = rb.label;
    }
  }

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
    bands: bandsOut,
    bandThresholds: { easy: TH.easy, normal: TH.normal, hard: TH.hard, unsolvable: UNSOLV },
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
  console.log('我们的难度 vs base_diff 皮尔逊相关:', isNaN(corr) ? 'n/a' : corr.toFixed(3));
  console.log('拷贝牌图:', tileN, '张 →', path.relative(PROJECT_ROOT, OUT_TILES));
  console.log('数据写入:', path.relative(PROJECT_ROOT, OUT_DATA), '(' + (fs.statSync(OUT_DATA).size / 1024 / 1024).toFixed(2) + ' MB)');
  console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main();
