import { Node, UITransform, Vec3 } from 'cc';

// 项目通用工具方法集合：
// - 纯函数/纯节点操作，零业务状态
// - 仅依赖 cc 基础类型（Node / UITransform / Vec3）
// - 调用方按需 `import { Utils } from './util/Utils'` 即可
export class Utils {
    // 在 parent 的整棵子树里按名字深度查找节点。getChildByName 只查一层，
    // 这里需要跨层级时用（例如从场景根节点找 'slotNode'）
    public static findChildDeep(parent: Node | null, name: string): Node | null {
        if (!parent) return null;
        const direct = parent.getChildByName(name);
        if (direct) return direct;
        for (const child of parent.children) {
            const found = Utils.findChildDeep(child, name);
            if (found) return found;
        }
        return null;
    }

    // 把世界坐标换算成 parent 节点的本地坐标。常用于把飞行中的牌挂到
    // flyLayer 时保持视觉位置不变。parent 没有 UITransform 时会顺手补一个
    public static worldToLocalPosition(parent: Node, worldPosition: Vec3): Vec3 {
        const transform = parent.getComponent(UITransform) || parent.addComponent(UITransform);
        return transform.convertToNodeSpaceAR(worldPosition);
    }

    // worldToLocalPosition 的反向：本地坐标转世界坐标
    public static localToWorldPosition(parent: Node, localPosition: Vec3): Vec3 {
        const transform = parent.getComponent(UITransform) || parent.addComponent(UITransform);
        return transform.convertToWorldSpaceAR(localPosition);
    }

    public static clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    // 基于 mulberry32 的可重现随机数源。同一个 seed 永远产出同一串结果，
    // 关卡级的洗牌、AI 决策等需要"可回放"的逻辑用这个，而不是 Math.random
    public static createRandom(seed: number): () => number {
        let value = seed >>> 0;
        return () => {
            value += 0x6D2B79F5;
            let t = value;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Fisher-Yates 原地洗牌。random 默认走 createRandom 时是可复现的，
    // 调用方也可以传 Math.random 走真随机
    public static shuffle<T>(items: T[], random: () => number): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            const tmp = items[i];
            items[i] = items[j];
            items[j] = tmp;
        }
        return items;
    }
}
