"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const global_1 = require("./global");
const config_1 = require("./config");
exports.methods = {
    openPanel() {
        Editor.Panel.open(global_1.PACKAGE_NAME);
    },
    async getConfig() {
        const saved = await Editor.Profile.getProject(global_1.PACKAGE_NAME, 'obfuscation');
        return (0, config_1.normalizeConfig)(saved);
    },
    async saveConfig(config) {
        const normalized = (0, config_1.normalizeConfig)(config);
        await Editor.Profile.setProject(global_1.PACKAGE_NAME, 'obfuscation', normalized);
        return normalized;
    },
};
function load() {
    console.debug(`${global_1.PACKAGE_NAME} main loaded`);
}
function unload() {
    console.debug(`${global_1.PACKAGE_NAME} main unloaded`);
}
