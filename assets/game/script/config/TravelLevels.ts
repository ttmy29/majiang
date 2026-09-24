/** Tile Explorer 1.97.0 Android 默认主线的导入格式；不再生成替代布局。 */
export const MAX_TRAVEL_LEVEL = 971;
export const TRAVEL_DATA_VERSION = 3;
export type TravelDifficulty = 'normal' | 'hard' | 'superHard';
export interface TravelTilePlan {
    id: number;
    layer: number;
    /** 原始坐标：col = x，row = -y；仅渲染时统一居中缩放。 */
    row: number;
    col: number;
    type: string;
    faceDown: boolean;
    sourceType?: number;
}
export interface TravelLevelPlan {
    level: number;
    layoutId: number;
    difficulty: TravelDifficulty;
    title: string;
    width: number;
    height: number;
    centerCol?: number;
    centerRow?: number;
    bounds?: { minCol: number; maxCol: number; minRow: number; maxRow: number };
    source?: {
        game: 'Tile Explorer'; version: '1.97.0'; platform: 'Android';
        originalLevel: number; levelId: number; layoutName: string; boardFile: string; boardIndex: number;
        boardHash: string; dataHash: string; tileCount: number; typeTag: string;
    };
    deal?: { tileTypes: number[]; typeWeight: number[]; difficulty: number; createRule: number; algorithm: string };
    tiles: TravelTilePlan[];
}

type PositionedTile = Pick<TravelTilePlan, 'layer' | 'row' | 'col'>;
export function isTravelBlocked(tile: PositionedTile, remaining: readonly PositionedTile[]): boolean {
    return remaining.some(other => other.layer > tile.layer
        && Math.abs(other.col - tile.col) < 0.98 && Math.abs(other.row - tile.row) < 0.98);
}

export function travelRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 0x100000000;
    };
}

/** 本地配牌适配，不声称复刻 APK 的动态调难/发牌算法。坐标和机关参数不参与改写。 */
export function assignTravelFaces(plan: TravelLevelPlan, availableTypes: readonly string[]): number[] {
    const random = travelRandom((plan.source?.originalLevel || plan.level) * 2654435761 + plan.layoutId);
    const candidates = availableTypes.slice();
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const groups = plan.tiles.length / 3;
    const weights = (plan.deal?.typeWeight || [1, 1, 1]).filter(weight => weight > 0);
    const count = Math.min(groups, candidates.length, weights.length);
    if (!Number.isInteger(groups) || count < 1) throw new Error(`Invalid travel deal: ${plan.level}`);
    const faces: string[] = [];
    const totalWeight = weights.slice(0, count).reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) faces.push(candidates[i]);
    while (faces.length < groups) {
        let roll = random() * totalWeight;
        let index = 0;
        while (index < count - 1 && roll >= weights[index]) roll -= weights[index++];
        faces.push(candidates[index]);
    }
    for (let i = faces.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [faces[i], faces[j]] = [faces[j], faces[i]];
    }
    const remaining = plan.tiles.slice();
    const solution: number[] = [];
    let removed = 0;
    while (remaining.length) {
        const visible = remaining.filter(tile => !isTravelBlocked(tile, remaining));
        if (!visible.length) throw new Error(`Unresolvable source layout: ${plan.level}`);
        const tile = visible[Math.floor(random() * visible.length)];
        tile.type = faces[Math.floor(removed++ / 3)];
        solution.push(tile.id);
        remaining.splice(remaining.indexOf(tile), 1);
    }
    return solution;
}
