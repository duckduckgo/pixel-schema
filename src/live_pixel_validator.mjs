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
            const paramsSchemas = paramsValidator.compileParamsSchema(combinedParams);
            const suffixesSchema = paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
            tokenizedPixels[prefix] = {
                paramsSchemas,
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

    validatePixelParamsAndSuffixes(prefix, pixel, paramsString, pixelSchemas) {
        // 1) Skip outdated pixels based on version
        const paramsUrlFormat = JSON5.parse(paramsString).join('&');
        const paramsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const versionKey = this.#defsVersion.key;
        if (versionKey && paramsStruct[versionKey] && validateVersion(paramsStruct[versionKey])) {
            if (compareVersions(paramsStruct[versionKey], this.#defsVersion.version) === -1) {
                return [];
            }
        }

        // 2) If pixelSchemas contains base64 schemas, remove those params from struct and validate separately
        const paramsSchemas = pixelSchemas.paramsSchemas;
        Object.entries(paramsSchemas.base64ParamsSchemas).forEach(([paramName, base64Schema]) => {
            if (!paramsStruct[paramName]) return;

            const b64Val = decodeURIComponent(paramsStruct[paramName]);
            const jsonVal = JSON.parse(Buffer.from(b64Val, 'base64').toString('utf8'));
            base64Schema(jsonVal);
            this.#saveErrors(prefix, jsonVal, formatAjvErrors(base64Schema.errors));

            delete paramsStruct[paramName];
        });

        // 3) Validate regular params
        paramsSchemas.regularParamsSchema(paramsStruct);
        this.#saveErrors(prefix, paramsUrlFormat, formatAjvErrors(paramsSchemas.regularParamsSchema.errors));

        // 4) Validate suffixes if they exist
        if (pixel.length === prefix.length) return;

        const pixelSuffix = pixel.split(`${prefix}.`)[1];
        const pixelNameStruct = {};
        pixelSuffix.split('.').forEach((suffix, idx) => {
            pixelNameStruct[idx] = suffix;
        });
        pixelSchemas.suffixesSchema(pixelNameStruct);
        this.#saveErrors(prefix, pixel, formatAjvErrors(pixelSchemas.suffixesSchema.errors, pixelNameStruct));
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
