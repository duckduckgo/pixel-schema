import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { formatAjvErrors } from './error_utils.mjs';
import { fileURLToPath } from 'url';
import { ParamsValidator } from './params_validator.mjs';

/**
 * @typedef {import('./types.mjs').PixelDefinitions} PixelDefinitions
 */

const schemasPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const pixelSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'pixel_schema.json5')).toString());
const paramsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'param_schema.json5')).toString());
const suffixSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'suffix_schema.json5')).toString());
const nativeExperimentsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'native_experiments_schema.json5')).toString());
const searchExperimentsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'search_experiments_schema.json5')).toString());
const journeysSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'wide_events_schema.json5')).toString());

/**
 * Validator for the overall pixel definition - ensures pixels and common params/suffixes conform to their schema
 */
export class DefinitionsValidator {
    #ajvValidatePixels;
    #ajvValidateParams;
    #ajvValidateSuffixes;

    #commonParams;
    #commonSuffixes;
    #ignoreParams;

    #paramsValidator;
    // eslint-disable-next-line new-cap
    #ajv = new Ajv2020.default({ allErrors: true });

    #definedPrefixes = new Set();

    /**
     * @param {Record<string, unknown>} commonParams - object containing common parameters
     * @param {Record<string, unknown>} commonSuffixes - object containing common suffixes
     * @param {Record<string, unknown>} ignoreParams - object containing parameters to ignore
     */
    constructor(commonParams, commonSuffixes, ignoreParams) {
        this.#commonParams = commonParams;
        this.#commonSuffixes = commonSuffixes;
        this.#ignoreParams = ignoreParams;
        this.#paramsValidator = new ParamsValidator(this.#commonParams, this.#commonSuffixes, this.#ignoreParams);

        addFormats.default(this.#ajv);
        this.#ajv.addSchema(paramsSchema);
        this.#ajv.addSchema(suffixSchema);

        this.#ajvValidatePixels = this.#ajv.compile(pixelSchema);
        this.#ajvValidateParams = this.#ajv.compile(paramsSchema);
        this.#ajvValidateSuffixes = this.#ajv.compile(suffixSchema);
    }

    /**
     * Validates the parameter dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonParamsDefinition() {
        this.#ajvValidateParams(this.#commonParams);
        return formatAjvErrors(this.#ajvValidateParams.errors);
    }

    /**
     * Validates the shared dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonSuffixesDefinition() {
        this.#ajvValidateSuffixes(this.#commonSuffixes);
        return formatAjvErrors(this.#ajvValidateSuffixes.errors);
    }

    /**
     * Validates the ignore parameter definitions against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateIgnoreParamsDefinition() {
        this.#ajvValidateParams(this.#ignoreParams);
        return formatAjvErrors(this.#ajvValidateParams.errors);
    }

    /**
     * Validates native experiments definition
     *
     * @param {object} experimentsDef should follow the schema defined in native_experiments_schema.json5
     * @returns any validation errors
     */
    validateNativeExperimentsDefinition(experimentsDef) {
        const ajvExpSchema = this.#ajv.compile(nativeExperimentsSchema);
        ajvExpSchema(experimentsDef);
        return formatAjvErrors(ajvExpSchema.errors);
    }

    /**
     * Validates search experiments definition
     *
     * @param {object} experimentsDef should follow the schema defined in search_experiments_schema.json5
     * @returns any validation errors
     */
    validateSearchExperimentsDefinition(experimentsDef) {
        const ajvExpSchema = this.#ajv.compile(searchExperimentsSchema);
        ajvExpSchema(experimentsDef);
        return formatAjvErrors(ajvExpSchema.errors);
    }

    /**
     * Validates journeys definition
     *
     * @param {object} journeysDef should follow the schema defined in wide_events_schema.json5
     * @returns any validation errors
     */
    validateJourneysDefinition(journeysDef) {
        console.log('Validating journeys schema...')
        const ajvExpSchema = this.#ajv.compile(journeysSchema);
        ajvExpSchema(journeysDef);
        return formatAjvErrors(ajvExpSchema.errors);
    }

    /**
     * Validates the full pixel definition, including shortcuts, parameters, and suffixes
     *
     * @param {PixelDefinitions} pixelsDef - object containing multiple pixel definitions
     * @param {?Record<string, string>} [userMap] - map of valid github usernames
     * @returns {Array<string>} - array of error messages
     */
    validatePixelsDefinition(pixelsDef, userMap = null) {
        // 1) Validate that pixel definition conforms to schema
        if (!this.#ajvValidatePixels(pixelsDef)) {
            // Doesn't make sense to check the rest if main definition is invalid
            return formatAjvErrors(this.#ajvValidatePixels.errors);
        }

        // 2) Validate that:
        // (a) there are no duplicate prefixes and
        // (b) shortcuts, params, and suffixes can be compiled into a separate schema
        // (c) all owners are valid github usernames in the provided userMap
        const errors = [];
        Object.entries(/** @type {PixelDefinitions} */ (pixelsDef)).forEach(([pixelName, pixelDef]) => {
            if (this.#definedPrefixes.has(pixelName)) {
                errors.push(`${pixelName} --> Conflicting/duplicated definitions found!`);
                return;
            }

            // All owners should be valid github user names in the approved DDG list
            if (userMap) {
                for (const owner of pixelDef.owners ?? []) {
                    if (!userMap[owner]) {
                        errors.push(`Owner ${owner} for pixel ${pixelName} not in list of acceptable github user names`);
                    }
                }
            }

            this.#definedPrefixes.add(pixelName);
            try {
                this.#paramsValidator.compileSuffixesSchema(pixelDef.suffixes);
                this.#paramsValidator.compileParamsSchema(pixelDef.parameters);
            } catch (error) {
                errors.push(`${pixelName} --> ${error.message}`);
            }
        });

        return errors;
    }
}
