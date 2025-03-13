#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { ParamsValidator } from '../src/params_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';

export class LivePixelsValidator {
    #productDef;
    #ignoreParams;
    #paramsValidator;
    #compiledPixels;

    undocumentedPixels = new Set();
    pixelErrors = {};

    constructor(tokenizedPixels, productDef, ignoreParams, paramsValidator) {
        this.#productDef = productDef;
        this.#ignoreParams = ignoreParams;
        this.#paramsValidator = paramsValidator;

        this.#compileDefs(tokenizedPixels);
        this.#compiledPixels = tokenizedPixels;
    }

    #compileDefs(tokenizedPixels) {
        Object.entries(tokenizedPixels).forEach(([prefix, pixelDef]) => {
            if (prefix !== 'ROOT_PREFIX') {
                this.#compileDefs(pixelDef);
                return;
            }

            const combinedParams = pixelDef.parameters
                ? [...pixelDef.parameters, ...Object.values(this.#ignoreParams)]
                : [...Object.values(this.#ignoreParams)];

            // Pixel name is always lower case:
            const lowerCasedSuffixes = pixelDef.suffixes ? JSON5.parse(JSON.stringify(pixelDef.suffixes).toLowerCase()) : [];

            // Pre-compile each schema
            const paramsSchema = this.#paramsValidator.compileParamsSchema(combinedParams);
            const suffixesSchema = this.#paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
            tokenizedPixels[prefix] = {
                paramsSchema,
                suffixesSchema
            };
        });
    }

    validatePixel(pixel, request) {
        // Match longest prefix:
        const pixelParts = pixel.split('.');
        var pixelMatch = this.#compiledPixels;
        var matchedParts = "";
        for (var i = 0; i < pixelParts.length; i++) {
            const part = pixelParts[i];
            if (pixelMatch[part]) {
                pixelMatch = pixelMatch[part];
                matchedParts += part + ".";
            } else {
                break;
            }
        }

        if (!pixelMatch['ROOT_PREFIX']) {
            this.undocumentedPixels.add(pixel);
            return;
        }

        const prefix = matchedParts.slice(0, -1);
        const url = this.#productDef.forceLowerCase ? request.toLowerCase() : request;
        const errors = this.#paramsValidator.validateLivePixels(pixelMatch['ROOT_PREFIX'], prefix, pixel, url, this.#productDef.target);
        if (errors.length) {
            if (!this.pixelErrors[prefix]) {
                this.pixelErrors[prefix] = {
                    errors: new Set(),
                    requests: new Set()
                }
            }

            this.pixelErrors[prefix].requests.add(request);
            for (const error of errors) {
                this.pixelErrors[prefix].errors.add(error);
            }
        }
    }
}
