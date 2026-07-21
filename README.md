# Mahjong Match

基于 **Cocos Creator 3.8.8** 的麻将消除小游戏项目，项目名为 `mahjong_eliminate`。代码主要使用 TypeScript 编写，玩法围绕堆叠麻将牌、任务盒收集、底部存牌槽、道具、广告/分享激励、关卡存档和云存档同步展开。

## 项目概况

- 引擎版本：Cocos Creator `3.8.8`
- 设计分辨率：`750 x 1334`
- 语言：TypeScript，`tsconfig.json` 中 `strict: false`
- 入口流程：`assets/loading/loading.scene` -> 加载 `game`、`audio`、`bgm` bundle -> `assets/game/game.scene` -> 开始页 -> 游戏页
- 主要平台：微信小游戏，同时保留 Web Mobile 构建模板
- npm：仓库没有运行脚本，`package.json` 只保存 Cocos 项目元信息

## 玩法规则

玩家点击棋盘上未被上层遮挡的麻将牌。牌会根据当前目标分流：

- 命中顶部任务盒目标：飞入对应任务盒。
- 未命中目标：进入底部存牌槽。
- 某个任务盒收集满 `3` 张同类牌后，该任务盒执行完成动画，随后从任务队列中取下一个目标。
- 底部存牌槽中已有的牌，在任务盒刷新出匹配类型时会自动回收进任务盒。

当前默认玩法参数在 [LevelConfig.ts](assets/game/script/config/LevelConfig.ts) 中：

```ts
slotCount: 7
levelTime: 0
unlockedSlotCount: 2
```

注意：底部存牌槽的实际失败判断是 `slots.length >= slotCount - 1`，因此默认 `slotCount = 7` 时，槽内达到 6 张就判定槽位满。

## 游戏系统

- **任务盒**：顶部共 4 个任务盒，默认解锁前 2 个；后续盒子通过解锁逻辑打开。
- **道具**：撤回、换牌、解锁盒子；撤回/换牌次数会持久化，次数用完后可通过激励视频补充。
- **随机免费道具**：部分关卡通过 `Constants.showRandomPropButtonLevel` 显示额外道具入口。
- **新手关**：关卡 `0` 是引导关，通关后直接进入下一关。
- **提示弹窗**：第 `15` 关首次进入会展示 `tips` 弹窗。
- **连击**：连续收集会触发 combo UI 和对应语音。
- **链条牌**：关卡 JSON 的 `decoded_config.chain` 可配置两张牌之间的链条限制。
- **铁锁牌**：关卡 JSON 的 `decoded_config.ironData` 可配置锁住的牌。
- **自动收尾**：非引导关在棋盘稳定且只剩最后一层可点牌时，会自动把剩余可匹配牌送入任务盒。
- **胜利**：棋盘上的牌全部清理完成后通关，保存下一关进度并弹出胜利界面。
- **失败**：槽位满会弹出失败界面；玩家可选择继续或重开。时间到/死局逻辑保留在代码中，其中死局检测当前未启用。

## 关卡数据

关卡数据不在 `assets/game/json` 下，而是按 50 关一组拆成独立 bundle：

```text
assets/config_levels_000_049/
assets/config_levels_050_099/
...
assets/config_levels_1350_1399/
```

每个分段下包含以下盘面目录：

- `level_json`：基础/兜底盘面（保留全部关卡，也是 level-atlas 难度分析的输入）
- `level_base`：前 10 关（含引导关 0）的固定盘面
- `level_easy` / `level_normal` / `level_hard`：第 11 关起按连胜值分配的 简单/普通/困难 三档盘面
- `level_json2` / `level_json3`：旧「重开/看广告变简单」变体，运行时已停用，仅保留供 level-atlas 分析

加载逻辑在 [LevelJsonLoader.ts](assets/game/script/config/LevelJsonLoader.ts)：

- 分段大小由 `Constants.LevelConfigSegmentSize = 50` 控制。
- bundle 前缀由 `Constants.LevelConfigBundlePrefix = 'config_levels_'` 控制。
- `ensureLevelJson(boardId, tier)` 先在对应难度档目录找该盘面，缺档回退到 `level_json`。
- 难度档与盘面由 [StreakManager](assets/game/script/manager/StreakManager.ts) 决定（见 `Constants.WinStreak`）：`config_levels_base` 中存在的同号关卡优先使用基础盘面，其余按普通档 `level_hard` 的实际资源顺序出题；连胜负责升降简单/普通/困难版本，缺少同号变体时回退普通版。顺序盘面全部走完后才随机抽取未重复盘面，全玩过再循环。
- 同一主线关进入失败状态达到 5 次后，如果当前实际盘面存在同号 `level_easy` 配置，后续重开或重新进关会固定切换到该简单盘面；没有同号简单配置时继续使用原难度分配逻辑。
- 当前盘面会预热后续 10 关，并释放窗口外资源。
- 请求超过现有默认关卡范围时，会回落到已存在的最高默认关卡。

当前资源目录中的关卡数量：

| 类型 | 目录 | 数量 |
| --- | --- | ---: |
| 默认关卡 | `level_json` | 1391 |
| 重开变体 | `level_json2` | 130 |
| 广告变体 | `level_json3` | 130 |

关卡 JSON 主要字段：

- `level_no`：关卡号。
- `positions[]`：棋盘牌位，字段为 `{ z_layer, y_row, x_col, tile_id }`。
- `decoded_config.task[0]`：任务盒目标队列，每个 `tile_id` 代表一组 3 张目标牌。
- `decoded_config.taskNum[0]`：任务数量，当前导出工具按每组 3 张重建。
- `decoded_config.chain`：链条配置。
- `decoded_config.ironData`：铁锁配置。
- `summary` / `index_config`：统计和难度信息。

## 目录结构

```text
assets/
  loading/                 加载场景、SDK、HTTP、云存档拉取逻辑
  game/
    game.scene             主场景
    prefab/                游戏内 UI、牌、弹窗、特效预制体
    resources/             牌面、UI、背景、magic 动画等资源
    script/                玩法、UI、管理器和工具脚本
    spine/                 Spine 资源
    spine1/                Spine 资源
  audio/                   音效 bundle
  bgm/                     背景音乐 bundle
  config_levels_*/         分段关卡 bundle
build-templates/
  wechatgame/              微信小游戏构建模板
  web-mobile/              Web Mobile 模板和关卡配置工具页面
settings/                  Cocos Creator 项目配置
profiles/                  Cocos Creator 配置
library/ temp/ build/      Cocos 生成目录或构建产物
```

## 核心脚本

- [loading.ts](assets/loading/loading.ts)：加载页；初始化 SDK，拉取云存档，加载 game/audio/bgm bundle，进入游戏场景。
- [SDKManager.ts](assets/loading/SDKManager.ts)：微信登录、激励视频、分享、埋点上报。
- [HttpManager.ts](assets/loading/HttpManager.ts)：云存档 HTTP 接口封装。
- [GameLaunch.ts](assets/game/script/GameLaunch.ts)：主场景启动；初始化层级、音频、UI 预制体和音效资源。
- [GameCtrl.ts](assets/game/script/GameCtrl.ts)：玩法主控制器；负责发牌、点击分流、任务队列、失败/胜利、道具、快照、自动收尾等。
- [UIGameLayer.ts](assets/game/script/UIGameLayer.ts)：游戏 UI 表现层；监听 `director` 事件渲染任务盒、道具、提示、连击和动画。
- [UIStartLayer.ts](assets/game/script/UIStartLayer.ts)：开始页；处理开始游戏、设置入口、微信原生按钮和关卡预热。
- [LayerManager.ts](assets/game/script/manager/LayerManager.ts)：开始页、游戏页、弹窗、Toast 的层级和预制体管理。
- [AudioManager.ts](assets/game/script/manager/AudioManager.ts)：BGM、音效、开关持久化和临时 ducking/pause。
- [ProgressManager.ts](assets/game/script/manager/ProgressManager.ts)：关卡进度、道具次数、广告次数、重开次数和局内快照。
- [StorageManager.ts](assets/game/script/manager/StorageManager.ts)：`sys.localStorage` 包装。
- [ArchiveManager.ts](assets/game/script/manager/ArchiveManager.ts)：本地存档打包并上传云端。
- [MahjongItem.ts](assets/game/script/MahjongItem.ts)：单张麻将牌表现、触摸、阴影和动效。
- [ironItem.ts](assets/game/script/ironItem.ts)：铁锁表现。
- [boxEffect.ts](assets/game/script/boxEffect.ts)：任务盒特效。

## 事件通信

玩法层和 UI 层主要通过 `director.emit / director.on` 通信，事件名集中在 [Constants.ts](assets/game/script/config/Constants.ts) 的 `eventNames` 中。常用事件包括：

- `GameUiInit`：把牌预制体和牌面资源传给 UI 层。
- `LevelStart`：通知 UI 当前关卡开始。
- `HudUpdate`：刷新剩余牌、槽位、时间、连击等状态。
- `RenderSlot` / `ClearSlot` / `ResetSlots`：任务盒渲染和复位。
- `ShowSlotFillAnimation` / `ShowSlotMoveOut` / `ShowSlotMoveIn` / `ShowSlotUnlock`：任务盒动画。
- `SetUndoButtonStatus` / `SetPropCount` / `SetRandomPropButton`：道具按钮状态。
- `ShowTipsAnimator` / `StopTipsAnimator` / `TipsAnimatorEnd`：闲置提示。
- `FailureContinue` / `FailureRestart` / `WinNextLevel`：胜负弹窗回调。

## 存档与平台逻辑

本地存档使用 `sys.localStorage`，主要 key 定义在 [StorageManager.ts](assets/game/script/manager/StorageManager.ts)：

- 音乐、音效、震动开关
- 当前关卡
- 局内快照
- 第 15 关提示是否展示
- 撤回/换牌道具次数
- 累计广告次数
- 当前关重开次数

云存档流程：

1. `loading.ts` 启动时调用 `HttpManager.loginAndFetchMd5()`。
2. 拉取云端存档并写回本地 `localStorage`。
3. 进入游戏前最多等待 3 秒，超时则使用本地数据继续。
4. 游戏内关键保存点由 `ArchiveManager` 防抖上传。

非微信环境下，登录、广告和部分 SDK 能力会降级或直接执行成功回调，方便编辑器/浏览器调试。

## 音频资源

- 背景音乐：`assets/bgm/mj_bgm.mp3`
- 音效目录：`assets/audio/`
- 当前显式注册使用的音效名在 [AudioManager.ts](assets/game/script/manager/AudioManager.ts) 的 `AudioClipNames` 中，包括按钮、点击麻将、发牌、胜利、失败、换牌提示、任务盒动画和 combo 语音。

## 运行方式

1. 使用 **Cocos Creator 3.8.8** 打开项目根目录。
2. 确认启动场景为 `assets/loading/loading.scene`。
3. 在编辑器中预览运行。

本仓库没有 `npm start`、`npm run build` 等脚本；构建请使用 Cocos Creator 的构建面板。

## 构建与工具

- `build/`：当前已有构建产物目录。
- `build-templates/wechatgame/`：微信小游戏构建模板，包含首屏脚本和背景图。
- `build-templates/web-mobile/level-config.html`：关卡配置/预览工具页面，可导入导出关卡 JSON，并重建 `positions`、`decoded_config.data/task/taskNum` 和 `summary`。
- `engine-mangle-config.json`：引擎混淆相关配置。

## 开发注意事项

- Cocos 资源文件和 `.meta` 文件要一起提交，避免资源 UUID 丢失。
- 新增关卡时放入对应的 `config_levels_XXX_YYY/level_json` 分段；超过当前最高段时需要新增 bundle 目录及 `.meta`。
- 如果要给重开或广告场景配置变体，分别放入同段的 `level_json2` 或 `level_json3`。
- 关卡中同类牌数量应能被 3 整除，并与 `decoded_config.task` 对齐。
- 改任务盒动画耗时，需要同步检查 `Constants.slotAnim`，玩法层会按这些等待时间推进状态。
- `library/`、`temp/`、`build/` 多数是 Cocos 生成目录；改源码和资源时优先看 `assets/`、`settings/`、`build-templates/`。
level_easy   = easy 简单
level_hard   = normal 普通
level_normal = hard 困难/最高档
