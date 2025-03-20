#!/usr/bin/env node
import JSON5 from 'json5';
import { compareVersions, validate as validateVersion } from 'compare-versions';

import { formatAjvErrors } from './error_utils.mjs';
import { ROOT_PREFIX } from './constants.mjs';

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 */

export class LivePixelsValidator {
    #compiledPixels;
    #defsVersion;
    #forceLowerCase;

    undocumentedPixels = new Set();
    pixelErrors = {};

    /**
     * @param {object} tokenizedPixels similar in format to schemas/pixel_schema.json5.
     * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
     * @param {ProductDefinition} productDef
     * @param {object} ignoreParams contains params that follow the schemas/param_schema.json5 type.
     * @param {ParamsValidator} paramsValidator
     */
    constructor(tokenizedPixels, productDef, ignoreParams, paramsValidator) {
        this.#defsVersion = productDef.target;
        this.#forceLowerCase = productDef.forceLowerCase;

        this.#compileDefs(tokenizedPixels, ignoreParams, paramsValidator);
        this.#compiledPixels = tokenizedPixels;
    }

    #compileDefs(tokenizedPixels, ignoreParams, paramsValidator) {
        Object.entries(tokenizedPixels).forEach(([prefix, pixelDef]) => {
            if (prefix !== ROOT_PREFIX) {
                this.#compileDefs(pixelDef, ignoreParams, paramsValidator);
                return;
            }

            const combinedParams = [...(pixelDef.parameters || []), ...Object.values(ignoreParams)];

            // Pixel name is always lower case:
            const lowerCasedSuffixes = pixelDef.suffixes ? JSON5.parse(JSON.stringify(pixelDef.suffixes).toLowerCase()) : [];

            // Pre-compile each schema
            const paramsSchema = paramsValidator.compileParamsSchema(combinedParams);
            const suffixesSchema = paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
            tokenizedPixels[prefix] = {
                paramsSchema,
                suffixesSchema,
            };
        });
    }

    /**
     * Validates pixel against saved schema and saves any errors
     * @param {String} pixel full pixel name in "." notation
     * @param {String} params query params as a String representation of an array
     */
    validatePixel(pixel, params) {
        // Match longest prefix:
        const pixelParts = pixel.split('.');
        let pixelMatch = this.#compiledPixels;
        let matchedParts = '';
        for (let i = 0; i < pixelParts.length; i++) {
            const part = pixelParts[i];
            if (pixelMatch[part]) {
                pixelMatch = pixelMatch[part];
                matchedParts += part + '.';
            } else {
                break;
            }
        }

        if (!pixelMatch[ROOT_PREFIX]) {
            this.undocumentedPixels.add(pixel);
            return;
        }

        const prefix = matchedParts.slice(0, -1);
        const normalizedParams = this.#forceLowerCase ? params.toLowerCase() : params;
        this.validatePixelParamsAndSuffixes(prefix, pixel, normalizedParams, pixelMatch[ROOT_PREFIX]);
    }

    validatePixelParamsAndSuffixes(prefix, pixel, paramsString, pixelDef) {
        // 1) Validate params - skip outdated pixels based on version
        const paramsUrlFormat = JSON5.parse(paramsString).join('&');
        const paramsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const versionKey = this.#defsVersion.key;
        if (versionKey && paramsStruct[versionKey] && validateVersion(paramsStruct[versionKey])) {
            if (compareVersions(paramsStruct[versionKey], this.#defsVersion.version) === -1) {
                return [];
            }
        }

        pixelDef.paramsSchema(paramsStruct);
        this.#saveErrors(prefix, paramsUrlFormat, formatAjvErrors(pixelDef.paramsSchema.errors));

        // 2) Validate suffixes if they exist
        if (pixel.length === prefix.length) return;

        const pixelSuffix = pixel.split(`${prefix}.`)[1];
        const pixelNameStruct = {};
        pixelSuffix.split('.').forEach((suffix, idx) => {
            pixelNameStruct[idx] = suffix;
        });
        pixelDef.suffixesSchema(pixelNameStruct);
        this.#saveErrors(prefix, pixel, formatAjvErrors(pixelDef.suffixesSchema.errors, pixelNameStruct));
    }

    #saveErrors(prefix, example, errors) {
        if (!errors.length) return;

        if (!this.pixelErrors[prefix]) {
            this.pixelErrors[prefix] = {};
        }

        for (const error of errors) {
            if (!this.pixelErrors[prefix][error]) {
                this.pixelErrors[prefix][error] = new Set();
            }
            this.pixelErrors[prefix][error].add(example);
        }
    }
}
