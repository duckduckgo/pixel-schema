#!/usr/bin/env node

/***
 * Tool for validating pixel debug logs against pixel definitions
 */
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { processPixelDefs, buildLivePixelValidator } from '../src/live_validation_utils.mjs';
import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';
import { MAIN_DIR_ARG, getMainDirPositional } from '../src/args_utils.mjs';

const argv = yargs(hideBin(process.argv))
    .command(`$0 ${MAIN_DIR_ARG} debugLogPath pixelPrefix`, 'Validates a debug log against pixel definitions', (yargs) => {
        return yargs
            .positional(MAIN_DIR_ARG, getMainDirPositional())
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
    .demandOption([MAIN_DIR_ARG, 'debugLogPath', 'pixelPrefix'])
    .parse();

async function main() {
    processPixelDefs(argv.dirPath);
    const { validator } = await buildLivePixelValidator(argv.dirPath);
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

        try {
            const pixelParts = pixelRequest.split('?');
            const pixel = pixelParts[0].split(/\s+/)[0];
            const params = pixelParts[1] ? pixelParts[1].split(/\s+/)[0] : '';
            const result = validator.validatePixel(pixel, params);
            const outputPixel = params ? `'${pixel}?${params}'` : `'${pixel}'`;
            if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_PASSED) {
                console.log(`✅ Valid: ${outputPixel}`);
            } else if (result.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
                console.warn(`⚠️  Undocumented: '${pixel}'`);
            } else if (result.status === PIXEL_VALIDATION_RESULT.OLD_APP_VERSION) {
                console.warn(`⚠️  Old app version, validation skipped: ${outputPixel}`);
            } else if (result.status === PIXEL_VALIDATION_RESULT.VALIDATION_FAILED) {
                console.error(`❌ Invalid: ${outputPixel} - see below for details`);
                for (const errorObj of result.errors) {
                    console.error(`\t${errorObj.error}`);
                }
            }
        } catch (e) {
            console.error(`Invalid log line ${pixelRequest} - skipping validation`);
        }
    }
}

await main();
