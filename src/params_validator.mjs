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
    #ajv = new Ajv2020({ allErrors: true, coerceTypes: true });
    #commonParams;
    #commonSuffixes;

    constructor(commonParams, commonSuffixes) {
        this.#commonParams = commonParams;
        this.#commonSuffixes = commonSuffixes;

        addFormats(this.#ajv);
        this.#ajv.addKeyword('key');
        this.#ajv.addKeyword('keyPattern');
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
     * Helper function to replace shortcuts and ensure String types by default
     * @param {*} item - shortcut or a param/suffix
     * @param {*} common - object containing common params/suffixes
     * @returns updated param/suffix
     */
    getUpdatedItem(item, common) {
        const updatedItem = typeof item === 'string' ? this.replaceCommonPlaceholder(item, common) : item;
        this.castEnumsToString(updatedItem);

        // default type is string
        updatedItem.type = updatedItem.type || 'string';
        return updatedItem;
    }

    /**
     * Replaces shortcuts to common suffixes and compiles the suffix schema
     * @param {*} suffixes
     * @returns an ajv compiled schema
     * @throws if any errors are found
     */
    compileSuffixesSchema(suffixes) {
        if (!suffixes) return this.#ajv.compile({});

        const properties = {};
        let idx = 0;
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

    adjustBase64Schema(schema) {
        // Non-object type should get the same treatment as basic params:
        if (!schema.properties) {
            schema = this.getUpdatedItem(schema, {});
            return;
        }

        // Any sub-schema with properties must be of type object and not allow additionalProperties:
        if (schema.type && schema.type !== 'object') {
            throw new Error(`has children with properties whose type is not 'object'`);
        }
        if (schema.additionalProperties) {
            throw new Error(`has children with properties that allow additionalProperties`);
        }

        schema.type = 'object';
        schema.additionalProperties = false;
    }

    /**
     * Modifies provided parameters into proper JSON schemas: TODO
     * @param {Object[]} parameters
     * @returns {Object} schemas - resultant JSON schemas
     * @returns {Object} schemas.regularParamsSchema - schema covering regular parameters
     * @returns {Object} schemas.base64ParamsSchemas - schemas covering base64 params, keyed by param name
     * @throws if any errors are found
     */
    compileParamsSchema(parameters) {
        if (!parameters) return this.#ajv.compile({});

        const properties = {};
        const patternProperties = {};
        const base64ParamsSchemas = {};
        parameters.forEach((origParam) => {
            if (origParam.base64DataSchema) {
                // TODO: will need to have combined Set to keep track of keys between base64 and non-base64
                traverse(origParam.base64DataSchema, (schema) => {
                    try {
                        this.adjustBase64Schema(schema);
                    } catch (error) {
                        throw new Error(`${origParam.key}'s base64DataSchema ${error.message}`);
                    }
                });

                base64ParamsSchemas[origParam.key] = origParam.base64DataSchema;
                return;
            }

            const param = this.getUpdatedItem(origParam, this.#commonParams);
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

        // Compile schemas and return
        Object.entries(base64ParamsSchemas).forEach(([key, base64Schema]) => {
            try {
                base64ParamsSchemas[key] = this.#ajv.compile(base64Schema);
            } catch (error) {
                throw new Error(`${key}'s base64DataSchema is invalid: ${error.message}`);
            }
        });

        const pixelParams = {
            type: 'object',
            properties,
            patternProperties,
            additionalProperties: false,
        };

        return {
            regularParamsSchema: this.#ajv.compile(pixelParams),
            base64ParamsSchemas,
        };
    }
}
