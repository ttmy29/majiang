import { assetManager, AssetManager, JsonAsset } from 'cc';
import { MAX_TRAVEL_LEVEL, TRAVEL_DATA_VERSION, TravelLevelPlan } from './TravelLevels';

const BUNDLE_NAME = 'config_levels_travel';
const LEVELS_PER_FILE = 100;

interface TravelChunk {
    version: number;
    startLevel: number;
    endLevel: number;
    levels: TravelLevelPlan[];
}

let bundlePromise: Promise<AssetManager.Bundle> | null = null;
const chunks = new Map<number, Promise<TravelChunk>>();

function loadBundle(): Promise<AssetManager.Bundle> {
    if (!bundlePromise) {
        bundlePromise = new Promise<AssetManager.Bundle>((resolve, reject) => {
            const existing = assetManager.getBundle(BUNDLE_NAME);
            if (existing) {
                resolve(existing);
                return;
            }
            assetManager.loadBundle(BUNDLE_NAME, (error, bundle) => {
                if (error || !bundle) reject(error || new Error(`Missing bundle ${BUNDLE_NAME}`));
                else resolve(bundle);
            });
        }).catch(error => {
            bundlePromise = null;
            throw error;
        });
    }
    return bundlePromise;
}

function chunkName(start: number, end: number): string {
    const padded = (value: number) => (`0000${value}`).slice(-4);
    return `levels_${padded(start)}_${padded(end)}`;
}

async function loadChunk(first: number): Promise<TravelChunk> {
    const last = Math.min(first + LEVELS_PER_FILE - 1, MAX_TRAVEL_LEVEL);
    const path = chunkName(first, last);
    const bundle = await loadBundle();
    const asset = await new Promise<JsonAsset>((resolve, reject) => {
        bundle.load(path, JsonAsset, (error, result) => {
            if (error || !result) reject(error || new Error(`Missing travel data ${path}`));
            else resolve(result);
        });
    });
    const chunk = asset.json as TravelChunk;
    if (!chunk || chunk.version !== TRAVEL_DATA_VERSION || chunk.startLevel !== first || chunk.endLevel !== last
        || !Array.isArray(chunk.levels) || chunk.levels.length !== last - first + 1) {
        throw new Error(`Invalid travel data ${path}`);
    }
    return chunk;
}

/** 按关号加载所在的百关文件；同一文件只发起一次加载请求。 */
export async function ensureTravelLevel(level: number): Promise<TravelLevelPlan> {
    if (!Number.isInteger(level) || level < 1 || level > MAX_TRAVEL_LEVEL) {
        throw new Error(`Travel level out of range: ${level}`);
    }
    const first = Math.floor((level - 1) / LEVELS_PER_FILE) * LEVELS_PER_FILE + 1;
    let pending = chunks.get(first);
    if (!pending) {
        pending = loadChunk(first).catch(error => {
            chunks.delete(first);
            throw error;
        });
        chunks.set(first, pending);
    }
    const plan = (await pending).levels[level - first];
    if (!plan || plan.level !== level || !Array.isArray(plan.tiles) || !plan.tiles.length || plan.tiles.length % 3
        || plan.source?.game !== 'Tile Explorer' || plan.source.tileCount !== plan.tiles.length) {
        throw new Error(`Invalid travel level ${level}`);
    }
    return plan;
}
