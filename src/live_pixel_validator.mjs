#!/usr/bin/env node
import { compareVersions, validate as validateVersion } from 'compare-versions';

import { formatAjvErrors } from './error_utils.mjs';
import { ROOT_PREFIX, PIXEL_DELIMITER, PIXEL_VALIDATION_RESULT } from './constants.mjs';
import { matchPixel } from './pixel_utils.mjs';

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 * @typedef {import('./params_validator.mjs').ParamsValidator} ParamsValidator
 * @typedef {import('ajv').ValidateFunction} ValidateFunction
 */

export class LivePixelsValidator {
    #compiledPixels;
    #defsVersion;
    #defsVersionKey;
    #forceLowerCase;

    #commonExperimentParamsSchema;
    #commonExperimentSuffixesSchema;
    #compiledExperiments;

    #currentPixelState;

    /**
     * @param {object} tokenizedPixels similar in format to schemas/pixel_schema.json5.
     * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
     * @param {ProductDefinition} productDef
     * @param {object} experimentsDef experiment definitions, following schemas/native_experiments_schema.json5 type.
     */
    constructor(tokenizedPixels, productDef, experimentsDef, paramsValidator) {
        this.#initPixelState();
        this.#forceLowerCase = productDef.forceLowerCase;
        this.#defsVersion = this.#getNormalizedVal(productDef.target.version);
        this.#defsVersionKey = this.#getNormalizedVal(productDef.target.key);

        this.#compileDefs(tokenizedPixels, paramsValidator);
        this.#compiledPixels = tokenizedPixels;

        // Experiments params and suffixes
        this.#commonExperimentParamsSchema = paramsValidator.compileCommonExperimentParamsSchema();
        this.#commonExperimentSuffixesSchema = paramsValidator.compileSuffixesSchema(experimentsDef.defaultSuffixes || []);

        // Experiment metrics
        this.#compiledExperiments = experimentsDef.activeExperiments || {};
        const defaultsSchema = paramsValidator.compileExperimentMetricSchema({ enum: [1, 4, 6, 11, 21, 30] });
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
     * @param {import('ajv').SchemaObject | undefined} paramSchema - AJV schema fragment
     * @returns {String|null} decoded and normalized param value
     */
    #getDecodedAndNormalizedVal(paramValue, paramSchema) {
        if (!paramSchema) return null; // will fail validation later

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

    #compileDefs(tokenizedPixels, paramsValidator, currentPrefix = '') {
        Object.entries(tokenizedPixels).forEach(([prefixPart, pixelDef]) => {
            const newPrefix = currentPrefix ? `${currentPrefix}${PIXEL_DELIMITER}${prefixPart}` : prefixPart;
            if (prefixPart !== ROOT_PREFIX) {
                this.#compileDefs(pixelDef, paramsValidator, newPrefix);
                return;
            }

            // Pixel name is always lower case:
            const lowerCasedSuffixes = pixelDef.suffixes ? JSON.parse(JSON.stringify(pixelDef.suffixes).toLowerCase()) : [];
            const normalizedParams = pixelDef.parameters ? JSON.parse(this.#getNormalizedVal(JSON.stringify(pixelDef.parameters))) : [];

            // Pre-compile each schema and remember owners
            const paramsSchema = paramsValidator.compileParamsSchema(normalizedParams, currentPrefix);
            const suffixesSchema = paramsValidator.compileSuffixesSchema(lowerCasedSuffixes);
            const owners = pixelDef.owners;
            const requireVersion = pixelDef.requireVersion ?? false;
            tokenizedPixels[prefixPart] = {
                paramsSchema,
                suffixesSchema,
                owners,
                requireVersion,
            };
        });
    }

    /**
     * (Re)initializes the current pixel state.
     */
    #initPixelState() {
        this.#currentPixelState = {
            status: PIXEL_VALIDATION_RESULT.VALIDATION_PASSED,
            owners: [],
            prefixForErrors: null,
            errors: [],
        };
    }

    validateNativeExperimentPixel(pixel, paramsUrlFormat) {
        const pixelParts = pixel.split(`experiment${PIXEL_DELIMITER}`)[1].split(PIXEL_DELIMITER);

        const pixelPrefixLen = 3;
        if (pixelParts.length < pixelPrefixLen) {
            // Invalid experiment pixel
            this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.UNDOCUMENTED;
            return this.#currentPixelState;
        }

        const pixelType = pixelParts[0];
        if (pixelType !== 'enroll' && pixelType !== 'metrics') {
            // Invalid experiment pixel type
            this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.UNDOCUMENTED;
            return this.#currentPixelState;
        }

        const experimentName = pixelParts[1];
        const pixelPrefix = ['experiment', pixelType, experimentName].join(PIXEL_DELIMITER);
        if (!this.#compiledExperiments[experimentName]) {
            this.#saveErrors(pixelPrefix, pixel, [`Unknown experiment '${experimentName}'`]);
            return this.#currentPixelState;
        }

        // Check cohort
        const cohortName = pixelParts[2];
        if (!this.#compiledExperiments[experimentName].cohorts.includes(cohortName)) {
            this.#saveErrors(pixelPrefix, pixel, [`Unexpected cohort '${cohortName}' for experiment '${experimentName}'`]);
            return this.#currentPixelState;
        }

        // Check suffixes if they exist
        if (pixelParts.length > pixelPrefixLen) {
            const pixelNameStruct = {};
            let structIdx = 0;
            for (let i = pixelPrefixLen; i < pixelParts.length; i++) {
                pixelNameStruct[structIdx] = pixelParts[i];
                structIdx++;
            }
            this.#commonExperimentSuffixesSchema(pixelNameStruct);
            this.#saveErrors(pixelPrefix, pixel, formatAjvErrors(this.#commonExperimentSuffixesSchema.errors, pixelNameStruct));
        }

        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const metric = rawParamsStruct.metric;
        const metricValue = rawParamsStruct.value;
        if (pixelType === 'metrics') {
            if (!metric || !metricValue) {
                this.#saveErrors(pixel, paramsUrlFormat, [`Experiment metrics pixels must contain 'metric' and 'value' params`]);
                return this.#currentPixelState;
            }

            const metricSchema = this.#compiledExperiments[experimentName].metrics[metric];
            if (!metricSchema) {
                this.#saveErrors(pixel, paramsUrlFormat, [`Unknown experiment metric '${metric}'`]);
                return this.#currentPixelState;
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
        return this.#currentPixelState;
    }

    /**
     * Validates pixel against saved schema and returns any errors
     * @param {String} pixel full pixel name in "_" notation
     * @param {String} params query params as they would appear in a URL, but without the cache buster
     */
    validatePixel(pixel, params) {
        this.#initPixelState();
        if (pixel.startsWith(`experiment${PIXEL_DELIMITER}`)) {
            return this.validateNativeExperimentPixel(pixel, params);
        }
        const [prefix, pixelMatch] = matchPixel(pixel, this.#compiledPixels);

        if (!pixelMatch) {
            this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.UNDOCUMENTED;
            return this.#currentPixelState;
        }

        // Found a match: remember owners
        // TODO: experiments don't have owners. Fix in https://app.asana.com/1/137249556945/project/1209805270658160/task/1210955210382823?focus=true
        this.#currentPixelState.owners = pixelMatch.owners;
        this.#currentPixelState.requireVersion = pixelMatch.requireVersion;

        this.validatePixelParamsAndSuffixes(prefix, pixel, params, pixelMatch);
        return this.#currentPixelState;
    }

    validatePixelParamsAndSuffixes(prefix, pixel, paramsUrlFormat, pixelSchemas) {
        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const paramsStruct = {};
        Object.entries(rawParamsStruct).forEach(([key, val]) => {
            const normalizedKey = this.#getNormalizedVal(key);
            const paramSchema = pixelSchemas.paramsSchema.schema.properties[normalizedKey];
            paramsStruct[normalizedKey] = this.#getDecodedAndNormalizedVal(val, paramSchema);
        });

        if (this.#defsVersionKey) {
            // 1) Skip pixels where requireVersion is set but version param is absent
            if (this.#currentPixelState.requireVersion && !paramsStruct[this.#defsVersionKey]) {
                this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.OLD_APP_VERSION;
                return this.#currentPixelState;
            }

            // 1b) Skip outdated pixels based on version
            if (paramsStruct[this.#defsVersionKey] && validateVersion(paramsStruct[this.#defsVersionKey])) {
                if (compareVersions(paramsStruct[this.#defsVersionKey], this.#defsVersion) === -1) {
                    this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.OLD_APP_VERSION;
                    return this.#currentPixelState;
                }
            }
        }

        // 2) Validate regular params
        pixelSchemas.paramsSchema(paramsStruct);
        this.#saveErrors(prefix, paramsUrlFormat, formatAjvErrors(pixelSchemas.paramsSchema.errors));

        // 3) Validate suffixes if they exist
        if (pixel.length === prefix.length) {
            return this.#currentPixelState;
        }

        const pixelSuffix = pixel.split(`${prefix}${PIXEL_DELIMITER}`)[1];
        const pixelNameStruct = {};
        pixelSuffix.split(PIXEL_DELIMITER).forEach((suffix, idx) => {
            pixelNameStruct[idx] = suffix;
        });
        pixelSchemas.suffixesSchema(pixelNameStruct);
        this.#saveErrors(prefix, pixel, formatAjvErrors(pixelSchemas.suffixesSchema.errors, pixelNameStruct));

        return this.#currentPixelState;
    }

    #saveErrors(prefix, example, errors) {
        if (!errors || !errors.length) return;

        this.#currentPixelState.status = PIXEL_VALIDATION_RESULT.VALIDATION_FAILED;
        this.#currentPixelState.prefixForErrors = prefix;

        for (const error of errors) {
            this.#currentPixelState.errors.push({
                error,
                example,
            });
        }
    }
}
