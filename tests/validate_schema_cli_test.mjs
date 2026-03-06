import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const validDefsPath = path.join('tests', 'test_data', 'valid');

function createTempDefsCopy() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-schema-validate-schema-'));
    fs.cpSync(validDefsPath, tempDir, { recursive: true });
    return tempDir;
}

function runValidateSchema(args) {
    return spawnSync('node', ['./bin/validate_schema.mjs', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
}

describe('validate_schema.mjs CLI branches', () => {
    it('validates a single pixel definition file when --file targets pixels', () => {
        const defsCopy = createTempDefsCopy();
        try {
            const result = runValidateSchema([defsCopy, '--file', 'pixel_subfolder/test_pixels.json']);

            expect(result.status).to.equal(0);
            expect(result.stderr.trim()).to.equal('');
            expect(result.stdout).to.include('Validating pixels definition:');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('validates a single wide event file when --file targets wide_events', () => {
        const defsCopy = createTempDefsCopy();
        try {
            const result = runValidateSchema([defsCopy, '--file', 'wide_events.json']);

            expect(result.status).to.equal(0);
            expect(result.stderr.trim()).to.equal('');
            expect(result.stdout).to.include('Validating wide events definition:');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('exits with an error when --file does not exist in pixels or wide_events', () => {
        const defsCopy = createTempDefsCopy();
        try {
            const result = runValidateSchema([defsCopy, '--file', 'does-not-exist.json']);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include('File not found in pixels or wide_events definitions: does-not-exist.json');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('exits with an error when github user map path is invalid', () => {
        const defsCopy = createTempDefsCopy();
        const invalidUserMapPath = path.join(defsCopy, 'pixels', 'missing-user-map.yml');
        try {
            const result = runValidateSchema([defsCopy, '--githubUserMap', invalidUserMapPath]);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include(`Error reading GitHub user map from ${invalidUserMapPath}:`);
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('reports validation errors for malformed search_experiments.json input', () => {
        const defsCopy = createTempDefsCopy();
        const searchExperimentsPath = path.join(defsCopy, 'pixels', 'search_experiments.json');
        fs.writeFileSync(searchExperimentsPath, '{', 'utf8');

        try {
            const result = runValidateSchema([defsCopy]);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include('ERROR in search_experiments.json: must be object');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('skips directories while recursively validating wide event definitions', () => {
        const defsCopy = createTempDefsCopy();
        const nestedWideEventDir = path.join(defsCopy, 'wide_events', 'definitions', 'nested');
        const emptyWideEventDir = path.join(defsCopy, 'wide_events', 'definitions', 'empty');
        fs.mkdirSync(nestedWideEventDir, { recursive: true });
        fs.mkdirSync(emptyWideEventDir, { recursive: true });
        fs.writeFileSync(path.join(nestedWideEventDir, 'nested_wide_events.json'), '{}', 'utf8');

        try {
            const result = runValidateSchema([defsCopy]);

            expect(result.status).to.equal(0);
            expect(result.stdout).to.include('nested_wide_events.json');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('exits with an error when wide_events exists but base_event.json is missing', () => {
        const defsCopy = createTempDefsCopy();
        fs.rmSync(path.join(defsCopy, 'wide_events', 'base_event.json'));

        try {
            const result = runValidateSchema([defsCopy]);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include('ERROR: base_event.json is required for wide event validation');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('returns top-level error when file parsing throws unexpectedly', () => {
        const defsCopy = createTempDefsCopy();
        const brokenPixelPath = path.join(defsCopy, 'pixels', 'definitions', 'pixel_subfolder', 'broken_pixel.json');
        fs.writeFileSync(brokenPixelPath, '{', 'utf8');

        try {
            const result = runValidateSchema([defsCopy, '--file', 'pixel_subfolder/broken_pixel.json']);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include('Error:');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });

    it('exits with an error when product target version configuration is invalid', () => {
        const defsCopy = createTempDefsCopy();
        const productPath = path.join(defsCopy, 'product.json');
        const productDef = JSON.parse(fs.readFileSync(productPath, 'utf8'));
        productDef.target.versionUrl = 'https://example.com/version.json';
        productDef.target.versionRef = 'version';
        fs.writeFileSync(productPath, `${JSON.stringify(productDef, null, 4)}\n`, 'utf8');

        try {
            const result = runValidateSchema([defsCopy]);

            expect(result.status).to.equal(1);
            expect(result.stderr).to.include('ERROR in product.json target version: Cannot specify both "version" and "versionUrl"/"versionRef"');
        } finally {
            fs.rmSync(defsCopy, { recursive: true, force: true });
        }
    });
});
