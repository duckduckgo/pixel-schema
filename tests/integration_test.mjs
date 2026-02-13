import { exec } from 'child_process';
import { expect } from 'chai';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const timeout = 10000;
const validDefsPath = path.join('tests', 'test_data', 'valid');
const liveValidationResultsPath = path.join(validDefsPath, 'pixels', 'expected_processing_results');
const validCaseInsensitiveDefsPath = path.join('tests', 'test_data', 'valid_case_insensitive');
const invalidDefsPath = path.join('tests', 'test_data', 'invalid');
const validUserMapPath = path.join('tests', 'test_data', 'valid', 'pixels', 'user_map.yml');

describe('Invalid defs without user map', () => {
    it('should output all required params', (done) => {
        exec(`npm run validate-ddg-pixel-defs ${invalidDefsPath}`, (error, _, stderr) => {
            const pixelPath = path.join(invalidDefsPath, 'pixels', 'definitions', 'pixels.json');
            const wideEventsPath = path.join(invalidDefsPath, 'wide_events', 'definitions', 'wide_events.json');
            const expectedErrors = [
                'ERROR in native_experiments.json: /defaultSuffixes must be array',
                "ERROR in native_experiments.json: /activeExperiments/invalidExperiment must have required property 'cohorts'",
                "ERROR in native_experiments.json: /activeExperiments/invalidExperiment must have required property 'metrics'",
                "ERROR in search_experiments.json: /expInvalidA must have required property 'variants'",
                "ERROR in search_experiments.json: /expInvalidB must have required property 'description'",
                `ERROR in ${pixelPath}: Invalid property name 'experiment.invalid'. If this is a pixel:`,
                "\t* pixel names must not contain '.' --> use '_' instead",
                "\t* experiments must be defined in the 'native_experiments.json' file",
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'description'`,
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'owners'`,
                `ERROR in ${wideEventsPath}: w_wide_import_summary: Generated schema does not match metaschema - /properties/global/properties must have required property 'platform'; /properties/global/properties must have required property 'type'; /properties/global/properties must NOT have additional properties. Found extra property 'platform2'; /properties/global/properties/sample_rate must have required property 'maximum'; /properties/global/properties/sample_rate/minimum must be equal to constant; /properties/feature/properties/status must have required property 'enum'; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'latency_ms_bucketed'; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'failure_detail'`,
                `ERROR in ${wideEventsPath}: w_wide_import_bookmarks: Generated schema does not match metaschema - /properties/global/properties must have required property 'platform'; /properties/global/properties must have required property 'type'; /properties/global/properties must NOT have additional properties. Found extra property 'platform2'; /properties/global/properties/sample_rate must have required property 'maximum'; /properties/global/properties/sample_rate/minimum must be equal to constant; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'latency_ms_bucketed'; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'failure_detail'`,
                `ERROR in ${wideEventsPath}: w_wide_import_credentials: Generated schema does not match metaschema - /properties/global/properties must have required property 'platform'; /properties/global/properties must have required property 'type'; /properties/global/properties must NOT have additional properties. Found extra property 'platform2'; /properties/global/properties/sample_rate must have required property 'maximum'; /properties/global/properties/sample_rate/minimum must be equal to constant; /properties/feature/properties/name/enum/0 must be string; /properties/feature/properties/status must have required property 'enum'; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'latency_ms_bucketed'; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'failure_detail'`,
                `ERROR in ${wideEventsPath}: w_wide_import_credentials: Generated schema is not valid JSON Schema - Cannot read properties of undefined (reading 'replace')`,
                `ERROR in ${wideEventsPath}: w_wide_import_timeout: Generated schema does not match metaschema - /properties/global/properties must have required property 'platform'; /properties/global/properties must have required property 'type'; /properties/global/properties must NOT have additional properties. Found extra property 'platform2'; /properties/global/properties/sample_rate must have required property 'maximum'; /properties/global/properties/sample_rate/minimum must be equal to constant; /properties/feature/properties/data/properties must NOT have additional properties. Found extra property 'failure_detail'`,
                `ERROR in ${wideEventsPath}: w_wide_import_cancelled: Generated schema does not match metaschema - /properties/global/properties must have required property 'platform'; /properties/global/properties must have required property 'type'; /properties/global/properties must NOT have additional properties. Found extra property 'platform2'; /properties/global/properties/sample_rate must have required property 'maximum'; /properties/global/properties/sample_rate/minimum must be equal to constant`,
            ];

            const errors = stderr.trim().split('\n');
            expect(errors).to.include.members(expectedErrors);
            expect(error.code).to.equal(1);

            done();
        });
    }).timeout(timeout);
});

describe('Invalid owner with user map', () => {
    it('should output error for invalid owner', (done) => {
        // Careful: We need the -- to pass the -g flag to the script
        exec(`npm run validate-ddg-pixel-defs -- ${invalidDefsPath} -g ${validUserMapPath}`, (error, _, stderr) => {
            const pixelPath = path.join(invalidDefsPath, 'pixels', 'definitions', 'invalid_owner.json');

            // All of these should be present in the output
            const expectedErrors = [
                `ERROR in ${pixelPath}: Owner username_not_in_user_map for pixel pixel_with_invalid_owner not in list of acceptable github user names`,
            ];

            const errors = stderr.trim().split('\n');
            expect(errors).to.include.members(expectedErrors);
            expect(error.code).to.equal(1);

            done();
        });
    }).timeout(timeout);
});

describe('Valid defs without user map', () => {
    it('should exit normally', (done) => {
        exec(`npm run validate-ddg-pixel-defs ${validDefsPath}`, (error, _, stderr) => {
            expect(stderr.length).to.equal(0);
            expect(error).to.equal(null);

            done();
        });
    }).timeout(timeout);
});

describe('Valid defs with user map', () => {
    it('should exit normally', (done) => {
        exec(`npm run validate-ddg-pixel-defs -- ${validDefsPath} -g ${validUserMapPath}`, (error, _, stderr) => {
            expect(stderr.length).to.equal(0);
            expect(error).to.equal(null);

            done();
        });
    }).timeout(timeout);
});

describe('Validate live pixels', () => {
    it('case sensitive - should produce expected errors', (done) => {
        exec(`npm run preprocess-defs ${validDefsPath}`, (error, _, stderr) => {
            expect(error).to.equal(null);
            const tokenizedPixels = JSON5.parse(
                fs.readFileSync(fileUtils.getTokenizedPixelsPath(path.join(validDefsPath, 'pixels'))).toString(),
            );
            const expectedPixels = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'tokenized_pixels.json')).toString());
            expect(tokenizedPixels).to.deep.equal(expectedPixels);

            exec(`npm run validate-live-pixels ${validDefsPath} ${validDefsPath}/pixels/test_live_pixels.csv`, (error, _, stderr) => {
                expect(error).to.equal(null);

                // Check output files
                const pixelErrors = JSON5.parse(
                    fs.readFileSync(fileUtils.getPixelErrorsPath(path.join(validDefsPath, 'pixels'))).toString(),
                );
                const expectedErrors = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'pixel_errors.json')).toString());
                expect(pixelErrors).to.deep.equal(expectedErrors);

                const undocumentedPixels = JSON5.parse(
                    fs.readFileSync(fileUtils.getUndocumentedPixelsPath(path.join(validDefsPath, 'pixels'))).toString(),
                );
                const expectedUndocumented = JSON5.parse(
                    fs.readFileSync(path.join(liveValidationResultsPath, 'undocumented_pixels.json')).toString(),
                );
                expect(undocumentedPixels).to.deep.equal(expectedUndocumented);

                done();
            });
        });
    }).timeout(timeout);

    it('case insensitive - should produce zero errors', (done) => {
        exec(`npm run preprocess-defs ${validCaseInsensitiveDefsPath}`, (error, _, stderr) => {
            expect(error).to.equal(null);

            exec(
                `npm run validate-live-pixels ${validCaseInsensitiveDefsPath} ${validCaseInsensitiveDefsPath}/pixels/test_live_pixels.csv`,
                (error, _, stderr) => {
                    expect(error).to.equal(null);

                    // Check output files
                    const pixelErrors = JSON5.parse(
                        fs.readFileSync(fileUtils.getPixelErrorsPath(path.join(validCaseInsensitiveDefsPath, 'pixels'))).toString(),
                    );
                    expect(pixelErrors).to.be.empty;

                    const undocumentedPixels = JSON5.parse(
                        fs.readFileSync(fileUtils.getUndocumentedPixelsPath(path.join(validCaseInsensitiveDefsPath, 'pixels'))).toString(),
                    );
                    expect(undocumentedPixels).to.be.empty;

                    done();
                },
            );
        });
    }).timeout(timeout);
});

describe('Validate pixel debug logs', () => {
    it('should validate Android-like pixel debug logs', (done) => {
        const debugLogPath = path.join(validDefsPath, 'pixels', 'pixel_debug_log.txt');
        const pixelPrefix = 'Pixel url request: https://improving.duckduckgo.com/t/';
        exec(`npm run validate-ddg-pixel-logs ${validDefsPath} ${debugLogPath} "${pixelPrefix}"`, (error, stdout, stderr) => {
            expect(error).to.equal(null);

            // Check errors
            const expectedErrors = [
                `❌ Invalid: 'm_my_first_pixel?extraParam=hello' - see below for details`,
                `\tmust NOT have additional properties. Found extra property 'extraParam'`,
                "⚠️  Old app version, validation skipped: 'm_my_first_pixel?count=42&date=2025-03-12&appVersion=0.0.1'",
                "⚠️  Undocumented: 'unknown-pixel'",
            ];
            const errors = stderr.trim().split('\n');
            expect(errors).to.include.members(expectedErrors);

            // Check regular output
            const expectedLogs = ["✅ Valid: 'm_my_first_pixel?count=42&date=2025-03-12&appVersion=2.0.3'"];
            const logs = stdout.trim().split('\n');
            expect(logs).to.include.members(expectedLogs);

            done();
        });
    }).timeout(timeout);

    it('should validate Windows-like pixel debug logs', (done) => {
        const debugLogPath = path.join(validDefsPath, 'pixels', 'pixel_debug_log.txt');
        const pixelPrefix = 'Log: Debug: Published Pixel';
        exec(`npm run validate-ddg-pixel-logs ${validDefsPath} ${debugLogPath} "${pixelPrefix}"`, (error, stdout, stderr) => {
            expect(error).to.equal(null);

            // Check errors
            const expectedErrors = [
                `❌ Invalid: 'experiment_enroll_defaultBrowser_control?extraParam=20' - see below for details`,
                `\tmust NOT have additional properties. Found extra property 'extraParam'`,
                "⚠️  Undocumented: 'experiment_enroll_x'",
            ];
            const errors = stderr.trim().split('\n');
            expect(errors).to.include.members(expectedErrors);

            // Check regular output
            const expectedLogs = ["✅ Valid: 'm_my_first_pixel'"];
            const logs = stdout.trim().split('\n');
            expect(logs).to.include.members(expectedLogs);

            done();
        });
    }).timeout(timeout);
});
