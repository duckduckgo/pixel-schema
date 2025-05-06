#!/usr/bin/env node
import JSON5 from 'json5';
import { compareVersions, validate as validateVersion } from 'compare-versions';

import { formatAjvErrors } from './error_utils.mjs';
import { ROOT_PREFIX } from './constants.mjs';

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 * @typedef {import('./params_validator.mjs').ParamsValidator} ParamsValidator
 */

const EXP_PIXEL_PREFIX_LEN = 3;

export class LivePixelsValidator {
    #compiledPixels;
    #defsVersion;
    #defsVersionKey;
    #forceLowerCase;

    #commonExperimentParamsSchema;
    #commonExperimentSuffixesSchema;
    #compiledExperiments;

    undocumentedPixels = new Set();
    pixelErrors = {};

    /**
     * @param {object} tokenizedPixels similar in format to schemas/pixel_schema.json5.
     * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
     * @param {ProductDefinition} productDef
     * @param {object} experimentsDef experiment definitions, following schemas/native_experiments_schema.json5 type.
     * @param {ParamsValidator} paramsValidator
     */
    constructor(tokenizedPixels, productDef, experimentsDef, paramsValidator) {
        this.#forceLowerCase = productDef.forceLowerCase;
        this.#defsVersion = this.#getNormalizedVal(productDef.target.version);
        this.#defsVersionKey = this.#getNormalizedVal(productDef.target.key);

        this.#compileDefs(tokenizedPixels, paramsValidator);
        this.#compiledPixels = tokenizedPixels;

        // Experiments params and suffixes
        this.#commonExperimentParamsSchema = paramsValidator.compileCommonExperimentParamsSchema();
        this.#commonExperimentSuffixesSchema = paramsValidator.compileSuffixesSchema(
            experimentsDef.defaultSuffixes || [],
            EXP_PIXEL_PREFIX_LEN,
        );

        // Experiment metrics
        this.#compiledExperiments = experimentsDef.activeExperiments || {};
        const defaultsSchema = paramsValidator.compileExperimentMetricSchema({ enum: [1, 2, 3, 4, 5, 6, 10, 11, 21, 30] });
        Object.entries(this.#compiledExperiments).forEach(([_, experimentDef]) => {
            Object.entries(experimentDef.metrics).forEach(([metric, metricDef]) => {
                experimentDef.metrics[metric] = paramsValidator.compileExperimentMetricSchema(metricDef);
            });
            experimentDef.metrics.app_use = defaultsSchema;
            experimentDef.metrics.search = defaultsSchema;
        });
    }

    /**
     * @param {String} val
     * @returns {String} value that's lowercased based on current product defs
     */
    #getNormalizedVal(val) {
        return this.#forceLowerCase ? val.toLowerCase() : val;
    }

    /**
     * @param {String} paramValue
     * @param {ValidateFunction} paramSchema - AJV compiled schema
     * @returns {String} decoded and normalized param value
     */
    #getDecodedAndNormalizedVal(paramValue, paramSchema) {
        if (!paramSchema) return; // will fail validation later

        // Decode before lowercasing
        let updatedVal = paramValue;
        try {
            updatedVal = decodeURIComponent(paramValue);
        } catch (e) {
            console.warn(`WARNING: Failed to decode param value '${paramValue}'`);
        }

        if (paramSchema.encoding === 'base64') {
            updatedVal = Buffer.from(updatedVal, 'base64').toString('utf8');
        }

        // Lowercase before parsing into an object
        if (this.#forceLowerCase) {
            updatedVal = updatedVal.toLowerCase();
        }

        if (paramSchema.type === 'object') {
            updatedVal = JSON.parse(updatedVal);
        }

        return updatedVal;
    }

    #compileDefs(tokenizedPixels, paramsValidator) {
        Object.entries(tokenizedPixels).forEach(([prefix, pixelDef]) => {
            if (prefix !== ROOT_PREFIX) {
                this.#compileDefs(pixelDef, paramsValidator);
                return;
            }

            // Pixel name is always lower case:
            const lowerCasedSuffixes = pixelDef.suffixes ? JSON.parse(JSON.stringify(pixelDef.suffixes).toLowerCase()) : [];
            const normalizedParams = pixelDef.parameters ? JSON.parse(this.#getNormalizedVal(JSON.stringify(pixelDef.parameters))) : [];

            // Pre-compile each schema
            const paramsSchema = paramsValidator.compileParamsSchema(normalizedParams);
            const suffixesSchema = paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
            tokenizedPixels[prefix] = {
                paramsSchema,
                suffixesSchema,
            };
        });
    }

    validateExperimentPixel(pixel, paramsString) {
        const pixelParts = pixel.split('experiment.')[1].split('.');

        if (pixelParts.length < EXP_PIXEL_PREFIX_LEN) {
            // Invalid experiment pixel
            this.undocumentedPixels.add(pixel);
            return;
        }

        const pixelType = pixelParts[0];
        if (pixelType !== 'enroll' && pixelType !== 'metrics') {
            // Invalid experiment pixel type
            this.undocumentedPixels.add(pixel);
            return;
        }

        const experimentName = pixelParts[1];
        const pixelPrefix = `experiment.${pixelType}.${experimentName}`;
        if (!this.#compiledExperiments[experimentName]) {
            this.#saveErrors(pixelPrefix, pixel, [`Unknown experiment '${experimentName}'`]);
            return;
        }

        // Check cohort
        const cohortName = pixelParts[2];
        if (!this.#compiledExperiments[experimentName].cohorts.includes(cohortName)) {
            this.#saveErrors(pixelPrefix, pixel, [`Unexpected cohort '${cohortName}' for experiment '${experimentName}'`]);
            return;
        }

        // Check suffixes if they exist
        if (pixelParts.length > EXP_PIXEL_PREFIX_LEN) {
            const pixelNameStruct = {};
            for (let i = EXP_PIXEL_PREFIX_LEN; i < pixelParts.length; i++) {
                pixelNameStruct[i] = pixelParts[i];
            }
            this.#commonExperimentSuffixesSchema(pixelNameStruct);
            this.#saveErrors(pixelPrefix, pixel, formatAjvErrors(this.#commonExperimentSuffixesSchema.errors, pixelNameStruct));
        }

        const paramsUrlFormat = JSON5.parse(paramsString).join('&');
        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const metric = rawParamsStruct.metric;
        const metricValue = rawParamsStruct.value;
        if (pixelType === 'metrics') {
            if (!metric || !metricValue) {
                this.#saveErrors(pixel, paramsUrlFormat, [`Experiment metrics pixels must contain 'metric' and 'value' params`]);
                return;
            }

            const metricSchema = this.#compiledExperiments[experimentName].metrics[metric];
            if (!metricSchema) {
                this.#saveErrors(pixel, paramsUrlFormat, [`Unknown  experiment metric '${metric}'`]);
                return;
            }

            metricSchema(metricValue);
            this.#saveErrors(pixel, paramsUrlFormat, formatAjvErrors(metricSchema.errors));

            // Remove metric and value from params for further validation
            delete rawParamsStruct.metric;
            delete rawParamsStruct.value;
        }

        // Validate enrollmentDate and conversionWindow
        this.#commonExperimentParamsSchema(rawParamsStruct);
        this.#saveErrors(pixel, paramsUrlFormat, formatAjvErrors(this.#commonExperimentParamsSchema.errors));
    }

    /**
     * Validates pixel against saved schema and saves any errors
     * @param {String} pixel full pixel name in "." notation
     * @param {String} params query params as a String representation of an array
     */
    validatePixel(pixel, params) {
        if (pixel.startsWith('experiment.')) {
            this.validateExperimentPixel(pixel, params);
            return;
        }

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
        this.validatePixelParamsAndSuffixes(prefix, pixel, params, pixelMatch[ROOT_PREFIX]);
    }

    validatePixelParamsAndSuffixes(prefix, pixel, paramsString, pixelSchemas) {
        // 1) Skip outdated pixels based on version
        const paramsUrlFormat = JSON5.parse(paramsString).join('&');
        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const paramsStruct = {};
        Object.entries(rawParamsStruct).forEach(([key, val]) => {
            const normalizedKey = this.#getNormalizedVal(key);
            const paramSchema = pixelSchemas.paramsSchema.schema.properties[normalizedKey];
            paramsStruct[normalizedKey] = this.#getDecodedAndNormalizedVal(val, paramSchema);
        });

        if (this.#defsVersionKey && paramsStruct[this.#defsVersionKey] && validateVersion(paramsStruct[this.#defsVersionKey])) {
            if (compareVersions(paramsStruct[this.#defsVersionKey], this.#defsVersion) === -1) {
                return [];
            }
        }

        // 2) Validate regular params
        pixelSchemas.paramsSchema(paramsStruct);
        this.#saveErrors(prefix, paramsUrlFormat, formatAjvErrors(pixelSchemas.paramsSchema.errors));

        // 3) Validate suffixes if they exist
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
