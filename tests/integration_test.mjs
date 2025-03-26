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
describe('Invalid defs', () => {
    it('should output all required params', (done) => {
        exec(`npm run validate-ddg-pixel-defs ${invalidDefsPath}`, (error, _, stderr) => {
            const pixelPath = path.join(invalidDefsPath, 'pixels', 'pixels.json');
            const expectedErrors = [
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'description'`,
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'owners'`,
                `ERROR in ${pixelPath}: /invalid_pixel must have required property 'triggers'`,
            ];

            const errors = stderr.trim().split('\n');
            expect(errors).to.include.members(expectedErrors);
            expect(error.code).to.equal(1);

            done();
        });
    }).timeout(timeout);
});

describe('Valid defs', () => {
    it('should exit normally', (done) => {
        exec(`npm run validate-ddg-pixel-defs ${validDefsPath}`, (error, _, stderr) => {
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
            const tokenizedPixels = JSON5.parse(fs.readFileSync(fileUtils.getTokenizedPixelsPath(validDefsPath)));
            const expectedPixels = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'tokenized_pixels.json')));
            expect(tokenizedPixels).to.deep.equal(expectedPixels);
        });

        exec(`npm run validate-live-pixels ${validDefsPath} ${validDefsPath}/test_live_pixels.csv`, (error, _, stderr) => {
            expect(error).to.equal(null);

            // Check output files
            const pixelErrors = JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(validDefsPath)));
            const expectedErrors = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'pixel_errors.json')));
            expect(pixelErrors).to.deep.equal(expectedErrors);

            const undocumentedPixels = JSON5.parse(fs.readFileSync(fileUtils.getUndocumentedPixelsPath(validDefsPath)));
            const expectedUndocumented = JSON5.parse(fs.readFileSync(path.join(liveValidationResultsPath, 'undocumented_pixels.json')));
            expect(undocumentedPixels).to.deep.equal(expectedUndocumented);

            done();
        });
    }).timeout(timeout);

    it('case insensitive - should produce expected errors', (done) => {
        exec(`npm run preprocess-defs ${validCaseInsensitiveDefsPath}`, (error, _, stderr) => {
            expect(error).to.equal(null);
        });

        exec(
            `npm run validate-live-pixels ${validCaseInsensitiveDefsPath} ${validCaseInsensitiveDefsPath}/test_live_pixels.csv`,
            (error, _, stderr) => {
                expect(error).to.equal(null);

                // Check output files
                const pixelErrors = JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(validCaseInsensitiveDefsPath)));
                expect(pixelErrors).to.be.empty;

                const undocumentedPixels = JSON5.parse(fs.readFileSync(fileUtils.getUndocumentedPixelsPath(validCaseInsensitiveDefsPath)));
                expect(undocumentedPixels).to.be.empty;

                done();
            },
        );
    }).timeout(timeout);
});
