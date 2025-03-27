/**
 * Helper functions for parsing and finding various schema files
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

const RESULTS_DIR = 'pixel_processing_results';

/**
 * Read common parameters
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} common parameters
 */
export function readCommonParams(mainPixelDir) {
    console.log(mainPixelDir);
    return parseFile(path.join(mainPixelDir, 'common_params.json'));
}

/**
 * Read common suffixes
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} common suffixes
 */
export function readCommonSuffixes(mainPixelDir) {
    return parseFile(path.join(mainPixelDir, 'common_suffixes.json'));
}

/**
 * Read ignore parameters
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} ignore parameters
 */
export function readIgnoreParams(mainPixelDir) {
    return parseFile(path.join(mainPixelDir, 'ignore_params.json'));
}

/**
 * Get product definition path
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} product definition path
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
 * Get path to pixel errors encountered during live validation
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} pixel errors path
 */
export function getPixelErrorsPath(mainPixelDir) {
    return path.join(getResultsDir(mainPixelDir), 'pixel_errors.json');
}

/**
 * Get path to undocumented pixels encountered during live validation
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} undocumented pixels path
 */
export function getUndocumentedPixelsPath(mainPixelDir) {
    return path.join(getResultsDir(mainPixelDir), 'undocumented_pixels.json');
}

/**
 * Get tokenized pixels path and creates the path if it doesn't exist
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} tokenized pixels path
 */
export function getTokenizedPixelsPath(mainPixelDir) {
    return path.join(getResultsDir(mainPixelDir), 'tokenized_pixels.json');
}

/**
 * Read tokenized pixel definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} tokenized pixel definitions
 */
export function readTokenizedPixels(mainPixelDir) {
    return parseFile(getTokenizedPixelsPath(mainPixelDir));
}

function parseFile(filePath) {
    return JSON5.parse(fs.readFileSync(filePath).toString());
}
