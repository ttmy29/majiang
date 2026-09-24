# 三消玩法新增弹窗

新增资源，不替换已有 `failure.prefab` / `tips.prefab`，不改主场景或已有业务逻辑。

| 预制体（game bundle 内路径） | 对应效果图 | 主要节点 |
| --- | --- | --- |
| `prefab/recoverCount` | 恢复次数 | `view/panel`、`view/title`、`view/content`、`view/recoverButton` |
| `prefab/failureThree` | 失败界面 | `view/title`、`view/content`、`view/reviveButton`、`view/observeButton` |
| `prefab/gameplayGuide` | 玩法说明 | `view/panel`、`view/title`、`view/content`、`view/closeButton`、`view/confirmButton` |

切图位于 `assets/game/resources/threePopups/`，保留原图像素及透明边距。恢复次数与玩法说明复用无字面板，标题独立；确定按钮复用现有绿色空白按钮底图和可编辑 Label。`adSlot.png` 是同时导入的广告牌盒备用切图，不作为第四个预制体。

- `bg`：全屏半透明遮罩；根节点使用 Widget 拉伸并阻止触摸穿透。
- `view`：根据实际窗口等比缩放，支持项目 750 × 1334 设计尺寸及长屏。
- 不把效果图中的游戏背景、麻将底栏、IQ 数值或红色设计标注烘焙到弹窗里，它们属于底层游戏画面。
- “确定”与右上角关闭按钮可直接关闭玩法说明。
- 失败界面按住底部提示 0.25 秒后隐藏弹窗和遮罩，松手或取消触摸恢复，观察期间不会误触棋盘。
- 恢复次数效果图没有关闭按钮，因此保留原设计。

## 业务接入

`UIThreePopup.ts` 只管理展示。恢复与复活按钮发出节点事件，不直接发奖励，也不擅自调用广告或现有主线失败逻辑。

```ts
import { assetManager, instantiate, Prefab } from 'cc';
import { ThreePopupEvent, UIThreePopup } from './UIThreePopup';

const gameBundle = assetManager.getBundle('game');
gameBundle.load('prefab/recoverCount', Prefab, (error, prefab) => {
    if (error) return;
    const popup = instantiate(prefab);
    popup.on(ThreePopupEvent.RecoverRequested, (ui: UIThreePopup) => {
        // 接入项目对应道具的激励广告；仅在广告成功并补充次数后执行 ui.close()。
        // 广告取消/失败时保留弹窗，不发奖励。
    });
    uiLayer.addChild(popup); // uiLayer 为当前 Canvas 中的 UI 层节点
});
```

其他事件：`ReviveRequested`、`Confirmed`、`Closed`。新弹窗尚未加入 `Constants` 的自动加载列表，未改变当前游戏入口；也可在编辑器直接拖入 Canvas 预览/绑定事件。

## 检查

运行 `node tools/test-three-popups.cjs` 校验序列化引用、组件绑定、图片尺寸、资源 UUID、按钮事件及布局边界。
