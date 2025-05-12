/**
 * Public validation API
 */

import { LivePixelsValidator } from './src/live_pixel_validator.mjs';
import { ParamsValidator } from './src/params_validator.mjs';
import { tokenizePixelDefs } from './src/tokenizer.mjs';

/**
 * @typedef {import('./src/types.mjs').ProductDefinition} ProductDefinition
 */

/**
 * Build a LivePixelsValidator
 * @param {object} commonParams
 * @param {object} commonSuffixes
 * @param {ProductDefinition} productDef
 * @param {object} ignoreParams
 * @param {object} tokenizedPixels
 * @param {object} experimentsDef
 * @returns
 */
export function buildLivePixelValidator(commonParams, commonSuffixes, productDef, ignoreParams, tokenizedPixels, experimentsDef = {}) {
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams);
    return new LivePixelsValidator(tokenizedPixels, productDef, experimentsDef, paramsValidator);
}

/**
 * Build tokenizedPixels from a list of pixelDefs objects.
 *
 * @param {object[]} allPixelDefs
 */
export function buildTokenizedPixels(allPixelDefs) {
    const tokenizedDefs = {};
    allPixelDefs.forEach((pixelsDefs) => {
        tokenizePixelDefs(pixelsDefs, tokenizedDefs);
    });
    return tokenizedDefs;
}

/**
 *
 * @param {LivePixelsValidator} validator
 * @param {string} url
 */
export function validateSinglePixel(validator, url) {
    const parsedUrl = new URL(url);
    // parse pixel ID out of the URL path
    const pixel = parsedUrl.pathname.slice(3);
    // validator expects URL params after cache buster
    const params = parsedUrl.search.slice(1).replace(/^\d+=?&/, '');
    // reset errors in validator
    validator.pixelErrors = {};
    validator.undocumentedPixels.clear();
    // validate
    validator.validatePixel(pixel, params);
    if (validator.undocumentedPixels.size > 0) {
        throw new Error(`Undocumented Pixel: ${JSON.stringify(Array.from(validator.undocumentedPixels))}`);
    }
    if (Object.keys(validator.pixelErrors).length > 0) {
        throw new Error(`Pixel Errors: ${JSON.stringify(validator.pixelErrors)}`);
    }
}
