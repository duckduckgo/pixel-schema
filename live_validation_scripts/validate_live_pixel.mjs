#!/usr/bin/env node

import csv from 'csv-parser';
import fs from 'fs';
import JSON5 from 'json5';

import { getArgParserWithCsv } from '../src/args_utils.mjs';
import * as fileUtils from '../src/file_utils.mjs';
import { buildLivePixelValidator } from '../src/live_validation_utils.mjs';
import { PIXEL_DELIMITER, PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';

const NUM_EXAMPLE_ERRORS = 5;

const argv = getArgParserWithCsv('Validates pixels from the provided CSV file', 'path to CSV file containing pixels to validate').parse();
const undocumentedPixels = new Set();
const pixelErrors = {};

async function main(mainDir, csvFile) {
    console.log(`Validating live pixels in ${csvFile} against definitions from ${mainDir}`);

    const { validator: liveValidator, pixelsConfigDir, productDef } = await buildLivePixelValidator(mainDir);
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

            // The CSV version column contains either a pixel parameter token or the app version from the request header.
            const versionKey = productDef.target.key ?? null;
            let headerVersion = null;
            if (versionKey) {
                const versionColumnValue = typeof row.version === 'string' ? row.version.trim() : '';
                const explicitVersionPrefix = `${versionKey}=`;
                const hasTargetVersionParam = parsedParams.some((param) => param.startsWith(explicitVersionPrefix));
                // Reattach an explicit version token when this row's params do not include it.
                if (!hasTargetVersionParam && versionColumnValue.startsWith(explicitVersionPrefix)) {
                    parsedParams = parsedParams.concat(versionColumnValue);
                } else if (!hasTargetVersionParam && versionColumnValue && !versionColumnValue.includes('=')) {
                    // A bare header version is request metadata, not a synthetic pixel parameter.
                    headerVersion = versionColumnValue;
                }
            }
            const paramsUrlFormat = parsedParams.join('&');

            const result = liveValidator.validatePixel(pixelRequestFormat, paramsUrlFormat, headerVersion);
            saveResult(pixelRequestFormat, result);
        })
        .on('end', async () => {
            console.log(`\nDone.\nTotal pixels processed: ${processedPixels.toLocaleString('en-US')}`);
            console.log(`Undocumented pixels: ${undocumentedPixels.size.toLocaleString('en-US')}`);
            console.log(`Pixels with validation errors: ${Object.keys(pixelErrors).length.toLocaleString('en-US')}`);

            fs.writeFileSync(fileUtils.getUndocumentedPixelsPath(pixelsConfigDir), JSON.stringify(Array.from(undocumentedPixels), null, 4));
            fs.writeFileSync(fileUtils.getPixelErrorsPath(pixelsConfigDir), JSON.stringify(pixelErrors, setReplacer, 4));
            console.log(`Validation results saved to ${fileUtils.getResultsDir(pixelsConfigDir)}`);
        });
}

function saveResult(pixelRequestFormat, result) {
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

main(argv.dirPath, argv.csvFile).catch((err) => {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
