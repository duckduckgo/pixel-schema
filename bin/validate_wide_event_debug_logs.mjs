#!/usr/bin/env node

/***
 * Tool for validating wide event debug logs against wide event definitions
 */
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import { MAIN_DIR_ARG, getMainDirPositional } from '../src/args_utils.mjs';
import { WideEventDefinitionsValidator } from '../src/definitions_validator.mjs';
import { formatAjvErrors } from '../src/error_utils.mjs';
import * as fileUtils from '../src/file_utils.mjs';

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

function readWideEventDefinitions(definitionsDir) {
    const entries = fs.readdirSync(definitionsDir, { recursive: true, encoding: 'utf8' });
    /** @type {Record<string, any>} */
    const wideEvents = {};

    for (const file of entries) {
        const fullPath = path.join(definitionsDir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            continue;
        }

        const parsed = JSON5.parse(fs.readFileSync(fullPath, 'utf8'));
        for (const [eventName, eventDef] of Object.entries(parsed)) {
            if (wideEvents[eventName]) {
                throw new Error(`Duplicate wide event definition found: ${eventName}`);
            }
            wideEvents[eventName] = eventDef;
        }
    }

    return wideEvents;
}

function buildWideEventValidators(mainDir) {
    const wideEventsDir = path.join(mainDir, 'wide_events');
    const definitionsDir = path.join(wideEventsDir, 'definitions');
    if (!fs.existsSync(definitionsDir)) {
        throw new Error(`Wide events definitions directory not found: ${definitionsDir}`);
    }

    const baseEvent = fileUtils.readBaseEvent(wideEventsDir);
    if (!baseEvent) {
        throw new Error('base_event.json is required for wide event validation');
    }

    const commonProps = fileUtils.readCommonProps(wideEventsDir);
    const validator = new WideEventDefinitionsValidator(commonProps);
    const wideEvents = readWideEventDefinitions(definitionsDir);

    const schemaErrors = [];
    const schemasByEvent = validator.generateWideEventSchemas(wideEvents, baseEvent, schemaErrors);
    if (schemaErrors.length > 0) {
        for (const error of schemaErrors) {
            console.error(error);
        }
        process.exit(1);
    }

    const ajv = new Ajv2020.default({ allErrors: true });
    addFormats.default(ajv);
    /** @type {Record<string, import('ajv').ValidateFunction>} */
    const validators = {};

    for (const [eventName, schema] of Object.entries(schemasByEvent)) {
        const version = schema?.properties?.meta?.properties?.version?.const;
        if (!version) {
            console.error(`Generated schema missing meta.version for ${eventName}`);
            continue;
        }
        const key = `${eventName}-${version}`;
        validators[key] = ajv.compile(/** @type {import('ajv').AnySchema} */ (schema));
    }

    return validators;
}

async function main() {
    const validators = buildWideEventValidators(argv.dirPath);
    const data = fs.readFileSync(argv.debugLogPath, 'utf8');

    for (const line of data.split(/\r?\n/)) {
        const trimmed = line.trim();
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
            for (const error of formatAjvErrors(validate.errors)) {
                console.error(`\t${error}`);
            }
        }
    }
}

await main();
