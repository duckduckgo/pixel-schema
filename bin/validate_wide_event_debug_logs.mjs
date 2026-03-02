#!/usr/bin/env node

/***
 * Tool for validating wide event debug logs against wide event definitions
 */
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import { MAIN_DIR_ARG, getMainDirPositional } from '../src/args_utils.mjs';
import { formatAjvErrors } from '../src/error_utils.mjs';
import * as fileUtils from '../src/file_utils.mjs';
import { readLogLines, printValidationErrors } from '../src/debug_log_utils.mjs';

const argv = yargs(hideBin(process.argv))
    .command(`$0 ${MAIN_DIR_ARG} debugLogPath`, 'Validates a wide event debug log against definitions', (yargs) => {
        return yargs
            .positional(MAIN_DIR_ARG, getMainDirPositional())
            .positional('debugLogPath', {
                describe: 'path to wide event debug log file (JSONL)',
                type: 'string',
                demandOption: true,
            });
    })
    .demandOption([MAIN_DIR_ARG, 'debugLogPath'])
    .parse();

function buildWideEventValidators(mainDir) {
    const wideEventsDir = path.join(mainDir, 'wide_events');
    const generatedSchemasDir = fileUtils.getGeneratedSchemasDir(wideEventsDir);
    if (!fs.existsSync(generatedSchemasDir)) {
        throw new Error(
            `Generated schemas not found at ${generatedSchemasDir}. Run "node ./bin/validate_schema.mjs ${mainDir}" first.`,
        );
    }

    const ajv = new Ajv2020.default({ allErrors: true });
    addFormats.default(ajv);
    /** @type {Record<string, import('ajv').ValidateFunction>} */
    const validators = {};

    const entries = fs.readdirSync(generatedSchemasDir, { encoding: 'utf8' });
    for (const entry of entries) {
        if (!entry.endsWith('.json')) {
            continue;
        }
        const schemaPath = path.join(generatedSchemasDir, entry);
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        const eventType = schema?.properties?.meta?.properties?.type?.const;
        const version = schema?.properties?.meta?.properties?.version?.const;
        if (!eventType || !version) {
            console.error(`Generated schema missing meta.type or meta.version: ${schemaPath}`);
            continue;
        }
        const key = `${eventType}-${version}`;
        validators[key] = ajv.compile(/** @type {import('ajv').AnySchema} */ (schema));
    }

    return validators;
}

async function main() {
    const validators = buildWideEventValidators(argv.dirPath);
    for (const trimmed of readLogLines(argv.debugLogPath)) {
        if (!trimmed || !trimmed.startsWith('{')) {
            continue;
        }

        let eventPayload;
        try {
            eventPayload = JSON.parse(trimmed);
        } catch (error) {
            console.error(`Invalid log line - skipping validation: ${trimmed}`);
            continue;
        }

        const eventType = eventPayload?.meta?.type;
        const eventVersion = eventPayload?.meta?.version;
        if (!eventType || !eventVersion) {
            console.error(`Invalid wide event payload (missing meta.type or meta.version): ${trimmed}`);
            continue;
        }

        const key = `${eventType}-${eventVersion}`;
        const validate = validators[key];
        const outputEvent = `'${eventType}@${eventVersion}'`;
        if (!validate) {
            console.warn(`⚠️  Undocumented wide event: ${outputEvent}`);
            continue;
        }

        if (validate(eventPayload)) {
            console.log(`✅ Valid: ${outputEvent}`);
        } else {
            console.error(`❌ Invalid: ${outputEvent} - see below for details`);
            printValidationErrors(formatAjvErrors(validate.errors));
        }
    }
}

await main();
