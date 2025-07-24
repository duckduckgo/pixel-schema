#!/usr/bin/env node
import { compareVersions, validate as validateVersion } from 'compare-versions';

import { formatAjvErrors } from './error_utils.mjs';
import { ROOT_PREFIX, PIXEL_DELIMITER } from './constants.mjs';

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 * @typedef {import('./params_validator.mjs').ParamsValidator} ParamsValidator
 */

export const PixelValidationResult = Object.freeze({
    UNDEFINED: 0,
    UNDOCUMENTED: 1,
    OLD_APP_VERSION: 2,
    VALIDATION_FAILED: 3,
    VALIDATION_PASSED: 4,
});

export const PixelValidationResultString = {
    [PixelValidationResult.UNDEFINED]: 'Undefined',
    [PixelValidationResult.UNDOCUMENTED]: 'Undocumented',
    [PixelValidationResult.OLD_APP_VERSION]: 'DDG App Version Outdated',
    [PixelValidationResult.VALIDATION_FAILED]: 'Validation Failed',
    [PixelValidationResult.VALIDATION_PASSED]: 'Validation Passed',
};

export class LivePixelsValidator {
    #compiledPixels;
    #defsVersion;
    #defsVersionKey;
    #forceLowerCase;

    #commonExperimentParamsSchema;
    #commonExperimentSuffixesSchema;
    #compiledExperiments;

    // TODO: MOVE pixelErrors out to the caller?
    pixelErrors = {};
    currentPixelState = {};

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

    validateExperimentPixel(pixel, paramsUrlFormat) {
        let errorFound = false;

        const pixelParts = pixel.split(`experiment${PIXEL_DELIMITER}`)[1].split(PIXEL_DELIMITER);

        const pixelPrefixLen = 3;
        if (pixelParts.length < pixelPrefixLen) {
            // Invalid experiment pixel
            this.currentPixelState.status = PixelValidationResult.UNDOCUMENTED;
            return PixelValidationResult.UNDOCUMENTED;
        }

        const pixelType = pixelParts[0];
        if (pixelType !== 'enroll' && pixelType !== 'metrics') {
            // Invalid experiment pixel type
            this.currentPixelState.status = PixelValidationResult.UNDOCUMENTED;
            return PixelValidationResult.UNDOCUMENTED;
        }

        const experimentName = pixelParts[1];
        const pixelPrefix = ['experiment', pixelType, experimentName].join(PIXEL_DELIMITER);
        if (!this.#compiledExperiments[experimentName]) {
            this.#saveErrors(pixelPrefix, pixel, [`Unknown experiment '${experimentName}'`]);
            this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
            return PixelValidationResult.VALIDATION_FAILED;
        }

        // Check cohort
        const cohortName = pixelParts[2];
        if (!this.#compiledExperiments[experimentName].cohorts.includes(cohortName)) {
            this.#saveErrors(pixelPrefix, pixel, [`Unexpected cohort '${cohortName}' for experiment '${experimentName}'`]);
            this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
            return PixelValidationResult.VALIDATION_FAILED;
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
            if (this.#saveErrors(pixelPrefix, pixel, formatAjvErrors(this.#commonExperimentSuffixesSchema.errors, pixelNameStruct))) {
                errorFound = true;
            }
        }

        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const metric = rawParamsStruct.metric;
        const metricValue = rawParamsStruct.value;
        if (pixelType === 'metrics') {
            if (!metric || !metricValue) {
                if (this.#saveErrors(pixel, paramsUrlFormat, [`Experiment metrics pixels must contain 'metric' and 'value' params`])) {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
                    return PixelValidationResult.VALIDATION_FAILED;
                } else if (errorFound) {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
                    return PixelValidationResult.VALIDATION_FAILED;
                } else {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_PASSED;
                    return PixelValidationResult.VALIDATION_PASSED;
                }
            }

            const metricSchema = this.#compiledExperiments[experimentName].metrics[metric];
            if (!metricSchema) {
                if (this.#saveErrors(pixel, paramsUrlFormat, [`Unknown  experiment metric '${metric}'`])) {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
                    return PixelValidationResult.VALIDATION_FAILED;
                } else if (errorFound) {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
                    return PixelValidationResult.VALIDATION_FAILED;
                } else {
                    this.currentPixelState.status = PixelValidationResult.VALIDATION_PASSED;
                    return PixelValidationResult.VALIDATION_PASSED;
                }
            }

            metricSchema(metricValue);
            if (this.#saveErrors(pixel, paramsUrlFormat, formatAjvErrors(metricSchema.errors))) {
                errorFound = true;
            }

            // Remove metric and value from params for further validation
            delete rawParamsStruct.metric;
            delete rawParamsStruct.value;
        }

        // Validate enrollmentDate and conversionWindow
        this.#commonExperimentParamsSchema(rawParamsStruct);
        if (this.#saveErrors(pixel, paramsUrlFormat, formatAjvErrors(this.#commonExperimentParamsSchema.errors))) {
            errorFound = true;
        }

        if (errorFound) {
            this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
            return PixelValidationResult.VALIDATION_FAILED;
        }

        this.currentPixelState.status = PixelValidationResult.VALIDATION_PASSED;
        return PixelValidationResult.VALIDATION_PASSED;
    }

    /**
     * @param {String} pixel
     * @returns {String} prefix of pixel
     */
    getPixelPrefix(pixel) {
        if (pixel.startsWith(`experiment${PIXEL_DELIMITER}`)) {
            const pixelParts = pixel.split(`experiment${PIXEL_DELIMITER}`)[1].split(PIXEL_DELIMITER);
            return pixelParts[0] + PIXEL_DELIMITER + pixelParts[1] + PIXEL_DELIMITER + pixelParts[2];
        }
        const pixelParts = pixel.split(PIXEL_DELIMITER);
        let pixelMatch = this.#compiledPixels;
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
        return matchedParts.slice(0, -1);
        // return pixelParts.slice(0, -1).join(PIXEL_DELIMITER);
    }

    /**
     * Validates pixel against saved schema and saves any errors
     * @param {String} pixel full pixel name in "_" notation
     * @param {String} params query params as they would appear in a URL, but without the cache buster
     */
    validatePixel(pixel, params) {
        this.currentPixelState.prefix = 'undefined';
        this.currentPixelState.status = PixelValidationResult.UNDEFINED;

        if (pixel.startsWith(`experiment${PIXEL_DELIMITER}`)) {
            return this.validateExperimentPixel(pixel, params);
        }

        // Match longest prefix:
        const pixelParts = pixel.split(PIXEL_DELIMITER);
        let pixelMatch = this.#compiledPixels;
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

        if (!pixelMatch[ROOT_PREFIX]) {
            this.currentPixelState.status = PixelValidationResult.UNDOCUMENTED;
            return PixelValidationResult.UNDOCUMENTED;
        }

        const prefix = matchedParts.slice(0, -1);
        return this.validatePixelParamsAndSuffixes(prefix, pixel, params, pixelMatch[ROOT_PREFIX]);
    }

    validatePixelParamsAndSuffixes(prefix, pixel, paramsUrlFormat, pixelSchemas) {
        // 1) Skip outdated pixels based on version
        const rawParamsStruct = Object.fromEntries(new URLSearchParams(paramsUrlFormat));
        const paramsStruct = {};
        Object.entries(rawParamsStruct).forEach(([key, val]) => {
            const normalizedKey = this.#getNormalizedVal(key);
            const paramSchema = pixelSchemas.paramsSchema.schema.properties[normalizedKey];
            paramsStruct[normalizedKey] = this.#getDecodedAndNormalizedVal(val, paramSchema);
        });

        if (this.#defsVersionKey && paramsStruct[this.#defsVersionKey] && validateVersion(paramsStruct[this.#defsVersionKey])) {
            if (compareVersions(paramsStruct[this.#defsVersionKey], this.#defsVersion) === -1) {
                /*  This is not the latest version of the app
                    Parameters are sometimes added to pixels in newer versions
                    Err on side of not flagging this as a failed validation
                    */
                this.currentPixelState.status = PixelValidationResult.OLD_APP_VERSION;
                return PixelValidationResult.OLD_APP_VERSION;
            }
        }

        let errorFound = false;
        let numErrorsFound = 0;
        // 2) Validate regular params
        pixelSchemas.paramsSchema(paramsStruct);
        errorFound = this.#saveErrors(prefix, paramsUrlFormat, formatAjvErrors(pixelSchemas.paramsSchema.errors));

        if (errorFound) {
            numErrorsFound++;
        }
        // 3) Validate suffixes if they exist
        if (pixel.length === prefix.length) {
            if (numErrorsFound > 0) {
                this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
                return PixelValidationResult.VALIDATION_FAILED;
            } else {
                this.currentPixelState.status = PixelValidationResult.VALIDATION_PASSED;
                return PixelValidationResult.VALIDATION_PASSED;
            }
        }

        const pixelSuffix = pixel.split(`${prefix}${PIXEL_DELIMITER}`)[1];
        const pixelNameStruct = {};
        pixelSuffix.split(PIXEL_DELIMITER).forEach((suffix, idx) => {
            pixelNameStruct[idx] = suffix;
        });
        pixelSchemas.suffixesSchema(pixelNameStruct);
        errorFound = this.#saveErrors(prefix, pixel, formatAjvErrors(pixelSchemas.suffixesSchema.errors, pixelNameStruct));

        if (errorFound) {
            numErrorsFound++;
        }
        if (numErrorsFound > 0) {
            this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
            return PixelValidationResult.VALIDATION_FAILED;
        }
        this.currentPixelState.status = PixelValidationResult.VALIDATION_PASSED;
        return PixelValidationResult.VALIDATION_PASSED;
    }

    // Reture true if errors were found
    // Return false if errors were not found
    #saveErrors(prefix, example, errors) {
        // No errors found
        if (!errors.length) return false;

        if (!this.pixelErrors[prefix]) {
            this.pixelErrors[prefix] = {};
        }

        this.currentPixelState.prefix = prefix;
        this.currentPixelState.status = PixelValidationResult.VALIDATION_FAILED;
        this.currentPixelState.example = example;

        for (const error of errors) {
            if (!this.pixelErrors[prefix][error]) {
                this.pixelErrors[prefix][error] = new Set();
            }
            this.pixelErrors[prefix][error].add(example);

            if (!this.currentPixelState.errors) {
                this.currentPixelState.errors = new Set();
            }
            this.currentPixelState.errors.add(error);
        }

        // Errors were found
        return true;
    }

    //COULD JUST RETURN THIS FROM THE VALIDATE PIXEL FUNCTION 
    getLastPixelState() {
        return this.currentPixelState;
    }
}
