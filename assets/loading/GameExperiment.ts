import { sys } from 'cc';

declare const wx: any;

type ExperimentValues = Record<string, string>;
type ExperimentWindow = Window & {
    __mahjongGameExperimentValues?: ExperimentValues;
};

/**
 * 启动阶段统一读取微信小游戏实验参数。
 *
 * 实验值放在 window 上，确保 loading 与 game 两个 bundle 读取的是同一份结果。
 */
export class GameExperiment {
    static readonly BottomUiKey = 'expt_1785998905';
    static readonly TreatmentValue = '1';

    private static readonly RequestTimeoutMs = 2000;
    private static preloadPromise: Promise<void> | null = null;

    static preloadBottomUi(): Promise<void> {
        if (this.preloadPromise) return this.preloadPromise;
        // 每次启动先回到对照组；请求失败或超时时不沿用开发热重载留下的旧值。
        delete this.getValues()[this.BottomUiKey];

        this.preloadPromise = new Promise<void>((resolve) => {
            if (sys.platform !== sys.Platform.WECHAT_GAME
                || typeof wx === 'undefined'
                || !wx
                || typeof wx.getGameExptInfo !== 'function') {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve();
            };
            const timeoutId = setTimeout(finish, this.RequestTimeoutMs);

            try {
                wx.getGameExptInfo({
                    keyList: [this.BottomUiKey],
                    success: (res: any) => {
                        if (settled) return;
                        const list = Array.isArray(res?.list) ? res.list : [];
                        const item = list.find((info: any) => info?.param_name === this.BottomUiKey);
                        this.getValues()[this.BottomUiKey] = `${item?.param_value ?? ''}`;
                        finish();
                    },
                    fail: (err: any) => {
                        console.warn('GameExperiment: getGameExptInfo failed', err);
                        finish();
                    },
                });
            } catch (err) {
                console.warn('GameExperiment: getGameExptInfo error', err);
                finish();
            }
        });

        return this.preloadPromise;
    }

    static isBottomUiEnabled(): boolean {
        //return true;
        return this.getValues()[this.BottomUiKey] === this.TreatmentValue;
    }

    private static getValues(): ExperimentValues {
        const globalWindow = window as ExperimentWindow;
        if (!globalWindow.__mahjongGameExperimentValues) {
            globalWindow.__mahjongGameExperimentValues = {};
        }
        return globalWindow.__mahjongGameExperimentValues;
    }
}
