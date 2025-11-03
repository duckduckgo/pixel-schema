import { PIXEL_DELIMITER, ROOT_PREFIX } from './constants.mjs';
import { tokenizePixelDefs } from './tokenizer.mjs';

// Parse experiments matching schemas/search_experiments_schema.json5, remapping them to a format compatible with ignoreParams
export function parseSearchExperiments(searchExperiments) {
    const out = {};

    for (const [name, def] of Object.entries(searchExperiments)) {
        out[name] = parseExperimentDef(name, def);
        const altName = `prebounce_${name}`;
        out[altName] = parseExperimentDef(altName, def);
    }

    return out;
}

function parseExperimentDef(name, def) {
    const experiment = {
        key: name,
        description: def.description ?? null
    };

    if (Array.isArray(def.variants)) {
        experiment.enum = def.variants;
        if (def.variants.length > 0) {
            // infer type from first variant
            experiment.type = typeof def.variants[0];
        }
    }

    return experiment;
}

// return list of search pixels with associated experiments status
// consumes output from parseSearchExperiments()
export function getEnabledSearchExperiments(pixels) {
    const out = {};

    for (const [name, def] of Object.entries(pixels)) {
        // only "addSearchExperimentParams: false" present in pixels.json
        // so default to true
        out[name] = def.addSearchExperimentParams ?? true;
    }

    return out;
}

// tree search for tokenized pixels
// returns the longest matching pixel prefix and the matched pixel object
export function matchPixel(pixel, allPixels) {
        // Match longest prefix:
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

        if(matchedParts != '') matchedParts = matchedParts.slice(0, -1);
        return [matchedParts, pixelMatch[ROOT_PREFIX]]
}

// flat search for pixels
// return the longest matching pixel prefix and the matched pixel object
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
 * @param {Array<string|object>} parameters The base list of parameters.
 * @param {Array<string|object>} extraParams The list of parameters to merge from.
 * @returns {Array<string|object>} The merged list of parameters.
 */
export function mergeParameters(parameters, extraParams) {
    const parameterKeys = new Set(parameters.map(p => (typeof p === 'string' ? p : (p.keyPattern || p.key))));
    return [
        ...parameters,
        ...extraParams.filter(p => !parameterKeys.has(typeof p === 'string' ? p : (p.keyPattern || p.key)))
    ];
}