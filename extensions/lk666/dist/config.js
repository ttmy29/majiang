"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.normalizeConfig = normalizeConfig;
exports.DEFAULT_CONFIG = {
    enabled: false,
    preset: 'lower',
    include: 'assets/**/*.js, subpackages/**/*.js, src/bundle-scripts/**/*.js',
    exclude: 'assets/internal/**, assets/resources/**, cocos-js/**, src/import-map.js, src/polyfills.bundle.js, src/system.bundle.js',
    verbose: true,
};
const presetNames = ['off', 'default', 'high', 'mid', 'low', 'lower'];
function normalizeConfig(config) {
    const preset = config?.preset && presetNames.includes(config.preset) ? config.preset : exports.DEFAULT_CONFIG.preset;
    return {
        enabled: config?.enabled ?? exports.DEFAULT_CONFIG.enabled,
        preset,
        include: config?.include || exports.DEFAULT_CONFIG.include,
        exclude: config?.exclude || exports.DEFAULT_CONFIG.exclude,
        verbose: config?.verbose ?? exports.DEFAULT_CONFIG.verbose,
    };
}
