/**
 * Helper functions for parsing and finding various schema files
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import { fileURLToPath } from 'url';

const RESULTS_DIR = 'pixel_processing_results';
export const GLOBAL_PIXEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'global_pixel_definitions');

/**
 * Attempt to read and parse a file using JSON5. Tries .json
 * first but will try to json5 if missing.
 *
 * @param {string} filePath - Absolute path to a file
 * @returns {object} Parsed file content
 * @throws Will throw an error if neither file exists.
 */
function parseFile(filePath) {
    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
        // Try the '.json5' fallback
        const { dir, name } = path.parse(filePath);
        const altPath = path.join(dir, `${name}.json5`);
        if (fs.existsSync(altPath)) {
            resolvedPath = altPath;
        } else {
            throw new Error(`Neither ${filePath} nor ${altPath} exist.`);
        }
    }
    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    return JSON5.parse(fileContent);
}

/**
 * Builds a file path from the main pixel directory and the given filename,
 * then parses the file.
 *
 * @param {string} mainPixelDir - path to the main pixels directory
 * @param {string} filename - file name (with extension) to read
 * @returns {object} Parsed file content
 */
function readSchemaFile(mainPixelDir, filename) {
    const filePath = path.join(mainPixelDir, filename);
    return parseFile(filePath);
}

/**
 * Read common parameters
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} common parameters
 */
export function readCommonParams(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'params_dictionary.json');
}

/**
 * Read common properties
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} common properties
 */
export function readCommonProps(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'props_dictionary.json');
}

/**
 * Read common suffixes
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} common suffixes
 */
export function readCommonSuffixes(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'suffixes_dictionary.json');
}

/**
 * Read ignore parameters
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} ignore parameters
 */
export function readIgnoreParams(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'ignore_params.json');
}

/**
 * Read product definition
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} product definition
 */
export function readProductDef(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'product.json');
}

/**
 * Read native experiments definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} native experiments definitions
 */
export function readNativeExperimentsDef(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'native_experiments.json');
}

/**
 * Read search experiments definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} search experiments definitions
 */
export function readSearchExperimentsDef(mainPixelDir) {
    try {
        return readSchemaFile(mainPixelDir, 'search_experiments.json');
    } catch {
        return null;
    }
}

/**
 * Read search pixels definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} search pixels definitions
 */
export function readSearchPixelsDef(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'search_pixels.json');
}

/**
 * Get results directory path and create it if it doesn't exist
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} results directory path
 */
export function getResultsDir(mainPixelDir) {
    const resultsDir = path.join(mainPixelDir, RESULTS_DIR);
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }
    return resultsDir;
}

/**
 * Get path to a file inside the results directory.
 *
 * @param {string} mainPixelDir - path to the main pixels directory
 * @param {string} filename - file name within the results directory
 * @returns {string} Absolute path to the file in results
 */
function getResultsFilePath(mainPixelDir, filename) {
    return path.join(getResultsDir(mainPixelDir), filename);
}

/**
 * Get path to pixel errors encountered during live validation
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} pixel errors path
 */
export function getPixelErrorsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'pixel_errors.json');
}

/**
 * Get path to undocumented pixels encountered during live validation
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} undocumented pixels path
 */
export function getUndocumentedPixelsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'undocumented_pixels.json');
}

/**
 * Get tokenized pixels path
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} tokenized pixels path
 */
export function getTokenizedPixelsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'tokenized_pixels.json');
}

/**
 * Read tokenized pixel definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} tokenized pixel definitions
 */
export function readTokenizedPixels(mainPixelDir) {
    return parseFile(getTokenizedPixelsPath(mainPixelDir));
}

/**
 * Read base event definition for wide events
 * @param {string} wideEventsDir - path to the wide_events directory
 * @returns {object | null} base event definition or null if not found
 */
export function readBaseEvent(wideEventsDir) {
    const baseEventPath = path.join(wideEventsDir, 'base_event.json');
    if (fs.existsSync(baseEventPath)) {
        return JSON5.parse(fs.readFileSync(baseEventPath, 'utf8'));
    }
    return null;
}

/**
 * Get generated schemas directory path and create it if it doesn't exist
 * @param {string} wideEventsDir - path to the wide_events directory
 * @returns {string} generated schemas directory path
 */
export function getGeneratedSchemasDir(wideEventsDir) {
    const generatedSchemasDir = path.join(wideEventsDir, 'generated_schemas');
    if (!fs.existsSync(generatedSchemasDir)) {
        fs.mkdirSync(generatedSchemasDir, { recursive: true });
    }
    return generatedSchemasDir;
}

/**
 * Write a generated wide event schema to the generated_schemas directory
 * @param {string} wideEventsDir - path to the wide_events directory
 * @param {string} eventName - name of the wide event
 * @param {object} schema - the generated schema to write
 */
export function writeGeneratedSchema(wideEventsDir, eventName, schema) {
    const generatedSchemasDir = getGeneratedSchemasDir(wideEventsDir);
    // Extract version from schema to include in filename
    const version = schema.meta?.version;
    const filename = version ? `${eventName}-${version}.json` : `${eventName}.json`;
    const schemaPath = path.join(generatedSchemasDir, filename);
    // Wrap event in { eventName: schema } structure for the output file
    const schemaObj = { [eventName]: schema };
    fs.writeFileSync(schemaPath, JSON.stringify(schemaObj, null, 4));
}

/**
 * Write all generated wide event schemas to the generated_schemas directory
 * @param {string} wideEventsDir - path to the wide_events directory
 * @param {object} schemas - object containing all generated schemas keyed by event name
 */
export function writeAllGeneratedSchemas(wideEventsDir, schemas) {
    for (const [eventName, schemaDef] of Object.entries(schemas)) {
        writeGeneratedSchema(wideEventsDir, eventName, schemaDef);
    }
}
