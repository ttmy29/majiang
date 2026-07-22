import { _decorator, AudioClip, AudioSource, Component, assetManager, director, Prefab } from 'cc';
import { LayerManager } from './manager/LayerManager';
import { AudioManager } from './manager/AudioManager';
import { Constants } from './config/Constants';
import { ProgressManager } from './manager/ProgressManager';


const { ccclass, property } = _decorator;

@ccclass('GameLaunch')
export class GameLaunch extends Component {
    
    start() {
        LayerManager.instance.init();
        if (ProgressManager.loadLevel() === 0) {
            LayerManager.instance.showGameLayer();
        } else {
            LayerManager.instance.showStartLayer(false);
        }
        this.initAudioManager();
        this.initPrefabResources();
        this.initAudioResources();
    }

    private initAudioManager() {
        // assetManager.loadBundle(Constants.BgmBundleName, (err, bundle) => {
        //     bundle.load<AudioClip>('mj_bgm', AudioClip, (err, clip: AudioClip) => {
        //         if (err) {
        //             console.error('加载音频失败', err);
        //             return;
        //         }

        //         const bgmSource = this.node.addComponent(AudioSource);
        //         bgmSource.clip = clip;
        //         bgmSource.loop = true;

        //         const effectSourceCount = 4;
        //         const effectSources: AudioSource[] = [];
        //         for (let i = 0; i < effectSourceCount; i++) {
        //             effectSources.push(this.node.addComponent(AudioSource));
        //         }

        //         AudioManager.instance.init([bgmSource, ...effectSources]);
        //     });
        // });  
        const bundle = assetManager.getBundle(Constants.BgmBundleName);
        bundle.load<AudioClip>('mj_bgm', AudioClip, (err, clip: AudioClip) => {
            if (err) {
                console.error('加载音频失败', err);
                return;
            }

            const bgmSource = this.node.addComponent(AudioSource);
            bgmSource.clip = clip;
            bgmSource.loop = true;

            const effectSourceCount = 4;
            const effectSources: AudioSource[] = [];
            for (let i = 0; i < effectSourceCount; i++) {
                effectSources.push(this.node.addComponent(AudioSource));
            }

            AudioManager.instance.init([bgmSource, ...effectSources]);
        });
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
                director.emit(Constants.eventNames.EventUIPrefabsReady);
            });
        }
    }

    initAudioResources() {
        // assetManager.loadBundle(Constants.AudioBundleName, (err, bundle) => {
        //     bundle.loadDir('/', AudioClip, (err, clipArray: AudioClip[]) => {
        //         if (err) {
        //             console.error('加载音频失败', err);
        //             return;
        //         }
        //         // 把加载到的 clip 注册到单例,clip.name 不带扩展名,跟 AudioClipNames 里的字符串对齐即可命中
        //         AudioManager.instance.initAudioClips(clipArray);
        //         console.log('加载音频成功', clipArray.length);
        //     });
        // });
        const bundle = assetManager.getBundle(Constants.AudioBundleName);
        bundle.loadDir('/', AudioClip, (err, clipArray: AudioClip[]) => {
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
