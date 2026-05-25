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
        [k: string]: any;
    };
    summary?: any;
    [k: string]: any;
}

const levelMap: Map<number, LevelJson> = new Map();
let preloaded = false;

export function preloadAllLevels(bundle: AssetManager.Bundle | null, done: () => void) {
    if (preloaded || !bundle) {
        preloaded = true;
        done();
        return;
    }
    bundle.loadDir('json', JsonAsset, (err, assets) => {
        if (err || !assets?.length) {
            console.warn('LevelJsonLoader: loadDir json failed', err);
            preloaded = true;
            done();
            return;
        }
        for (const asset of assets) {
            const json = asset.json as LevelJson | null;
            if (!json || typeof json.level_no !== 'number') continue;
            levelMap.set(json.level_no, json);
        }
        preloaded = true;
        done();
    });
}

export function getLevelJson(level: number): LevelJson | null {
    if (levelMap.has(level)) return levelMap.get(level)!;
    if (levelMap.size === 0) return null;
    const maxLevel = Math.max(...levelMap.keys());
    return levelMap.get(maxLevel) || null;
}

export function hasAnyLevelJson(): boolean {
    return levelMap.size > 0;
}
