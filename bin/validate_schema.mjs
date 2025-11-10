#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import yaml from 'js-yaml';

import { DefinitionsValidator } from '../src/definitions_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';
import { hideBin } from 'yargs/helpers';

import * as fileUtils from '../src/file_utils.mjs';
import { parseSearchExperiments, getEnabledSearchExperiments } from '../src/pixel_utils.mjs';

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
    .option('githubUserMap', {
        alias: 'g',
        describe: 'Path to the GitHub user map YAML file',
        type: 'string',
        demandOption: false,
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
const pixelIgnoreParams = fileUtils.readIgnoreParams(mainDir);
const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
const ignoreParams = { ...globalIgnoreParams, ...pixelIgnoreParams }; // allow local ignores to override global ones

const validator = new DefinitionsValidator(commonParams, commonSuffixes, ignoreParams);
logErrors('ERROR in params_dictionary.json:', validator.validateCommonParamsDefinition());
logErrors('ERROR in suffixes_dictionary.json:', validator.validateCommonSuffixesDefinition());
logErrors('ERROR in ignore_params.json:', validator.validateIgnoreParamsDefinition());

// 2) Validate experiments
const experiments = fileUtils.readNativeExperimentsDef(mainDir);
logErrors('ERROR in native_experiments.json:', validator.validateNativeExperimentsDefinition(experiments));

const searchExperiments = {
    enabled: false,
    expDefs: {},
    expPixels: {},
};
const rawSearchExperiments = fileUtils.readSearchExperimentsDef(mainDir);
if (rawSearchExperiments) {
    searchExperiments.expDefs = parseSearchExperiments(rawSearchExperiments);
    const searchPixels = fileUtils.readSearchPixelsDef(mainDir);
    searchExperiments.expPixels = getEnabledSearchExperiments(searchPixels);
    searchExperiments.enabled = true;
    logErrors('ERROR in search_experiments.json:', validator.validateNativeExperimentsDefinition(searchExperiments.expDefs));
} else {
    console.log('Missing search_experiments.json, skipping search experiments validation.');
}

// 3) Validate pixels and params
function validateFile(file, userMap) {
    console.log(`Validating pixels definition: ${file}`);
    const pixelsDef = JSON5.parse(fs.readFileSync(file));
    logErrors(`ERROR in ${file}:`, validator.validatePixelsDefinition(pixelsDef, userMap));
}

function validateFolder(folder, userMap) {
    fs.readdirSync(folder, { recursive: true }).forEach((file) => {
        const fullPath = path.join(folder, file);
        if (fs.statSync(fullPath).isDirectory()) {
            return;
        }

        validateFile(fullPath, userMap);
    });
}
let userMap = null;

if (argv.githubUserMap) {
    console.log(`Reading GitHub user map from: ${argv.githubUserMap}`);
    try {
        userMap = yaml.load(fs.readFileSync(argv.githubUserMap, 'utf8'));
    } catch (error) {
        console.error(`Error reading GitHub user map from ${argv.githubUserMap}:`, error.message);
        process.exit(1);
    }
} else {
    console.log('No GitHub user map provided, skipping owner validation.');
}

if (argv.file) {
    validateFile(path.join(pixelsDir, argv.file), userMap);
} else {
    validateFolder(pixelsDir, userMap);
}
