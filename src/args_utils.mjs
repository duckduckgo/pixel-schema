import fs from 'fs';
import yargs from 'yargs';

import { hideBin } from 'yargs/helpers';
import { PIXELS_TMP_CSV } from './constants.mjs';

/** @typedef {import('yargs').Argv} Argv */

/**
 * Builds a yargs parser for commands that require a directory path.
 * @param {string} description - CLI command description.
 * @returns {Argv} Configured yargs parser.
 */
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

/**
 * Builds a yargs parser for commands that require a directory path and optional CSV file.
 * @param {string} description - CLI command description.
 * @param {string} csvFileDescription - Help text for the CSV file argument.
 * @returns {Argv} Configured yargs parser.
 */
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

/**
 * Builds a yargs parser for generating Asana reports.
 * @param {string} description - CLI command description.
 * @returns {Argv} Configured yargs parser.
 */
export function getArgParserAsanaReports(description) {
    return yargs(hideBin(process.argv))
        .command('$0 dirPath userMapFile asanaProjectID', description, (yargs) => {
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
                .positional('userMapFile', {
                    describe: 'Path to user map YAML file',
                    type: 'string',
                    demandOption: true,
                })
                .positional('asanaProjectID', {
                    describe: 'ID of the Asana project to create the task in',
                    type: 'string',
                    demandOption: true,
                });
        })
        .demandOption('dirPath');
}

/**
 * Builds a yargs parser for deleting Asana attachments.
 * @param {string} description - CLI command description.
 * @returns {Argv} Configured yargs parser.
 */
export function getArgParserDeleteAttachments(description) {
    return yargs(hideBin(process.argv))
        .command('$0 asanaProjectID', description, (yargs) => {
            return yargs
                .positional('asanaProjectID', {
                    describe: 'ID of the Asana project to create the task in',
                    type: 'string',
                    demandOption: true,
                })
                .option('dry-run', {
                    describe: 'Show what would be deleted without actually deleting anything',
                    type: 'boolean',
                    default: false,
                    alias: 'd',
                });
        })
        .demandOption('asanaProjectID');
}
