import { Button, Node } from 'cc';
import { AudioManager } from './AudioManager';
import { LayerManager } from './LayerManager';
import { ProgressManager } from './ProgressManager';
import { SDKManager } from '../../../loading/SDKManager';
import { ThreePopupEvent, UIThreePopup } from '../UIThreePopup';

/** 首页和通关页共用的旅行次数恢复弹窗。广告完成前不发放次数。 */
export class TravelRecoveryManager {
    static show(onRecovered?: () => void): Node | null {
        const layers = LayerManager.instance;
        const existing = layers.getOpenUI('recoverCount');
        if (existing) return existing;
        if (!layers.hasUI('recoverCount')) {
            layers.showToast('旅行次数弹窗资源加载中，请稍后重试');
            return null;
        }
        const node = layers.showUI('recoverCount');
        if (!node) return null;
        const popup = node.getComponent(UIThreePopup);
        const button = node.getChildByPath('view/recoverButton')?.getComponent(Button);
        if (!popup || !button) {
            node.destroy();
            layers.showToast('旅行次数弹窗资源未就绪');
            return null;
        }

        let pending = false;
        let settled = false;
        let requestId = 0;
        const mask = node.getChildByName('bg');
        mask?.on(Node.EventType.TOUCH_END, () => {
            if (!pending && node.isValid) popup.close();
        });
        node.on(ThreePopupEvent.RecoverRequested, () => {
            if (pending || settled || !node.isValid) return;
            AudioManager.instance.playClick();
            pending = true;
            const currentRequest = ++requestId;
            button.interactable = false;
            SDKManager.instance.showVideoAd(() => {
                if (!pending || settled || currentRequest !== requestId || !node.isValid) return;
                pending = false;
                settled = true;
                ProgressManager.addGlobalAdCount(1);
                ProgressManager.refillTravelAttempts();
                popup.close();
                layers.showToast('旅行次数 +5');
                onRecovered?.();
            }, () => {
                if (!pending || settled || currentRequest !== requestId || !node.isValid) return;
                pending = false;
                button.interactable = true;
                layers.showToast('视频播放未完成！');
            }, 'travel_attempts');
        });
        return node;
    }
}
