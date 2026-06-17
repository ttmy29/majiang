# 麻将关卡图鉴 · 真实难度 (level-atlas)

用**真实麻将牌贴图**渲染每一关，并给出基于游戏**真实玩法模拟求解**的难度值。
放在 `build-templates/web-mobile/` 下，会随 Cocos web 构建一起进入 `build/` 输出；也可直接双击 `index.html` 打开（file://）。

## 怎么用

直接双击打开 `index.html` 即可。
- 列表：真实牌面预览 + 难度徽标 + 槽位压力指标，可按难度档 / 机关 / 配置档筛选与排序。
- 点任意关进入详情：左侧是**麻将机自动演示**（按真实规则自动出牌，可看底部槽位填充、三消、自动补全、峰值槽位计量条），右侧是**真实难度分解**；顶部可切换默认 / 重开档 / 广告档对比同一关三档差异。

## 难度怎么算（真实，非估算）

引擎 `engine.js` 严格复刻游戏运行时机制（见 `assets/game/script/GameCtrl.ts` 等）：
- **遮挡可点**：仅被更高层、行列差 ≤1（半格）的牌遮挡；同层永不互挡。
- **目标槽**：默认解锁 **2** 个，每个集满 **3** 张三消；目标按 `decoded_config.task[0]` 顺序出队，并对卡在底部槽里的"急需类型"插队（`assignNewTarget`）。
- **底部槽位补全**：目标槽变化后自动把匹配的底部存牌吸入（`collectStoredTargets`）。
- **容量判负**：底部存牌槽满 **6** 判负。
- **链 / 铁锁**：成对点击 / 邻居移除后解锁，均按源码实现。
- `flipData / crossChain / blockNum` 运行时未使用 → 引擎忽略（与游戏一致）。

难度 = 对每关做**迭代加深求解**，得到"按最优玩法仍被迫同时存放的最小峰值槽位压力"为主因，叠加平均槽位占用、被迫入槽频率、规模、遮挡、机关负载，归一到 **0–100** 连续真实分。
- 分不出胜负（2 槽 cap5 内无解）→ 标记**需解锁/广告**，归入极难段（这是游戏靠广告解锁第 3/4 槽的真实压力点）。
- 四个难度档（简单/普通/困难/极难）的阈值按全体默认关卡的分布自动划定，保证四档都可用；徽标上的**数字**才是真实难度值。
- 配置自带的 `base_diff` / `hard` 是固定占位（全库恒为 7 / 4），仅作对照展示，不参与计算。

## 重新生成（改了关卡或引擎后）

```bash
cd build-templates/web-mobile/level-atlas
node generate.cjs
```

脚本会：扫描 `assets/config_levels_*/{level_json,level_json2,level_json3}/pure_level*_config.json` → 跑 `engine.js` 算难度与演示动作 → 写 `data/levels.js` → 把 `assets/game/resources/mahjong/*.png` 拷到 `tiles/`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 查看器（列表 + 详情 + 自动演示），加载 `engine.js` 与 `data/levels.js` |
| `engine.js` | 难度模拟引擎（UMD，Node 与浏览器共用，保证"算分逻辑 = 演示逻辑"） |
| `generate.cjs` | Node 生成脚本 |
| `data/levels.js` | 生成的数据（`globalThis.MAHJONG_ATLAS`） |
| `tiles/` | 从游戏资源拷贝的真实牌图 |

难度权重 / 分档可在 `engine.js` 顶部 `CONFIG` 调整，改后重跑 `generate.cjs`。
