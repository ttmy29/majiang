const Constants = {
    eventNames: {
        EventShowSlotShake: 'ShowSlotFillAnimation',
        EventShowSlotUnlock: 'ShowSlotUnlock',
        EventShowSlotMoveIn: 'ShowSlotMoveIn',
        EventShowSlotMoveOut: 'ShowSlotMoveOut',
        // —— 以下事件由 GameCtrl emit、UIGameLayer 渲染 ——
        // 一次性初始化，把 GameCtrl 的 mahjongItem 预制体和 iconFrames 资源 map 交给 UI 层
        EventGameUiInit: 'GameUiInit',
        // 关卡开始:payload 是当前关卡值
        EventLevelStart: 'LevelStart',
        // HUD（关卡 / 剩余 / 槽位 / 倒计时）
        EventHudUpdate: 'HudUpdate',
        // Toast 文案
        EventShowToast: 'ShowToast',
        // 连击 label
        EventComboUpdate: 'ComboUpdate',
        // 渲染单个目标槽（预览图、锁/提示子节点）
        EventRenderSlot: 'RenderSlot',
        // 清理单个目标槽（销毁预览 + 已收集到槽里的牌）
        EventClearSlot: 'ClearSlot',
        // 关卡重开：批量把所有槽位 transform/box_2 复位到场景初始状态
        EventResetSlots: 'ResetSlots',
        // 清理槽位容器内的脏子节点(上一局残留的 slotTile_* 等),并把 slot3/slot4 的 box_2/lock 重新点亮
        EventCleanSlotContainers: 'CleanSlotContainers',
        // 撤回按钮置灰状态:true=灰(无可撤回),false=彩(有可撤回)
        EventSetUndoButtonStatus: 'SetUndoButtonStatus',
        // 道具剩余次数:GameCtrl -> UI,payload {undo, switch},>0 显示 di+countLabel,==0 显示 ad1
        EventSetPropCount: 'SetPropCount',
        // 闲置帮助提示:payload 是 index(1=解锁槽位按钮,2=换牌按钮)
        EventShowTipsAnimator: 'ShowTipsAnimator',
        EventShowShuffleTileEffect: 'ShowShuffleTileEffect',
        EventHideGuide: 'HideGuide',
        // 引导关玩家成功点中一张目标牌:payload 是引导期间累计的成功点击数(从 1 开始)
        EventGuideTileTapped: 'GuideTileTapped',
        // 帮助提示动画结束:UI -> GameCtrl,玩家点击提示按钮后通知,用于解除"动画中不重启计时"的锁
        EventTipsAnimatorEnd: 'TipsAnimatorEnd',
        // 强制中断帮助提示:GameCtrl -> UI,玩家在动画播放中点了麻将牌,停止呼吸动画
        EventStopTipsAnimator: 'StopTipsAnimator',
        // 失败弹窗"继续游戏":UIFailureLayer -> GameCtrl,payload 是 opentype(null=解锁一个槽位继续,非空=清空底部 slot 继续)
        EventFailureContinue: 'FailureContinue',
        // 失败弹窗"重新开始":UIFailureLayer -> GameCtrl,从当前关重开
        EventFailureRestart: 'FailureRestart',
        // 胜利弹窗"下一关":UIWinLayer -> GameCtrl,进入下一关
        EventWinNextLevel: 'WinNextLevel',
    },
    // UIGameLayer.slotNodeArr 中节点的固定索引约定：
    // [0] = 底部存牌槽 (slot)，[1..4] = 顶部 4 个目标槽 (slot1~slot4)
    slotLayer: {
        BottomSlotBarID: 0,
        TargetBoxIndexOffset: 1,
    },
    // 槽位动画的等待时长，与 UIGameLayer 里的 tween 段累加值保持一致。
    // 改动 UIGameLayer 的动画节奏时记得同步这里，否则会出现动画还没演完业务状态就刷新的衔接 bug。
    slotAnim: {
        // MoveOut: 0.1833 延迟 + 三段挤压 0.05*3 + 0.3 飞出 = 0.6333s，留少量余量到 0.65s
        MoveOutWait: 0.65,
        // MoveIn: 0.3 飞回原位，留余量到 0.35s。期间 slot 里的牌若提前飞过去会落到半路位置
        MoveInWait: 0.35,
        // Unlock: 盖子飞出最长链路 0.35 延迟 + 0.2167 淡出 = 0.5667s，留余量到 0.6s
        UnlockWait: 0.6,
    },
    shuffleAnim: {
        Duration: 0.72,
        SwapAt: 0.33,
    },
    prefab: {
        setting: 'prefab/setting',
        failure: 'prefab/failure',
        win: 'prefab/win',
        guide: 'prefab/guide'
    },
    GameBundleName: 'game',
    AudioBundleName: 'audio',
    BgmBundleName: 'bgm',
    MahjongBoard: {
        // 麻将牌面资源所在目录，只加载该目录下的数字牌面作为棋盘牌型。
        ResourceDir: 'resources/mahjong',
        // 资源目录中存在但不参与随机牌型生成的辅助图片。
        ExcludedFrames: ['flip', 'yinying'],
        // 棋盘上相邻两列麻将牌的横向间距。
        // 牌身 root = 149×186(prefab 阴影是 208×242,但 root 才决定视觉重叠),
        // BoardScale=0.57 后牌可视约 85×106。这里步距 80/100 保持比例 ≈ 0.80,
        // 让同层正格相邻的牌还有少量重叠(塔形堆叠感),错砖半格重叠约 53%
        TileStepX: 80,
        // 棋盘上相邻两行麻将牌的纵向间距。
        TileStepY: 98,
        // 棋盘麻将牌实例的统一缩放比例。
        BoardScale: 0.57,
        // 棋盘生成时至少使用的可视行数，用于让低关卡也能形成较完整的塔形轮廓。
        MinVisualRows: 6,
        // 棋盘生成时至少使用的可视列数，用于让低关卡也能形成较完整的塔形轮廓。
        MinVisualCols: 6,
        // 底层可视行数上限(高):createLayerGridSizes 扩容时不会超过这个值;
        // 关卡 config.rows 超过它也会被夹回来。
        MaxVisualRows: 6,
        // 底层可视列数上限(宽):同上,关卡 config.cols 超过它也会被夹回。
        MaxVisualCols: 8,
        // 每上一层相对下一层的目标牌数比例，值越小上层越集中。
        UpperLayerRatio: 0.55,
        // 每上一层相对下一层的横向偏移:每层 +1 半格 = TileStepX / 2 = 40,形成经典塔形 staircase 的右上方累积阶梯。
        // 层间 dx = halfStepX < 0.82*TileStepX = 65.6,L_n+1 仍能锁住 L_n。
        // 底层 (layer 0) 锚定在 pNode 原点,上层按 layer * 40 依次往右叠加 —— 经典塔形从底往上"长"出去。
        LayerOffsetX: 0,
        // 每上一层相对下一层的纵向偏移:每层 +1 半格 = TileStepY / 2 = 50。
        // 层间 dy = halfStepY < 0.82*TileStepY = 82,L_n+1 锁住 L_n;
        // 跨层 (dy = 整格 = 100) 已超阈值,L_n+2 不再锁 L_n —— 即"每张牌只跟紧邻上层"的塔形语义,
        // 跟真实麻将塔"每层只压一层"一致。
        // 底层留在原位,上层往上叠加;视觉中心由底层(最大面积)主导,无需额外居中。
        LayerOffsetY: 0,
        // 半格错位摆放(细粒度):当前累积塔形已由 LayerOffsetX/Y 完成,这里默认全 [0,0] 即可。
        // 想要某一层在常规阶梯之外再额外错半格(做花俏布局),可往数组里追加 [1,1] 等条目。
        LayerHalfOffsetPattern: [
            [0, 0],
        ] as Array<readonly [number, number]>,
        // 槽位麻将牌实例的统一缩放比例 36。
        SlotScale: 0.32,
        // 底部存牌槽里牌的缩放(比目标槽 SlotScale 略小 0.05),视觉上比目标槽小一圈
        SlotTileScale: 0.27,
        // 牌在底部 slot 内的 siblingIndex 基数: BottomSlotSiblingBase + slotIndex
        BottomSlotSiblingBase: 100,
        // 牌在目标槽内的 siblingIndex 基数: TargetBoxSiblingBase + orderInBox + 1
        TargetBoxSiblingBase: 160,
        // ==================== 棋盘自适应布局 ====================
        // 思路:优先读取 pNode 运行时真实尺寸,再用关卡 bbox 计算 fitRatio。
        // 棋盘按 fitRatio 缩放牌的位置和大小,装进真实尺寸 - 2*Padding 的可用区域。
        // 小关允许适当放大,大关允许适当缩小,但边框视觉永远是同一个矩形 ——
        // 关与关之间布局一致,不会出现"小关旷/大关瘦"的尺寸跳变。
        // 只有运行时取不到 UITransform 尺寸时才使用兜底值。
        FallbackFitWidth: 600,
        FallbackFitHeight: 580,
        // 只有取不到麻将牌预制体尺寸时才使用兜底值。
        FallbackTileWidth: 149,
        FallbackTileHeight: 186,
        // 棋盘到边框的视觉内边距(像素,在 pNode 视觉尺度下)。调大更留白,调小牌更大。
        BoardPadding: 0,
        // 极端关卡(超大 bbox)缩放下限,避免牌缩得看不清。低于这个值就不再缩了(容许略微溢出)
        MinBoardFitRatio: 0.5,
        // 小棋盘放大上限,避免少牌关被放得过满或飞牌手感跳变太大
        MaxBoardFitRatio: 1.18,
    },
};

export { Constants };
