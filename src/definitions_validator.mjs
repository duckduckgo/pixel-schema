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
        const rootSectionsToSkip = ['description', 'owners', 'meta', 'context'];
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
     * Deep merges source into target, where source values override target values.
     * For arrays, source replaces target entirely.
     * @param {any} target - The base object
     * @param {any} source - The object to merge in
     * @returns {any} merged object
     */
    #deepMerge(target, source) {
        if (source === undefined || source === null) {
            return target;
        }
        if (target === undefined || target === null) {
            return source;
        }
        if (Array.isArray(source)) {
            return source;
        }
        if (typeof source !== 'object' || typeof target !== 'object') {
            return source;
        }

        const result = { ...target };
        for (const key of Object.keys(source)) {
            result[key] = this.#deepMerge(target[key], source[key]);
        }
        return result;
    }

    /**
     * Merges an event definition with the base event template.
     * Handles special transformations for the new format:
     * - context array becomes context.name.enum
     * - feature.name string becomes feature.name.enum with single value
     * - feature.status array becomes feature.status.enum
     * @param {object} eventDef - The event-specific definition
     * @param {object} baseEvent - The base event template
     * @returns {object} merged event definition
     */
    #mergeWithBaseEvent(eventDef, baseEvent) {
        const merged = JSON.parse(JSON.stringify(baseEvent));

        // Remove meta from merged - it's handled separately in generateWideEventSchemas
        delete merged.meta;

        // Handle context transformation: array -> context.name.enum (at root level)
        if (Array.isArray(eventDef.context)) {
            merged.context = {
                name: {
                    ...merged.context?.name,
                    enum: eventDef.context,
                },
            };
        } else if (eventDef.context) {
            merged.context = this.#deepMerge(merged.context, eventDef.context);
        }

        // Handle feature transformation
        if (eventDef.feature) {
            // feature.name: string -> enum with single value
            if (typeof eventDef.feature.name === 'string') {
                merged.feature.name = {
                    ...merged.feature.name,
                    enum: [eventDef.feature.name],
                };
            } else if (eventDef.feature.name) {
                merged.feature.name = this.#deepMerge(merged.feature.name, eventDef.feature.name);
            }

            // feature.status: array -> enum
            if (Array.isArray(eventDef.feature.status)) {
                merged.feature.status = {
                    ...merged.feature.status,
                    enum: eventDef.feature.status,
                };
            } else if (eventDef.feature.status) {
                merged.feature.status = this.#deepMerge(merged.feature.status, eventDef.feature.status);
            }

            // feature.data: deep merge
            if (eventDef.feature.data) {
                merged.feature.data = this.#deepMerge(merged.feature.data, eventDef.feature.data);
            }
        }

        // Merge app section
        if (eventDef.app) {
            merged.app = this.#deepMerge(merged.app, eventDef.app);
        }

        // Merge global section
        if (eventDef.global) {
            merged.global = this.#deepMerge(merged.global, eventDef.global);
        }

        return merged;
    }

    /**
     * Generates the full wide event schema by merging event definition with base event
     * and expanding shortcuts.
     * @param {object} wideEvents - The wide event definitions
     * @param {object} baseEvent - The base event template (required)
     * @returns {object} Generated schemas keyed by event name
     */
    generateWideEventSchemas(wideEvents, baseEvent) {

        // Get base version for combining with event versions
        const baseVersion = baseEvent.meta?.version?.value;
        if (baseVersion === undefined) {
            throw new Error("base_event.json must have 'meta.version.value' defined");
        }

        // Merge each event with base event
        const mergedEvents = {};
        for (const [eventName, eventDef] of Object.entries(wideEvents)) {
            // Validate that event doesn't redefine base properties (app, global)
            // These should come from base_event.json only
            if (eventDef.app) {
                throw new Error(`${eventName}: 'app' section should not be defined in event - it comes from base_event.json`);
            }
            if (eventDef.global) {
                throw new Error(`${eventName}: 'global' section should not be defined in event - it comes from base_event.json`);
            }

            // Validate that event has a version for combining with base version
            if (!eventDef.meta?.version) {
                throw new Error(`${eventName}: 'meta.version' is required to generate versioned schema filename`);
            }

            const mergedEventContent = this.#mergeWithBaseEvent(eventDef, baseEvent);

            // Combine versions: base version + event two-octet version -> semver
            const eventVersion = eventDef.meta.version;
            const combinedVersion = `${baseVersion}.${eventVersion}`;
            const combinedMeta = {
                ...eventDef.meta,
                version: combinedVersion,
            };

            mergedEvents[eventName] = {
                description: eventDef.description,
                owners: eventDef.owners,
                meta: combinedMeta,
                ...mergedEventContent,
            };
        }

        // Then expand shortcuts (props_dictionary references)
        const generatedSchemas = this.#expandWideEventShortcuts(mergedEvents);

        return generatedSchemas;
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
     * @param {object} baseEvent - base event template (required)
     * @param {?Record<string, string>} [userMap] - map of valid github usernames
     * @returns {{ errors: string[], generatedSchemas: object }} validation errors and generated schemas
     */
    validateWideEventDefinition(wideEvents, baseEvent, userMap = null) {
        const errors = [];

        if (!baseEvent) {
            return { errors: ['base_event.json is required for wide event validation'], generatedSchemas: {} };
        }

        // 1. Generate schemas by merging with base event and expanding shortcuts
        let generatedSchemas;
        try {
            generatedSchemas = this.generateWideEventSchemas(wideEvents, baseEvent);
        } catch (error) {
            return { errors: [error.message], generatedSchemas: {} };
        }

        // 2. Validate schema
        const ajvExpSchema = this.#ajv.compile(wideEventSchema);
        if (!ajvExpSchema(generatedSchemas)) {
            return { errors: formatAjvErrors(ajvExpSchema.errors), generatedSchemas };
        }

        // 3. Iterate events for additional checks
        Object.entries(/** @type {Record<string, any>} */ (generatedSchemas)).forEach(([eventName, eventDef]) => {
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

        return { errors, generatedSchemas };
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
