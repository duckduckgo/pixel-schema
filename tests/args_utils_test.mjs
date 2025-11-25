import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getArgParser, getArgParserWithCsv, getArgParserAsanaReports, getArgParserDeleteAttachments } from '../src/args_utils.mjs';
import { PIXELS_TMP_CSV } from '../src/constants.mjs';

const ORIGINAL_EXISTS_SYNC = fs.existsSync;
const ORIGINAL_STAT_SYNC = fs.statSync;
const ORIGINAL_ARGV = process.argv.slice();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_DIR = path.join(__dirname, 'test_data', 'valid');
const VALID_USER_MAP = path.join(VALID_DIR, 'user_map.yml');
const VALID_CSV = path.join(VALID_DIR, 'test_live_pixels.csv');

const SCRIPT_NAME = 'args_utils_test';

function stubFs({ exists, isDir }) {
    fs.existsSync = () => exists;
    fs.statSync = () => ({
        isDirectory: () => isDir,
    });
}

function restoreFs() {
    fs.existsSync = ORIGINAL_EXISTS_SYNC;
    fs.statSync = ORIGINAL_STAT_SYNC;
}

function configureParser(parser) {
    parser.exitProcess(false);
    parser.showHelpOnFail(false);
    parser.fail((msg, err) => {
        throw err || new Error(msg);
    });
    return parser;
}

function parse(parser, ...cliArgs) {
    const args = cliArgs.flat();
    return parser.parseAsync(args);
}

async function expectParseError(parser, cliArgs, expectedMessage) {
    let caught;
    try {
        await parse(parser, ...cliArgs);
    } catch (error) {
        caught = error;
    }

    expect(caught, 'expected parser to throw').to.be.instanceOf(Error);

    if (typeof expectedMessage === 'string') {
        expect(caught.message).to.equal(expectedMessage);
    } else if (expectedMessage instanceof RegExp) {
        expect(caught.message).to.match(expectedMessage);
    }
}

beforeEach(() => {
    restoreFs();
    process.argv = ['node', SCRIPT_NAME];
});

afterEach(() => {
    restoreFs();
    process.argv = ORIGINAL_ARGV.slice();
});

describe('getArgParser', () => {
    it('parses dirPath when the path exists and is a directory', async () => {
        const parser = configureParser(getArgParser('Validate directory'));
        const argv = await parse(parser, VALID_DIR);
        expect(argv.dirPath).to.equal(VALID_DIR);
    });

    it('throws when the provided path does not exist', async () => {
        const missingDir = '/path/does/not/exist';
        stubFs({ exists: false, isDir: false });
        const parser = configureParser(getArgParser('Validate directory'));

        await expectParseError(parser, [missingDir], `Directory path ${missingDir} does not exist!`);
    });

    it('throws when the provided path exists but is not a directory', async () => {
        const notDir = path.join(VALID_DIR, 'user_map.yml');
        stubFs({ exists: true, isDir: false });
        const parser = configureParser(getArgParser('Validate directory'));

        await expectParseError(parser, [notDir], `Directory path ${notDir} does not exist!`);
    });
});

describe('getArgParserWithCsv', () => {
    it('uses the default CSV path when none is provided', async () => {
        const parser = configureParser(getArgParserWithCsv('Validate directory', 'CSV file'));
        const argv = await parse(parser, VALID_DIR);

        expect(argv.dirPath).to.equal(VALID_DIR);
        expect(argv.csvFile).to.equal(PIXELS_TMP_CSV);
    });

    it('accepts a custom CSV positional argument', async () => {
        const parser = configureParser(getArgParserWithCsv('Validate directory', 'CSV file'));
        const argv = await parse(parser, VALID_DIR, VALID_CSV);

        expect(argv.dirPath).to.equal(VALID_DIR);
        expect(argv.csvFile).to.equal(VALID_CSV);
    });

    it('throws when the directory path is invalid', async () => {
        const missingDir = '/missing/dir';
        stubFs({ exists: false, isDir: false });
        const parser = configureParser(getArgParserWithCsv('Validate directory', 'CSV file'));

        await expectParseError(parser, [missingDir], `Directory path ${missingDir} does not exist!`);
    });
});

describe('getArgParserAsanaReports', () => {
    it('parses required positional arguments', async () => {
        const parser = configureParser(getArgParserAsanaReports('Asana reports'));
        const argv = await parse(parser, VALID_DIR, VALID_USER_MAP, '123456');

        expect(argv.dirPath).to.equal(VALID_DIR);
        expect(argv.userMapFile).to.equal(VALID_USER_MAP);
        expect(argv.asanaProjectID).to.equal('123456');
    });

    it('throws when the directory path is invalid', async () => {
        const missingDir = '/invalid/asana/dir';
        stubFs({ exists: false, isDir: false });
        const parser = configureParser(getArgParserAsanaReports('Asana reports'));

        await expectParseError(parser, [missingDir, VALID_USER_MAP, '123456'], `Directory path ${missingDir} does not exist!`);
    });

    it('throws when required positional arguments are missing', async () => {
        const parser = configureParser(getArgParserAsanaReports('Asana reports'));

        await expectParseError(parser, [VALID_DIR], /Not enough non-option arguments/);
    });
});

describe('getArgParserDeleteAttachments', () => {
    it('parses asanaProjectID and sets dry-run default to false', async () => {
        const parser = configureParser(getArgParserDeleteAttachments('Delete attachments'));
        const argv = await parse(parser, 'proj123');

        expect(argv.asanaProjectID).to.equal('proj123');
        expect(argv['dry-run']).to.equal(false);
    });

    it('enables dry-run when -d is provided', async () => {
        const parser = configureParser(getArgParserDeleteAttachments('Delete attachments'));
        const argv = await parse(parser, 'proj123', '-d');

        expect(argv.asanaProjectID).to.equal('proj123');
        expect(argv['dry-run']).to.equal(true);
        expect(argv.d).to.equal(true);
    });

    it('throws when asanaProjectID is missing', async () => {
        const parser = configureParser(getArgParserDeleteAttachments('Delete attachments'));

        await expectParseError(parser, ['--dry-run'], /Not enough non-option arguments/);
    });
});
