# Mahjong Match

一个基于 **Cocos Creator 3.8.8** 的麻将消除小游戏工程。TypeScript 编写，包含加载场景、开始界面、游戏主场景、音频管理、关卡 JSON 驱动的棋盘布局，以及一套围绕"任务槽（目标盒）+ 底部存牌槽"的消除玩法。

## 项目概述

这个项目不是传统"三消槽满即消"的羊了个羊式实现，而是在堆叠消除上加入了 **任务槽** 机制：

- 关卡由 JSON 配置驱动，预设棋盘布局与任务出现顺序。
- 玩家点击未被遮挡的麻将牌后：
  - 命中当前任务槽对应牌型，飞入任务槽累计进度。
  - 未命中任务则进入底部存牌槽。
- 任务槽收集满 3 张后，整个槽位会带着收集到的牌一起"飞出屏幕"，再从队列中取出下一个目标"飞回原位"。
- 底部存牌槽里的牌，一旦后续任务槽刷出对应类型，会自动归集进任务槽。

整体上属于"堆叠消除 + 任务收集"的混合玩法，强调读牌、路径规划、任务管理与节奏感。

## 工程结构

```text
assets/
  loading/                     加载场景与加载脚本
  game/
    game.scene                 主游戏场景
    prefab/
      mahjongItem.prefab       麻将牌预制体
      setting.prefab           设置面板预制体
      toastItem.prefab         Toast 提示预制体
    resources/                 牌面、背景、UI 素材
      mahjong/                 主麻将牌面图标
      mahjong2/                备用牌面图标
      home/  ui/  game/        界面与背景资源
    audio/                     全部音效（m4a）
    json/                      pure_level1~level10_config.json 关卡数据
    script/
      GameLaunch.ts            场景启动入口
      GameCtrl.ts              玩法主控制器（仅业务逻辑）
      MahjongItem.ts           单张牌的表现、阴影与触摸
      UIGameLayer.ts           游戏 HUD / 槽位动画 / 提示动画（事件驱动）
      UIStartLayer.ts          开始页逻辑
      UISetingLayer.ts         设置面板逻辑
      config/
        Constants.ts           棋盘参数、事件名、动画时长常量
        LevelConfig.ts         JSON 不覆盖的运行时玩法参数
        LevelJsonLoader.ts     关卡 JSON 预加载与按关号取数据
      manager/
        LayerManager.ts        界面层级 / 弹窗 / Toast
        AudioManager.ts        BGM 与音效播放，开关持久化到 localStorage
settings/                      Cocos Creator 工程配置
build/                         构建产物目录
```

## 玩法规则

### 1. 可点击条件

只有 **未被上层牌遮挡** 的牌可以点击。遮挡判断由 [GameCtrl.isTileBlocked](assets/game/script/GameCtrl.ts) 按 `0.82 * TileStep` 范围逐对比对得出，被遮挡的牌会自动蒙上一层阴影。

### 2. 任务槽（目标盒）

- 顶部最多 4 个任务槽（`slot1`~`slot4`），默认开启 2 个（`unlockedSlotCount`）。
- 每个任务槽固定需要 **3 张相同任务牌**。
- 任务来源是关卡 JSON 中 `decoded_config.task[0]` 的有序队列，按顺序出队，不随机。
- 收集满后：
  - 等抖动峰值结束，触发 **MoveOut** 动画——盖子下压 + 槽位带着牌一起飞出屏幕。
  - 从队列取下一个目标，触发 **MoveIn** 动画——槽位飞回原位。
  - 队列为空时槽位停在屏幕外（`movedOut = true`），等不到补充就保持下线。
- 解锁按钮可以临时再开一个槽（带"盖子飞出"动画）。

### 3. 底部存牌槽

- 未命中任务的牌进入底部 `slot` 槽。
- 容量由 `slotCount` 控制，默认 7；**实际失败阈值** 是 `slotCount - 1`（默认 7 时即槽里 6 张就判负），这是有意保留的"差一张救命"的紧张感。
- 同类牌会插入到已有同类牌之后，便于聚集观察。
- 每次任务槽刷新或槽位移入后，会再扫描一次存牌槽，把可归集的牌自动飞入对应任务槽（`collectStoredTargets`）。

### 4. 撤回 / 换牌 / 解锁

三个局内按钮，分别绑在 `UIGameLayer.undoButton/switchButton/unlockButton`：

- **撤回**：从 `actionHistory` 弹出最近一次进入存牌槽的牌，飞回原位、恢复可点击、恢复阴影层级。无可撤回时按钮置灰。
- **换牌**：随机打乱所有未消除牌的 type（只重映射，不改总数），随后重渲染任务槽预览。任务总数不变，队列仍可用。
- **解锁槽位**：开启第一个未解锁的任务槽，播完盖子飞出动画后再生成新目标，避免预览图在盖子还没飞走时提前露脸。

### 5. 闲置帮助提示

玩家任一次点牌后开始计 10 秒（`IDLE_TIPS_SECONDS`），到时仍无操作时：

- 随机挑"解锁槽位"或"换牌"其中一个按钮播放呼吸动画 + Tips 渐显。
- 动画播放期间再次点牌会中断提示并重排计时。

### 6. 失败条件

- 底部存牌槽达到 `slotCount - 1`。
- 倒计时归零（`levelTime > 0` 时才计时）。
- **死局检测**（`canStillCompleteTasks`）：把当前任务槽剩余需求 + 任务队列里尚未上场的需求按类型累加，与棋盘剩余张数对比，任一类型供给不足就直接判负。

### 7. 过关条件

棋盘上全部牌被移除（飞入任务槽或仍在存牌槽中视为未消除）。胜利后 1.5 秒自动进入下一关。

## 关卡设计

### 数据来源：关卡 JSON

每关的棋盘布局 / 牌型分布 / 任务顺序都由 `assets/game/json/pure_levelN_config.json` 描述，由 [LevelJsonLoader](assets/game/script/config/LevelJsonLoader.ts) 在游戏启动时 `loadDir` 一次性预加载。

关键字段：

- `level_no`：关号。
- `positions[]`：每张牌的 `{ z_layer, y_row, x_col, tile_id }`，半格坐标。
- `decoded_config.task[0]`：任务出现顺序，是一个 `tile_id` 数组。
- `summary`：行列、各 type 张数、`hard` 难度等元数据。
- `index_config.base_diff`：基础难度系数（运行时仅作为信息读入，不参与生成）。

当前内置 **10 个关卡** 数据文件。请求超出 10 关时，[LevelJsonLoader.getLevelJson](assets/game/script/config/LevelJsonLoader.ts) 兜底返回 `level_no` 最大的那份 JSON，关号继续递增。

### 玩法参数：LevelConfig.ts

JSON 不描述的运行时参数集中在 [LevelConfig.ts](assets/game/script/config/LevelConfig.ts)：

```ts
interface LevelPlayConfig {
    level: number;             // 当前关号（运行时强制注入）
    slotCount: number;         // 底部存牌槽容量，默认 7
    levelTime: number;         // 限时秒数，0 = 不限时
    unlockedSlotCount: number; // 开局解锁的任务槽数，默认 2
}
```

默认值适用所有关卡。需要单独调某关时，把对应 `{ level, ... }` 条目加进 `levelPlayConfigs` 数组即可。

### 棋盘自适应

不同关卡 JSON 的半格跨度差别很大（level1 是 10×10，level9 是 14×16，level10 是 14×8）。`computeBoardFitRatio` 用 pNode UITransform 与棋盘像素 bbox 算出 `fitRatio`，整体缩放 `mahjongPnode` 节点，牌位置 / 间距 / 阴影 / 遮挡阈值同比例跟随，无需改其他玩法逻辑。

## 核心脚本

- [GameLaunch.ts](assets/game/script/GameLaunch.ts)：初始化 LayerManager、AudioManager；加载 Toast / 设置 / 音频资源。
- [GameCtrl.ts](assets/game/script/GameCtrl.ts)：玩法主控制器。生成棋盘、维护牌堆与状态、命中/未命中分流、任务队列出队、死局检测、撤回 / 换牌 / 解锁、HUD / Toast / 连击事件 emit。**只负责业务，不直接改 UI**。
- [UIGameLayer.ts](assets/game/script/UIGameLayer.ts)：监听 GameCtrl 抛出的事件，负责所有 UI 表现：HUD label 更新、目标槽预览渲染、任务槽 Shake / MoveIn / MoveOut / Unlock 动画、闲置提示呼吸动画、撤回按钮置灰、Toast。
- [MahjongItem.ts](assets/game/script/MahjongItem.ts)：单张牌的表现层。设置牌面 / 阴影、可点击遮罩、点击反馈、阴影层（`_shadowLayer_<layer>_` 容器）与渲染层级维护。
- [LevelJsonLoader.ts](assets/game/script/config/LevelJsonLoader.ts)：扫描 `game` bundle 下 `json/` 目录预加载所有关卡 JSON。
- [Constants.ts](assets/game/script/config/Constants.ts)：所有事件名、棋盘几何参数、动画时长常量。**改 UIGameLayer 动画节奏时记得同步这里**，否则会出现动画还没演完业务状态就刷新的衔接 bug。
- [manager/AudioManager.ts](assets/game/script/manager/AudioManager.ts)：BGM / 音效播放，`AudioClipNames` 集中维护 clip 名；声音开关写在 `localStorage` 的 `mahjong_match_audio_enabled`。
- [manager/LayerManager.ts](assets/game/script/manager/LayerManager.ts)：开始 / 游戏 / UI / Popup / Top 层级管理、UI 预制体注册、Toast 队列。
- [UIStartLayer.ts](assets/game/script/UIStartLayer.ts) / [UISetingLayer.ts](assets/game/script/UISetingLayer.ts)：开始页与设置面板。

## 事件总线

GameCtrl ↔ UIGameLayer 完全靠 `director.emit / on` 解耦。事件名集中在 [Constants.eventNames](assets/game/script/config/Constants.ts)：

| 事件名                  | 方向                | 用途                                       |
| ----------------------- | ------------------- | ------------------------------------------ |
| `GameUiInit`            | GameCtrl → UI       | 把 prefab + iconFrames 一次性交给 UI 层    |
| `HudUpdate`             | GameCtrl → UI       | 剩余 / 槽位 / 倒计时 / 连击                |
| `ShowToast`             | GameCtrl → UI       | 弹出文字提示                               |
| `RenderSlot`            | GameCtrl → UI       | 渲染单个任务槽（预览图、锁、提示）         |
| `ClearSlot`             | GameCtrl → UI       | 清理任务槽（销毁预览与已收集牌）           |
| `ResetSlots`            | GameCtrl → UI       | 整局重开时复位所有槽位 transform / box_2   |
| `ShowSlotFillAnimation` | GameCtrl → UI       | 牌落入槽位时的挤压抖动                     |
| `ShowSlotMoveOut`       | GameCtrl → UI       | 任务完成飞出屏幕（盖子下压 + 横向甩出）    |
| `ShowSlotMoveIn`        | GameCtrl → UI       | 新目标飞回原位                             |
| `ShowSlotUnlock`        | GameCtrl → UI       | 解锁动画（盖子飞出 + 槽位回弹）            |
| `SetUndoButtonStatus`   | GameCtrl → UI       | 撤回按钮置灰 / 恢复                        |
| `ShowTipsAnimator`      | GameCtrl → UI       | 闲置 10s 后引导提示（解锁按钮或换牌按钮）  |
| `StopTipsAnimator`      | GameCtrl → UI       | 玩家在提示动画期间点牌，强制中断           |
| `TipsAnimatorEnd`       | UI → GameCtrl       | 玩家响应了提示按钮，解锁"动画中不计时"     |

## 音频

`assets/game/audio/` 下挂了一大堆 m4a，目前在用的只是其中一部分，在 [AudioClipNames](assets/game/script/manager/AudioManager.ts) 中显式声明：

- `button_sound` 按钮点击
- `mj_up` 麻将点击
- `pageopen_sound` 页面打开
- `gaigaizi` 任务完成盖子合上
- `taskBoxMove` 任务槽移入
- `game_start` 开局发牌
- `taskFly` 撤回飞行
- `prop_tips` 换牌提示
- `mj_error` 麻将抖动

未使用的音频资源（`activity_*`、`finishgood`、`niua` 等）保留在工程内备扩展。

## 运行方式

仓库没有 npm 脚本，直接用 **Cocos Creator 3.8.8** 打开。

### 本地预览

1. 打开 Cocos Creator 3.8.8。
2. 导入或打开目录 `E:\work\mahjong_match`。
3. 启动场景：`assets/loading/loading.scene`。
4. 在编辑器中预览运行。

### 构建发布

使用 Cocos Creator 自带的构建面板进行 Web / 原生平台导出，已有产物目录 `build/`。

## 资源与分辨率

- 设计分辨率：`750 x 1334`
- 包含两套牌面（`resources/mahjong`、`resources/mahjong2`），可在 [Constants.MahjongBoard.ResourceDir](assets/game/script/config/Constants.ts) 切换。
- `resources/mahjong/` 下 `flip`、`yinying` 是辅助图（翻面、阴影），通过 `ExcludedFrames` 列表排除在牌型选择之外。

## 当前进度与待办

### 已完成

- 加载场景 → 开始页 → 游戏页的完整链路
- 10 关 JSON 数据 + 棋盘自适应缩放
- 任务队列模式（按 JSON 出队，非随机）
- 顶部 4 槽（默认 2 开 + 2 锁）+ 解锁按钮 + 解锁动画
- 任务完成 MoveOut / MoveIn / 盖子动画 + 抖动
- 撤回 / 换牌 / 解锁三件套
- 闲置 10 秒帮助提示与中断逻辑
- 音频系统 + 设置面板（声音开关持久化）
- 死局检测与自动判负、自动判胜、自动续关
- 阴影系统（同层四方向邻居判定，撤回 / 消除后自动重算）
- Toast 队列（前一条立即上移淡出）

### 已知限制

- **`nowLevel` 默认为 10**：当前 `GameCtrl.nowLevel = 10` 是为了便于调试，正式发布时应该改回 1，或通过本地存档读取。
- **没有本地存档**：刷新页面后不会保存通关进度。`localStorage` 已被 `AudioManager` 用于音效开关，但关卡进度还没接入。
- **超过 10 关复用最高关 JSON**：`LevelJsonLoader.getLevelJson` 在请求超出范围时返回 `level_no` 最大的 JSON，关号继续递增——还没有真正的"无限关卡"生成。
- **`UIGameLayer` 的 `targetLabel/statusLabel` 当前置空**：`HudUpdate` 事件已接通，但文案被显式清空，HUD label 实际不显示（仅保留连击 label）。
- **`levelPlayConfigs` 数组为空**：所有关都用默认参数；如需个别关单独调时长 / 槽容量，往这里加条目。

### 后续可扩展方向

- 接入本地存档（关卡进度、累计成绩）。
- 接入失败 / 结算页与新手引导。
- 把 `dynamicDiff / hard` 字段真正参与关卡选择或难度微调。
- 为换牌 / 解锁 / 撤回加上次数与消耗系统。
- 把 HUD 文案设计稿落到 `UIGameLayer` 上。
- 标准化 Web / 原生构建流程文档。

## 版本信息

- 引擎版本：`Cocos Creator 3.8.8`
- 工程名：`mahjong_eliminate`（见 [package.json](package.json)）
