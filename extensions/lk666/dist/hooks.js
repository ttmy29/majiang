"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onError = exports.unload = exports.onAfterBuild = exports.load = exports.throwError = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("./config");
const global_1 = require("./global");
const JavascriptObfuscator = require('javascript-obfuscator');
const presets = {
    off: {
        compact: true,
        controlFlowFlattening: false,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: false,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        debugProtectionInterval: false,
        disableConsoleOutput: false,
        domainLock: [],
        identifierNamesGenerator: 'hexadecimal',
        identifiersDictionary: [],
        identifiersPrefix: '',
        inputFileName: '',
        log: false,
        renameGlobals: false,
        reservedNames: [],
        reservedStrings: [],
        rotateStringArray: false,
        seed: 0,
        selfDefending: false,
        shuffleStringArray: false,
        sourceMap: false,
        sourceMapBaseUrl: '',
        sourceMapFileName: '',
        sourceMapMode: 'separate',
        splitStrings: false,
        splitStringsChunkLength: 10,
        stringArray: false,
        stringArrayEncoding: false,
        stringArrayThreshold: 0.8,
        target: 'browser',
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
    },
    default: {
        compact: true,
        controlFlowFlattening: false,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: false,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        debugProtectionInterval: false,
        disableConsoleOutput: false,
        domainLock: [],
        identifierNamesGenerator: 'hexadecimal',
        identifiersDictionary: [],
        identifiersPrefix: '',
        inputFileName: '',
        log: false,
        renameGlobals: false,
        reservedNames: [],
        reservedStrings: [],
        rotateStringArray: true,
        seed: 0,
        selfDefending: false,
        shuffleStringArray: true,
        sourceMap: false,
        sourceMapBaseUrl: '',
        sourceMapFileName: '',
        sourceMapMode: 'separate',
        splitStrings: false,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayEncoding: false,
        stringArrayThreshold: 0.8,
        target: 'browser',
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
    },
    high: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 1,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 1,
        debugProtection: true,
        debugProtectionInterval: true,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: true,
        shuffleStringArray: true,
        splitStrings: true,
        splitStringsChunkLength: 5,
        stringArray: true,
        stringArrayEncoding: 'rc4',
        stringArrayThreshold: 1,
        transformObjectKeys: true,
        unicodeEscapeSequence: false,
    },
    mid: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        debugProtectionInterval: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: true,
        shuffleStringArray: true,
        splitStrings: true,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayEncoding: 'base64',
        stringArrayThreshold: 0.75,
        transformObjectKeys: true,
        unicodeEscapeSequence: false,
    },
    low: {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        debugProtectionInterval: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: false,
        shuffleStringArray: true,
        splitStrings: false,
        stringArray: true,
        stringArrayEncoding: false,
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
    },
    lower: {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        debugProtectionInterval: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'mangled',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: false,
        shuffleStringArray: false,
        splitStrings: false,
        stringArray: true,
        stringArrayEncoding: false,
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
    },
};
exports.throwError = true;
const load = async function () {
    log('builder hooks loaded');
};
exports.load = load;
const onAfterBuild = async function (options, result) {
    const savedOptions = await Editor.Profile.getProject(global_1.PACKAGE_NAME, 'obfuscation');
    const taskOptions = options.packages?.[global_1.PACKAGE_NAME];
    const taskOverrides = taskOptions?.enabled ? taskOptions : {};
    const pkgOptions = (0, config_1.normalizeConfig)({
        ...savedOptions,
        ...taskOverrides,
    });
    if (!pkgOptions.enabled) {
        log('skip obfuscation because it is disabled');
        return;
    }
    const outputDir = result.dest || options.buildPath;
    if (!outputDir || !(0, fs_1.existsSync)(outputDir)) {
        throw new Error(`[${global_1.PACKAGE_NAME}] build output directory not found: ${outputDir}`);
    }
    const presetName = pkgOptions.preset || 'lower';
    const obfuscatorOptions = presets[presetName] || presets.lower;
    const includes = splitPatterns(pkgOptions.include);
    const excludes = splitPatterns(pkgOptions.exclude);
    const files = collectJavaScriptFiles(outputDir).filter((file) => shouldObfuscate(outputDir, file, includes, excludes));
    for (const file of files) {
        obfuscate(file, obfuscatorOptions);
        if (pkgOptions.verbose) {
            log('obfuscated', normalizePath((0, path_1.relative)(outputDir, file)));
        }
    }
    log(`obfuscation completed, ${files.length} file(s) processed`);
};
exports.onAfterBuild = onAfterBuild;
const unload = async function () {
    log('builder hooks unloaded');
};
exports.unload = unload;
const onError = async function () {
    console.warn(`[${global_1.PACKAGE_NAME}] builder hook failed`);
};
exports.onError = onError;
function collectJavaScriptFiles(dir) {
    const files = [];
    for (const name of (0, fs_1.readdirSync)(dir)) {
        const file = (0, path_1.join)(dir, name);
        const stat = (0, fs_1.statSync)(file);
        if (stat.isDirectory()) {
            files.push(...collectJavaScriptFiles(file));
        }
        else if (stat.isFile() && name.endsWith('.js')) {
            files.push(file);
        }
    }
    return files;
}
function shouldObfuscate(root, file, includes, excludes) {
    const relativePath = normalizePath((0, path_1.relative)(root, file));
    const included = includes.length === 0 || includes.some((pattern) => matchGlob(relativePath, pattern));
    const excluded = excludes.some((pattern) => matchGlob(relativePath, pattern));
    return included && !excluded;
}
function obfuscate(file, options) {
    const sourceCode = (0, fs_1.readFileSync)(file, 'utf8');
    const result = JavascriptObfuscator.obfuscate(sourceCode, options);
    (0, fs_1.writeFileSync)(file, result.getObfuscatedCode());
}
function splitPatterns(value) {
    return (value || '')
        .split(',')
        .map((item) => normalizePath(item.trim()))
        .filter(Boolean);
}
function matchGlob(value, pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
}
function normalizePath(value) {
    return value.split(path_1.sep).join('/');
}
function log(...arg) {
    console.log(`[${global_1.PACKAGE_NAME}]`, ...arg);
}
