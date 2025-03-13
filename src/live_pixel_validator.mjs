#!/usr/bin/env node
import JSON5 from 'json5';
import { compareVersions, validate as validateVersion } from 'compare-versions';

import { formatAjvErrors } from './error_utils.mjs';
import { ROOT_PREFIX } from './constants.mjs';

export class LivePixelsValidator {
    #compiledPixels;
    #defsVersion;
    #forceLowerCase;

    undocumentedPixels = new Set();
    pixelErrors = {};

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

            const combinedParams = pixelDef.parameters
                ? [...pixelDef.parameters, ...Object.values(ignoreParams)]
                : [...Object.values(ignoreParams)];

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

    validatePixel(pixel, request) {
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
        const normalizedRequest = this.#forceLowerCase ? request.toLowerCase() : request;
        const urlSplit = normalizedRequest.split('/')[2].split('?');
        // grab pixel parameters with any preceding cache buster removed
        const livePixelRequestParams = /^([0-9]+&)?(.*)$/.exec(urlSplit[1] || '')[2];
        this.validatePixelParamsAndSuffixes(prefix, pixel, livePixelRequestParams, pixelMatch[ROOT_PREFIX]);
    }

    validatePixelParamsAndSuffixes(prefix, pixel, paramsString, pixelDef) {
        // 1) Validate params - skip outdated pixels based on version
        const paramsStruct = Object.fromEntries(new URLSearchParams(paramsString));
        const versionKey = this.#defsVersion.key;
        if (versionKey && paramsStruct[versionKey] && validateVersion(paramsStruct[versionKey])) {
            if (compareVersions(paramsStruct[versionKey], this.#defsVersion.version) === -1) {
                return [];
            }
        }

        pixelDef.paramsSchema(paramsStruct);
        this.#saveErrors(prefix, paramsString, formatAjvErrors(pixelDef.paramsSchema.errors));

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
