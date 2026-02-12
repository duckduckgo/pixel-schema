/**
 * Utility functions for live pixel validation
 */
import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import { tokenizePixelDefs } from './tokenizer.mjs';
import { LivePixelsValidator } from './live_pixel_validator.mjs';
import { ParamsValidator } from './params_validator.mjs';
import * as fileUtils from './file_utils.mjs';
import { resolveTargetVersion, parseSearchExperiments, getEnabledSearchExperiments } from './pixel_utils.mjs';

/**
 * @typedef {import('./types.mjs').ProductDefinition} ProductDefinition
 */

/**
 * Processes pixel definitions in the main directory, tokenizing them and writing them to a file.
 * @param {string} mainDir - The main directory containing pixels and wide event definitions.
 */
export function processPixelDefs(mainDir) {
    const tokenizedDefs = {};
    const { pixelsConfigDir, pixelDefsDir } = fileUtils.resolvePixelsDirs(mainDir);

    fs.readdirSync(pixelDefsDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDefsDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());
        tokenizePixelDefs(pixelsDefs, tokenizedDefs);
    });

    // Write out tokenized pixel defs to a file
    const outFile = fileUtils.getTokenizedPixelsPath(pixelsConfigDir);
    console.log(`Writing out tokenized pixel defs to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(tokenizedDefs, null, 4));
}

/**
 * Build a LivePixelsValidator instance from the main pixels directory.
 * @param {string} mainDir - The main directory containing pixels and wide event definitions.
 * @returns {Promise<{validator: LivePixelsValidator, pixelsConfigDir: string, productDef: ProductDefinition}>}
 * A LivePixelsValidator instance, the resolved path to the pixels config directory, and the product definition.
 */
export async function buildLivePixelValidator(mainDir) {
    const { pixelsConfigDir } = fileUtils.resolvePixelsDirs(mainDir);
    const productDef = fileUtils.readProductDef(mainDir);

    // Resolve version (may fetch from URL if versionUrl is specified)
    const resolvedVersion = await resolveTargetVersion(productDef.target);
    if (resolvedVersion) {
        productDef.target.version = resolvedVersion;
        console.log(`Using minimum version: ${resolvedVersion}`);
    } else {
        console.log('No target version specified; skipping version checks.');
    }

    const nativeExperimentsDef = fileUtils.readNativeExperimentsDef(pixelsConfigDir);
    const commonParams = fileUtils.readCommonParams(pixelsConfigDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(pixelsConfigDir);
    const tokenizedPixels = fileUtils.readTokenizedPixels(pixelsConfigDir);

    const pixelIgnoreParams = fileUtils.readIgnoreParams(pixelsConfigDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const ignoreParams = { ...globalIgnoreParams, ...pixelIgnoreParams }; // allow local ignores to override global ones

    // SERP only:
    const searchExperiments = {
        enabled: false,
        expDefs: {},
        expPixels: {},
    };

    if (productDef.searchExperimentsEnabled) {
        const rawSearchExperiments = fileUtils.readSearchExperimentsDef(pixelsConfigDir);
        searchExperiments.expDefs = parseSearchExperiments(rawSearchExperiments);
        const searchPixels = fileUtils.readSearchPixelsDef(pixelsConfigDir);
        searchExperiments.expPixels = getEnabledSearchExperiments(searchPixels);
        console.log(`Loaded ${Object.keys(searchExperiments.expDefs).length} search experiments.`);
        searchExperiments.enabled = true;
    } else {
        console.log('Skipping search experiments.');
    }

    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams, searchExperiments);
    return {
        validator: new LivePixelsValidator(tokenizedPixels, productDef, nativeExperimentsDef, paramsValidator),
        pixelsConfigDir,
        productDef,
    };
}
