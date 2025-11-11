import { exec } from 'child_process';
import { expect } from 'chai';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const timeout = 10000;
const validDefsPath = path.join('tests', 'test_data', 'valid');
const liveValidationResultsPath = path.join(validDefsPath, 'expected_processing_results');
const validCaseInsensitiveDefsPath = path.join('tests', 'test_data', 'valid_case_insensitive');
const invalidDefsPath = path.join('tests', 'test_data', 'invalid');
const validUserMapPath = path.join('tests', 'test_data', 'valid', 'user_map.yml');

describe('Invalid defs without user map', () => {
    it('should output all required params', (done) => {
        exec(`npm run validate-ddg-pixel-defs ${invalidDefsPath}`, (error, _, stderr) => {
            const pixelPath = path.join(invalidDefsPath, 'pixels', 'pixels.json');
            const expectedErrors = [
                'ERROR in native_experiments.json: /defaultSuffixes must be array',
                "ERROR in native_experiments.json: /activeExperiments/invalidExperiment must have required property 'cohorts'",
                "ERROR in native_experiments.json: /activeExperiments/invalidExperiment must have required property 'metrics'",
                `ERROR in ${pixelPath}: Invalid property name 'experiment.invalid'. If this is a pixel:`,
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'description'`,
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'owners'`,
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
            const pixelPath = path.join(invalidDefsPath, 'pixels', 'invalid_owner.json');

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
            const tokenizedPixels = JSON5.parse(fs.readFileSync(fileUtils.getTokenizedPixelsPath(validDefsPath)).toString());
            const expectedPixels = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'tokenized_pixels.json')).toString());
            expect(tokenizedPixels).to.deep.equal(expectedPixels);
        });

        exec(`npm run validate-live-pixels ${validDefsPath} ${validDefsPath}/test_live_pixels.csv`, (error, _, stderr) => {
            expect(error).to.equal(null);

            // Check output files
            const pixelErrors = JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(validDefsPath)).toString());
            const expectedErrors = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'pixel_errors.json')).toString());
            expect(pixelErrors).to.deep.equal(expectedErrors);

            const undocumentedPixels = JSON5.parse(fs.readFileSync(fileUtils.getUndocumentedPixelsPath(validDefsPath)).toString());
            const expectedUndocumented = JSON5.parse(
                fs.readFileSync(path.join(liveValidationResultsPath, 'undocumented_pixels.json')).toString(),
            );
            expect(undocumentedPixels).to.deep.equal(expectedUndocumented);

            done();
        });
    }).timeout(timeout);

    it('case insensitive - should produce zero errors', (done) => {
        exec(`npm run preprocess-defs ${validCaseInsensitiveDefsPath}`, (error, _, stderr) => {
            expect(error).to.equal(null);
        });

        exec(
            `npm run validate-live-pixels ${validCaseInsensitiveDefsPath} ${validCaseInsensitiveDefsPath}/test_live_pixels.csv`,
            (error, _, stderr) => {
                expect(error).to.equal(null);

                // Check output files
                const pixelErrors = JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(validCaseInsensitiveDefsPath)).toString());
                expect(pixelErrors).to.be.empty;

                const undocumentedPixels = JSON5.parse(
                    fs.readFileSync(fileUtils.getUndocumentedPixelsPath(validCaseInsensitiveDefsPath)).toString(),
                );
                expect(undocumentedPixels).to.be.empty;

                done();
            },
        );
    }).timeout(timeout);
});
