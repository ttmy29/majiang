import { Component, director, find, instantiate, Label, Node, Prefab, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { AudioManager, AudioClipNames } from './AudioManager';

export enum LayerType {
    Start = 'startLayer',
    Game = 'gameLayer',
    UI = 'uiLayer',
    Popup = 'popupLayer',
    Top = 'topLayer',
}

export class LayerManager {
    private static _instance: LayerManager;
    private _layers: Map<LayerType, Node> = new Map();
    private _uiPrefabs: Map<string, Prefab> = new Map();
    private _toastPrefab: Prefab | null = null;
    private constructor() { }
    private _activeToasts: Node[] = [];
    public static get instance(): LayerManager {
        if (!this._instance) {
            this._instance = new LayerManager();
        }
        return this._instance;
    }

    public init(): void {
        const canvas = find('Canvas');
        if (!canvas) {
            console.error('LayerManager.init: Canvas not found');
            return;
        }

        director.addPersistRootNode(canvas);

        const types = [LayerType.Start, LayerType.Game, LayerType.UI, LayerType.Popup, LayerType.Top];
        for (const type of types) {
            const node = canvas.getChildByName(type);
            if (node) {
                this._layers.set(type, node);
            }
        }
    }

    public initToastPrefab(prefab: Prefab): void {
        this._toastPrefab = prefab;
    }
    /**
         * 根据预制体名称显示 UI
         * @param uiName 预制体名称（即 constants.prefab 中的文件名，例如 'setting'）
         */
/**
     * 显示 UI 并传递动态参数
     * @param uiName 预制体名称 / 脚本组件名称
     * @param args 传递给 UI 脚本的任意参数列表
     */
    public showUI(uiName: string, ...args: any[]): Node | null {
        // 1. 从缓存字典中获取预制体
        const prefab = this._uiPrefabs.get(uiName);
        if (!prefab) {
            console.error(`UI 预制体未找到: ${uiName}，请检查是否已正确加载`);
            return null;
        }

        // 2. 获取 UI 挂载的层级 (假设默认挂载到 UI 层)
        const uiLayer = this._layers.get(LayerType.UI);
        if (!uiLayer) {
            console.error('UI 层级未找到，请检查 Canvas 下是否有对应的节点');
            return null;
        }

        // 3. 实例化预制体并添加到层级中
        const uiNode = instantiate(prefab);
        uiLayer.addChild(uiNode);

        // 弹窗类 UI 统一播放一次打开音效,后续新增弹窗不用每个都接
        AudioManager.instance.playOneShot(AudioClipNames.pageOpen);

        // 4. 获取对应的脚本组件，并传入参数
        // Cocos 支持通过字符串名称获取组件，这里假设你的脚本组件名（ccclass名）和 uiName 一致
     const comp = uiNode.getComponents(Component).find(
        c => typeof (c as any).init === 'function'
    );
    if (comp) {
        (comp as any).init(...args);
    }

        return uiNode;
    }

    public initUIPrefab(prefabArr: Prefab[]): void {
        console.log('initUIPrefab 接收到的预制体:', prefabArr);

        if (!prefabArr || prefabArr.length === 0) {
            return;
        }

        // 遍历数组，将预制体存入 _uiPrefabs 字典中
        for (const prefab of prefabArr) {
            if (prefab && prefab.name) {
                this._uiPrefabs.set(prefab.name, prefab);
            }
        }

        console.log('当前已缓存的 UI 预制体名单:', Array.from(this._uiPrefabs.keys()));
    }




    public getLayer(type: LayerType): Node {
        return this._layers.get(type)!;
    }

    public add(prefab: Prefab, type: LayerType = LayerType.UI): Node {
        const node = instantiate(prefab);
        this.getLayer(type).addChild(node);
        return node;
    }

    public clear(type: LayerType): void {
        this.getLayer(type).removeAllChildren();
    }

    public showStartLayer(): void {
        this._layers.get(LayerType.Start)!.active = true;
        this._layers.get(LayerType.Game)!.active = false;
    }

    public showGameLayer(): void {
        this._layers.get(LayerType.Start)!.active = false;
        this._layers.get(LayerType.Game)!.active = true;
    }

    public showToast(message: string): boolean {
        if (!this._toastPrefab) return false;

        // ==========================================
        // 需求 2：有新的显示时，之前的立即移动消失
        // ==========================================
        for (const oldToast of this._activeToasts) {
            if (oldToast && oldToast.isValid) {
                // 停止旧 Toast 身上所有的等待定时器和动画
                Tween.stopAllByTarget(oldToast);
                const oldOpacity = oldToast.getComponent(UIOpacity) ?? oldToast.addComponent(UIOpacity);
                Tween.stopAllByTarget(oldOpacity);

                // 获取旧 Toast 当前的实时位置（防止在移动中途被打断）
                const currentPos = oldToast.position.clone();
                oldOpacity.opacity = 100;
                tween(oldToast)
                    .to(0.5, { position: new Vec3(currentPos.x, currentPos.y + 120, currentPos.z) }, { easing: "quadOut" })
                    .call(() => { oldToast.destroy(); })
                    .start();

                tween(oldOpacity)
                    .to(0.15, { opacity: 0 })
                    .start();
            }
        }
        // 旧的全部进入退场状态，清空记录数组
        this._activeToasts = [];

        // ==========================================
        // 常规创建新的 Toast
        // ==========================================
        const toast = instantiate(this._toastPrefab);
        toast.getChildByName("label")!.getComponent(Label)!.string = message;
        this.getLayer(LayerType.Top).addChild(toast);

        const startPos = toast.position.clone();
        const opacity = toast.getComponent(UIOpacity) ?? toast.addComponent(UIOpacity);
        opacity.opacity = 255;

        // 将新创建的 Toast 加入追踪列表
        this._activeToasts.push(toast);

        // ==========================================
        // 需求 1：显示 1.5 秒后，再移动消失
        // ==========================================
        tween(toast)
            .delay(1.5) // 静止展示 1.5 秒
            .to(0.5, { position: new Vec3(startPos.x, startPos.y + 120, startPos.z) }, { easing: "quadOut" })
            .call(() => {
                // 正常结束时，将其从追踪列表中移除并销毁节点
                const index = this._activeToasts.indexOf(toast);
                if (index > -1) {
                    this._activeToasts.splice(index, 1);
                }
                if (toast.isValid) {
                    toast.destroy();
                }
            })
            .start();

        tween(opacity)
            .delay(1.5) // 透明度同步等待 1.5 秒
            .to(0.5, { opacity: 0 })
            .start();

        return true;
    }

}
