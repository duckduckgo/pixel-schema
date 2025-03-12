/**
 * Helper functions for parsing and finding various schema files
 */

import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

/**
 * Get tokenized pixels path
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {string} tokenized pixels path
 */
export function getTokenizedPixelsPath(mainPixelDir) {
    return path.join(mainPixelDir, 'tokenized_pixels.json');
}

/** 
 * Get tokenized pixel definitions
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} tokenized pixel definitions
 */
export function getTokenizedPixels(mainPixelDir) {
    return JSON5.parse(fs.readFileSync(getTokenizedPixelsPath(mainPixelDir)));
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
 * Get product definition
 * @param {string} mainPixelDir - path to the main pixels directory
 * @returns {object} product definition
 */
export function getProductDef(mainPixelDir) {
    return JSON5.parse(fs.readFileSync(getProductDefPath(mainPixelDir)));
}
