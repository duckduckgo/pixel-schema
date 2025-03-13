import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { formatAjvErrors } from './error_utils.mjs';
import { fileURLToPath } from 'url';
import { ParamsValidator } from './params_validator.mjs';

const schemasPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const pixelSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'pixel_schema.json5')));
const paramsSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'param_schema.json5')));
const suffixSchema = JSON5.parse(fs.readFileSync(path.join(schemasPath, 'suffix_schema.json5')));

/**
 * Validator for the overall pixel definition - ensures pixels and common params/suffixes conform to their schema
 */
export class DefinitionsValidator {
    #ajvValidatePixels;
    #ajvValidateParams;
    #ajvValidateSuffixes;

    #commonParams;
    #commonSuffixes;

    #paramsValidator;
    #ajv = new Ajv2020({ allErrors: true });

    #definedPrefixes = new Set();

    /**
     * @param {*} commonParams - object containing common parameters
     * @param {*} commonSuffixes - object containing common suffixes
     */
    constructor(commonParams, commonSuffixes) {
        this.#commonParams = commonParams;
        this.#commonSuffixes = commonSuffixes;
        this.#paramsValidator = new ParamsValidator(this.#commonParams, this.#commonSuffixes);

        addFormats(this.#ajv);
        this.#ajv.addSchema(paramsSchema);
        this.#ajv.addSchema(suffixSchema);

        this.#ajvValidatePixels = this.#ajv.compile(pixelSchema);
        this.#ajvValidateParams = this.#ajv.compile(paramsSchema);
        this.#ajvValidateSuffixes = this.#ajv.compile(suffixSchema);
    }

    validateCommonParamsDefinition() {
        this.#ajvValidateParams(this.#commonParams);
        return formatAjvErrors(this.#ajvValidateParams.errors);
    }

    validateCommonSuffixesDefinition() {
        this.#ajvValidateSuffixes(this.#commonSuffixes);
        return formatAjvErrors(this.#ajvValidateSuffixes.errors);
    }

    /**
     * Validates the full pixel definition, including shortcuts, parameters, and suffixes
     *
     * @param {*} pixelsDef - object containing multiple pixel definitions
     * @returns {Array<string>} - array of error messages
     */
    validatePixelsDefinition(pixelsDef) {
        // 1) Validate that pixel definition conforms to schema
        if (!this.#ajvValidatePixels(pixelsDef)) {
            // Doesn't make sense to check the rest if main definition is invalid
            return formatAjvErrors(this.#ajvValidatePixels.errors);
        }

        // 2) Validate that:
        // (a) there are no duplicate prefixes and
        // (b) shortcuts, params, and suffixes can be compiled into a separate schema
        const errors = [];
        Object.entries(pixelsDef).forEach(([pixelName, pixelDef]) => {
            if (this.#definedPrefixes.has(pixelName)) {
                errors.push(`${pixelName} --> Conflicting/duplicated definitions found!`);
                return;
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
