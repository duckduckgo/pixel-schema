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
 * Base validator class with shared AJV infrastructure and utilities.
 * Not intended to be used directly - use PixelDefinitionsValidator or WideEventDefinitionsValidator.
 */
class BaseDefinitionsValidator {
    /** @protected */
    _ajv;
    /** @protected */
    _paramsValidator;
    /** @protected */
    _dictionary;
    /** @protected */
    _definedPrefixes = new Set();

    /**
     * @param {Record<string, unknown>} dictionary - object containing common params (pixels) or props (wide events)
     */
    constructor(dictionary) {
        this._dictionary = dictionary;
        // eslint-disable-next-line new-cap
        this._ajv = new Ajv2020.default({ allErrors: true });
        addFormats.default(this._ajv);
    }

    /**
     * Recursively expands shortcuts in an object (mutates the object)
     * @protected
     * @param {any} obj
     * @returns {any} expanded object
     */
    _recursivelyExpandShortcuts(obj) {
        if (Array.isArray(obj)) return obj;

        if (typeof obj === 'object' && obj !== null) {
            for (const [key, val] of Object.entries(obj)) {
                obj[key] = this._recursivelyExpandShortcuts(val);
            }
            return obj;
        }

        if (typeof obj === 'string') {
            if (Object.prototype.hasOwnProperty.call(this._dictionary, obj)) {
                return this._paramsValidator.getUpdatedItem(obj, this._dictionary);
            }
            return obj;
        }

        return obj;
    }

    /**
     * Recursively expands shortcuts (returns new object)
     * @protected
     * @param {any} obj
     * @returns {any}
     */
    _expandShortcuts(obj) {
        if (!obj) return obj;

        if (Array.isArray(obj)) {
            return obj.map((item) => this._expandShortcuts(item));
        }

        if (typeof obj === 'object') {
            const newObj = {};
            for (const [key, value] of Object.entries(obj)) {
                newObj[key] = this._expandShortcuts(value);
            }
            return newObj;
        }

        if (typeof obj === 'string') {
            if (Object.prototype.hasOwnProperty.call(this._dictionary, obj)) {
                return this._paramsValidator.getUpdatedItem(obj, this._dictionary);
            }
            return obj;
        }

        throw TypeError(`${obj} --> unexpected prop of type ${typeof obj}`);
    }
}

/**
 * Validator for pixel definitions - ensures pixels, common params, and suffixes conform to their schemas.
 */
export class PixelDefinitionsValidator extends BaseDefinitionsValidator {
    #ajvValidatePixels;
    #ajvValidateParams;
    #ajvValidateSuffixes;

    #commonSuffixes;
    #ignoreParams;

    /**
     * @param {Record<string, unknown>} commonParams - object containing common parameters (params_dictionary.json)
     * @param {Record<string, unknown>} commonSuffixes - object containing common suffixes (suffixes_dictionary.json)
     * @param {Record<string, unknown>} ignoreParams - object containing parameters to ignore (ignore_params.json)
     */
    constructor(commonParams, commonSuffixes, ignoreParams) {
        super(commonParams);
        this.#commonSuffixes = commonSuffixes;
        this.#ignoreParams = ignoreParams;
        this._paramsValidator = new ParamsValidator(this._dictionary, this.#commonSuffixes, this.#ignoreParams);

        this._ajv.addSchema(paramsSchema);
        this._ajv.addSchema(suffixSchema);

        this.#ajvValidatePixels = this._ajv.compile(pixelSchema);
        this.#ajvValidateParams = this._ajv.compile(paramsSchema);
        this.#ajvValidateSuffixes = this._ajv.compile(suffixSchema);
    }

    /**
     * Validates the parameter dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonParamsDefinition() {
        this.#ajvValidateParams(this._dictionary);
        return formatAjvErrors(this.#ajvValidateParams.errors);
    }

    /**
     * Validates the shared suffix dictionary definition against the corresponding schema.
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
        const ajvExpSchema = this._ajv.compile(nativeExperimentsSchema);
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
        const ajvExpSchema = this._ajv.compile(searchExperimentsSchema);
        ajvExpSchema(experimentsDef);
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
            if (this._definedPrefixes.has(pixelName)) {
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

            this._definedPrefixes.add(pixelName);
            try {
                this._paramsValidator.compileSuffixesSchema(pixelDef.suffixes);
                this._paramsValidator.compileParamsSchema(pixelDef.parameters);
            } catch (error) {
                errors.push(`${pixelName} --> ${error.message}`);
            }
        });

        return errors;
    }
}

/**
 * Validator for wide event definitions - ensures wide events and props dictionary conform to their schemas.
 */
export class WideEventDefinitionsValidator extends BaseDefinitionsValidator {
    #ajvValidateProps;

    /**
     * @param {Record<string, unknown>} propsDict - object containing common properties (props_dictionary.json)
     */
    constructor(propsDict) {
        super(propsDict);
        this._paramsValidator = new ParamsValidator(this._dictionary, {}, {});

        this._ajv.addSchema(propSchema);
        this.#ajvValidateProps = this._ajv.compile(propSchema);
    }

    /**
     * Validates the properties dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonPropsDefinition() {
        this.#ajvValidateProps(this._dictionary);
        return formatAjvErrors(this.#ajvValidateProps.errors);
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
                eventDef[key] = this._recursivelyExpandShortcuts(val);
            }
        }

        return expandedEvents;
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

        // context.name: array -> enum with 1+ values (only if context is provided)
        if (eventDef.context) {
            merged.context = {
                name: {
                    ...merged.context?.name,
                    enum: eventDef.context,
                },
            };
        } else {
            // Context is optional - remove from merged if not provided by event
            delete merged.context;
        }

        // feature.name: string -> enum with single value
        merged.feature.name = {
            ...merged.feature.name,
            enum: [eventDef.feature?.name],
        };
        // feature.status: array -> enum with 1+ values
        merged.feature.status = {
            ...merged.feature.status,
            enum: eventDef.feature?.status,
        };
        merged.feature.data = eventDef.feature?.data;

        merged.app = baseEvent.app;
        merged.global = baseEvent.global;

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
        const ajvExpSchema = this._ajv.compile(wideEventSchema);
        if (!ajvExpSchema(generatedSchemas)) {
            return { errors: formatAjvErrors(ajvExpSchema.errors), generatedSchemas };
        }

        // 3. Convert to valid AJV schemas and verify they compile
        for (const [eventName, eventDef] of Object.entries(/** @type {Record<string, any>} */ (generatedSchemas))) {
            try {
                const ajvSchema = this.#convertToAjvSchema(eventDef);
                this._ajv.compile(ajvSchema);
            } catch (error) {
                errors.push(`${eventName}: Generated schema failed to compile - ${error.message}`);
            }
        }

        // 4. Iterate events for additional checks (use original for metadata access)
        Object.entries(/** @type {Record<string, any>} */ (generatedSchemas)).forEach(([eventName, eventDef]) => {
            // Check duplicates using meta.type
            const type = eventDef.meta?.type;
            if (type) {
                if (this._definedPrefixes.has(type)) {
                    errors.push(`${type} --> Conflicting/duplicated definitions found!`);
                } else {
                    this._definedPrefixes.add(type);
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

        // Return original format for compatibility (AJV compilation was just validation)
        return { errors, generatedSchemas };
    }

    /**
     * Converts a property definition to a valid AJV JSON Schema.
     * - Literal values (strings, arrays, objects without 'type') become { const: value }
     * - Property definitions (objects with valid JSON Schema 'type') are kept as-is
     * - Container objects (nested properties) become { type: "object", properties: {...} }
     * @param {any} value - The value to convert
     * @returns {object} Valid JSON Schema
     */
    #convertToAjvSchema(value) {
        // Null/undefined
        if (value === null || value === undefined) {
            return { const: value };
        }

        // Primitive literals
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return { const: value };
        }

        // Arrays - treat as const value
        if (Array.isArray(value)) {
            return { const: value };
        }

        // Objects
        if (typeof value === 'object') {
            // Check if it's a property definition (has 'type' with a valid JSON Schema type)
            const validSchemaTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
            if ('type' in value && validSchemaTypes.includes(value.type)) {
                return value;
            }

            // Otherwise it's a container - convert children and wrap in object schema
            const properties = {};
            const required = [];
            for (const [key, val] of Object.entries(value)) {
                properties[key] = this.#convertToAjvSchema(val);
                required.push(key);
            }
            return {
                type: 'object',
                properties,
                required,
                additionalProperties: false,
            };
        }

        return { const: value };
    }
}

/**
 * Backwards-compatible facade that provides all validation methods.
 * For new code, prefer using PixelDefinitionsValidator or WideEventDefinitionsValidator directly.
 * @deprecated Use PixelDefinitionsValidator or WideEventDefinitionsValidator instead
 */
export class DefinitionsValidator {
    #pixelValidator;
    #wideEventValidator;

    /**
     * @param {Record<string, unknown>} commonParams - object containing common parameters
     * @param {Record<string, unknown>} commonSuffixes - object containing common suffixes
     * @param {Record<string, unknown>} ignoreParams - object containing parameters to ignore
     */
    constructor(commonParams, commonSuffixes, ignoreParams) {
        this.#pixelValidator = new PixelDefinitionsValidator(commonParams, commonSuffixes, ignoreParams);
        // For wide events, commonParams is actually the props dictionary
        this.#wideEventValidator = new WideEventDefinitionsValidator(commonParams);
    }

    // Pixel validation methods (delegated to PixelDefinitionsValidator)

    /**
     * Validates the parameter dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonParamsDefinition() {
        return this.#pixelValidator.validateCommonParamsDefinition();
    }

    /**
     * Validates the shared suffix dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonSuffixesDefinition() {
        return this.#pixelValidator.validateCommonSuffixesDefinition();
    }

    /**
     * Validates the ignore parameter definitions against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateIgnoreParamsDefinition() {
        return this.#pixelValidator.validateIgnoreParamsDefinition();
    }

    /**
     * Validates native experiments definition
     *
     * @param {object} experimentsDef should follow the schema defined in native_experiments_schema.json5
     * @returns any validation errors
     */
    validateNativeExperimentsDefinition(experimentsDef) {
        return this.#pixelValidator.validateNativeExperimentsDefinition(experimentsDef);
    }

    /**
     * Validates search experiments definition
     *
     * @param {object} experimentsDef should follow the schema defined in search_experiments_schema.json5
     * @returns any validation errors
     */
    validateSearchExperimentsDefinition(experimentsDef) {
        return this.#pixelValidator.validateSearchExperimentsDefinition(experimentsDef);
    }

    /**
     * Validates the full pixel definition, including shortcuts, parameters, and suffixes
     *
     * @param {PixelDefinitions} pixelsDef - object containing multiple pixel definitions
     * @param {?Record<string, string>} [userMap] - map of valid github usernames
     * @returns {Array<string>} - array of error messages
     */
    validatePixelsDefinition(pixelsDef, userMap = null) {
        return this.#pixelValidator.validatePixelsDefinition(pixelsDef, userMap);
    }

    // Wide event validation methods (delegated to WideEventDefinitionsValidator)

    /**
     * Validates the properties dictionary definition against the corresponding schema.
     * @returns {string[]} AJV error messages, if any.
     */
    validateCommonPropsDefinition() {
        return this.#wideEventValidator.validateCommonPropsDefinition();
    }

    /**
     * Generates the full wide event schema by merging event definition with base event
     * and expanding shortcuts.
     * @param {object} wideEvents - The wide event definitions
     * @param {object} baseEvent - The base event template (required)
     * @returns {object} Generated schemas keyed by event name
     */
    generateWideEventSchemas(wideEvents, baseEvent) {
        return this.#wideEventValidator.generateWideEventSchemas(wideEvents, baseEvent);
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
        return this.#wideEventValidator.validateWideEventDefinition(wideEvents, baseEvent, userMap);
    }
}
