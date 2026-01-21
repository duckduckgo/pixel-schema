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
     * Expands shortcuts in a properties object (for feature.data.ext)
     * @param {object} props - properties object
     * @returns {object} expanded properties
     */
    #expandPropertiesShortcuts(props) {
        if (!props || typeof props !== 'object') return props;

        const expanded = {};
        for (const [key, val] of Object.entries(props)) {
            expanded[key] = this._recursivelyExpandShortcuts(val);
        }
        return expanded;
    }

    /**
     * Wraps a section (app, global, etc.) in proper JSON Schema object structure.
     * @param {object} sectionDef - The section definition with property definitions
     * @param {string[]} requiredProps - Array of required property names
     * @returns {object} JSON Schema object structure
     */
    #wrapSectionAsJsonSchema(sectionDef, requiredProps) {
        return {
            type: 'object',
            required: requiredProps,
            additionalProperties: false,
            properties: sectionDef,
        };
    }

    /**
     * Generates a valid JSON Schema for a single wide event by merging with base event.
     * The output is a valid JSON Schema that can validate wide event data.
     * @param {string} eventName - The event name
     * @param {object} eventDef - The event-specific definition
     * @param {object} baseEvent - The base event template
     * @returns {object} Valid JSON Schema for this event
     */
    #generateEventJsonSchema(eventName, eventDef, baseEvent) {
        // Get base version for combining with event version
        const baseVersion = baseEvent.meta?.version?.value;
        const eventVersion = eventDef.meta.version;
        const combinedVersion = `${baseVersion}.${eventVersion}`;

        // Determine required top-level properties
        const requiredProps = ['meta', 'global', 'feature'];
        if (baseEvent.app) requiredProps.push('app');
        if (eventDef.context) requiredProps.push('context');

        // Build properties object
        const properties = {};

        // meta section - use const values for type and version
        properties.meta = {
            type: 'object',
            required: ['type', 'version'],
            additionalProperties: false,
            properties: {
                type: { const: eventDef.meta.type },
                version: { const: combinedVersion },
            },
        };

        // app section from base_event (if present)
        if (baseEvent.app) {
            const appProps = JSON.parse(JSON.stringify(baseEvent.app));
            const appRequired = Object.keys(appProps);
            properties.app = this.#wrapSectionAsJsonSchema(appProps, appRequired);
        }

        // global section from base_event
        const globalProps = JSON.parse(JSON.stringify(baseEvent.global));
        const globalRequired = Object.keys(globalProps);
        properties.global = this.#wrapSectionAsJsonSchema(globalProps, globalRequired);

        // feature section - merge base structure with event-specific values
        const featureNameDef = {
            ...baseEvent.feature?.name,
            enum: [eventDef.feature?.name],
        };
        const featureStatusDef = {
            ...baseEvent.feature?.status,
            enum: eventDef.feature?.status,
        };

        // Expand shortcuts in feature.data.ext
        const eventData = eventDef.feature?.data || { ext: {} };
        const expandedExt = this.#expandPropertiesShortcuts(eventData.ext || {});

        const extProperties = {
            type: 'object',
            additionalProperties: false,
            properties: expandedExt,
        };

        const dataProperties = { ext: extProperties };
        const dataRequired = ['ext'];

        // Include error if present in event data
        if (eventData.error) {
            dataProperties.error = {
                type: 'object',
                required: ['domain', 'code'],
                additionalProperties: false,
                properties: eventData.error,
            };
        }

        // Include any other properties defined directly under feature.data
        for (const [key, value] of Object.entries(eventData)) {
            if (key === 'ext' || key === 'error') continue;
            dataProperties[key] = value;
        }

        const featureDataDef = {
            type: 'object',
            required: dataRequired,
            additionalProperties: false,
            properties: dataProperties,
        };

        properties.feature = {
            type: 'object',
            required: ['name', 'status', 'data'],
            additionalProperties: false,
            properties: {
                name: featureNameDef,
                status: featureStatusDef,
                data: featureDataDef,
            },
        };

        // context section (optional) - transform array to enum
        if (eventDef.context) {
            const contextNameDef = {
                ...baseEvent.context?.name,
                enum: eventDef.context,
            };
            properties.context = {
                type: 'object',
                required: ['name'],
                additionalProperties: false,
                properties: {
                    name: contextNameDef,
                },
            };
        }

        // Build the complete JSON Schema
        return {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            description: eventDef.description,
            $comment: JSON.stringify({ owners: eventDef.owners }),
            type: 'object',
            required: requiredProps,
            additionalProperties: false,
            properties,
        };
    }

    /**
     * Generates valid JSON Schemas for wide events by merging event definitions with base event.
     * Each generated schema is a valid JSON Schema that can validate wide event data.
     * @param {object} wideEvents - The wide event definitions
     * @param {object} baseEvent - The base event template (required)
     * @param {string[]} errors - array to collect validation errors
     * @returns {object} Generated JSON Schemas keyed by event name
     */
    generateWideEventSchemas(wideEvents, baseEvent, errors) {
        // Validate base_event has required version
        const baseVersion = baseEvent.meta?.version?.value;
        if (baseVersion === undefined) {
            throw new Error("base_event.json must have 'meta.version.value' defined");
        }

        const generatedSchemas = {};
        const ajvMetaSchema = this._ajv.compile(wideEventSchema);

        for (const [eventName, eventDef] of Object.entries(wideEvents)) {
            if (eventDef.app) {
                const error = `${eventName}: 'app' section should not be defined in event - it comes from base_event.json`;
                errors.push(error);
            }
            if (eventDef.global) {
                const error = `${eventName}: 'global' section should not be defined in event - it comes from base_event.json`;
                errors.push(error);
            }

            const generatedSchema = this.#generateEventJsonSchema(eventName, eventDef, baseEvent);

            // Validate generated schema against metaschema
            if (!ajvMetaSchema(generatedSchema)) {
                const error = `${eventName}: Generated schema does not match metaschema - ${formatAjvErrors(ajvMetaSchema.errors).join(
                    '; ',
                )}`;
                errors.push(error);
            }

            // Verify generated schema is a valid JSON Schema by compiling it
            try {
                this._ajv.compile(/** @type {import('ajv').AnySchema} */ (generatedSchema));
            } catch (error) {
                const errorMessage = `${eventName}: Generated schema is not valid JSON Schema - ${error.message}`;
                errors.push(errorMessage);
            }

            generatedSchemas[eventName] = generatedSchema;
        }

        return generatedSchemas;
    }

    /**
     * Validates wide event definition and generates JSON Schemas.
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

        // 1. Generate JSON Schemas by merging with base event
        let generatedSchemas;
        try {
            generatedSchemas = this.generateWideEventSchemas(wideEvents, baseEvent, errors);
        } catch (error) {
            return { errors: [error.message], generatedSchemas: {} };
        }

        // 2. Additional checks: duplicates and owner validation
        for (const [eventName] of Object.entries(/** @type {Record<string, any>} */ (generatedSchemas))) {
            // Check duplicates using the event meta.type
            const eventType = wideEvents?.[eventName]?.meta?.type;
            if (eventType) {
                if (this._definedPrefixes.has(eventType)) {
                    errors.push(`${eventType} --> Conflicting/duplicated definitions found!`);
                } else {
                    this._definedPrefixes.add(eventType);
                }
            }

            // Check owners (stored in x-owners)
            if (userMap) {
                const owners = wideEvents?.[eventName]?.owners ?? [];
                for (const owner of owners) {
                    if (!userMap[owner]) {
                        errors.push(`Owner ${owner} for wide event ${eventName} not in list of acceptable github user names`);
                    }
                }
            }
        }

        return { errors, generatedSchemas };
    }
}
