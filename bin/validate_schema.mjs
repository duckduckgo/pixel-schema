#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';

import { DefinitionsValidator } from '../src/definitions_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';
import { hideBin } from 'yargs/helpers';

import * as fileUtils from '../src/file_utils.mjs';

const argv = yargs(hideBin(process.argv))
    .command('$0 [dirPath]', 'validate pixel definitions', (yargs) => {
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
    .option('file', {
        alias: 'f',
        type: 'string',
        description: 'Relative path to a single definition file within {dirPath}/pixels',
    })
    .parse();

// 1) Validate common params and suffixes
const mainDir = argv.dirPath;
const pixelsDir = path.join(mainDir, 'pixels');
const commonParams = fileUtils.readCommonParams(mainDir);
const commonSuffixes = fileUtils.readCommonSuffixes(mainDir);
const validator = new DefinitionsValidator(commonParams, commonSuffixes);
logErrors('ERROR in common_params.json:', validator.validateCommonParamsDefinition());
logErrors('ERROR in common_suffixes.json:', validator.validateCommonSuffixesDefinition());

// 2) Validate pixels and params
function validateFile(file) {
    console.log(`Validating pixels definition: ${file}`);
    const pixelsDef = JSON5.parse(fs.readFileSync(file));
    logErrors(`ERROR in ${file}:`, validator.validatePixelsDefinition(pixelsDef));
}

function validateFolder(folder) {
    fs.readdirSync(folder, { recursive: true }).forEach((file) => {
        const fullPath = path.join(folder, file);
        if (fs.statSync(fullPath).isDirectory()) {
            return;
        }

        validateFile(fullPath);
    });
}

if (argv.file) {
    validateFile(path.join(pixelsDir, argv.file));
} else {
    validateFolder(pixelsDir);
}
