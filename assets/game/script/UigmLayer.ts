import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    EditBox,
    Graphics,
    HorizontalTextAlignment,
    Label,
    Node,
    UITransform,
    UIOpacity,
    Vec3,
    VerticalTextAlignment,
    Widget,
    tween,
    view,
} from 'cc';
import { GameCtrl } from './GameCtrl';
import { setCurrentGameMode } from './config/GameMode';
import { AudioClipNames, AudioManager } from './manager/AudioManager';
import { ArchiveManager } from './manager/ArchiveManager';
import { LayerManager, LayerType } from './manager/LayerManager';
import { ProgressManager } from './manager/ProgressManager';
import { StorageKey, StorageManager } from './manager/StorageManager';

const { ccclass } = _decorator;

const GM_LAYER_NAME = 'UigmLayer';
const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 680;

export interface GmPanelActions {
    getLevel(): number;
    reset(): Promise<boolean> | boolean;
    jump(level: number): Promise<boolean> | boolean;
    complete(): boolean;
    minLevel?: number;
    maxLevel?: number;
    resetLabel?: string;
    levelLabel?: string;
    onClose?: () => void;
}

@ccclass('UigmLayer')
export class UigmLayer extends Component {
    private levelEditBox: EditBox | null = null;
    private buttons: Button[] = [];
    private operationPending = false;
    private actions: GmPanelActions | null = null;
    private closeNotified = false;

    public static show(actions?: GmPanelActions): UigmLayer | null {
        const existing = LayerManager.instance.getOpenUI(GM_LAYER_NAME);
        if (existing?.isValid) return existing.getComponent(UigmLayer);

        const uiLayer = LayerManager.instance.getLayer(LayerType.UI);
        if (!uiLayer?.isValid) return null;

        const node = new Node(GM_LAYER_NAME);
        node.active = false;
        node.layer = uiLayer.layer;
        node.addComponent(UITransform);
        const component = node.addComponent(UigmLayer);
        component.actions = actions || null;
        uiLayer.addChild(node);
        node.active = true;
        AudioManager.instance.playOneShot(AudioClipNames.pageOpen);
        return component;
    }

    protected onLoad(): void {
        this.buildView();
    }

    protected onDestroy(): void {
        this.notifyClosed();
        this.buttons.length = 0;
        this.levelEditBox = null;
    }

    public async onButtonNewUserClick(): Promise<void> {
        if (this.operationPending) return;
        AudioManager.instance.playClick();

        if (this.actions) {
            await this.runExternalAction(
                () => this.actions!.reset(),
                `已重置并进入${this.actions.levelLabel || '关卡'} ${this.actions.minLevel ?? 0}`,
                '重置失败',
            );
            return;
        }

        this.setOperationPending(true);

        const storage = StorageManager.instance;
        const keys = Object.keys(StorageKey) as Array<keyof typeof StorageKey>;
        for (const key of keys) storage.removeItem(StorageKey[key]);

        ProgressManager.saveLevel(0);
        ProgressManager.clearSnapshot();
        setCurrentGameMode('main');
        ArchiveManager.instance.scheduleUpload();

        const gameLayer = LayerManager.instance.getLayer(LayerType.Game);
        if (!gameLayer?.isValid) {
            this.setOperationPending(false);
            LayerManager.instance.showToast('游戏层尚未初始化');
            return;
        }

        if (!gameLayer.active) {
            this.closeImmediately();
            LayerManager.instance.showGameLayer();
            LayerManager.instance.showToast('已重置并进入第 0 关');
            return;
        }

        const gameCtrl = gameLayer.getComponent(GameCtrl);
        if (!gameCtrl) {
            this.setOperationPending(false);
            LayerManager.instance.showToast('未找到游戏控制器');
            return;
        }

        try {
            const started = await gameCtrl.gmJumpToLevel(0);
            if (!started) {
                LayerManager.instance.showToast('第 0 关加载失败');
                return;
            }

            this.closeImmediately();
            LayerManager.instance.showToast('已重置并进入第 0 关');
        } catch (error) {
            console.error('[UigmLayer] reset to level 0 failed', error);
            LayerManager.instance.showToast('第 0 关加载失败');
        } finally {
            if (this.node?.isValid) this.setOperationPending(false);
        }
    }

    public async onButtonJumpClick(): Promise<void> {
        if (this.operationPending) return;
        AudioManager.instance.playClick();

        const level = this.readTargetLevel();
        if (level === null) {
            LayerManager.instance.showToast(this.getLevelInputError());
            return;
        }

        if (this.actions) {
            const levelLabel = this.actions.levelLabel || '关卡';
            await this.runExternalAction(
                () => this.actions!.jump(level),
                `已跳转到${levelLabel} ${level}`,
                `${levelLabel} ${level} 加载失败`,
            );
            return;
        }

        const gameLayer = LayerManager.instance.getLayer(LayerType.Game);
        if (!gameLayer?.isValid) {
            LayerManager.instance.showToast('游戏层尚未初始化');
            return;
        }

        this.setOperationPending(true);
        setCurrentGameMode('main');

        if (!gameLayer.active) {
            ProgressManager.saveLevel(level);
            ProgressManager.clearSnapshot();
            ArchiveManager.instance.scheduleUpload();
            this.closeImmediately();
            LayerManager.instance.showGameLayer();
            LayerManager.instance.showToast(`已跳转到关卡 ${level}`);
            return;
        }

        const gameCtrl = gameLayer.getComponent(GameCtrl);
        if (!gameCtrl) {
            this.setOperationPending(false);
            LayerManager.instance.showToast('未找到游戏控制器');
            return;
        }

        try {
            const started = await gameCtrl.gmJumpToLevel(level);
            if (!started) {
                LayerManager.instance.showToast(`关卡 ${level} 加载失败`);
                return;
            }

            this.closeImmediately();
            LayerManager.instance.showToast(`已跳转到关卡 ${level}`);
        } catch (error) {
            console.error(`[UigmLayer] jump to level ${level} failed`, error);
            LayerManager.instance.showToast(`关卡 ${level} 加载失败`);
        } finally {
            if (this.node?.isValid) this.setOperationPending(false);
        }
    }

    public onButtonCompleteClick(): void {
        if (this.operationPending) return;
        AudioManager.instance.playClick();

        if (this.actions) {
            if (!this.actions.complete()) {
                LayerManager.instance.showToast('当前没有可完成的进行中关卡');
                return;
            }
            this.closeImmediately();
            return;
        }

        const gameLayer = LayerManager.instance.getLayer(LayerType.Game);
        const gameCtrl = gameLayer?.active ? gameLayer.getComponent(GameCtrl) : null;
        if (!gameCtrl || !gameCtrl.gmCompleteLevel()) {
            LayerManager.instance.showToast('当前没有可完成的进行中关卡');
            return;
        }

        this.closeImmediately();
    }

    public onButtonCloseClick(): void {
        if (this.operationPending) return;
        AudioManager.instance.playClick();
        this.closeImmediately();
    }

    private buildView(): void {
        const parentSize = this.node.parent?.getComponent(UITransform)?.contentSize || view.getVisibleSize();
        const rootTransform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        rootTransform.setContentSize(parentSize.width, parentSize.height);

        const widget = this.node.addComponent(Widget);
        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.isAlignLeft = true;
        widget.isAlignRight = true;
        widget.top = 0;
        widget.bottom = 0;
        widget.left = 0;
        widget.right = 0;
        widget.updateAlignment();
        this.node.addComponent(BlockInputEvents);

        const backdrop = this.node.addComponent(Graphics);
        backdrop.fillColor = new Color(0, 0, 0, 178);
        backdrop.rect(-parentSize.width / 2, -parentSize.height / 2, parentSize.width, parentSize.height);
        backdrop.fill();

        const panel = this.createRoundedRect(
            this.node,
            'panel',
            PANEL_WIDTH,
            PANEL_HEIGHT,
            new Color(35, 38, 44, 255),
        );
        panel.setPosition(0, 0, 0);

        this.createLabel(panel, 'title', 'GM 面板', 40, 0, 270, 500, 64, new Color(255, 255, 255, 255));
        this.createButton(
            panel,
            'newUser',
            this.actions?.resetLabel || '新用户',
            0,
            150,
            480,
            92,
            new Color(184, 62, 58, 255),
            this.onButtonNewUserClick,
        );

        this.levelEditBox = this.createLevelInput(panel, -105, 30, 270, 88);
        this.levelEditBox.string = `${this.actions?.getLevel() ?? ProgressManager.loadLevel()}`;
        this.createButton(
            panel,
            'jump',
            '跳关',
            165,
            30,
            190,
            88,
            new Color(54, 112, 181, 255),
            this.onButtonJumpClick,
        );

        this.createButton(
            panel,
            'complete',
            '直接完成',
            0,
            -95,
            480,
            92,
            new Color(53, 139, 91, 255),
            this.onButtonCompleteClick,
        );
        this.createButton(
            panel,
            'close',
            '关闭',
            0,
            -220,
            480,
            92,
            new Color(92, 97, 107, 255),
            this.onButtonCloseClick,
        );

        const opacity = this.node.addComponent(UIOpacity);
        opacity.opacity = 0;
        panel.setScale(new Vec3(0.85, 0.85, 1));
        tween(opacity).to(0.12, { opacity: 255 }).start();
        tween(panel).to(0.16, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
    }

    private createRoundedRect(
        parent: Node,
        name: string,
        width: number,
        height: number,
        color: Color,
    ): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = color;
        graphics.roundRect(-width / 2, -height / 2, width, height, 8);
        graphics.fill();
        return node;
    }

    private createLabel(
        parent: Node,
        name: string,
        text: string,
        fontSize: number,
        x: number,
        y: number,
        width: number,
        height: number,
        color: Color,
    ): Label {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(x, y, 0);
        node.addComponent(UITransform).setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.max(fontSize + 8, height);
        label.color = color;
        label.horizontalAlign = HorizontalTextAlignment.CENTER;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.useSystemFont = true;
        return label;
    }

    private createButton(
        parent: Node,
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        color: Color,
        handler: () => void,
    ): Button {
        const node = this.createRoundedRect(parent, name, width, height, color);
        node.setPosition(x, y, 0);
        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.96;
        node.on(Button.EventType.CLICK, handler, this);
        this.createLabel(node, 'label', text, 32, 0, 0, width - 24, height - 12, new Color(255, 255, 255, 255));
        this.buttons.push(button);
        return button;
    }

    private createLevelInput(parent: Node, x: number, y: number, width: number, height: number): EditBox {
        const node = this.createRoundedRect(parent, 'levelInput', width, height, new Color(245, 246, 248, 255));
        node.setPosition(x, y, 0);

        const textLabel = this.createLabel(
            node,
            'TEXT_LABEL',
            '',
            30,
            0,
            0,
            width - 32,
            height - 12,
            new Color(34, 37, 43, 255),
        );
        const placeholderLabel = this.createLabel(
            node,
            'PLACEHOLDER_LABEL',
            '关卡数',
            28,
            0,
            0,
            width - 32,
            height - 12,
            new Color(126, 131, 141, 255),
        );

        const editBox = node.addComponent(EditBox);
        editBox.textLabel = textLabel;
        editBox.placeholderLabel = placeholderLabel;
        editBox.inputMode = EditBox.InputMode.DECIMAL;
        editBox.inputFlag = EditBox.InputFlag.DEFAULT;
        editBox.returnType = EditBox.KeyboardReturnType.DONE;
        editBox.maxLength = 8;
        return editBox;
    }

    private readTargetLevel(): number | null {
        const value = this.levelEditBox?.string.trim() || '';
        if (!/^\d+$/.test(value)) return null;

        const level = Number(value);
        if (!Number.isSafeInteger(level)) return null;
        const minLevel = this.actions?.minLevel ?? 0;
        const maxLevel = this.actions?.maxLevel;
        if (level < minLevel || (typeof maxLevel === 'number' && level > maxLevel)) return null;
        return level;
    }

    private getLevelInputError(): string {
        const minLevel = this.actions?.minLevel ?? 0;
        const maxLevel = this.actions?.maxLevel;
        if (typeof maxLevel === 'number') {
            return `请输入 ${minLevel} 至 ${maxLevel} 的整数关卡`;
        }
        return `请输入 ${minLevel} 或更大的整数关卡`;
    }

    private async runExternalAction(
        action: () => Promise<boolean> | boolean,
        successText: string,
        failureText: string,
    ): Promise<void> {
        this.setOperationPending(true);
        try {
            if (!await action()) {
                LayerManager.instance.showToast(failureText);
                return;
            }
            this.closeImmediately();
            LayerManager.instance.showToast(successText);
        } catch (error) {
            console.error('[UigmLayer] external GM action failed', error);
            LayerManager.instance.showToast(failureText);
        } finally {
            if (this.node?.isValid) this.setOperationPending(false);
        }
    }

    private setOperationPending(pending: boolean): void {
        this.operationPending = pending;
        for (const button of this.buttons) {
            if (button?.isValid) button.interactable = !pending;
        }
    }

    private closeImmediately(): void {
        if (!this.node?.isValid) return;
        this.notifyClosed();
        this.node.removeFromParent();
        this.node.destroy();
    }

    private notifyClosed(): void {
        if (this.closeNotified) return;
        this.closeNotified = true;
        const onClose = this.actions?.onClose;
        this.actions = null;
        onClose?.();
    }
}
