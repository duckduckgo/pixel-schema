import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import traverse from 'json-schema-traverse';

/**
 * Validator for pixel parameters and suffixes:
 * 1) ensures they can be used as schemas themselves to validate live pixels
 * 2) validates shortcuts
 * 3) validates live pixels
 */
export class ParamsValidator {
    #ajv = new Ajv2020({ allErrors: true, coerceTypes: true, strict: true, allowUnionTypes: true });
    #commonParams;
    #commonSuffixes;
    #ignoreParams;

    /**
     * 
     * @param {object} commonParams contains params that follow the schemas/param_schema.json5 type.
     * @param {object} commonSuffixes contains suffixes that follow the schemas/suffix_schema.json5 type. 
     * @param {object} ignoreParams contains params that follow the schemas/param_schema.json5 type. 
     */
    constructor(commonParams, commonSuffixes, ignoreParams) {
        this.#commonParams = commonParams;
        this.#commonSuffixes = commonSuffixes;
        this.#ignoreParams = Object.values(ignoreParams);

        addFormats(this.#ajv);
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
        if (item.enum) {
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
        const updatedItem = typeof item === 'string' ? this.replaceCommonPlaceholder(item, common) : item;
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
     * Replaces shortcuts to common suffixes and compiles the suffix schema
     * @param {Object} suffixes
     * @param {number} startingIdx starting index for the suffixes schema
     * @returns {ValidateFunction} an ajv compiled schema
     * @throws if any errors are found
     */
    compileSuffixesSchema(suffixes, startingIdx = 0) {
        if (!suffixes) return this.#ajv.compile({});

        const properties = {};
        let idx = startingIdx;
        suffixes.forEach((item) => {
            const suffix = this.getUpdatedItem(item, this.#commonSuffixes);
            if (suffix.key) {
                // If suffix contains a key, we set it as an enum
                // to use as a static portion of the pixel name
                properties[idx] = { enum: [suffix.key] };
                idx++;
            }

            properties[idx] = suffix;
            idx++;
        });

        const pixelNameSchema = {
            type: 'object',
            properties,
            additionalProperties: false,
        };

        return this.#ajv.compile(pixelNameSchema);
    }

    /**
     * Compiles provided parameters into an AJV schema
     * @param {Object[]} parameters
     * @returns {Object} schemas - resultant compiled AJV schema
     * @throws if any errors are found
     */
    compileParamsSchema(parameters) {
        const combinedParams = [...(parameters || []), ...this.#ignoreParams];
        if (!combinedParams) return this.#ajv.compile({});

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
    compileExperimentMetricSchema(metricDef) {
        return this.#ajv.compile(this.getUpdatedItem(metricDef, {}));
    }

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
                        pattern: "^([0-9]{2}|[0-9]{4})\/[0-9]{1,2}\/[0-9]{1,2}$",
                        type: 'string',
                    }
                ]
            },
            {
                key: 'conversionWindowDays',
                pattern: '^([0-9]+(-[0-9]+)?)$',
            },
        ]

        return this.compileParamsSchema(expPrams);
    }
}
