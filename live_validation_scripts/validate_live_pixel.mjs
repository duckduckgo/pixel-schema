#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();

function main(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const productDef = fileUtils.readProductDef(mainDir);
    const commonParams = fileUtils.readCommonParams(mainDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(mainDir);

    const tokenizedPixels = fileUtils.readTokenizedPixels(mainDir);
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);
    const ignoreParams = fileUtils.readIgnoreParams(mainDir);

    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, ignoreParams, paramsValidator);
    let processedPixels = 0;
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            processedPixels++;
            if (processedPixels % 100000 === 0) {
                console.log(`...Processing row ${processedPixels.toLocaleString('en-US')}...`);
            }
            liveValidator.validatePixel(row.pixel, row.params);
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels processed: ${processedPixels.toLocaleString('en-US')}`);
            console.log(`Undocumented pixels: ${liveValidator.undocumentedPixels.size.toLocaleString('en-US')}`);

            fs.writeFileSync(
                fileUtils.getUndocumentedPixelsPath(mainDir),
                JSON.stringify(Array.from(liveValidator.undocumentedPixels), null, 4),
            );
            fs.writeFileSync(fileUtils.getPixelErrorsPath(mainDir), JSON.stringify(liveValidator.pixelErrors, setReplacer, 4));
            console.log(`Validation results saved to ${fileUtils.getResultsDir(mainDir)}`);
        });
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

main(argv.dirPath, argv.csvFile);
