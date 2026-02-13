#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import yargs from 'yargs';
import yaml from 'js-yaml';

import { PixelDefinitionsValidator, WideEventDefinitionsValidator } from '../src/definitions_validator.mjs';
import { logErrors } from '../src/error_utils.mjs';
import { hideBin } from 'yargs/helpers';

import * as fileUtils from '../src/file_utils.mjs';
import { resolveTargetVersion } from '../src/pixel_utils.mjs';

async function main() {
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
            description: 'Relative path to a single definition file within {dirPath}/pixels/definitions',
        })
        .parse();

    // 1) Validate common params and suffixes
    const mainDir = argv.dirPath;
    const pixelsConfigDir = path.join(mainDir, 'pixels');
    const wideEventsConfigDir = path.join(mainDir, 'wide_events');
    const pixelsDir = path.join(pixelsConfigDir, 'definitions');

    const commonParams = fileUtils.readCommonParams(pixelsConfigDir);
    const commonSuffixes = fileUtils.readCommonSuffixes(pixelsConfigDir);
    const pixelIgnoreParams = fileUtils.readIgnoreParams(pixelsConfigDir);
    const globalIgnoreParams = fileUtils.readIgnoreParams(fileUtils.GLOBAL_PIXEL_DIR);
    const productDef = fileUtils.readProductDef(mainDir);

    // Validate and resolve target version (may fetch from URL if versionUrl is specified)
    try {
        const resolvedVersion = await resolveTargetVersion(productDef.target);
        if (resolvedVersion) {
            console.log(`Target version: ${resolvedVersion}`);
        } else {
            console.log('No target version specified; skipping version checks.');
        }
    } catch (error) {
        console.error(`ERROR in product.json target version: ${error.message}`);
        process.exit(1);
    }

    const ignoreParams = { ...globalIgnoreParams, ...pixelIgnoreParams }; // allow local ignores to override global ones

    const validator = new PixelDefinitionsValidator(commonParams, commonSuffixes, ignoreParams);
    logErrors('ERROR in params_dictionary.json:', validator.validateCommonParamsDefinition());
    logErrors('ERROR in suffixes_dictionary.json:', validator.validateCommonSuffixesDefinition());
    logErrors('ERROR in ignore_params.json:', validator.validateIgnoreParamsDefinition());

    // 2) Validate experiments
    const experiments = fileUtils.readNativeExperimentsDef(pixelsConfigDir);
    logErrors('ERROR in native_experiments.json:', validator.validateNativeExperimentsDefinition(experiments));

    if (productDef.searchExperimentsEnabled === true) {
        console.log('Validating search_experiments.json');
        try {
            const rawSearchExperiments = fileUtils.readSearchExperimentsDef(pixelsConfigDir);
            logErrors('ERROR in search_experiments.json:', validator.validateSearchExperimentsDefinition(rawSearchExperiments));
        } catch (error) {
            console.error('Failed to parse search_experiments.json:', error.message);
        }
    }

    // 3) Validate wide events
    const wideEventsDir = path.join(wideEventsConfigDir, 'definitions');
    let wideEventValidator;
    let baseEvent = null;

    if (fs.existsSync(wideEventsDir)) {
        const wideEventParams = fileUtils.readCommonProps(wideEventsConfigDir);
        wideEventValidator = new WideEventDefinitionsValidator(wideEventParams);
        logErrors('ERROR in wide_events/props_dictionary.json:', wideEventValidator.validateCommonPropsDefinition());

        // Read base event template (required for wide event validation)
        baseEvent = fileUtils.readBaseEvent(wideEventsConfigDir);
        if (!baseEvent) {
            console.error('ERROR: base_event.json is required for wide event validation');
            process.exit(1);
        }
    }

    async function validateWideEventFile(file, userMap) {
        console.log(`Validating wide events definition: ${file}`);
        const wideEventsDef = JSON5.parse(fs.readFileSync(file, 'utf8'));
        const { errors, generatedSchemas } = wideEventValidator.validateWideEventDefinition(wideEventsDef, baseEvent, userMap);
        logErrors(`ERROR in ${file}:`, errors);

        // Write generated schemas
        if (Object.keys(generatedSchemas).length > 0) {
            await fileUtils.writeAllGeneratedSchemas(wideEventsConfigDir, generatedSchemas);
            console.log(
                `Generated ${Object.keys(generatedSchemas).length} schema(s) to ${path.join(wideEventsConfigDir, 'generated_schemas')}`,
            );
        }
    }

    async function validateWideEventFolder(folder, userMap) {
        const entries = fs.readdirSync(folder, { recursive: true, encoding: 'utf8' });
        for (const file of entries) {
            const fullPath = path.join(folder, file);
            if (fs.statSync(fullPath).isDirectory()) {
                continue;
            }
            await validateWideEventFile(fullPath, userMap);
        }
    }

    // 4) Validate pixels and params
    function validatePixelFile(file, userMap) {
        console.log(`Validating pixels definition: ${file}`);
        const pixelsDef = JSON5.parse(fs.readFileSync(file, 'utf8'));
        logErrors(`ERROR in ${file}:`, validator.validatePixelsDefinition(pixelsDef, userMap));
    }

    function validatePixelFolder(folder, userMap) {
        fs.readdirSync(folder, { recursive: true, encoding: 'utf8' }).forEach((file) => {
            const fullPath = path.join(folder, file);
            if (fs.statSync(fullPath).isDirectory()) {
                return;
            }

            validatePixelFile(fullPath, userMap);
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
        const pixelPath = path.join(pixelsDir, argv.file);
        const wideEventPath = path.join(wideEventsDir, argv.file);

        if (fs.existsSync(pixelPath)) {
            validatePixelFile(pixelPath, userMap);
        } else if (fs.existsSync(wideEventPath) && wideEventValidator) {
            await validateWideEventFile(wideEventPath, userMap);
        } else {
            console.error(`File not found in pixels or wide_events definitions: ${argv.file}`);
            process.exit(1);
        }
    } else {
        validatePixelFolder(pixelsDir, userMap);
        if (wideEventValidator) {
            await validateWideEventFolder(wideEventsDir, userMap);
        }
    }
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
