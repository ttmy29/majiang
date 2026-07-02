export type PresetName = 'off' | 'default' | 'high' | 'mid' | 'low' | 'lower';

export interface ObfuscationConfig {
    enabled?: boolean;
    preset?: PresetName;
    include?: string;
    exclude?: string;
    verbose?: boolean;
}

export const DEFAULT_CONFIG: Required<ObfuscationConfig> = {
    enabled: false,
    preset: 'lower',
    include: 'assets/**/*.js, subpackages/**/*.js, src/bundle-scripts/**/*.js',
    exclude: 'assets/internal/**, assets/resources/**, cocos-js/**, src/import-map.js, src/polyfills.bundle.js, src/system.bundle.js',
    verbose: true,
};

const presetNames: PresetName[] = ['off', 'default', 'high', 'mid', 'low', 'lower'];

export function normalizeConfig(config?: ObfuscationConfig): Required<ObfuscationConfig> {
    const preset = config?.preset && presetNames.includes(config.preset) ? config.preset : DEFAULT_CONFIG.preset;
    return {
        enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
        preset,
        include: config?.include || DEFAULT_CONFIG.include,
        exclude: config?.exclude || DEFAULT_CONFIG.exclude,
        verbose: config?.verbose ?? DEFAULT_CONFIG.verbose,
    };
}
