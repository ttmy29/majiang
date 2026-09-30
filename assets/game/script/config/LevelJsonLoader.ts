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
        flipData?: number[][];
        [k: string]: any;
    };
    summary?: any;
    [k: string]: any;
}

export type LevelTier = 'base' | 'easy' | 'normal' | 'hard';
export type LevelVariant = LevelTier | 'fixed' | 'test' | 'activity';

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
    variant: LevelVariant;
    level: number;
    path: string;
}

const BASE_BUNDLE = 'config_levels_base';
const FIXED_BUNDLE = 'config_levels_test430';
const TEST_BUNDLE = 'config_levels_test180';
const FIXED_MAIN_LEVEL_MAX = 180;
const ADVANCED_BUNDLE = 'config_levels_advanced';
const ACTIVITY_BUNDLE = 'config_levels_activity';
const BASE_MAX_LEVEL = 11;
const ACTIVITY_MAX_LEVEL = 93;

const variantIndexes: Record<LevelVariant, VariantIndex> = {
    base: createVariantIndex(BASE_BUNDLE, ''),
    fixed: createVariantIndex(FIXED_BUNDLE, ''),
    test: createVariantIndex(TEST_BUNDLE, ''),
    easy: createVariantIndex(ADVANCED_BUNDLE, 'level_easy'),
    normal: createVariantIndex(ADVANCED_BUNDLE, 'level_hard'),
    hard: createVariantIndex(ADVANCED_BUNDLE, 'level_normal'),
    activity: createVariantIndex(ACTIVITY_BUNDLE, ''),
};

const variantBuckets: Record<LevelVariant, VariantBucket> = {
    base: createVariantBucket(),
    fixed: createVariantBucket(),
    test: createVariantBucket(),
    easy: createVariantBucket(),
    normal: createVariantBucket(),
    hard: createVariantBucket(),
    activity: createVariantBucket(),
};

const bundleLoadingPromises = new Map<string, Promise<AssetManager.Bundle | null>>();
const bundleAssetRefState = new Map<string, number>();
const bundleLoadingCounts = new Map<string, number>();
const missingBundles = new Set<string>();
let cacheGeneration = 0;

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

function getBucket(variant: LevelVariant): VariantBucket {
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

/** 主线优先使用 430 关同号盘面；缺号时沿用原有 180 关与普通关卡流程。 */
async function resolvePreferredTestVariant(level: number): Promise<'fixed' | 'test' | null> {
    const normalizedLevel = normalizeLevel(level);
    if (normalizedLevel <= 0) return null;

    const fixedIndex = await ensureVariantIndex('fixed');
    if (fixedIndex.indexedLevels.has(normalizedLevel)) return 'fixed';

    return normalizedLevel <= FIXED_MAIN_LEVEL_MAX ? 'test' : null;
}

export async function shouldUseTestMainLevel(level: number): Promise<boolean> {
    return (await resolvePreferredTestVariant(level)) !== null;
}

async function resolveMainLevelVariant(level: number, tier: LevelTier): Promise<LevelVariant> {
    if (tier !== 'base') return tier;
    return await resolvePreferredTestVariant(level) ?? 'base';
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

async function ensureVariantIndex(variant: LevelVariant): Promise<VariantIndex> {
    const state = variantIndexes[variant];
    if (state.scanned) return state;
    if (state.readyPromise) {
        await state.readyPromise;
        return state;
    }

    const generation = cacheGeneration;
    state.readyPromise = ensureBundleReady(state.bundleName).then((bundle) => {
        if (generation !== cacheGeneration) return;

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

async function resolveVariantLevelInfo(level: number, variant: LevelVariant): Promise<LevelAssetInfo | null> {
    const normalizedLevel = normalizeLevel(level);
    if (variant === 'base' || variant === 'fixed' || variant === 'test' || variant === 'activity') {
        return {
            bundleName: variantIndexes[variant].bundleName,
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

    const generation = cacheGeneration;
    adjustCount(bundleLoadingCounts, info.bundleName, 1);

    const promise = ensureBundleReady(info.bundleName).then((bundle) => {
        if (!bundle) return null;

        return new Promise<JsonAsset | null>((resolve) => {
            bundle.load(info.path, JsonAsset, (err, asset) => {
                if (generation !== cacheGeneration) {
                    if (asset) assetManager.releaseAsset(asset);
                    resolve(null);
                    return;
                }

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

    let trackedPromise: Promise<JsonAsset | null>;
    trackedPromise = promise.then((asset) => {
        if (bucket.loading.get(cacheKey) === trackedPromise) {
            bucket.loading.delete(cacheKey);
        }
        if (generation === cacheGeneration) {
            adjustCount(bundleLoadingCounts, info.bundleName, -1);
        }
        return asset;
    }, (err) => {
        if (bucket.loading.get(cacheKey) === trackedPromise) {
            bucket.loading.delete(cacheKey);
        }
        if (generation === cacheGeneration) {
            adjustCount(bundleLoadingCounts, info.bundleName, -1);
        }
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

function releaseVariantLevel(variant: LevelVariant, bundleName: string, level: number) {
    const bucket = getBucket(variant);
    const cacheKey = getCacheKey(bundleName, level);
    if (!bucket.assets.has(cacheKey)) return;

    const bundle = assetManager.getBundle(bundleName);
    const path = variant === 'base' || variant === 'fixed' || variant === 'test' || variant === 'activity'
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

    const generation = cacheGeneration;
    const promise = new Promise<AssetManager.Bundle | null>((resolve) => {
        assetManager.loadBundle(bundleName, (err, bundle) => {
            if (generation !== cacheGeneration) {
                if (bundle) {
                    bundle.releaseAll();
                    if (assetManager.getBundle(bundleName) === bundle) {
                        assetManager.removeBundle(bundle);
                    }
                }
                resolve(null);
                return;
            }

            if (err || !bundle) {
                console.warn(`LevelJsonLoader: load bundle ${bundleName} failed`, err);
                resolve(null);
                return;
            }
            resolve(bundle);
        });
    });

    let trackedPromise: Promise<AssetManager.Bundle | null>;
    trackedPromise = promise.then((bundle) => {
        if (bundleLoadingPromises.get(bundleName) === trackedPromise) {
            bundleLoadingPromises.delete(bundleName);
        }
        if (generation === cacheGeneration && !bundle) {
            missingBundles.add(bundleName);
        }
        return bundle;
    }, (err) => {
        if (bundleLoadingPromises.get(bundleName) === trackedPromise) {
            bundleLoadingPromises.delete(bundleName);
        }
        throw err;
    });

    bundleLoadingPromises.set(bundleName, trackedPromise);
    return trackedPromise;
}

export async function getAvailableBoardIds(tier: LevelTier): Promise<number[]> {
    const state = await ensureVariantIndex(tier);
    return Array.from(state.indexedLevels).sort((a, b) => a - b);
}

export async function warmupForwardWindow(level: number, aheadCount = 10): Promise<void> {
    const normalizedLevel = normalizeLevel(level);
    const targets = new Map<string, LevelAssetInfo>();

    for (let offset = 0; offset <= aheadCount; offset++) {
        const targetLevel = normalizedLevel + offset;
        const variant = await resolveMainLevelVariant(targetLevel, 'base');
        if (variant === 'base' && targetLevel > BASE_MAX_LEVEL) continue;
        const info = await resolveVariantLevelInfo(targetLevel, variant);
        if (!info) continue;
        targets.set(getCacheKey(info.bundleName, info.level), info);
    }

    await Promise.all(Array.from(targets.values(), (info) => ensureVariantAsset(info)));
}

export async function warmupActivityForwardWindow(level: number, aheadCount = 10): Promise<void> {
    const normalizedLevel = normalizeLevel(level);
    const targets = new Map<string, LevelAssetInfo>();

    for (let offset = 0; offset <= aheadCount; offset++) {
        const targetLevel = normalizedLevel + offset;
        if (targetLevel > ACTIVITY_MAX_LEVEL) break;

        const info = await resolveVariantLevelInfo(targetLevel, 'activity');
        if (!info) continue;
        targets.set(getCacheKey(info.bundleName, info.level), info);
    }

    await Promise.all(Array.from(targets.values(), (info) => ensureVariantAsset(info)));
}

export async function ensureLevelJson(level: number, tier: LevelTier | 'test' = 'base'): Promise<LevelJson | null> {
    const normalizedLevel = normalizeLevel(level);
    const variant = tier === 'test' ? 'test' : await resolveMainLevelVariant(normalizedLevel, tier);
    const info = await resolveVariantLevelInfo(normalizedLevel, variant);
    if (!info) {
        console.warn(`LevelJsonLoader: missing ${variant} level ${normalizedLevel}`);
        return null;
    }

    const asset = await ensureVariantAsset(info);
    if (!asset?.json && variant === 'fixed') {
        const fallbackVariant = normalizedLevel <= FIXED_MAIN_LEVEL_MAX ? 'test' : 'base';
        const fallbackInfo = await resolveVariantLevelInfo(normalizedLevel, fallbackVariant);
        const fallbackAsset = fallbackInfo ? await ensureVariantAsset(fallbackInfo) : null;
        return fallbackAsset?.json ? fallbackAsset.json as LevelJson : null;
    }
    return asset?.json ? asset.json as LevelJson : null;
}

export async function ensureActivityLevelJson(level: number): Promise<LevelJson | null> {
    const normalizedLevel = normalizeLevel(level);
    const info = await resolveVariantLevelInfo(normalizedLevel, 'activity');
    if (!info) {
        console.warn(`LevelJsonLoader: missing activity level ${normalizedLevel}`);
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

        (['base', 'fixed', 'test', 'easy', 'normal', 'hard'] as LevelVariant[]).forEach((variant) => {
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

export function releaseActivityOutsideWindow(level: number, aheadCount = 10): void {
    void (async () => {
        const normalizedLevel = normalizeLevel(level);
        const minLevel = normalizedLevel;
        const maxLevel = normalizedLevel + aheadCount;
        const variant: LevelVariant = 'activity';
        const bundleName = variantIndexes[variant].bundleName;

        for (const cacheKey of Array.from(getBucket(variant).assets.keys())) {
            const parsed = parseCacheKey(cacheKey);
            if (!parsed) continue;
            if (parsed.bundleName !== bundleName) continue;
            if (parsed.level >= minLevel && parsed.level <= maxLevel) continue;
            releaseVariantLevel(variant, parsed.bundleName, parsed.level);
        }
    })();
}

/**
 * 清理所有关卡 Bundle 的内存资源与本加载器缓存。
 * 文件系统中的远程资源缓存由调用方通过 assetManager.cacheManager 清理。
 */
export function clearLevelBundleCaches(): void {
    cacheGeneration++;

    const bundleNames = [BASE_BUNDLE, FIXED_BUNDLE, TEST_BUNDLE, ADVANCED_BUNDLE, ACTIVITY_BUNDLE];
    for (const bundleName of bundleNames) {
        const bundle = assetManager.getBundle(bundleName);
        if (!bundle) continue;

        try {
            bundle.releaseAll();
        } catch (err) {
            console.warn(`LevelJsonLoader: releaseAll ${bundleName} failed`, err);
        }

        try {
            assetManager.removeBundle(bundle);
        } catch (err) {
            console.warn(`LevelJsonLoader: remove bundle ${bundleName} failed`, err);
        }
    }

    for (const variant of Object.keys(variantBuckets) as LevelVariant[]) {
        const bucket = variantBuckets[variant];
        bucket.assets.clear();
        bucket.loading.clear();

        const state = variantIndexes[variant];
        state.indexedLevels.clear();
        state.pathByLevel.clear();
        state.scanned = false;
        state.missing = false;
        state.readyPromise = null;
    }

    bundleLoadingPromises.clear();
    bundleAssetRefState.clear();
    bundleLoadingCounts.clear();
    missingBundles.clear();
}
