#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();

function main(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const productDef = fileUtils.readProductDef(mainDir);
    const experimentsDef = fileUtils.readExperimentsDef(mainDir);
    const commonParams = fileUtils.readCommonParams(mainDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(mainDir);
    const tokenizedPixels = fileUtils.readTokenizedPixels(mainDir);

    const pixelIgnoreParams = fileUtils.readIgnoreParams(mainDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const ignoreParams = [...(Object.values(pixelIgnoreParams) || []), ...Object.values(globalIgnoreParams)];
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes, ignoreParams);

    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, experimentsDef, paramsValidator);

    const uniquePixels = new Set();
    const undocumentedPixels = new Set();
    const documentedPixelsWithOutdatedDefinitions = new Set();
    const documentedPixelsWithErrors = new Set();
    const documentedPixelsWithSuccessfulValidations = new Set();

    let processedPixels = 0;
    let accessesUndocumented = 0;
    let accessesDocumentedWithErrors = 0;
    let accessesDocumentedWithSuccessfulValidations = 0;
    let accessesDocumentedWithOutdatedDefinitions = 0;

    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            processedPixels++;
            if (processedPixels % 100000 === 0) {
                console.log(`...Processing row ${processedPixels.toLocaleString('en-US')}...`);
            }
            const pixelRequestFormat = row.pixel.replaceAll('.', PIXEL_DELIMITER);
            const paramsUrlFormat = JSON5.parse(row.params).join('&');
            const ret = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat);
            uniquePixels.add(pixelRequestFormat);
            if (ret === LivePixelsValidator.PIXEL_UNDOCUMENTED) {
                accessesUndocumented++;
                undocumentedPixels.add(pixelRequestFormat);
            } else if (ret === LivePixelsValidator.PIXEL_DEFINITION_OUTDATED) {
                accessesDocumentedWithOutdatedDefinitions++;
                documentedPixelsWithOutdatedDefinitions.add(pixelRequestFormat);
            } else if (ret === LivePixelsValidator.PIXEL_VALIDATION_FAILED) {
                accessesDocumentedWithErrors++;
                documentedPixelsWithErrors.add(pixelRequestFormat);
            } else if (ret === LivePixelsValidator.PIXEL_VALIDATION_PASSED) {
                accessesDocumentedWithSuccessfulValidations++;
                documentedPixelsWithSuccessfulValidations.add(pixelRequestFormat);
            }
        })
        .on('end', async () => {
            
            // Two original output lines; don't remove for now or tests will fail
            console.log(`\nDone.\nTotal pixels processed: ${processedPixels.toLocaleString('en-US')}`);
            console.log(`Undocumented pixels: ${liveValidator.undocumentedPixels.size.toLocaleString('en-US')}`);

            console.log(`Unique pixels\t${uniquePixels.size.toLocaleString('en-US')} accesses ${processedPixels.toLocaleString('en-US')}`);

            let percent = (undocumentedPixels.size / uniquePixels.size) * 100;
            let percentAccessed = (accessesUndocumented / processedPixels) * 100;
            console.log(
                `Undocumented pixels (unique)\t${undocumentedPixels.size.toLocaleString('en-US')} percent (${percent.toFixed(2)}%) accesses ${accessesUndocumented.toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
            );

            percent = (documentedPixelsWithOutdatedDefinitions.size / uniquePixels.size) * 100;
            percentAccessed = (accessesDocumentedWithOutdatedDefinitions / processedPixels) * 100;
            console.log(
                `Documented pixels with outdated definitions\t${documentedPixelsWithOutdatedDefinitions.size.toLocaleString('en-US')} percent(${percent.toFixed(2)} %) accesses ${accessesDocumentedWithOutdatedDefinitions.toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
            );

            percent = (documentedPixelsWithErrors.size / uniquePixels.size) * 100;
            percentAccessed = (accessesDocumentedWithErrors / processedPixels) * 100;
            console.log(
                `Documented pixels with errors\t${documentedPixelsWithErrors.size.toLocaleString('en-US')} percent (${percent.toFixed(2)}%) accesses ${accessesDocumentedWithErrors.toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
            );

            percent = (documentedPixelsWithSuccessfulValidations.size / uniquePixels.size) * 100;
            percentAccessed = (accessesDocumentedWithSuccessfulValidations / processedPixels) * 100;
            console.log(
                `Documented pixels with successful validations\t${documentedPixelsWithSuccessfulValidations.size.toLocaleString('en-US')} percent (${percent.toFixed(2)}%) accesses ${accessesDocumentedWithSuccessfulValidations.toLocaleString('en-US')} percentAccessed (${percentAccessed.toFixed(2)}%)`,
            );

            // Other stats?
            // Documented pixels not seen?

            try {
                fs.writeFileSync(
                    fileUtils.getUndocumentedPixelsPath(mainDir),
                    JSON.stringify(Array.from(liveValidator.undocumentedPixels), null, 4),
                );
            } catch (err) {
                if (err instanceof RangeError) {
                    console.error(
                        'Error: List of undocumented pixels is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                    );
                    process.exit(1);
                } else {
                    throw err;
                }
            }

            /*
                This script will fail if there are too many errors to write out the JSON.
                For now we could limit the validation to the last 7 days in 
                clickhouse_fetcher.mjs and that keeps the JSON at an acceptable size. 
                Longer term we can revisit this for a more robust solution.

            */
            try {
                fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(liveValidator.pixelErrors, setReplacer, 4));
            } catch (err) {
                if (err instanceof RangeError) {
                    console.error(
                        'Error: List of pixel errors is too large to write to JSON. Try limiting the validation range (DAYS_TO_FETCH).',
                    );
                    process.exit(1);
                } else {
                    throw err;
                }
            }
            console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
        });
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        return Array.from(value);
        // return Array.from(value).slice(0,10);
    }
    return value;
}

main(argv.dirPath, argv.csvFile);
