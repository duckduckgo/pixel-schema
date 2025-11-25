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
