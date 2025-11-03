import { PIXEL_DELIMITER } from './constants.mjs';
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

    let tokenizedPixels = {};
    tokenizePixelDefs(out, tokenizedPixels);

    return out;
}

// return the longest matching pixel prefix and the matched pixel object
export function matchPixel_old(pixel, allPixels) {
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

        return [matchedParts, pixelMatch]
}

// return the longest matching pixel prefix and the matched pixel object
export function matchPixel(pixel, allPixels) {
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