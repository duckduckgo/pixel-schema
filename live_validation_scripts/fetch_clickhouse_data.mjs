#!/usr/bin/env node
import { MAIN_DIR_ARG, getMainDirPositional } from '../src/args_utils.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
    .command(`$0 [${MAIN_DIR_ARG}]`, 'Fetches pixel data from Clickhouse into a temporary CSV file', (yargs) => {
        return yargs.positional(MAIN_DIR_ARG, getMainDirPositional())
            .positional('pixelPrefix', {
                describe: 'pixel to match against with LIKE operator',
                type: 'string',
                default: '',
            });
    })
    .demandOption(MAIN_DIR_ARG)
    .parse();

preparePixelsCSV(argv.dirPath, argv.pixelPrefix);
