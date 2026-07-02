import { BuildPlugin } from '../@types';
import { PACKAGE_NAME } from './global';

export const load: BuildPlugin.load = function() {
    console.debug(`${PACKAGE_NAME} load`);
};

export const unload: BuildPlugin.Unload = function() {
    console.debug(`${PACKAGE_NAME} unload`);
};

export const configs: BuildPlugin.Configs = {
    '*': {
        hooks: './hooks',
        doc: 'editor/publish/custom-build-plugin.html',
        options: {
            enabled: {
                label: `i18n:${PACKAGE_NAME}.options.enabled`,
                description: `i18n:${PACKAGE_NAME}.options.enabled_desc`,
                default: false,
                render: {
                    ui: 'ui-checkbox',
                },
            },
            preset: {
                label: `i18n:${PACKAGE_NAME}.options.preset`,
                description: `i18n:${PACKAGE_NAME}.options.preset_desc`,
                default: 'lower',
                render: {
                    ui: 'ui-select-pro',
                    items: [
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_lower`,
                            value: 'lower',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_low`,
                            value: 'low',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_mid`,
                            value: 'mid',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_high`,
                            value: 'high',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_default`,
                            value: 'default',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.preset_off`,
                            value: 'off',
                        },
                    ],
                },
            },
            include: {
                label: `i18n:${PACKAGE_NAME}.options.include`,
                description: `i18n:${PACKAGE_NAME}.options.include_desc`,
                default: 'assets/**/*.js, subpackages/**/*.js, src/bundle-scripts/**/*.js',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: 'assets/**/*.js, subpackages/**/*.js',
                    },
                },
            },
            exclude: {
                label: `i18n:${PACKAGE_NAME}.options.exclude`,
                description: `i18n:${PACKAGE_NAME}.options.exclude_desc`,
                default: 'assets/internal/**, assets/resources/**, cocos-js/**, src/import-map.js, src/polyfills.bundle.js, src/system.bundle.js',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: 'assets/internal/**, cocos-js/**',
                    },
                },
            },
            verbose: {
                label: `i18n:${PACKAGE_NAME}.options.verbose`,
                description: `i18n:${PACKAGE_NAME}.options.verbose_desc`,
                default: true,
                render: {
                    ui: 'ui-checkbox',
                },
            },
        },
    },
};
