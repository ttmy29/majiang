import { assetManager, AssetManager, JsonAsset } from 'cc';

export interface LevelJsonPosition {
    z_layer: number;
    y_row: number;
    x_col: number;
    tile_id: number;
}

export interface LevelJson {
    level_no: number;
    index_config?: {
        [k: string]: any;
    };
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

export type LevelTier = 'base' | 'easy' | 'normal' | 'hard';

interface VariantIndex {
    bundleName: string;
    dir: string;
    indexedLevels: Set<number>;
    pathByLevel: Map<number, string>;
    scanned: boolean;
    missing: boolean;
    readyPromise: Promise<void> | null;
}

interface VariantBucket {
    assets: Map<string, JsonAsset>;
    loading: Map<string, Promise<JsonAsset | null>>;
}

interface LevelAssetInfo {
    bundleName: string;
    variant: LevelTier;
    level: number;
    path: string;
}

const BASE_BUNDLE = 'config_levels_base';
const ADVANCED_BUNDLE = 'config_levels_advanced';
const BASE_MAX_LEVEL = 11;

const variantIndexes: Record<LevelTier, VariantIndex> = {
    base: createVariantIndex(BASE_BUNDLE, ''),
    easy: createVariantIndex(ADVANCED_BUNDLE, 'level_easy'),
    normal: createVariantIndex(ADVANCED_BUNDLE, 'level_hard'),
    hard: createVariantIndex(ADVANCED_BUNDLE, 'level_normal'),
};

const variantBuckets: Record<LevelTier, VariantBucket> = {
    base: createVariantBucket(),
    easy: createVariantBucket(),
    normal: createVariantBucket(),
    hard: createVariantBucket(),
};

const bundleLoadingPromises = new Map<string, Promise<AssetManager.Bundle | null>>();
const bundleAssetRefState = new Map<string, number>();
const bundleLoadingCounts = new Map<string, number>();
const missingBundles = new Set<string>();

function createVariantBucket(): VariantBucket {
    return {
        assets: new Map(),
        loading: new Map(),
    };
}

function createVariantIndex(bundleName: string, dir: string): VariantIndex {
    return {
        bundleName,
        dir,
        indexedLevels: new Set(),
        pathByLevel: new Map(),
        scanned: false,
        missing: false,
        readyPromise: null,
    };
}

function normalizeLevel(level: number): number {
    if (!Number.isFinite(level)) return 0;
    return Math.max(0, Math.floor(level));
}

function extractLevel(path: string): number | null {
    const match = path.match(/pure_level(\d+)_config$/);
    if (!match) return null;
    const level = Number(match[1]);
    return Number.isFinite(level) ? level : null;
}

function getBucket(variant: LevelTier): VariantBucket {
    return variantBuckets[variant];
}

function getCacheKey(bundleName: string, level: number): string {
    return `${bundleName}|${level}`;
}

function parseCacheKey(cacheKey: string): { bundleName: string; level: number } | null {
    const separatorIndex = cacheKey.lastIndexOf('|');
    if (separatorIndex < 0) return null;

    const bundleName = cacheKey.slice(0, separatorIndex);
    const level = Number(cacheKey.slice(separatorIndex + 1));
    if (!bundleName || !Number.isFinite(level)) return null;

    return {
        bundleName,
        level,
    };
}

function adjustCount(store: Map<string, number>, key: string, delta: number) {
    const nextValue = (store.get(key) || 0) + delta;
    if (nextValue > 0) {
        store.set(key, nextValue);
        return;
    }
    store.delete(key);
}

function readVariantIndex(bundle: AssetManager.Bundle, state: VariantIndex) {
    state.indexedLevels.clear();
    state.pathByLevel.clear();

    const infos = bundle.getDirWithPath(state.dir, JsonAsset, []);
    for (const info of infos) {
        const level = extractLevel(info.path);
        if (level === null) continue;

        state.indexedLevels.add(level);
        state.pathByLevel.set(level, info.path);
    }
}

async function ensureVariantIndex(variant: LevelTier): Promise<VariantIndex> {
    const state = variantIndexes[variant];
    if (state.scanned) return state;
    if (state.readyPromise) {
        await state.readyPromise;
        return state;
    }

    state.readyPromise = ensureBundleReady(state.bundleName).then((bundle) => {
        if (!bundle) {
            state.missing = true;
            state.scanned = true;
            return;
        }

        readVariantIndex(bundle, state);
        state.scanned = true;
    });

    await state.readyPromise;
    return state;
}

async function resolveVariantLevelInfo(level: number, variant: LevelTier): Promise<LevelAssetInfo | null> {
    const normalizedLevel = normalizeLevel(level);
    if (variant === 'base') {
        return {
            bundleName: variantIndexes.base.bundleName,
            variant,
            level: normalizedLevel,
            path: `pure_level${normalizedLevel}_config`,
        };
    }

    const state = await ensureVariantIndex(variant);
    const path = state.pathByLevel.get(normalizedLevel);
    if (!path) return null;

    return {
        bundleName: state.bundleName,
        variant,
        level: normalizedLevel,
        path,
    };
}

async function ensureVariantAsset(info: LevelAssetInfo): Promise<JsonAsset | null> {
    const bucket = getBucket(info.variant);
    const cacheKey = getCacheKey(info.bundleName, info.level);
    if (bucket.assets.has(cacheKey)) return bucket.assets.get(cacheKey)!;
    if (bucket.loading.has(cacheKey)) return bucket.loading.get(cacheKey)!;

    adjustCount(bundleLoadingCounts, info.bundleName, 1);

    const promise = ensureBundleReady(info.bundleName).then((bundle) => {
        if (!bundle) return null;

        return new Promise<JsonAsset | null>((resolve) => {
            bundle.load(info.path, JsonAsset, (err, asset) => {
                if (err || !asset) {
                    console.warn(`LevelJsonLoader: load ${info.bundleName}/${info.path} failed`, err);
                    resolve(null);
                    return;
                }

                bucket.assets.set(cacheKey, asset);
                adjustCount(bundleAssetRefState, info.bundleName, 1);
                resolve(asset);
            });
        });
    });

    const trackedPromise = promise.then((asset) => {
        bucket.loading.delete(cacheKey);
        adjustCount(bundleLoadingCounts, info.bundleName, -1);
        return asset;
    }, (err) => {
        bucket.loading.delete(cacheKey);
        adjustCount(bundleLoadingCounts, info.bundleName, -1);
        throw err;
    });

    bucket.loading.set(cacheKey, trackedPromise);
    return trackedPromise;
}

function tryReleaseBundle(bundleName: string) {
    if ((bundleAssetRefState.get(bundleName) || 0) > 0) return;
    if ((bundleLoadingCounts.get(bundleName) || 0) > 0) return;

    const bundle = assetManager.getBundle(bundleName);
    if (!bundle) return;

    try {
        (bundle as any).releaseAll?.();
    } catch (err) {
        console.warn(`LevelJsonLoader: releaseAll ${bundleName} failed`, err);
    }

    const bundleManager = assetManager as any;
    if (typeof bundleManager.removeBundle === 'function') {
        try {
            bundleManager.removeBundle(bundle);
        } catch (err) {
            console.warn(`LevelJsonLoader: remove bundle ${bundleName} failed`, err);
        }
    }
}

function releaseVariantLevel(variant: LevelTier, bundleName: string, level: number) {
    const bucket = getBucket(variant);
    const cacheKey = getCacheKey(bundleName, level);
    if (!bucket.assets.has(cacheKey)) return;

    const bundle = assetManager.getBundle(bundleName);
    const path = variant === 'base'
        ? `pure_level${level}_config`
        : variantIndexes[variant].pathByLevel.get(level);
    if (bundle && path) {
        bundle.release(path, JsonAsset);
    }

    bucket.assets.delete(cacheKey);
    bucket.loading.delete(cacheKey);
    adjustCount(bundleAssetRefState, bundleName, -1);
    tryReleaseBundle(bundleName);
}

export async function ensureBundleReady(bundleName: string): Promise<AssetManager.Bundle | null> {
    const existing = assetManager.getBundle(bundleName);
    if (existing) return existing;
    if (missingBundles.has(bundleName)) return null;
    if (bundleLoadingPromises.has(bundleName)) {
        return bundleLoadingPromises.get(bundleName)!;
    }

    const promise = new Promise<AssetManager.Bundle | null>((resolve) => {
        assetManager.loadBundle(bundleName, (err, bundle) => {
            if (err || !bundle) {
                console.warn(`LevelJsonLoader: load bundle ${bundleName} failed`, err);
                resolve(null);
                return;
            }
            resolve(bundle);
        });
    });

    const trackedPromise = promise.then((bundle) => {
        bundleLoadingPromises.delete(bundleName);
        if (!bundle) missingBundles.add(bundleName);
        return bundle;
    }, (err) => {
        bundleLoadingPromises.delete(bundleName);
        throw err;
    });

    bundleLoadingPromises.set(bundleName, trackedPromise);
    return trackedPromise;
}

export async function getAvailableBoardIds(tier: Exclude<LevelTier, 'base'>): Promise<number[]> {
    const state = await ensureVariantIndex(tier);
    return Array.from(state.indexedLevels).sort((a, b) => a - b);
}

export async function warmupForwardWindow(level: number, aheadCount = 10): Promise<void> {
    const normalizedLevel = normalizeLevel(level);
    const targets = new Map<string, LevelAssetInfo>();

    for (let offset = 0; offset <= aheadCount; offset++) {
        const targetLevel = normalizedLevel + offset;
        if (targetLevel > BASE_MAX_LEVEL) break;

        const info = await resolveVariantLevelInfo(targetLevel, 'base');
        if (!info) continue;
        targets.set(getCacheKey(info.bundleName, info.level), info);
    }

    await Promise.all(Array.from(targets.values(), (info) => ensureVariantAsset(info)));
}

export async function ensureLevelJson(level: number, tier: LevelTier = 'base'): Promise<LevelJson | null> {
    const normalizedLevel = normalizeLevel(level);
    const info = await resolveVariantLevelInfo(normalizedLevel, tier);
    if (!info) {
        console.warn(`LevelJsonLoader: missing ${tier} level ${normalizedLevel}`);
        return null;
    }

    const asset = await ensureVariantAsset(info);
    return asset?.json ? asset.json as LevelJson : null;
}

export function releaseOutsideWindow(level: number, aheadCount = 10): void {
    void (async () => {
        const normalizedLevel = normalizeLevel(level);
        const minLevel = normalizedLevel;
        const maxLevel = normalizedLevel + aheadCount;

        (['base', 'easy', 'normal', 'hard'] as LevelTier[]).forEach((variant) => {
            const bundleName = variantIndexes[variant].bundleName;
            for (const cacheKey of Array.from(getBucket(variant).assets.keys())) {
                const parsed = parseCacheKey(cacheKey);
                if (!parsed) continue;
                if (parsed.bundleName !== bundleName) continue;
                if (parsed.level >= minLevel && parsed.level <= maxLevel) continue;
                releaseVariantLevel(variant, parsed.bundleName, parsed.level);
            }
        });
    })();
}
