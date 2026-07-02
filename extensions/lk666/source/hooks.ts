import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { BuildHook, IBuildResult, ITaskOptions } from '../@types';
import { ObfuscationConfig, PresetName, normalizeConfig } from './config';
import { PACKAGE_NAME } from './global';

const JavascriptObfuscator = require('javascript-obfuscator');

const presets: Record<PresetName, Record<string, any>> = {
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

export const throwError: BuildHook.throwError = true;

export const load: BuildHook.load = async function() {
    log('builder hooks loaded');
};

export const onAfterBuild: BuildHook.onAfterBuild = async function(options: ITaskOptions, result: IBuildResult) {
    const savedOptions = await Editor.Profile.getProject(PACKAGE_NAME, 'obfuscation');
    const taskOptions = options.packages?.[PACKAGE_NAME] as ObfuscationConfig | undefined;
    const taskOverrides = taskOptions?.enabled ? taskOptions : {};
    const pkgOptions = normalizeConfig({
        ...savedOptions,
        ...taskOverrides,
    });
    if (!pkgOptions.enabled) {
        log('skip obfuscation because it is disabled');
        return;
    }

    const outputDir = result.dest || options.buildPath;
    if (!outputDir || !existsSync(outputDir)) {
        throw new Error(`[${PACKAGE_NAME}] build output directory not found: ${outputDir}`);
    }

    const presetName = pkgOptions.preset || 'lower';
    const obfuscatorOptions = presets[presetName] || presets.lower;
    const includes = splitPatterns(pkgOptions.include);
    const excludes = splitPatterns(pkgOptions.exclude);
    const files = collectJavaScriptFiles(outputDir).filter((file) => shouldObfuscate(outputDir, file, includes, excludes));

    for (const file of files) {
        obfuscate(file, obfuscatorOptions);
        if (pkgOptions.verbose) {
            log('obfuscated', normalizePath(relative(outputDir, file)));
        }
    }

    log(`obfuscation completed, ${files.length} file(s) processed`);
};

export const unload: BuildHook.unload = async function() {
    log('builder hooks unloaded');
};

export const onError: BuildHook.onError = async function() {
    console.warn(`[${PACKAGE_NAME}] builder hook failed`);
};

function collectJavaScriptFiles(dir: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        const stat = statSync(file);
        if (stat.isDirectory()) {
            files.push(...collectJavaScriptFiles(file));
        } else if (stat.isFile() && name.endsWith('.js')) {
            files.push(file);
        }
    }
    return files;
}

function shouldObfuscate(root: string, file: string, includes: string[], excludes: string[]) {
    const relativePath = normalizePath(relative(root, file));
    const included = includes.length === 0 || includes.some((pattern) => matchGlob(relativePath, pattern));
    const excluded = excludes.some((pattern) => matchGlob(relativePath, pattern));
    return included && !excluded;
}

function obfuscate(file: string, options: Record<string, any>) {
    const sourceCode = readFileSync(file, 'utf8');
    const result = JavascriptObfuscator.obfuscate(sourceCode, options);
    writeFileSync(file, result.getObfuscatedCode());
}

function splitPatterns(value?: string) {
    return (value || '')
        .split(',')
        .map((item) => normalizePath(item.trim()))
        .filter(Boolean);
}

function matchGlob(value: string, pattern: string): boolean {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
}

function normalizePath(value: string) {
    return value.split(sep).join('/');
}

function log(...arg: any[]) {
    console.log(`[${PACKAGE_NAME}]`, ...arg);
}
