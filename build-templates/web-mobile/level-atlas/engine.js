/*
 * Mahjong Level Atlas — 难度模拟引擎 (engine.js)
 * ------------------------------------------------------------------
 * UMD 模块：Node (生成脚本) 与浏览器 (自动演示) 共用同一份，
 * 保证"算分逻辑 == 演示逻辑"。
 *
 * 严格复刻游戏运行时机制 (来源 assets/game/script/GameCtrl.ts 等)：
 *   - 遮挡可点：高层、|dx|<=1 且 |dy|<=1 才算遮挡；同层永不互挡。
 *   - 目标槽：默认解锁 2 个，required=3 (三消)。
 *   - 任务队列：decoded_config.task[0] 顺序；assignNewTarget 先按底部 slot
 *     里卡住的"急需类型"插队，否则取队首。
 *   - 底部 slot 自动补全 collectStoredTargets：目标槽变化后把匹配的 slot 牌吸入。
 *   - 容量：slot 安全上限 5，达到 6 即判负 (slotCount-1=6)。
 *   - 链 chain：成对点击，需两端可点且 slot 余量够放不匹配的那张。
 *   - 铁锁 iron：锁住不可点，直到同层正交邻居被移除才解锁。
 *   - flipData / crossChain / blockNum 运行时未使用 —— 引擎忽略。
 *
 * 难度 = 模拟求解出的"最小峰值槽位压力 (minPeakSlot)" 为主因，
 *        叠加规模 / 遮挡 / 机关 / 被迫离目标点击等修正项。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  // ========================= 可调参数 =========================
  var CONFIG = {
    requiredPerBox: 3,        // 三消
    unlockedBoxes: 2,         // 默认解锁的目标槽数
    slotCapacity: 7,          // 底部存牌槽容量
    // 失败阈值 = slotCapacity - 1；安全停放上限 = 阈值 - 1 (再放一张就触发判负)
    get slotFailThreshold() { return Math.max(1, this.slotCapacity - 1); },   // 6
    get slotSafeMax() { return Math.max(1, this.slotFailThreshold - 1); },     // 5

    // 求解搜索预算 (节点数)；大盘面自动按牌数下调，靠贪心兜底
    searchBudgetBase: 90000,
    searchBudgetPerTile: 6000000, // 实际预算 = min(base, perTile / N)，下限 2500
    searchBudgetMin: 2500,

    // ---- 难度评分权重 (0-100，连续) ----
    // 主因 = 槽位压力 (峰值 + 平均占用)，pressureSpan 是可解关压力部分的满分跨度
    pressureSpan: 72,                      // 0..72 由槽位压力贡献
    unsolvableBase: 90,                    // 2 槽 cap5 内无解 → 90+ (需解锁/广告)
    unsolvableSpan: 10,
    solvableCap: 88,                       // 可解关分数上限，与不可解段拉开

    // 修正项 (加到基础分上)
    wSize: 7,        // 规模：牌数 → 0..wSize
    sizeFullTiles: 130, // 牌数达到此值吃满规模分
    wForced: 8,      // 被迫入槽频率 (forced / 三元组数) → 0..wForced
    wOcclusion: 6,   // 遮挡：覆盖率*层数因子 → 0..wOcclusion
    wInterleave: 4,  // 牌型相对队列顺序的交织度 → 0..wInterleave
    wSpecial: 9,     // 机关负载 → 0..wSpecial
    chainWeight: 1.1,
    ironWeight: 1.6,
    specialFull: 10, // 加权机关数达到此值吃满

    // 分档阈值 (绝对分；生成脚本会按分布重写 max，使四档都可用)
    bands: [
      { max: 30, band: 'easy', label: '简单' },
      { max: 50, band: 'normal', label: '普通' },
      { max: 70, band: 'hard', label: '困难' },
      { max: Infinity, band: 'very-hard', label: '极难' },
    ],
  };

  // ========================= 工具 =========================
  function isSameLayerOrthogonalNeighbor(aRow, aCol, bRow, bCol) {
    // 复刻 GameCtrl.isSameLayerOrthogonalNeighbor (同层在外层判定)
    var rowDiff = Math.abs(aRow - bRow);
    var colDiff = Math.abs(aCol - bCol);
    if ((rowDiff === 2 && colDiff === 0) || (rowDiff === 0 && colDiff === 2)) return true;
    return colDiff === 1 && (rowDiff === 2 || rowDiff === 3);
  }

  // 把外部关卡记录规范化成引擎内部静态结构
  // level: { positions:[[z,y,x,tile]...] | [{z_layer,y_row,x_col,tile_id}...],
  //          task:[ids...], chain:[[zA,rA,cA,zB,rB,cB]...], iron:[[z,r,c]...] }
  function buildBoard(level) {
    var rawPos = level.positions || [];
    var tiles = [];
    for (var i = 0; i < rawPos.length; i++) {
      var p = rawPos[i];
      var z, y, x, t;
      if (Array.isArray(p)) { z = p[0]; y = p[1]; x = p[2]; t = p[3]; }
      else { z = p.z_layer; y = p.y_row; x = p.x_col; t = p.tile_id; }
      tiles.push({ uid: i, z: z, y: y, x: x, type: String(t) });
    }
    var N = tiles.length;

    // 遮挡：每张牌的潜在遮挡者 (更高层、|dx|<=1 且 |dy|<=1)
    var blockers = [];
    for (var a = 0; a < N; a++) {
      var ta = tiles[a];
      var list = [];
      for (var b = 0; b < N; b++) {
        if (b === a) continue;
        var tb = tiles[b];
        if (tb.z <= ta.z) continue;
        if (Math.abs(tb.x - ta.x) <= 1 && Math.abs(tb.y - ta.y) <= 1) list.push(b);
      }
      blockers.push(list);
    }

    // 链：uid -> 伙伴 uid
    var partner = new Array(N).fill(-1);
    var chainPairs = [];
    var byCoord = new Map();
    for (var c = 0; c < N; c++) byCoord.set(tiles[c].z + '|' + tiles[c].y + '|' + tiles[c].x, c);
    var chainCfg = level.chain || [];
    for (var ci = 0; ci < chainCfg.length; ci++) {
      var r = chainCfg[ci];
      if (!Array.isArray(r) || r.length < 6) continue;
      var ua = byCoord.get(r[0] + '|' + r[1] + '|' + r[2]);
      var ub = byCoord.get(r[3] + '|' + r[4] + '|' + r[5]);
      if (ua == null || ub == null || ua === ub) continue;
      if (tiles[ua].z !== tiles[ub].z) continue;            // 跨层链不支持 (与运行时一致)
      if (partner[ua] !== -1 || partner[ub] !== -1) continue; // 端点不重复
      partner[ua] = ub; partner[ub] = ua;
      chainPairs.push([ua, ub]);
    }

    // 铁锁：uid -> 解锁邻居 uid 列表 (同层正交邻居)。全部邻居都在 = 仍锁；任一被移除 = 解锁。
    var ironUnlockers = new Map();
    var ironCfg = level.iron || [];
    for (var ii = 0; ii < ironCfg.length; ii++) {
      var ir = ironCfg[ii];
      if (!Array.isArray(ir) || ir.length < 3) continue;
      var lockUid = byCoord.get(ir[0] + '|' + ir[1] + '|' + ir[2]);
      if (lockUid == null) continue;
      var unlockers = [];
      for (var s = 0; s < N; s++) {
        if (s === lockUid) continue;
        var ts = tiles[s];
        if (ts.z !== tiles[lockUid].z) continue;
        if (isSameLayerOrthogonalNeighbor(ts.y, ts.x, tiles[lockUid].y, tiles[lockUid].x)) unlockers.push(s);
      }
      ironUnlockers.set(lockUid, unlockers);
    }

    var queue = (level.task || []).map(function (id) { return String(id); });

    return {
      tiles: tiles, N: N, blockers: blockers,
      partner: partner, chainPairs: chainPairs,
      ironUnlockers: ironUnlockers,
      queue: queue,
    };
  }

  // ========================= 动态状态 =========================
  function initState(board) {
    var alive = new Uint8Array(board.N);
    alive.fill(1);
    var boxes = [];
    for (var i = 0; i < CONFIG.unlockedBoxes; i++) boxes.push({ type: '', progress: 0 });
    var st = {
      alive: alive,
      removedCount: 0,
      slots: [],                 // uid 列表 (按入槽顺序)
      boxes: boxes,
      queue: board.queue.slice(),
      peak: 0,
    };
    settle(board, st, null);     // 初始 pickTargets：给 2 槽分配目标 + 首次吸入
    return st;
  }

  function cloneState(st) {
    return {
      alive: st.alive.slice(),
      removedCount: st.removedCount,
      slots: st.slots.slice(),
      boxes: [{ type: st.boxes[0].type, progress: st.boxes[0].progress },
              { type: st.boxes[1].type, progress: st.boxes[1].progress }],
      queue: st.queue.slice(),
      peak: st.peak,
    };
  }

  function ironLocked(board, st, uid) {
    var unlockers = board.ironUnlockers.get(uid);
    if (!unlockers) return false;        // 非铁锁牌
    if (unlockers.length === 0) return true; // 无解锁邻居 → 永久锁 (异常关)
    for (var i = 0; i < unlockers.length; i++) if (st.alive[unlockers[i]]) return true;
    return false;                        // 有邻居已被移除 → 解锁
  }

  function isBlocked(board, st, uid) {
    var bl = board.blockers[uid];
    for (var i = 0; i < bl.length; i++) if (st.alive[bl[i]]) return true;
    return false;
  }

  function isAccessible(board, st, uid) {
    return st.alive[uid] && !isBlocked(board, st, uid) && !ironLocked(board, st, uid);
  }

  function findMatchingBox(st, type, planned) {
    for (var i = 0; i < st.boxes.length; i++) {
      var box = st.boxes[i];
      var p = planned ? (planned[i] || 0) : 0;
      if (box.type === type && box.progress + p < CONFIG.requiredPerBox) return i;
    }
    return -1;
  }

  // 复刻 assignNewTarget：急需 (slot 里卡住的 type) 插队，否则取队首
  function assignNewTarget(board, st, box) {
    var urgent = [];
    var seen = new Set();
    for (var s = 0; s < st.slots.length; s++) {
      var ty = board.tiles[st.slots[s]].type;
      if (!seen.has(ty)) { seen.add(ty); urgent.push(ty); }
    }
    for (var u = 0; u < urgent.length; u++) {
      var idx = st.queue.indexOf(urgent[u]);
      if (idx >= 0) { box.type = st.queue.splice(idx, 1)[0]; box.progress = 0; return; }
    }
    box.type = st.queue.shift() || '';
    box.progress = 0;
  }

  // 复刻 collectStoredTargets：把匹配活跃目标槽的 slot 牌吸入 (一轮)
  function collectStored(board, st) {
    var planned = {};
    var moves = [];   // {slotPos, boxIndex}
    for (var s = 0; s < st.slots.length; s++) {
      var type = board.tiles[st.slots[s]].type;
      var bi = findMatchingBox(st, type, planned);
      if (bi < 0) continue;
      planned[bi] = (planned[bi] || 0) + 1;
      moves.push({ uid: st.slots[s], boxIndex: bi });
    }
    if (moves.length === 0) return [];
    // 应用：从 slots 移除并送入对应槽
    var pulledUids = [];
    for (var m = 0; m < moves.length; m++) {
      var uid = moves[m].uid;
      var pos = st.slots.indexOf(uid);
      if (pos >= 0) st.slots.splice(pos, 1);
      st.boxes[moves[m].boxIndex].progress += 1;
      st.removedCount += 1;
      pulledUids.push(uid);
    }
    return pulledUids;
  }

  // 让棋盘业务状态彻底安定：完成→换目标→补空槽→吸入，循环至稳定。
  // log (可选) 记录补全动画用的吸入/三消事件。
  function settle(board, st, log) {
    var guard = 0;
    while (guard++ < 1000) {
      var changed = false;
      // 1) 完成的槽 (progress>=required) 清空并换新目标
      for (var i = 0; i < st.boxes.length; i++) {
        var box = st.boxes[i];
        if (box.type && box.progress >= CONFIG.requiredPerBox) {
          if (log) log.push({ kind: 'clear', boxIndex: i, type: box.type });
          assignNewTarget(board, st, box);
          changed = true;
        }
      }
      // 2) 补空槽 (有队列时)
      for (var j = 0; j < st.boxes.length; j++) {
        if (st.boxes[j].type === '' && st.queue.length > 0) {
          assignNewTarget(board, st, st.boxes[j]);
          changed = true;
        }
      }
      // 3) 吸入底部 slot
      var pulled = collectStored(board, st);
      if (pulled.length > 0) {
        changed = true;
        if (log) for (var k = 0; k < pulled.length; k++) log.push({ kind: 'pull', uid: pulled[k] });
      }
      if (!changed) break;
    }
    if (st.slots.length > st.peak) st.peak = st.slots.length;
  }

  // 解锁与某张被移除的牌相邻的铁锁 (无需显式状态——ironLocked 由 alive 推导，这里仅为对齐语义)
  // 在我们的模型里铁锁解锁是 alive 的纯函数，无需额外处理。

  // 在状态上应用一个动作 (会原地修改 st)。返回 false = 非法/导致判负。
  // action: { type:'tap', uid } | { type:'chain', a, b }
  function applyAction(board, st, action, log) {
    if (action.type === 'tap') {
      var uid = action.uid;
      var ty = board.tiles[uid].type;
      st.alive[uid] = 0;
      var bi = findMatchingBox(st, ty, null);
      if (bi >= 0) {
        st.boxes[bi].progress += 1;
        st.removedCount += 1;
        if (log) log.push({ kind: 'toBox', uid: uid, boxIndex: bi });
      } else {
        if (st.slots.length >= CONFIG.slotFailThreshold) { st.alive[uid] = 1; return false; } // 已满，点不动
        st.slots.push(uid);
        if (st.slots.length > st.peak) st.peak = st.slots.length;
        if (log) log.push({ kind: 'toSlot', uid: uid });
        // 达到失败阈值 (6) 即判负
        if (st.slots.length >= CONFIG.slotFailThreshold) { settle(board, st, log); return st.removedCount === board.N; }
      }
      settle(board, st, log);
      return true;
    }
    if (action.type === 'chain') {
      var ua = action.a, ub = action.b;
      // 规划目的地：匹配的进槽，其余进 slot；slot 余量不足则非法
      var planned = {};
      var dest = [];
      var slotNeeded = 0;
      var pair = [ua, ub];
      for (var i = 0; i < 2; i++) {
        var t = board.tiles[pair[i]].type;
        var bi2 = findMatchingBox(st, t, planned);
        if (bi2 >= 0) { dest.push({ uid: pair[i], boxIndex: bi2 }); planned[bi2] = (planned[bi2] || 0) + 1; }
        else { dest.push({ uid: pair[i], boxIndex: -1 }); slotNeeded++; }
      }
      if (st.slots.length + slotNeeded > CONFIG.slotFailThreshold) return false;
      for (var d = 0; d < dest.length; d++) {
        st.alive[dest[d].uid] = 0;
        if (dest[d].boxIndex >= 0) {
          st.boxes[dest[d].boxIndex].progress += 1;
          st.removedCount += 1;
          if (log) log.push({ kind: 'toBox', uid: dest[d].uid, boxIndex: dest[d].boxIndex });
        } else {
          st.slots.push(dest[d].uid);
          if (log) log.push({ kind: 'toSlot', uid: dest[d].uid });
        }
      }
      if (st.slots.length > st.peak) st.peak = st.slots.length;
      settle(board, st, log);
      return true;
    }
    return false;
  }

  function isWin(board, st) { return st.removedCount === board.N; }

  // 枚举当前可行动作 (单点 + 链)
  function candidates(board, st) {
    var out = [];
    var chainHandled = new Set();
    for (var uid = 0; uid < board.N; uid++) {
      if (!st.alive[uid]) continue;
      if (!isAccessible(board, st, uid)) continue;
      var pu = board.partner[uid];
      if (pu !== -1) {
        if (chainHandled.has(uid)) continue;
        // 链：两端都要可点
        if (st.alive[pu] && isAccessible(board, st, pu)) {
          chainHandled.add(uid); chainHandled.add(pu);
          out.push({ type: 'chain', a: uid, b: pu });
        }
        continue;
      }
      out.push({ type: 'tap', uid: uid });
    }
    return out;
  }

  // 给动作打分用于排序 (越小越优先)：完成三消 > 普通匹配 > 入槽(按队列就近+解挡)
  function rankAction(board, st, action) {
    if (action.type === 'chain') {
      // 链优先看是否能匹配
      var bi = findMatchingBox(st, board.tiles[action.a].type, null);
      var bi2 = findMatchingBox(st, board.tiles[action.b].type, null);
      if (bi >= 0 || bi2 >= 0) return 5;
      return 50; // 双双入槽，较差
    }
    var ty = board.tiles[action.uid].type;
    var bi3 = findMatchingBox(st, ty, null);
    if (bi3 >= 0) {
      // 越接近完成越优先 (完成三消最优)
      return 10 - st.boxes[bi3].progress; // progress 2 → 8(完成), 1 → 9, 0 → 10
    }
    // 入槽：按 type 在队列中的位置 (越早越快被救) + 是否解挡
    var qpos = st.queue.indexOf(ty);
    var unblockBonus = countUnblockedBy(board, st, action.uid);
    var base = 100 + (qpos < 0 ? 60 : qpos); // 队列里没有的 type 最差 (永远救不回)
    return base - Math.min(unblockBonus, 8) * 2;
  }

  function countUnblockedBy(board, st, uid) {
    // 估算移除 uid 后能解挡几张 (uid 作为遮挡者出现在多少张牌的 blockers 里)
    var cnt = 0;
    for (var t = 0; t < board.N; t++) {
      if (!st.alive[t]) continue;
      var bl = board.blockers[t];
      for (var i = 0; i < bl.length; i++) { if (bl[i] === uid) { cnt++; break; } }
    }
    return cnt;
  }

  // ---- 精确状态键 (用于搜索去重)：alive 打包 + 目标槽 + 队列 + slot ----
  function stateKey(board, st) {
    var packed = '';
    var alive = st.alive;
    for (var i = 0; i < board.N; i += 8) {
      var b = 0;
      for (var k = 0; k < 8 && i + k < board.N; k++) if (alive[i + k]) b |= (1 << k);
      packed += String.fromCharCode(b);
    }
    var slotTypes = st.slots.map(function (u) { return board.tiles[u].type; }).join(',');
    return packed + '#' +
      st.boxes[0].type + ':' + st.boxes[0].progress + '#' +
      (st.boxes[1] ? st.boxes[1].type + ':' + st.boxes[1].progress : '') + '#' +
      st.queue.join(',') + '#' + slotTypes;
  }

  // 找一个"完全进目标槽"的动作 (单点匹配，或链两端都匹配)；优先能完成三消的。返回 action 或 null
  function fullyMatchingMove(board, st) {
    var best = null, bestScore = -1;
    for (var uid = 0; uid < board.N; uid++) {
      if (!st.alive[uid]) continue;
      if (board.partner[uid] !== -1) continue;       // 链单独处理
      if (!isAccessible(board, st, uid)) continue;
      var bi = findMatchingBox(st, board.tiles[uid].type, null);
      if (bi < 0) continue;
      var sc = st.boxes[bi].progress;                // 越接近完成越优先
      if (sc > bestScore) { bestScore = sc; best = { type: 'tap', uid: uid }; }
    }
    // 链：两端都匹配 (无需 slot) 才算"完全匹配"
    for (var c = 0; c < board.chainPairs.length; c++) {
      var a = board.chainPairs[c][0], bb = board.chainPairs[c][1];
      if (!st.alive[a] || !st.alive[bb]) continue;
      if (!isAccessible(board, st, a) || !isAccessible(board, st, bb)) continue;
      var planned = {};
      var ok = true;
      var pair = [a, bb];
      for (var pi = 0; pi < 2; pi++) {
        var mb = findMatchingBox(st, board.tiles[pair[pi]].type, planned);
        if (mb < 0) { ok = false; break; }
        planned[mb] = (planned[mb] || 0) + 1;
      }
      if (ok) { return { type: 'chain', a: a, b: bb }; } // 链匹配优先返回
    }
    return best;
  }

  // 自动走完所有"免费匹配"动作 (不增加 slot)，把动作追加到 actions
  function autoPlayMatching(board, st, actions) {
    settle(board, st, null);
    var guard = 0, lim = board.N * 4 + 50;
    while (guard++ < lim) {
      if (isWin(board, st)) break;
      var mv = fullyMatchingMove(board, st);
      if (!mv) break;
      applyAction(board, st, mv, null);
      actions.push(mv);
    }
  }

  // 当前所有"需要入槽"的可行动作 (单点非匹配 + 需借 slot 的链)，按"挖掘有用度"排序，取前 K
  function parkCandidates(board, st, K) {
    var needSet = {};
    for (var bi = 0; bi < st.boxes.length; bi++) if (st.boxes[bi].type) needSet[st.boxes[bi].type] = true;
    for (var q = 0; q < st.queue.length && q < 4; q++) needSet[st.queue[q]] = true; // 近未来队列

    var cands = [];
    var chainHandled = {};
    for (var uid = 0; uid < board.N; uid++) {
      if (!st.alive[uid] || !isAccessible(board, st, uid)) continue;
      var pu = board.partner[uid];
      if (pu !== -1) {
        if (chainHandled[uid]) continue;
        if (st.alive[pu] && isAccessible(board, st, pu)) {
          chainHandled[uid] = chainHandled[pu] = true;
          var planned = {}, slotNeed = 0, pr = [uid, pu];
          for (var i = 0; i < 2; i++) { var mb = findMatchingBox(st, board.tiles[pr[i]].type, planned); if (mb < 0) slotNeed++; else planned[mb] = (planned[mb] || 0) + 1; }
          if (slotNeed > 0) cands.push({ action: { type: 'chain', a: uid, b: pu }, slotNeed: slotNeed, uid: uid });
        }
        continue;
      }
      if (findMatchingBox(st, board.tiles[uid].type, null) >= 0) continue; // 匹配的归 autoPlay
      cands.push({ action: { type: 'tap', uid: uid }, slotNeed: 1, uid: uid });
    }

    // 有用度：移除它能让多少"需要的类型"的牌变可点 (它是那些牌当前唯一存活遮挡者)
    for (var cidx = 0; cidx < cands.length; cidx++) {
      var t = cands[cidx].uid;
      var unlockNeeded = 0, unlockAny = 0;
      for (var tt = 0; tt < board.N; tt++) {
        if (!st.alive[tt] || tt === t) continue;
        var bl = board.blockers[tt];
        if (bl.length === 0) continue;
        var isBlockerT = false, otherAlive = false;
        for (var z = 0; z < bl.length; z++) { if (bl[z] === t) isBlockerT = true; else if (st.alive[bl[z]]) otherAlive = true; }
        if (isBlockerT && !otherAlive) { unlockAny++; if (needSet[board.tiles[tt].type]) unlockNeeded++; }
      }
      var qpos = st.queue.indexOf(board.tiles[cands[cidx].uid].type);
      cands[cidx].score = unlockNeeded * 100 + unlockAny * 3 - (qpos < 0 ? 50 : qpos);
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands.slice(0, K);
  }

  var PARK_BRANCH_K = 6;

  // 迭代加深 DFS：在 slot 上限 cap 内求解，分支只发生在"被迫入槽"决策上。
  // 返回 true 表示成功，actions 里是完整动作序列。
  function dfsCap(board, st, cap, visited, counter, budget, actions) {
    autoPlayMatching(board, st, actions);
    if (isWin(board, st)) return true;
    if (counter.n++ > budget) return false;
    if (st.slots.length > cap) return false;
    var key = stateKey(board, st);
    if (visited.has(key)) return false;
    visited.add(key);

    var parks = parkCandidates(board, st, PARK_BRANCH_K);
    if (parks.length === 0) return false;   // 无匹配可走、又无法入槽 → 死局
    for (var i = 0; i < parks.length; i++) {
      if (st.slots.length + parks[i].slotNeed > cap) continue;
      var ns = cloneState(st);
      var ok = applyAction(board, ns, parks[i].action, null);
      if (!ok || ns.slots.length > cap) continue;
      var saved = actions.length;
      actions.push(parks[i].action);
      if (dfsCap(board, ns, cap, visited, counter, budget, actions)) return true;
      actions.length = saved;   // 回溯：撤销本分支追加的所有动作
    }
    return false;
  }

  // 求最小峰值槽位 (0..5)；若 cap5 内无解 → {solvable:false, peak:6}
  function solveMinPeak(board) {
    var budget = Math.max(CONFIG.searchBudgetMin,
      Math.min(CONFIG.searchBudgetBase, Math.floor(CONFIG.searchBudgetPerTile / Math.max(1, board.N))));
    for (var cap = 0; cap <= CONFIG.slotSafeMax; cap++) {
      var st = initState(board);
      var visited = new Set();
      var counter = { n: 0 };
      var actions = [];
      if (dfsCap(board, st, cap, visited, counter, budget, actions)) {
        return { solvable: true, peak: cap, actions: actions };
      }
    }
    return { solvable: false, peak: CONFIG.slotFailThreshold, actions: bestEffortLine(board) };
  }

  // 不可解时给演示用的"尽力而为"线：尽量匹配，必须入槽时挑有用度最高的，直到卡死/溢出
  function bestEffortLine(board) {
    var st = initState(board);
    var actions = [];
    var guard = 0, lim = board.N * 4 + 80;
    while (guard++ < lim) {
      autoPlayMatching(board, st, actions);
      if (isWin(board, st)) break;
      var parks = parkCandidates(board, st, 1);
      if (parks.length === 0) break;
      if (st.slots.length + parks[0].slotNeed > CONFIG.slotFailThreshold) break;
      if (!applyAction(board, st, parks[0].action, null)) break;
      actions.push(parks[0].action);
      if (st.slots.length >= CONFIG.slotFailThreshold) break;
    }
    return actions;
  }

  // 给定一串动作，重放出演示事件流 + 统计
  function replay(board, actions) {
    var st = initState(board);
    var log = [];
    var forced = 0;
    var slotArea = 0;      // slot 占用对步数的积分 (连续压力信号)
    var atPeakHits = 0;    // 落在峰值的步数
    for (var i = 0; i < actions.length; i++) {
      var act = actions[i];
      var willSlot = (act.type === 'tap' && findMatchingBox(st, board.tiles[act.uid].type, null) < 0);
      if (willSlot) forced++;
      applyAction(board, st, act, log);
      slotArea += st.slots.length;
      if (st.slots.length >= st.peak && st.peak > 0) atPeakHits++;
    }
    var steps = Math.max(1, actions.length);
    return {
      solved: isWin(board, st), peak: st.peak, log: log, forced: forced,
      avgSlot: slotArea / steps,
      peakShare: atPeakHits / steps,
    };
  }

  // ========================= 结构指标 =========================
  function structure(board) {
    var st0 = initStatePlain(board); // 不含初始 settle 的纯静态盘，用于"开局"指标
    var layers = new Set();
    var types = new Set();
    for (var i = 0; i < board.N; i++) { layers.add(board.tiles[i].z); types.add(board.tiles[i].type); }
    var blockedCount = 0, topCount = 0;
    for (var u = 0; u < board.N; u++) {
      if (board.blockers[u].some(function (b) { return st0.alive[b]; })) blockedCount++;
      else topCount++;
    }
    return {
      tiles: board.N,
      layers: layers.size,
      types: types.size,
      coveredRatio: board.N ? blockedCount / board.N : 0,
      topTiles: topCount,
      chainCount: board.chainPairs.length,
      ironCount: board.ironUnlockers.size,
      queueLen: board.queue.length,
    };
  }
  function initStatePlain(board) {
    var alive = new Uint8Array(board.N); alive.fill(1);
    return { alive: alive };
  }

  // 牌型相对队列顺序的交织度：队列里相邻三元组类型频繁切换 → 玩家需在 2 槽间频繁腾挪
  function interleaveScore(board, structureMetrics) {
    var q = board.queue;
    if (q.length < 2) return 0;
    var switches = 0;
    for (var i = 1; i < q.length; i++) if (q[i] !== q[i - 1]) switches++;
    // 归一到 0..1
    return Math.min(1, switches / q.length);
  }

  // ========================= 难度评分 =========================
  // 返回 0-100 连续分 (真实难度值)。band 为绝对分档的"临时值"，
  // 生成脚本会按全体关卡分布重设 band 使四档都可用 (见 generate.cjs)。
  function scoreDifficulty(m) {
    var base;
    if (!m.solvable) {
      base = CONFIG.unsolvableBase;   // 2 槽 cap5 内无解 → 需解锁/广告，封顶段
    } else {
      // 连续槽位压力：整数峰值 + 平均占用，避免 72% 关卡都卡在"峰值2"无法区分
      var ep = 0.6 * m.peak + 0.4 * m.avgSlot;          // 0..slotSafeMax
      base = (ep / CONFIG.slotSafeMax) * CONFIG.pressureSpan;  // 0..pressureSpan
    }

    var triples = Math.max(1, m.queueLen);
    var add = 0;
    add += CONFIG.wSize * Math.min(1, m.tiles / CONFIG.sizeFullTiles);
    add += CONFIG.wForced * Math.min(1, m.forced / triples);           // 每个三元组被迫入槽的频率
    var occ = m.coveredRatio * Math.min(1, (m.layers - 1) / 4);        // 单层关无遮挡因子
    add += CONFIG.wOcclusion * Math.min(1, occ * 1.4);
    add += CONFIG.wInterleave * m.interleave;
    var special = m.chainCount * CONFIG.chainWeight + m.ironCount * CONFIG.ironWeight;
    add += CONFIG.wSpecial * Math.min(1, special / CONFIG.specialFull);

    var score = base + add;
    if (m.solvable) score = Math.min(CONFIG.solvableCap, score);
    else score = Math.min(100, score + Math.min(CONFIG.unsolvableSpan, add * 0.5));
    score = Math.max(0, Math.round(score));

    return { score: score, band: bandForScore(score), label: labelForScore(score) };
  }

  function bandForScore(score) {
    for (var i = 0; i < CONFIG.bands.length; i++) if (score < CONFIG.bands[i].max) return CONFIG.bands[i].band;
    return CONFIG.bands[CONFIG.bands.length - 1].band;
  }
  function labelForScore(score) {
    for (var i = 0; i < CONFIG.bands.length; i++) if (score < CONFIG.bands[i].max) return CONFIG.bands[i].label;
    return CONFIG.bands[CONFIG.bands.length - 1].label;
  }

  // ========================= 对外主接口 =========================
  // 返回该关的完整分析 (含演示用 moveLog)
  function analyze(level) {
    var board = buildBoard(level);
    var struct = structure(board);

    // 迭代加深求最小峰值槽位 (真实难度主因)
    var solve = solveMinPeak(board);
    var bestActions = solve.actions;
    var solved = solve.solvable;

    var final = replay(board, bestActions);
    var metrics = {
      tiles: struct.tiles,
      layers: struct.layers,
      types: struct.types,
      coveredRatio: struct.coveredRatio,
      topTiles: struct.topTiles,
      chainCount: struct.chainCount,
      ironCount: struct.ironCount,
      queueLen: struct.queueLen,
      solvable: solved,
      peak: solved ? final.peak : Math.max(final.peak, CONFIG.slotFailThreshold),
      avgSlot: Math.round(final.avgSlot * 100) / 100,
      peakShare: Math.round(final.peakShare * 100) / 100,
      forced: final.forced,
      interleave: interleaveScore(board, struct),
    };
    var diff = scoreDifficulty(metrics);

    return {
      version: VERSION,
      metrics: metrics,
      difficulty: diff,
      // 演示：把动作序列展开成可回放事件 (含初始布局由调用方用 positions 渲染)
      moveLog: final.log,
      actions: bestActions.map(function (a) {
        return a.type === 'chain' ? { type: 'chain', a: a.a, b: a.b } : { type: 'tap', uid: a.uid };
      }),
    };
  }

  // 浏览器演示需要的：构建静态 board + 提供逐步推进的运行器
  function createRunner(level) {
    var board = buildBoard(level);
    var st = initState(board);
    return {
      board: board,
      state: st,
      reset: function () { st = initState(board); this.state = st; },
      snapshot: function () {
        return {
          alive: Array.prototype.slice.call(st.alive),
          slots: st.slots.slice(),
          boxes: st.boxes.map(function (b) { return { type: b.type, progress: b.progress }; }),
          queue: st.queue.slice(),
          peak: st.peak,
          removedCount: st.removedCount,
          won: isWin(board, st),
        };
      },
      candidates: function () { return candidates(board, st); },
      step: function (action) {
        var log = [];
        var willSlot = (action.type === 'tap' && findMatchingBox(st, board.tiles[action.uid].type, null) < 0);
        var ok = applyAction(board, st, action, log);
        return { ok: ok, log: log, willSlot: willSlot, won: isWin(board, st) };
      },
      isAccessible: function (uid) { return isAccessible(board, st, uid); },
      ironLocked: function (uid) { return ironLocked(board, st, uid); },
      isBlocked: function (uid) { return isBlocked(board, st, uid); },
    };
  }

  var api = {
    VERSION: VERSION,
    CONFIG: CONFIG,
    analyze: analyze,
    buildBoard: buildBoard,
    createRunner: createRunner,
    scoreDifficulty: scoreDifficulty,
  };

  root.MahjongEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
