/**
 * Helper functions for parsing and finding various schema files
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import { fileURLToPath } from 'url';

const RESULTS_DIR = 'pixel_processing_results';
export const GLOBAL_PIXEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'global_pixel_definitions');

function checkFileExists(filePath) {
    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
        // Try the '.json5' fallback
        const { dir, name } = path.parse(filePath);
        const altPath = path.join(dir, `${name}.json5`);
        if (fs.existsSync(altPath)) {
            resolvedPath = altPath;
            return true;
        } else {
            return false;
        }
    }
    return true;
}

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
 * Read experiments definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} experiments definitions
 */
export function readExperimentsDef(mainPixelDir) {
    return readSchemaFile(mainPixelDir, 'native_experiments.json');
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
 * Get path to the list of pixels with errors encountered during live validation
 * @param { string } mainPixelDir - path to the main pixels directory
 * @returns { string } pixel errors path
 */
export function getUniqueErrorPixelPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'unique_error_pixels.json');
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
 * Get path to static stats encountered during live validation
 * @param { string } mainPixelDir - path to the main pixels directory
 * @returns { string } static stats path
 */
export function getStaticStatsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'static_stats.json');
}

/**
 * Get path to live stats encountered during live validation
 * @param { string } mainPixelDir - path to the main pixels directory
 * @returns { string } live stats path
 */
export function getLiveStatsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'live_stats.json');
}

/**
 * Get path to pixel errors encountered during live validation
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} pixel errors path
 */
export function getPixelsWithErrorsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'pixels_with_errors.json');
}

/**
 * Get path to all owners encountered during live validation
 * This is a list of all the owners - pairs of owner names and pixel names
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} all owners path
 */
export function getAllOwnersPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'owners.json');
}

/**
 * Get path to all owners with errors encountered during live validation
 * This is a list of all the owners with errors - pairs of owner names and pixel names
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} all owners path
 */
export function getOwnersWithErrorsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'owners_with_errors.json');
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
 * Get path to the list of pixel owners with errors
 * This is a list of all the errors - pairs of invalid owner names and pixel names
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} pixel owner errors path
 */
export function getPixelOwnerErrorsPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'pixel_owner_errors.json');
}

/**
 * Get path to the list of unique owner names not in the map if github usernames to Asana user IDs
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} invalid owners path
 */
export function getInvalidOwnersPath(mainPixelDir) {
    return getResultsFilePath(mainPixelDir, 'invalid_owner_errors.json');
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

export function tokenizedPixelsFileExists(mainPixelDir) {
    return checkFileExists(getTokenizedPixelsPath(mainPixelDir));
}
