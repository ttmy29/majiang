import { PACKAGE_NAME } from './global';
import { ObfuscationConfig, normalizeConfig } from './config';

export const methods = {
    openPanel() {
        Editor.Panel.open(PACKAGE_NAME);
    },

    async getConfig() {
        const saved = await Editor.Profile.getProject(PACKAGE_NAME, 'obfuscation');
        return normalizeConfig(saved);
    },

    async saveConfig(config: ObfuscationConfig) {
        const normalized = normalizeConfig(config);
        await Editor.Profile.setProject(PACKAGE_NAME, 'obfuscation', normalized);
        return normalized;
    },
};

export function load() {
    console.debug(`${PACKAGE_NAME} main loaded`);
}

export function unload() {
    console.debug(`${PACKAGE_NAME} main unloaded`);
}
