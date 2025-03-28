/**
 * Helper functions for parsing and finding various schema files
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

const RESULTS_DIR = 'pixel_processing_results';

/**
 * Attempt to read and parse a file using JSON5. If the given filePath
 * does not exist try switching the extension (.json to .json5 or vice versa).
 *
 * @param {string} filePath - Absolute path to a file
 * @returns {object} Parsed file content
 * @throws Will throw an error if neither file exists.
 */
function parseFile(filePath) {
    let resolvedPath = filePath;
    if (!fs.existsSync(filePath)) {
        const { dir, name, ext } = path.parse(filePath);
        let alternativeExt;
        if (ext === '.json') {
            alternativeExt = '.json5';
        } else if (ext === '.json5') {
            alternativeExt = '.json';
        } else {
            throw new Error(`Unsupported file extension: ${ext}`);
        }
        const altPath = path.join(dir, name + alternativeExt);
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
 * Get product definition path based on mainPixelDir.
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} product definition file path
 */
export function getProductDefPath(mainPixelDir) {
    return path.join(mainPixelDir, 'product.json');
}

/**
 * Read product definition
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} product definition
 */
export function readProductDef(mainPixelDir) {
    return parseFile(getProductDefPath(mainPixelDir));
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
