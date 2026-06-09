import { _decorator, AudioClip, AudioSource, tween, Tween } from 'cc';
import { StorageKey, StorageManager } from './StorageManager';
import { ArchiveManager } from './ArchiveManager';

const { ccclass } = _decorator;

export enum AudioClipNames {
    Click = 'button_sound',//按钮点击
    mahjongClick = 'mj_up', //麻将点击
    pageOpen = 'pageopen_sound', //页面打开
    gaigaizi = 'gaigaizi', //盖子合上的音效
    taskBoxMove = 'taskBoxMove', //任务箱 槽位 移动回来 播放
    game_start = 'game_start', //游戏开始 牌飞的音效
    taskFly = 'taskFly', //撤回 牌飞的声音
    prop_tips = 'prop_tips', //换牌道具提示音效
    mj_error = 'mj_error', //麻将 抖动音效
    game_lose = 'game_lose', //游戏结束 失败弹窗音效
    game_win = 'game_win', //游戏结束 胜利弹窗音效
    combo_level1 = 'bucuo1', //1_好
    combo_level2 = 'lihai2', //2_优秀
    combo_level3 = 'niude3', //3_真棒
    combo_level4 = 'juele4', //4_漂亮
    combo_level5 = 'taiqiangle5', //5_真厉害
    combo_level6 = 'yingmale6', // 6_太棒了
    combo_level7 = 'wudile7', //7_绝绝子

}

export type AudioClipName = AudioClipNames | string | number;

@ccclass('AudioManager')
export class AudioManager {
    private audioSources: AudioSource[] = [];
    private bgmSource: AudioSource | null = null;
    private effectSources: AudioSource[] = [];

    private effectSourceIndex = 0;

    // BGM 正常音量。播放失败音效等场景会临时压低 bgm(ducking),结束后恢复到这个值
    private bgmBaseVolume = 1;

    public clips: { [name: string]: AudioClip } = {};

    private static _instance: AudioManager;
    public static get instance() {
        if (this._instance) {
            return this._instance;
        }

        this._instance = new AudioManager();
        return this._instance;
    }

    private get musicOn(): boolean {
        return StorageManager.instance.getBoolean(StorageKey.Music, true);
    }

    private get effectOn(): boolean {
        return StorageManager.instance.getBoolean(StorageKey.Audio, true);
    }

    init(audioSources: AudioSource[]) {
        this.audioSources = (audioSources || []).filter((source) => !!source);
        this.bgmSource = this.audioSources[0] || null;
        this.effectSources = this.audioSources.length > 1 ? this.audioSources.slice(1) : this.audioSources;
        this.effectSourceIndex = 0;

        this.play();
    }

    setMusicEnabled(enabled: boolean) {
        StorageManager.instance.setBoolean(StorageKey.Music, enabled);
        ArchiveManager.instance.scheduleUpload();
        if (enabled) {
            this.bgmSource?.play();
        } else {
            this.bgmSource?.pause();
        }
    }

    setEffectEnabled(enabled: boolean) {
        StorageManager.instance.setBoolean(StorageKey.Audio, enabled);
        ArchiveManager.instance.scheduleUpload();
    }

    play() {
        if (!this.musicOn || !this.bgmSource) return;

        // 复位音量,避免上一次 ducking 的 tween 被打断后 bgm 停在压低状态
        Tween.stopAllByTarget(this.bgmSource);
        this.bgmSource.volume = this.bgmBaseVolume;
        this.bgmSource.play();
    }

    pause() {
        this.audioSources.forEach((source) => source.pause());
    }

    stop() {
        this.audioSources.forEach((source) => source.stop());
    }

    registerClip(name: AudioClipName, clip: AudioClip) {
        if (!clip) return;

        this.clips[String(name)] = clip;
        this.clips[this.getClipKey(name)] = clip;
    }

    registerClips(clips: { [name: string]: AudioClip }) {
        if (!clips) return;

        Object.keys(clips).forEach((name) => {
            this.registerClip(name, clips[name]);
        });
    }

    initAudioClips(audioClips: AudioClip[]) {
        audioClips = audioClips || [];
        this.clips = {};

        audioClips.forEach((clip) => {
            this.registerClip(clip.name, clip);
        });
    }

    playBgm(clipName: AudioClipName, loop = true) {
        if (!this.musicOn || !this.bgmSource) return;

        const clip = this.getClip(clipName);
        if (!clip) return;

        Tween.stopAllByTarget(this.bgmSource);
        this.bgmSource.stop();
        this.bgmSource.clip = clip;
        this.bgmSource.loop = loop;
        this.bgmSource.volume = this.bgmBaseVolume;
        this.bgmSource.play();
    }

    playOneShot(clipName: AudioClipName, volume = 1) {
        if (!this.effectOn) return;

        const clip = this.getClip(clipName);
        const source = this.getEffectSource();
        if (!clip || !source) return;

        source.playOneShot(clip, volume);
    }

    playClick(volume = 1) {
        this.playOneShot(AudioClipNames.Click, volume);
    }

    /**
     * 播放一个音效,并在其播放期间临时压低 BGM 音量(audio ducking),
     * 让该音效(如失败提示音)盖过背景音乐更突出。音效放完后 BGM 自动平滑恢复。
     * @param clipName   音效名
     * @param volume     音效音量(0~1)
     * @param duckFactor BGM 压低后的音量系数(0~1),默认 0.2,即压到正常音量的 20%
     */
    playOneShotDuckingBgm(clipName: AudioClipName, volume = 1, duckFactor = 0.2) {
        if (!this.effectOn) return;

        const clip = this.getClip(clipName);
        const source = this.getEffectSource();
        if (!clip || !source) return;

        source.playOneShot(clip, volume);

        // 用音效本身的时长作为压低时长,音效放完时 bgm 正好开始恢复
        const duration = typeof clip.getDuration === 'function' ? clip.getDuration() : 0;
        this.duckBgm(duckFactor, duration > 0 ? duration : 1.5);
    }

    /**
     * 临时压低 BGM 音量并在 holdSeconds 后恢复到正常音量。
     * 快速压低 + 稍慢恢复,过渡更自然;重复调用会打断上一次重新计时。
     */
    duckBgm(duckFactor = 0.2, holdSeconds = 1.5) {
        if (!this.bgmSource || !this.musicOn) return;

        const fadeIn = 0.08;   // 快速压低
        const fadeOut = 0.45;  // 稍慢恢复
        const low = this.bgmBaseVolume * Math.max(0, Math.min(1, duckFactor));

        // 停掉上一次 ducking,避免多次叠加导致音量错乱
        Tween.stopAllByTarget(this.bgmSource);
        tween(this.bgmSource)
            .to(fadeIn, { volume: low })
            .delay(Math.max(0, holdSeconds))
            .to(fadeOut, { volume: this.bgmBaseVolume })
            .start();
    }

    private getClip(clipName: AudioClipName): AudioClip | null {
        const key = this.getClipKey(clipName);
        const clip = this.clips[key];
        if (!clip) {
            console.warn(`AudioManager: clip not found: ${key}`);
            return null;
        }

        return clip;
    }

    private getClipKey(clipName: AudioClipName): string {
        const fileName = String(clipName).replace(/\\/g, '/').split('/').pop() || '';
        return fileName.replace(/\.[^.]+$/, '');
    }

    private getEffectSource(): AudioSource | null {
        if (this.effectSources.length === 0) {
            return this.bgmSource;
        }

        const source = this.effectSources[this.effectSourceIndex % this.effectSources.length];
        this.effectSourceIndex = (this.effectSourceIndex + 1) % this.effectSources.length;
        return source;
    }
}
