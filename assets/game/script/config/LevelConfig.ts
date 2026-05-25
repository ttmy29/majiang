// 关卡参数:JSON 没有的玩法字段在这里配。
// 关卡棋盘 / 牌型 / 目标顺序由 assets/game/json/pure_levelN_config.json 驱动,
// 这里只剩 JSON 不涵盖的运行时玩法参数。
export interface LevelPlayConfig {
    // 当前关卡号。由 getLevelPlayConfig(level) 注入,levelPlayConfigs 条目里写不写都会被覆盖
    level: number;
    // 底部存牌槽容量。槽里牌数 >= slotCount-1 即判失败,7 是经典三消手感
    slotCount: number;
    // 关卡限时(秒)。0 = 不限时,HUD 也不显示倒计时
    levelTime: number;
    // 开局解锁的目标槽数(顶部 4 个槽 slot1~slot4 中默认亮起的前 N 个),其余靠玩家点解锁按钮逐个打开
    unlockedSlotCount: number;
}

// 没有在 levelPlayConfigs 里命中的关卡都用这套默认值。
// 加新关卡时:能用默认就不用动这里,需要单独调再往 levelPlayConfigs 加 { level, ... } 条目
const defaultLevelPlayConfig: Omit<LevelPlayConfig, 'level'> = {
    slotCount: 7,
    levelTime: 0,
    unlockedSlotCount: 2,
};

// 个别关卡要覆盖默认参数时在这里加条目,只写要覆盖的字段不够 —— 接口要求字段齐全。
// 例:{ level: 5, slotCount: 7, levelTime: 150, unlockedSlotCount: 2 }
const levelPlayConfigs: LevelPlayConfig[] = [
];

// 按关号取玩法参数:命中返回该条;未命中返回默认值(注意:默认/命中都会强制把 level 字段刷成传入值,
// 避免 levelPlayConfigs 里 level 字段写错时影响 HUD 显示)
export function getLevelPlayConfig(level: number): LevelPlayConfig {
    const matched = levelPlayConfigs.find((item) => item.level === level);
    if (matched) return { ...matched, level };
    return { ...defaultLevelPlayConfig, level };
}
