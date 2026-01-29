import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import * as fileUtils from './file_utils.mjs';
import { tokenizePixelDefs } from './tokenizer.mjs';
import { LivePixelsValidator } from './live_pixel_validator.mjs';
import { ParamsValidator } from './params_validator.mjs';
import { PIXEL_DELIMITER, ROOT_PREFIX } from './constants.mjs';

/**
 * @typedef {Object} SearchExperimentDefinition
 * @property {string} [description]
 * @property {Array<string|number|boolean>} [variants]
 */

/**
 * @typedef {Object} ParsedExperiment
 * @property {string} key
 * @property {string|null} description
 * @property {Array<string|number|boolean>} [enum]
 * @property {string} [type]
 */

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 */

/**
 * Parses experiments matching schemas/search_experiments_schema.json5, remapping them to a format compatible with ignoreParams.
 * @param {Record<string, SearchExperimentDefinition>} searchExperiments The raw search experiments.
 * @returns {Record<string, ParsedExperiment>} Parsed experiments keyed by name and alternate name.
 */
export function parseSearchExperiments(searchExperiments) {
    /** @type {Record<string, ParsedExperiment>} */
    const out = {};

    for (const [name, def] of Object.entries(searchExperiments)) {
        out[name] = parseExperimentDef(name, def);
        const altName = `prebounce_${name}`;
        out[altName] = parseExperimentDef(altName, def);
    }

    return out;
}

/**
 * Normalizes a single search experiment definition into the schema param representation.
 * @param {string} name The experiment key.
 * @param {SearchExperimentDefinition} def The raw experiment definition from SERP.
 * @returns {ParsedExperiment} Experiment in pixel schema params format.
 */
function parseExperimentDef(name, def) {
    const experiment = {
        key: name,
        description: def.description ?? null,
    };

    if (Array.isArray(def.variants)) {
        experiment.enum = def.variants;
        if (def.variants.length > 0) {
            experiment.type = typeof def.variants[0];
        }
    }

    return experiment;
}

/**
 * Returns a lookup of search experiments with their enabled status.
 * @param {Record<string, { addSearchExperimentParams?: boolean }>} pixels Parsed pixels keyed by experiment.
 * @returns {Record<string, boolean>} A pixel mapping indicating which pixels have experiments enabled.
 */
export function getEnabledSearchExperiments(pixels) {
    /** @type {Record<string, boolean>} */
    const out = {};

    for (const [name, def] of Object.entries(pixels)) {
        // only "addSearchExperimentParams: false" present in pixels.json
        // so default to true
        const enabled = def.addSearchExperimentParams ?? true;
        if (enabled) out[name] = true;
    }

    return out;
}

/**
 * Performs a tree-based match for tokenized pixels, returning the longest prefix and matched node.
 * @param {string} pixel The pixel identifier to match.
 * @param {Record<string, any>} allPixels The hierarchical pixel map.
 * @returns {[string, any]} A tuple of the matched prefix and associated pixel object.
 */
export function matchPixel(pixel, allPixels) {
    const pixelParts = pixel.split(PIXEL_DELIMITER);
    let pixelMatch = allPixels;
    let matchedParts = '';

    for (let i = 0; i < pixelParts.length; i++) {
        const part = pixelParts[i];
        if (pixelMatch[part]) {
            pixelMatch = pixelMatch[part];
            matchedParts += part + PIXEL_DELIMITER;
        } else {
            break;
        }
    }

    if (matchedParts !== '') matchedParts = matchedParts.slice(0, -1);
    return [matchedParts, pixelMatch[ROOT_PREFIX]];
}

/**
 * Performs a flat search for pixel prefixes, returning the longest match.
 * @param {string} pixel The pixel identifier to match.
 * @param {Record<string, any>} allPixels The flat map of pixel definitions.
 * @returns {[string, any]} A tuple of the matched prefix and the matched pixel object.
 */
export function matchSearchExperiment(pixel, allPixels) {
    let longestPrefix = null;

    for (const key of Object.keys(allPixels)) {
        if (pixel.startsWith(key)) {
            if (longestPrefix === null || key.length > longestPrefix.length) {
                const nextChar = pixel[key.length];
                if (nextChar === undefined || nextChar === PIXEL_DELIMITER) {
                    longestPrefix = key;
                }
            }
        }
    }

    if (longestPrefix) {
        return [longestPrefix, allPixels[longestPrefix]];
    }

    return ['', allPixels];
}

/**
 * Merges two lists of parameters, ensuring no duplicates based on key or keyPattern.
 * Supports full and shortcut parameter definitions.
 * @param {Array<string|object>} parameters The base list of parameters.
 * @param {Array<string|object>} extraParams The list of parameters to merge from.
 * @returns {Array<string|object>} The merged list of parameters.
 */
export function mergeParameters(parameters, extraParams) {
    const parameterKeys = new Set(parameters.map((p) => (typeof p === 'string' ? p : p.keyPattern || p.key)));
    return [...parameters, ...extraParams.filter((p) => !parameterKeys.has(typeof p === 'string' ? p : p.keyPattern || p.key))];
}

/**
 * Extract a value from an object using a dot-notation key path
 * @param {object} obj - The object to extract from
 * @param {string} keyPath - Dot-notation path (e.g. "latest_appstore_version.latest_version")
 * @returns {*} The value at the key path, or undefined if not found
 */
export function getValueByKeyPath(obj, keyPath) {
    return keyPath.split('.').reduce((current, key) => {
        return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
}

/**
 * Resolve the target version from a ProductDefinition.
 * If the target has a static `version`, returns it directly.
 * If the target has `versionUrl` and `versionRef`, fetches the version from the URL.
 *
 * @param {import('./types.mjs').ProductTarget} target - The target configuration from product.json
 * @returns {Promise<string>} The resolved version string
 * @throws {Error} If the version cannot be resolved
 */
export async function resolveTargetVersion(target) {
    // Static version takes precedence
    if (target.version) {
        if (target.versionUrl || target.versionRef) {
            throw new Error('Cannot specify both "version" and "versionUrl"/"versionRef" in target. Use one or the other.');
        }
        return target.version;
    }

    // Remote version via URL
    if (target.versionUrl && target.versionRef) {
        const response = await fetch(target.versionUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch version from ${target.versionUrl}: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const version = getValueByKeyPath(data, target.versionRef);
        if (version === undefined) {
            throw new Error(`Version key "${target.versionRef}" not found in response from ${target.versionUrl}`);
        }
        if (typeof version !== 'string') {
            throw new Error(`Version value at "${target.versionRef}" must be a string, got ${typeof version}`);
        }
        return version;
    }

    if (target.versionUrl && !target.versionRef) {
        throw new Error('target.versionRef is required when using target.versionUrl');
    }

    if (target.versionRef && !target.versionUrl) {
        throw new Error('target.versionUrl is required when using target.versionRef');
    }

    throw new Error('target must have either "version" or both "versionUrl" and "versionRef"');
}

// ------------------------------------------------------------
// Live validation utilities
// ------------------------------------------------------------

/**
 * Processes pixel definitions in the main directory, tokenizing them and writing them to a file.
 * @param {string} mainDir - The main directory containing pixels and wide event definitions.
 */
export function processPixelDefs(mainDir) {
    const tokenizedDefs = {};
    const { pixelsConfigDir, pixelDefsDir } = fileUtils.resolvePixelsDirs(mainDir);

    fs.readdirSync(pixelDefsDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDefsDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());
        tokenizePixelDefs(pixelsDefs, tokenizedDefs);
    });

    // Write out tokenized pixel defs to a file
    const outFile = fileUtils.getTokenizedPixelsPath(pixelsConfigDir);
    console.log(`Writing out tokenized pixel defs to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(tokenizedDefs, null, 4));
}

/**
 * Build a LivePixelsValidator instance from the main pixels directory.
 * @param {string} mainDir - The main directory containing pixels and wide event definitions.
 * @returns {Promise<{validator: LivePixelsValidator, pixelsConfigDir: string, productDef: ProductDefinition}>}
 * A LivePixelsValidator instance, the resolved path to the pixels config directory, and the product definition.
 */
export async function buildLivePixelValidator(mainDir) {
    const { pixelsConfigDir } = fileUtils.resolvePixelsDirs(mainDir);
    const productDef = fileUtils.readProductDef(mainDir);

    // Resolve version (may fetch from URL if versionUrl is specified)
    const resolvedVersion = await resolveTargetVersion(productDef.target);
    productDef.target.version = resolvedVersion;
    console.log(`Using minimum version: ${resolvedVersion}`);

    const nativeExperimentsDef = fileUtils.readNativeExperimentsDef(pixelsConfigDir);
    const commonParams = fileUtils.readCommonParams(pixelsConfigDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(pixelsConfigDir);
    const tokenizedPixels = fileUtils.readTokenizedPixels(pixelsConfigDir);

    const pixelIgnoreParams = fileUtils.readIgnoreParams(pixelsConfigDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const ignoreParams = { ...globalIgnoreParams, ...pixelIgnoreParams }; // allow local ignores to override global ones

    // SERP only:
    const searchExperiments = {
        enabled: false,
        expDefs: {},
        expPixels: {},
    };

    if (productDef.searchExperimentsEnabled) {
        const rawSearchExperiments = fileUtils.readSearchExperimentsDef(pixelsConfigDir);
        searchExperiments.expDefs = parseSearchExperiments(rawSearchExperiments);
        const searchPixels = fileUtils.readSearchPixelsDef(pixelsConfigDir);
        searchExperiments.expPixels = getEnabledSearchExperiments(searchPixels);
        console.log(`Loaded ${Object.keys(searchExperiments.expDefs).length} search experiments.`);
        searchExperiments.enabled = true;
    } else {
        console.log('Skipping search experiments.');
    }

    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams, searchExperiments);
    return {
        validator: new LivePixelsValidator(tokenizedPixels, productDef, nativeExperimentsDef, paramsValidator),
        pixelsConfigDir,
        productDef,
    };
}
