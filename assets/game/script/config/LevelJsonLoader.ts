import { AssetManager, JsonAsset } from 'cc';

export interface LevelJsonPosition {
    z_layer: number;
    y_row: number;
    x_col: number;
    tile_id: number;
}

export interface LevelJson {
    level_no: number;
    positions: LevelJsonPosition[];
    decoded_config: {
        task: number[][];
        taskNum: number[][];
        chain?: number[][];
        ironData?: number[][];
        [k: string]: any;
    };
    summary?: any;
    [k: string]: any;
}

// 三档关卡配置：默认 / 重拾档 / 广告档。启动时一次性并行预载进内存，getLevelJson 同步查表。
const levelMap: Map<number, LevelJson> = new Map();   // level_json  (默认)
const levelMap2: Map<number, LevelJson> = new Map();  // level_json2 (本关重开次数超阈值)
const levelMap3: Map<number, LevelJson> = new Map();  // level_json3 (全局看广告次数超阈值)
let preloaded = false;

// 从 config bundle 并行加载三个目录。level_json2 / level_json3 不存在属正常情况，安全跳过。
export function preloadAllLevels(bundle: AssetManager.Bundle | null, done: () => void) {
    if (preloaded || !bundle) {
        preloaded = true;
        done();
        return;
    }
    const dirs: Array<[string, Map<number, LevelJson>]> = [
        ['level_json', levelMap],
        ['level_json2', levelMap2],
        ['level_json3', levelMap3],
    ];
    let remaining = dirs.length;
    const finish = () => {
        if (--remaining === 0) {
            preloaded = true;
            done();
        }
    };
    for (const [dir, map] of dirs) {
        bundle.loadDir(dir, JsonAsset, (err, assets) => {
            if (err || !assets?.length) {
                // 只有默认目录缺失才告警；level_json2/3 缺失是预期内的
                if (dir === 'level_json') console.warn('LevelJsonLoader: loadDir level_json failed', err);
                finish();
                return;
            }
            for (const asset of assets) {
                const json = asset.json as LevelJson | null;
                if (!json || typeof json.level_no !== 'number') continue;
                map.set(json.level_no, json);
            }
            finish();
        });
    }
}

// 分档查表：广告档优先 → 重拾档 → 默认档；每档需「该关存在」否则逐级回退。
// 默认档保留原「找不到就取最大关」的兜底。
export function getLevelJson(level: number, opts?: { ad?: boolean; retry?: boolean }): LevelJson | null {
    if (opts?.ad && levelMap3.has(level)) return levelMap3.get(level)!;
    if (opts?.retry && levelMap2.has(level)) return levelMap2.get(level)!;
    if (levelMap.has(level)) return levelMap.get(level)!;
    if (levelMap.size === 0) return null;
    const maxLevel = Math.max(...levelMap.keys());
    return levelMap.get(maxLevel) || null;
}

export function hasAnyLevelJson(): boolean {
    return levelMap.size > 0;
}
