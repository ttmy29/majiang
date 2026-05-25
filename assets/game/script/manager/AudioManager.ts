import { _decorator, AudioClip, AudioSource, sys } from 'cc';

const { ccclass } = _decorator;

const AUDIO_CONFIG_KEY = 'mahjong_match_audio_enabled';

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

}

export type AudioClipName = AudioClipNames | string | number;

@ccclass('AudioManager')
export class AudioManager {
    private audioSources: AudioSource[] = [];
    private bgmSource: AudioSource | null = null;
    private effectSources: AudioSource[] = [];

    private soundOn = true;
    private effectSourceIndex = 0;

    public clips: { [name: string]: AudioClip } = {};

    private static _instance: AudioManager;
    public static get instance() {
        if (this._instance) {
            return this._instance;
        }

        this._instance = new AudioManager();
        return this._instance;
    }

    init(audioSources: AudioSource[]) {
        this.audioSources = (audioSources || []).filter((source) => !!source);
        this.bgmSource = this.audioSources[0] || null;
        this.effectSources = this.audioSources.length > 1 ? this.audioSources.slice(1) : this.audioSources;
        this.effectSourceIndex = 0;

        this.getSoundConfig();
        this.soundOn ? this.play() : this.pause();
    }

    getSoundConfig() {
        const value = sys.localStorage.getItem(AUDIO_CONFIG_KEY);
        this.soundOn = value === null ? true : value === 'true';
        return this.soundOn;
    }

    setSoundConfig(soundOn: boolean) {
        this.soundOn = soundOn;
        sys.localStorage.setItem(AUDIO_CONFIG_KEY, String(this.soundOn));
        this.soundOn ? this.play() : this.pause();
    }

    play() {
        if (!this.soundOn || !this.bgmSource) return;

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
        if (!this.soundOn || !this.bgmSource) return;

        const clip = this.getClip(clipName);
        if (!clip) return;

        this.bgmSource.stop();
        this.bgmSource.clip = clip;
        this.bgmSource.loop = loop;
        this.bgmSource.play();
    }

    playOneShot(clipName: AudioClipName, volume = 1) {
        if (!this.soundOn) return;

        const clip = this.getClip(clipName);
        const source = this.getEffectSource();
        if (!clip || !source) return;

        source.playOneShot(clip, volume);
    }

    playClick(volume = 1) {
        this.playOneShot(AudioClipNames.Click, volume);
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
