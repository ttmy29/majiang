import { _decorator, AudioClip, AudioSource, Component, assetManager, Prefab } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';

const { ccclass, property } = _decorator;

@ccclass('GameLaunch')
export class GameLaunch extends Component {

    start() {
        LayerManager.instance.init();
        LayerManager.instance.showStartLayer();
        this.initAudioManager();
        this.initPrefabResources();
        this.initAudioResources();
    }

    private initAudioManager() {
        // 优先用 GameLaunch 节点上挂的 AudioSource(第 0 个当 BGM,其余当音效);
        // 一个都没挂时自动补一个,保证 playOneShot 至少有 source 可走
        let sources = this.getComponents(AudioSource);
        if (sources.length === 0) {
            sources = [this.addComponent(AudioSource)];
        }
        AudioManager.instance.init(sources);
    }

    initPrefabResources() {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        if (!bundle) {
            console.error(`未找到对应 Bundle: ${Constants.GameBundleName}`);
            return;
        }

        // 1. 加载 Toast 预制体
        bundle.load<Prefab>('prefab/toastItem', (err, prefab) => {
            if (err) {
                console.error('加载 toastItem 预制体失败', err);
                return;
            }
            LayerManager.instance.initToastPrefab(prefab);
        });

        //@ts-ignore
        const prefabPaths = Object.values(Constants.prefab);

        if (prefabPaths.length > 0) {

            bundle.load(prefabPaths, (err, prefabs) => {
                if (err) {
                    console.error('批量加载 UI 预制体失败', err);
                    return;
                }
                //@ts-ignore
                LayerManager.instance.initUIPrefab(prefabs);
            });
        }
    }

    initAudioResources() {
        const bundle = assetManager.getBundle(Constants.GameBundleName);
        bundle.loadDir('audio', AudioClip, (err, clipArray: AudioClip[]) => {
            if (err) {
                console.error('加载音频失败', err);
                return;
            }
            // 把加载到的 clip 注册到单例,clip.name 不带扩展名,跟 AudioClipNames 里的字符串对齐即可命中
            AudioManager.instance.initAudioClips(clipArray);
            console.log('加载音频成功', clipArray.length);
        });
    }
}