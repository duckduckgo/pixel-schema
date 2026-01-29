#!/usr/bin/env node

/***
 * Tool for validating pixel debug logs against pixel definitions
 */
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { processPixelDefs, buildLivePixelValidator } from '../src/pixel_utils.mjs';
import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';

const argv = yargs(hideBin(process.argv))
    .command('$0 <debugLogPath> <pixelPrefix>', 'Validates a debug log against pixel definitions', (yargs) => {
        return yargs
            .positional('debugLogPath', {
                describe: 'path to debug log file',
                type: 'string',
                demandOption: true,
            })
            .positional('pixelPrefix', {
                describe: 'prefix that precedes pixel name and params',
                type: 'string',
                demandOption: true,
            });
    })
    .demandOption(['debugLogPath', 'pixelPrefix'])
    .parse();

async function main() {
    processPixelDefs('.'); // TODO: take main dir as argument
    const { validator } = await buildLivePixelValidator('.');
    console.log('Validator built');

    const pixelPrefix = argv.pixelPrefix;
    const data = fs.readFileSync(argv.debugLogPath, 'utf8');
    for (const line of data.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(pixelPrefix)) {
            continue;
        }

        const pixelRequest = trimmed.slice(pixelPrefix.length).trim();
        if (!pixelRequest) {
            continue;
        }

        const pixelParts = pixelRequest.split('?');
        const pixel = pixelParts[0];
        const params = pixelParts[1];
        const result = validator.validatePixel(pixel, params);
        if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_PASSED) {
            console.log(`✅ Valid ${pixelRequest}`);
        } else if (result.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
            console.warn(`⚠️  Undocumented '${pixelRequest}'`);
        } else if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_FAILED) {
            console.error(`❌ Invalid ${pixelRequest} - see below for details`);
            for (const errorObj of result.errors) {
                console.error(`\t${errorObj.error}`);
            }
        }
    }
}

await main();
