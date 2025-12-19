import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import traverse from 'json-schema-traverse';
import { matchSearchExperiment, mergeParameters } from '../src/pixel_utils.mjs';

/** @typedef {import('ajv').ValidateFunction} ValidateFunction */

/**
 * Validator for pixel parameters and suffixes:
 * 1) ensures they can be used as schemas themselves to validate live pixels
 * 2) validates shortcuts
 * 3) validates live pixels
 */
export class ParamsValidator {
    // eslint-disable-next-line new-cap
    #ajv = new Ajv2020.default({ allErrors: true, coerceTypes: true, strict: true, allowUnionTypes: true });
    #commonParams;
    #commonSuffixes;
    #ignoreParams;
    #searchExpParams;

    /**
     *
     * @param {object} commonParams contains params that follow the schemas/param_schema.json5 type.
     * @param {object} commonSuffixes contains suffixes that follow the schemas/suffix_schema.json5 type.
     * @param {object} ignoreParams contains params that follow the schemas/param_schema.json5 type.
     */
    constructor(commonParams, commonSuffixes, ignoreParams, searchExpParams = {}) {
        this.#commonParams = commonParams;
        this.#commonSuffixes = commonSuffixes;
        this.#ignoreParams = Object.values(ignoreParams);
        this.#searchExpParams = searchExpParams;

        addFormats.default(this.#ajv);
        this.#ajv.addKeyword('key');
        this.#ajv.addKeyword('keyPattern');
        this.#ajv.addKeyword('encoding');
    }

    /**
     * Helper function to replace shortcuts
     * @param {string} item - shortcut to a param/suffix
     * @param {*} common - object containing common params/suffixes
     * @returns updated param/suffix
     */
    replaceCommonPlaceholder(item, common) {
        if (!common[item]) throw new Error(`invalid shortcut '${item}' - please update common params/suffixes`);

        return common[item];
    }

    /**
     * Updates enum values to strings
     * This is needed to ensure cases like enum = [1, 2, 3] can be properly validated
     * against live pixels (which will be strings)
     * @param {*} item - param/suffix
     */
    castEnumsToString(item) {
        if (item.enum && item.type === undefined) {
            item.enum = item.enum.map((val) => val.toString());
        }
    }

    /**
     * Helper function to replace shortcuts, ensure String types by default, and disallow additionalProperties
     * @param {*} item - shortcut or a param/suffix
     * @param {*} common - object containing common params/suffixes
     * @returns updated param/suffix
     */
    getUpdatedItem(item, common) {
        // If item is a string, replace it with the common definition
        // We must clone the object to avoid modifying the original common definition
        let updatedItem = typeof item === 'string' ? JSON.parse(JSON.stringify(this.replaceCommonPlaceholder(item, common))) : item;
        
        this.castEnumsToString(updatedItem);

        // default type is string
        updatedItem.type = updatedItem.type || 'string';

        traverse(updatedItem, (schema) => {
            // Explicitly disallow additionalProperties for obj-params
            if (schema.type !== 'object') return;

            if (schema.additionalProperties) {
                throw new Error(`additionalProperties are not allowed`);
            }
            schema.additionalProperties = false;
        });

        return updatedItem;
    }

    /**
     * Replaces shortcuts to common suffixes and compiles the suffix schema.
     * Supports either:
     *  - a single ordered list of suffixes, e.g. ['a','b','c']
     *  - or a list of alternative ordered lists, e.g. [['a','b','c'], ['b','c']]
     * In the latter case, anyOf is used to allow any of the sequences.
     * @param {Array|Array[]|undefined} suffixes
     * @returns {ValidateFunction} an ajv compiled schema
     * @throws if any errors are found
     */
    compileSuffixesSchema(suffixes) {
        if (!suffixes) return this.#ajv.compile({});

        const buildSequenceSchema = (sequence) => {
            const properties = {};
            let idx = 0;
            sequence.forEach((item) => {
                const suffix = this.getUpdatedItem(item, this.#commonSuffixes);
                if (suffix.key) {
                    // Static token in the pixel name
                    properties[idx] = { enum: [suffix.key] };
                    idx++;
                }
                properties[idx] = suffix;
                idx++;
            });

            return {
                type: 'object',
                properties,
                additionalProperties: false,
            };
        };

        if (!Array.isArray(suffixes)) {
            throw new Error('suffixes must be an array (either a list or a list of lists)');
        }

        const containsArrays = suffixes.some(Array.isArray);
        const isArrayOfArrays = containsArrays && suffixes.every(Array.isArray);

        if (containsArrays && !isArrayOfArrays) {
            throw new Error('Invalid suffixes definition: when using nested arrays, provide only arrays of suffix sequences.');
        }

        if (isArrayOfArrays) {
            const schemas = suffixes.map((seq) => buildSequenceSchema(seq));
            return this.#ajv.compile({ anyOf: schemas });
        }

        // Flat, single sequence
        return this.#ajv.compile(buildSequenceSchema(suffixes));
    }

    /**
     * Compiles provided parameters into an AJV schema
     * @param {Object[]|undefined} parameters
     * @param {string} [pixelPrefix] - The pixel prefix, used to check for search experiment params.
     * @returns {Object} schemas - resultant compiled AJV schema
     * @throws if any errors are found
     */
    compileParamsSchema(parameters, pixelPrefix = '') {
        parameters = parameters || []; // handle undefined params

        let extraParams = this.#ignoreParams || [];

        if (this.#searchExpParams?.enabled === true) {
            const [, matchValue] = matchSearchExperiment(pixelPrefix, this.#searchExpParams.expPixels);
            if (matchValue === true) {
                extraParams = mergeParameters(extraParams, Object.values(this.#searchExpParams.expDefs));
            }
        }

        // combine params with extraParams, avoiding duplicates (parameters take precedence)
        const combinedParams = mergeParameters(parameters, extraParams);
        if (!combinedParams.length) return this.#ajv.compile({});

        const properties = {};
        const patternProperties = {};
        combinedParams
            .map((param) => this.getUpdatedItem(param, this.#commonParams))
            .forEach((param) => {
                if (param.keyPattern) {
                    if (patternProperties[param.keyPattern]) {
                        throw new Error(`duplicate keyPattern '${param.keyPattern}' found!`);
                    }
                    patternProperties[param.keyPattern] = param;
                } else {
                    if (properties[param.key]) {
                        throw new Error(`duplicate key '${param.key}' found!`);
                    }
                    properties[param.key] = param;
                }
            });

        const pixelParams = {
            type: 'object',
            properties,
            patternProperties,
            additionalProperties: false,
        };

        return this.#ajv.compile(pixelParams);
    }

    /** EXPERIMENTS */
    /**
     * Compiles a single experiment metric definition into an AJV validator.
     * @param {object} metricDef - Schema fragment describing the metric parameters.
     * @returns {ValidateFunction} AJV validator for the supplied metric definition.
     */
    compileExperimentMetricSchema(metricDef) {
        return this.#ajv.compile(this.getUpdatedItem(metricDef, {}));
    }

    /**
     * Compiles the set of shared experiment parameters into an AJV validator.
     * @returns {ValidateFunction} AJV validator for the common experiment params.
     */
    compileCommonExperimentParamsSchema() {
        const expPrams = [
            {
                key: 'enrollmentDate',
                anyOf: [
                    {
                        format: 'date',
                        type: 'string',
                    },
                    {
                        pattern: '^[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}$',
                        type: 'string',
                    },
                    {
                        pattern: '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$',
                        type: 'string',
                    },
                ],
            },
            {
                key: 'conversionWindowDays',
                pattern: '^([0-9]+(-[0-9]+)?)$',
            },
        ];

        return this.compileParamsSchema(expPrams);
    }
}
