import { expect } from 'chai';
import { spawnSync } from 'child_process';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import JSON5 from 'json5';
import os from 'os';
import path from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const headDir = path.join('tests', 'test_data', 'valid');
const pixelDefinitionsFile = path.join('pixels', 'definitions', 'pixel_guide.json5');
const subfolderDefinitionsFile = path.join('pixels', 'definitions', 'pixel_subfolder', 'test_pixels.json');

const unknownParamError = "must NOT have additional properties. Found extra property 'unknownParam'";
const bogusSuffixError = "Suffix 'bogus' must be equal to one of the allowed values";

const testCases = [
    // HEAD-only errors: the release definitions permit these values
    ['m.my.first.pixel', ['extraParam=10']],
    ['m.my.first.pixel', ['is_default=10']],
    // Release-only error: HEAD passes, so the release definitions are never consulted
    ['m.my.first.pixel', ['count=42']],
    // Shared error: neither definition knows 'unknownParam'
    ['m.my.first.pixel', ['unknownParam=1']],
    // Both reject, but for different reasons: HEAD exceeds the maximum, release has no 'count'
    ['m.my.first.pixel', ['count=500']],
    // Mixed row: only the 'unknownParam' error is shared
    ['m.my.first.pixel', ['unknownParam=2', 'is_default=10']],
    // Enum drift: 'bogus' is rejected by both enums, 'churned' only by HEAD
    ['m.my.first.pixel.bogus.exceptiontype.foo.android.phone', []],
    ['m.my.first.pixel.churned.exceptiontype.foo.android.phone', []],
    // Undocumented in both
    ['m.unknown.pixel', []],
    // Undocumented only in HEAD: pixel exists only in the release definitions
    ['m.release.only.pixel', []],
    // Undocumented only in release: pixel was added after the release
    ['test.pattern.suffix.5', []],
];

function createReleaseDir() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-defs-'));
    fs.cpSync(headDir, tempDir, { recursive: true });

    const definitionPath = path.join(tempDir, pixelDefinitionsFile);
    const definitions = JSON5.parse(fs.readFileSync(definitionPath, 'utf8'));

    // Remove most params, add a new one, and change the type of an existing one
    definitions.m_my_first_pixel.parameters = [
        'appVersion',
        {
            key: 'extraParam',
            type: 'integer',
        },
        {
            key: 'is_default',
            type: 'integer',
        },
    ];
    // Allow an extra user type suffix value
    definitions.m_my_first_pixel.suffixes[0].enum = ['new', 'returning', 'churned'];
    // Define a pixel that HEAD no longer has
    definitions.m_release_only_pixel = {
        description: 'Pixel removed after the release',
        owners: ['github_username'],
        triggers: ['other'],
    };
    fs.writeFileSync(definitionPath, `${JSON.stringify(definitions, null, 4)}\n`);

    // Drop a pixel that was added to HEAD after the release
    const subfolderPath = path.join(tempDir, subfolderDefinitionsFile);
    const { test_pattern_suffix: _, ...subfolderDefinitions } = JSON.parse(fs.readFileSync(subfolderPath, 'utf8'));
    fs.writeFileSync(subfolderPath, `${JSON.stringify(subfolderDefinitions, null, 4)}\n`);

    return tempDir;
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status, result.stderr).to.equal(0);
}

function writeTestCases(csvPath) {
    const rows = testCases.map(([pixel, params]) => [pixel, JSON.stringify(params), 'appVersion=2.0.3']);
    fs.writeFileSync(csvPath, stringify(rows, { header: true, columns: ['pixel', 'params', 'version'] }));
}

// Validates against mainDir's definitions, intersected with releaseDir's when given.
function validate(mainDir, csvPath, releaseDir = null) {
    run('node', ['./live_validation_scripts/validate_live_pixel.mjs', mainDir, csvPath, ...(releaseDir ? [releaseDir] : [])]);

    const pixelsDir = path.join(mainDir, 'pixels');
    return {
        pixelErrors: JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(pixelsDir), 'utf8')),
        undocumentedPixels: JSON5.parse(fs.readFileSync(fileUtils.getUndocumentedPixelsPath(pixelsDir), 'utf8')),
    };
}

describe('validate_live_pixel release snapshot comparison', () => {
    let releaseDir;
    let headOnly;
    let releaseOnly;
    let pixelErrors;
    let undocumentedPixels;

    before(function () {
        this.timeout(20000);
        releaseDir = createReleaseDir();
        const csvPath = path.join(releaseDir, 'release-test.csv');
        writeTestCases(csvPath);
        run('node', ['./live_validation_scripts/preprocess_defs.mjs', headDir]);
        run('node', ['./live_validation_scripts/preprocess_defs.mjs', releaseDir]);

        headOnly = validate(headDir, csvPath);
        releaseOnly = validate(releaseDir, csvPath);
        ({ pixelErrors, undocumentedPixels } = validate(headDir, csvPath, releaseDir));
    });

    after(() => {
        fs.rmSync(releaseDir, { recursive: true, force: true });
    });

    it('baseline: each side alone reports the errors the comparison later drops', () => {
        expect(headOnly.pixelErrors.m_my_first_pixel).to.include.keys(
            "must NOT have additional properties. Found extra property 'extraParam'",
            '/is_default must be boolean',
            '/count must be <= 100',
            "Suffix 'churned' must be equal to one of the allowed values",
        );
        expect(headOnly.pixelErrors).to.have.property('test_pattern_suffix');
        expect(headOnly.undocumentedPixels).to.include('m_release_only_pixel');

        expect(releaseOnly.pixelErrors.m_my_first_pixel).to.include.keys(
            "must NOT have additional properties. Found extra property 'count'",
        );
        expect(releaseOnly.undocumentedPixels).to.include('test_pattern_suffix_5');
    });

    it('persists a shared error with examples from every matching row, in CSV order', () => {
        expect(pixelErrors.m_my_first_pixel[unknownParamError]).to.deep.equal([
            'unknownParam=1&appVersion=2.0.3',
            'unknownParam=2&is_default=10&appVersion=2.0.3',
        ]);
    });

    // TODO: report HEAD errors when the release rejects the same param for a different reason. Today
    // 'count=500' is suppressed because HEAD reports '/count must be <= 100' while the release reports
    // an extra 'count' property. Once fixed, unskip this and add the error to the final deep.equal.
    it.skip('persists the HEAD error when the release rejects the same param for a different reason', () => {
        expect(pixelErrors.m_my_first_pixel['/count must be <= 100']).to.deep.equal(['count=500&appVersion=2.0.3']);
    });

    it('persists an enum error rejected by both despite differing allowed values', () => {
        expect(pixelErrors.m_my_first_pixel[bogusSuffixError]).to.deep.equal(['m_my_first_pixel_bogus_exceptiontype_foo_android_phone']);
    });

    it('reports a pixel undocumented in both, but not one undocumented on only one side', () => {
        expect(undocumentedPixels).to.deep.equal(['m_unknown_pixel']);
    });

    it('reports only errors that match across HEAD and release', () => {
        expect(pixelErrors).to.deep.equal({
            m_my_first_pixel: {
                owners: ['github_username'],
                [unknownParamError]: ['unknownParam=1&appVersion=2.0.3', 'unknownParam=2&is_default=10&appVersion=2.0.3'],
                [bogusSuffixError]: ['m_my_first_pixel_bogus_exceptiontype_foo_android_phone'],
            },
        });
    });
});
