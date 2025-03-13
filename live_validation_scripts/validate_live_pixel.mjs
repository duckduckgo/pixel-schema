#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';

import * as fileUtils from '../src/file_utils.mjs';

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate')
    .parse();

function main(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const productDef = fileUtils.getProductDef(mainDir);
    const forceLowerCase = productDef.forceLowerCase;

    const commonParams = fileUtils.getCommonParams(mainDir, forceLowerCase);
    const commonSuffixes = fileUtils.getCommonSuffixes(mainDir, forceLowerCase);
    
    const tokenizedPixels = fileUtils.getTokenizedPixels(mainDir, forceLowerCase);
    const paramsValidator = new ParamsValidator(commonParams, commonSuffixes);
    const ignoreParams = fileUtils.getIgnoreParams(mainDir, forceLowerCase);
    

    const liveValidator = new LivePixelsValidator(tokenizedPixels, productDef, ignoreParams, paramsValidator);
    let processedPixels = 0;
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', (row) => {
            processedPixels++;
            if (processedPixels % 100000 === 0) {
                console.log(`...Processing row ${processedPixels.toLocaleString('en-US')}...`);
            }
            liveValidator.validatePixel(row.pixel, row.request);
        })
        .on('end', async () => {
            console.log(`\nDone processing ${processedPixels.toLocaleString('en-US')} pixels.`);
            console.log(`...Undocumented pixels (${liveValidator.undocumentedPixels.size.toLocaleString('en-US')}):`);
            // console.log(undocumentedPixels);

            const undocumentedPixelsPath = path.join(fileUtils.getResultsDir(mainDir), "undocumentedPixels.json");
            fs.writeFileSync(undocumentedPixelsPath, JSON.stringify(Array.from(liveValidator.undocumentedPixels), null, 4));

            console.log('-----------------');
            // console.log(pixelErrors);
            const pixelErrorsPath = path.join(fileUtils.getResultsDir(mainDir), "pixelErrors.json");
            fs.writeFileSync(pixelErrorsPath, JSON.stringify(liveValidator.pixelErrors, setReplacer, 4));
        });
    
}

function setReplacer(_, value) {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

main(argv.dirPath, argv.csvFile);
