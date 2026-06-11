import { assetManager, AssetManager, JsonAsset } from 'cc';
import { Constants } from './Constants';
import { ProgressManager } from '../manager/ProgressManager';

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

type LevelVariant = 'default' | 'retry' | 'ad';

interface BundleSegment {
    start: number;
    end: number;
    bundleName: string;
}

interface VariantIndex {
    dir: string;
    indexedLevels: Set<number>;
    pathByLevel: Map<number, string>;
}

interface BundleIndexState {
    segment: BundleSegment;
    variantIndexes: Record<LevelVariant, VariantIndex>;
    maxDefaultLevel: number;
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
    level: number;
    path: string;
}

const DEFAULT_DIR = 'level_json';
const RETRY_DIR = 'level_json2';
const AD_DIR = 'level_json3';

const variantDirs: Record<LevelVariant, string> = {
    default: DEFAULT_DIR,
    retry: RETRY_DIR,
    ad: AD_DIR,
};

const variantBuckets: Record<LevelVariant, VariantBucket> = {
    default: createVariantBucket(),
    retry: createVariantBucket(),
    ad: createVariantBucket(),
};

const bundleLoadingPromises = new Map<string, Promise<AssetManager.Bundle | null>>();
const bundleIndexes = new Map<string, BundleIndexState>();
const bundleAssetRefState = new Map<string, number>();
const bundleLoadingCounts = new Map<string, number>();
const missingBundles = new Set<string>();

function createVariantBucket(): VariantBucket {
    return {
        assets: new Map(),
        loading: new Map(),
    };
}

function createVariantIndex(dir: string): VariantIndex {
    return {
        dir,
        indexedLevels: new Set(),
        pathByLevel: new Map(),
    };
}

function createBundleIndexState(segment: BundleSegment): BundleIndexState {
    return {
        segment,
        variantIndexes: {
            default: createVariantIndex(DEFAULT_DIR),
            retry: createVariantIndex(RETRY_DIR),
            ad: createVariantIndex(AD_DIR),
        },
        maxDefaultLevel: -1,
        scanned: false,
        missing: false,
        readyPromise: null,
    };
}

function getSegmentSize(): number {
    const configured = Math.floor(Constants.LevelConfigSegmentSize || 0);
    return configured > 0 ? configured : 50;
}

function getBundlePrefix(): string {
    return Constants.LevelConfigBundlePrefix || 'config_levels_';
}

function normalizeLevel(level: number): number {
    if (!Number.isFinite(level)) return 0;
    return Math.max(0, Math.floor(level));
}

function formatSegmentBound(value: number): string {
    const text = String(Math.max(0, value));
    return text.length >= 3 ? text : (`000${text}`).slice(-3);
}

function resolveSegmentByStart(start: number): BundleSegment {
    const safeStart = Math.max(0, start);
    const end = safeStart + getSegmentSize() - 1;
    return {
        start: safeStart,
        end,
        bundleName: `${getBundlePrefix()}${formatSegmentBound(safeStart)}_${formatSegmentBound(end)}`,
    };
}

function resolveSegmentForLevel(level: number): BundleSegment {
    const normalizedLevel = normalizeLevel(level);
    const segmentSize = getSegmentSize();
    const start = Math.floor(normalizedLevel / segmentSize) * segmentSize;
    return resolveSegmentByStart(start);
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

function getIndexedPath(bundleName: string, variant: LevelVariant, level: number): string | null {
    const state = bundleIndexes.get(bundleName);
    if (!state) return null;
    return state.variantIndexes[variant].pathByLevel.get(level) || null;
}

function readBundleIndex(bundle: AssetManager.Bundle, state: BundleIndexState) {
    state.maxDefaultLevel = -1;

    (Object.keys(variantDirs) as LevelVariant[]).forEach((variant) => {
        const variantIndex = state.variantIndexes[variant];
        variantIndex.indexedLevels.clear();
        variantIndex.pathByLevel.clear();

        const infos = bundle.getDirWithPath(variantIndex.dir, JsonAsset, []);
        for (const info of infos) {
            const level = extractLevel(info.path);
            if (level === null) continue;

            variantIndex.indexedLevels.add(level);
            variantIndex.pathByLevel.set(level, info.path);

            if (variant === 'default' && level > state.maxDefaultLevel) {
                state.maxDefaultLevel = level;
            }
        }
    });
}

async function ensureBundleIndex(segment: BundleSegment): Promise<BundleIndexState> {
    let state = bundleIndexes.get(segment.bundleName);
    if (!state) {
        state = createBundleIndexState(segment);
        bundleIndexes.set(segment.bundleName, state);
    }

    if (state.scanned) return state;
    if (state.readyPromise) {
        await state.readyPromise;
        return state;
    }

    state.readyPromise = ensureBundleReady(segment.bundleName).then((bundle) => {
        if (!bundle) {
            state!.missing = true;
            state!.scanned = true;
            return;
        }

        readBundleIndex(bundle, state!);
        state!.scanned = true;
    });

    await state.readyPromise;
    return state;
}

async function resolveVariantLevelInfo(level: number, variant: Exclude<LevelVariant, 'default'>): Promise<LevelAssetInfo | null> {
    const normalizedLevel = normalizeLevel(level);
    const segment = resolveSegmentForLevel(normalizedLevel);
    const state = await ensureBundleIndex(segment);
    const path = state.variantIndexes[variant].pathByLevel.get(normalizedLevel);
    if (!path) return null;

    return {
        bundleName: state.segment.bundleName,
        level: normalizedLevel,
        path,
    };
}

async function resolveDefaultLevelInfo(level: number): Promise<LevelAssetInfo | null> {
    const normalizedLevel = normalizeLevel(level);
    const segment = resolveSegmentForLevel(normalizedLevel);
    const segmentSize = getSegmentSize();

    for (let start = segment.start; start >= 0; start -= segmentSize) {
        const state = await ensureBundleIndex(resolveSegmentByStart(start));
        const exactPath = state.variantIndexes.default.pathByLevel.get(normalizedLevel);
        if (exactPath) {
            return {
                bundleName: state.segment.bundleName,
                level: normalizedLevel,
                path: exactPath,
            };
        }

        if (state.maxDefaultLevel < 0) continue;

        const fallbackPath = state.variantIndexes.default.pathByLevel.get(state.maxDefaultLevel);
        if (!fallbackPath) continue;

        return {
            bundleName: state.segment.bundleName,
            level: state.maxDefaultLevel,
            path: fallbackPath,
        };
    }

    return null;
}

async function ensureVariantAsset(variant: LevelVariant, info: LevelAssetInfo): Promise<JsonAsset | null> {
    const bucket = getBucket(variant);
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

function releaseVariantLevel(variant: LevelVariant, bundleName: string, level: number) {
    const bucket = getBucket(variant);
    const cacheKey = getCacheKey(bundleName, level);
    if (!bucket.assets.has(cacheKey)) return;

    const bundle = assetManager.getBundle(bundleName);
    const path = getIndexedPath(bundleName, variant, level);
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

export function resolveLevelLoadOptions(level: number): { ad: boolean; retry: boolean } {
    const normalizedLevel = normalizeLevel(level);
    return {
        ad: ProgressManager.loadGlobalAdCount() >= Constants.LevelDifficulty.AdThreshold,
        retry: ProgressManager.loadLevelRetryCount(normalizedLevel) > Constants.LevelDifficulty.RetryThreshold,
    };
}

export async function warmupForwardWindow(level: number, aheadCount = 10): Promise<void> {
    const normalizedLevel = normalizeLevel(level);
    const targets = new Map<string, LevelAssetInfo>();

    for (let offset = 0; offset <= aheadCount; offset++) {
        const info = await resolveDefaultLevelInfo(normalizedLevel + offset);
        if (!info) continue;
        targets.set(getCacheKey(info.bundleName, info.level), info);
    }

    await Promise.all(Array.from(targets.values(), (info) => ensureVariantAsset('default', info)));
}

export async function ensureLevelJson(level: number, opts?: { ad?: boolean; retry?: boolean }): Promise<LevelJson | null> {
    const normalizedLevel = normalizeLevel(level);

    if (opts?.ad) {
        const adInfo = await resolveVariantLevelInfo(normalizedLevel, 'ad');
        if (adInfo) {
            const adAsset = await ensureVariantAsset('ad', adInfo);
            if (adAsset?.json) return adAsset.json as LevelJson;
        }
    }

    if (opts?.retry) {
        const retryInfo = await resolveVariantLevelInfo(normalizedLevel, 'retry');
        if (retryInfo) {
            const retryAsset = await ensureVariantAsset('retry', retryInfo);
            if (retryAsset?.json) return retryAsset.json as LevelJson;
        }
    }

    const defaultInfo = await resolveDefaultLevelInfo(normalizedLevel);
    if (!defaultInfo) return null;

    const asset = await ensureVariantAsset('default', defaultInfo);
    return asset?.json ? asset.json as LevelJson : null;
}

export function releaseOutsideWindow(level: number, aheadCount = 10): void {
    void (async () => {
        const normalizedLevel = normalizeLevel(level);
        const defaultKeepKeys = new Set<string>();

        for (let offset = 0; offset <= aheadCount; offset++) {
            const info = await resolveDefaultLevelInfo(normalizedLevel + offset);
            if (!info) continue;
            defaultKeepKeys.add(getCacheKey(info.bundleName, info.level));
        }

        for (const cacheKey of Array.from(getBucket('default').assets.keys())) {
            if (defaultKeepKeys.has(cacheKey)) continue;

            const parsed = parseCacheKey(cacheKey);
            if (!parsed) continue;
            releaseVariantLevel('default', parsed.bundleName, parsed.level);
        }

        const minLevel = normalizedLevel;
        const maxLevel = normalizedLevel + aheadCount;
        (['retry', 'ad'] as Array<Exclude<LevelVariant, 'default'>>).forEach((variant) => {
            for (const cacheKey of Array.from(getBucket(variant).assets.keys())) {
                const parsed = parseCacheKey(cacheKey);
                if (!parsed) continue;
                if (parsed.level >= minLevel && parsed.level <= maxLevel) continue;
                releaseVariantLevel(variant, parsed.bundleName, parsed.level);
            }
        });
    })();
}
