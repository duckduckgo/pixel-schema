#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { parseSearchExperiments, getEnabledSearchExperiments, resolveTargetVersion } from '../src/pixel_utils.mjs';
import { PIXEL_DELIMITER, PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';

const NUM_EXAMPLE_ERRORS = 5;

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();
const detailedValidationOutputFile = process.env.DETAILED_VALIDATION_OUTPUT_FILE || null;
const disableResultSaving = process.env.DISABLE_RESULT_SAVING || false;
const undocumentedPixels = new Set();
const pixelErrors = {};

async function main(mainDir, csvFile, detailedValidationOutputFile = null) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const { pixelsConfigDir } = fileUtils.resolvePixelsDirs(mainDir);

    const productDef = fileUtils.readProductDef(mainDir);

    // Resolve version (may fetch from URL if versionUrl is specified)
    const resolvedVersion = await resolveTargetVersion(productDef.target);
    productDef.target.version = resolvedVersion;
    console.log(`Using minimum version: ${resolvedVersion}`);

    const nativeExperimentsDef = fileUtils.readNativeExperimentsDef(pixelsConfigDir);
    const commonParams = fileUtils.readCommonParams(pixelsConfigDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(pixelsConfigDir);
    const tokenizedPixels = fileUtils.readTokenizedPixels(pixelsConfigDir);

    const pixelIgnoreParams = fileUtils.readIgnoreParams(pixelsConfigDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const ignoreParams = { ...globalIgnoreParams, ...pixelIgnoreParams }; // allow local ignores to override global ones

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
    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, nativeExperimentsDef, paramsValidator);

    const additionalOutputStream = detailedValidationOutputFile ? fs.createWriteStream(detailedValidationOutputFile) : null;

    let processedPixels = 0;
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            processedPixels++;
            if (processedPixels % 100000 === 0) {
                console.log(`...Processing row ${processedPixels.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            let parsedParams = JSON5.parse(row.params);

            // filter out SERP nounces in the form "7128788=7128788"
            // TODO: move this to https://dub.duckduckgo.com/duckduckgo/prefect-etl/blob/main/deployments/pixels_validation.py#L27
            try {
                parsedParams = parsedParams.filter((p) => !p.match(/^\d+=\d*$/));
            } catch (e) {
                console.error(`Error filtering params for pixel ${pixelRequestFormat}: ${parsedParams}`);
                console.error(e);
            }

            // Append version param (e.g. appVersion=1.2.3) when defined in product.json
            const versionKey = productDef.target.key ?? null;
            if (versionKey) {
                // ensure version present in a dedicated CSV column and not already in params
                if (
                    typeof row.version === 'string' &&
                    row.version.trim() !== '' &&
                    parsedParams.every((p) => !p.startsWith(versionKey + '='))
                ) {
                    parsedParams = parsedParams.concat(row.version.trim());
                }
            }
            const paramsUrlFormat = parsedParams.join('&');

            const result = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
            saveResult(pixelRequestFormat, result);
            if (additionalOutputStream) {
                row.status = result.status;
                row.owners = result.owners;
                row.errors = result.errors.map((e) => e.error);
                row.prefix = result.prefixForErrors || result.prefix || '';
                row.params = parsedParams;
                additionalOutputStream.write(JSON.stringify(row) + '\n');
            }
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels processed: ${processedPixels.toLocaleString('en-US')}`);
            console.log(`Undocumented pixels: ${undocumentedPixels.size.toLocaleString('en-US')}`);
            console.log(`Pixels with validation errors: ${Object.keys(pixelErrors).length.toLocaleString('en-US')}`);

            fs.writeFileSync(fileUtils.getUndocumentedPixelsPath(pixelsConfigDir), JSON.stringify(Array.from(undocumentedPixels), null, 4));
            fs.writeFileSync(fileUtils.getPixelErrorsPath(pixelsConfigDir), JSON.stringify(pixelErrors, setReplacer, 4));
            console.log(`Validation results saved to ${fileUtils.getResultsDir(pixelsConfigDir)}`);

            if (additionalOutputStream) {
                console.log(`Detailed validation results saved to ${detailedValidationOutputFile}`);
                additionalOutputStream.end();
            }
        });
}

function saveResult(pixelRequestFormat, result) {
    if (disableResultSaving) {
        return;
    }
    if (result.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
        undocumentedPixels.add(pixelRequestFormat);
    } else if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_FAILED) {
        const prefix = result.prefixForErrors;
        if (!prefix || !result.errors || !result.errors.length) {
            console.error(`Error: Received invalid result (no prefix or errors) for pixel ${pixelRequestFormat}:`);
            console.error(result);
            process.exit(1);
        }

        if (!pixelErrors[prefix]) {
            pixelErrors[prefix] = {
                owners: result.owners,
            };
        }

        for (const errorWithExample of result.errors) {
            if (!pixelErrors[prefix][errorWithExample.error]) {
                pixelErrors[prefix][errorWithExample.error] = new Set();
            }
            pixelErrors[prefix][errorWithExample.error].add(errorWithExample.example);
        }
    }
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        return Array.from(value).slice(0, NUM_EXAMPLE_ERRORS);
    }
    return value;
}

main(argv.dirPath, argv.csvFile, detailedValidationOutputFile).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
