import fs from 'fs';
import yargs from 'yargs';

import { hideBin } from 'yargs/helpers';
import { PIXELS_TMP_CSV } from './constants.mjs';

export function getArgParser(description) {
    return yargs(hideBin(process.argv))
        .command('$0 [dirPath]', description, (yargs) => {
            return yargs.positional('dirPath', {
                describe: 'path to directory containing the pixels folder and common_[params/suffixes].json in the root',
                type: 'string',
                demandOption: true,
                coerce: (dirPath) => {
                    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                        throw new Error(`Directory path ${dirPath} does not exist!`);
                    }
                    return dirPath;
                },
            });
        })
        .demandOption('dirPath');
}

export function getArgParserWithCsv(description, csvFileDescription) {
    return yargs(hideBin(process.argv))
        .command('$0 [dirPath] [csvFile]', description, (yargs) => {
            return yargs
                .positional('dirPath', {
                    describe: 'path to directory containing the pixels folder and common_[params/suffixes].json in the root',
                    type: 'string',
                    demandOption: true,
                    coerce: (dirPath) => {
                        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                            throw new Error(`Directory path ${dirPath} does not exist!`);
                        }
                        return dirPath;
                    },
                })
                .positional('csvFile', {
                    describe: csvFileDescription,
                    type: 'string',
                    default: PIXELS_TMP_CSV,
                });
        })
        .demandOption('dirPath');
}
