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
const propSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'prop_schema.json5')).toString());
const suffixSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'suffix_schema.json5')).toString());
const nativeExperimentsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'native_experiments_schema.json5')).toString());
const searchExperimentsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'search_experiments_schema.json5')).toString());
const wideEventSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'wide_event_schema.json5')).toString());

/**
 * Validator for the overall pixel definition - ensures pixels and common params/suffixes conform to their schema
 */
export class DefinitionsValidator {
    #ajvValidatePixels;
    #ajvValidateParams;
    #ajvValidateProps;
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
        this.#ajv.addSchema(propSchema);
        this.#ajv.addSchema(suffixSchema);

        this.#ajvValidatePixels = this.#ajv.compile(pixelSchema);
        this.#ajvValidateParams = this.#ajv.compile(paramsSchema);
        this.#ajvValidateProps = this.#ajv.compile(propSchema);
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
     * Validates the properties dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonPropsDefinition() {
        this.#ajvValidateProps(this.#commonParams);
        return formatAjvErrors(this.#ajvValidateProps.errors);
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
     * Expands shortcuts in wide event definitions
     * @param {object} wideEvents
     * @returns {object} expanded wideEvents
     */
    #expandWideEventShortcuts(wideEvents) {
        const rootSectionsToSkip = ['description', 'owners', 'meta'];
        const expandedEvents = JSON.parse(JSON.stringify(wideEvents));

        for (const eventName of Object.keys(expandedEvents)) {
            const eventDef = expandedEvents[eventName];
            for (const [key, val] of Object.entries(eventDef)) {
                if (rootSectionsToSkip.includes(key)) continue;
                eventDef[key] = this.#recursivelyExpandShortcuts(val);
            }
        }

        return expandedEvents;
    }

    /**
     * Recursively expands shortcuts in an object
     * @param {any} obj
     * @returns {any} expanded object
     */
    #recursivelyExpandShortcuts(obj) {
        if (Array.isArray(obj)) return obj;

        if (typeof obj === 'object' && obj !== null) {
            for (const [key, val] of Object.entries(obj)) {
                obj[key] = this.#recursivelyExpandShortcuts(val);
            }
            return obj;
        }

        if (typeof obj === 'string') {
            if (Object.prototype.hasOwnProperty.call(this.#commonParams, obj)) {
                return this.#paramsValidator.getUpdatedItem(obj, this.#commonParams);
            }
            return obj;
        }

        return obj;
    }

    /**
     * Validates wide event definition
     *
     * @param {object} wideEvents should follow the schema defined in wide_event_schema.json5
     * @param {?Record<string, string>} [userMap] - map of valid github usernames
     * @returns any validation errors
     */
    validateWideEventDefinition(wideEvents, userMap = null) {
        const errors = [];

        // 1. Expand shortcuts
        let expandedEvents;
        try {
            expandedEvents = this.#expandWideEventShortcuts(wideEvents);
        } catch (error) {
            return [error.message];
        }

        // 2. Validate schema
        const ajvExpSchema = this.#ajv.compile(wideEventSchema);
        if (!ajvExpSchema(expandedEvents)) {
            return formatAjvErrors(ajvExpSchema.errors);
        }

        // 3. Iterate events for additional checks
        Object.entries(/** @type {Record<string, any>} */ (expandedEvents)).forEach(([eventName, eventDef]) => {
            // Check duplicates using meta.type
            const type = eventDef.meta?.type;
            if (type) {
                if (this.#definedPrefixes.has(type)) {
                    errors.push(`${type} --> Conflicting/duplicated definitions found!`);
                } else {
                    this.#definedPrefixes.add(type);
                }
            }

            // Check owners
            if (userMap) {
                for (const owner of eventDef.owners ?? []) {
                    if (!userMap[owner]) {
                        errors.push(`Owner ${owner} for wide event ${eventName} not in list of acceptable github user names`);
                    }
                }
            }
        });

        return errors;
    }

    /**
     * Recursively expands shortcuts
     * @param {any} obj
     * @returns {any}
     */
    #expandShortcuts(obj) {
        if (!obj) return obj;

        if (Array.isArray(obj)) {
            return obj.map((item) => this.#expandShortcuts(item));
        }

        if (typeof obj === 'object') {
            const newObj = {};
            for (const [key, value] of Object.entries(obj)) {
                newObj[key] = this.#expandShortcuts(value);
            }
            return newObj;
        }

        if (typeof obj === 'string') {
            if (Object.prototype.hasOwnProperty.call(this.#commonParams, obj)) {
                return this.#paramsValidator.getUpdatedItem(obj, this.#commonParams);
            }
            return obj;
        }

        throw TypeError(`${obj} --> unexpected prop of type ${typeof obj}`);
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
