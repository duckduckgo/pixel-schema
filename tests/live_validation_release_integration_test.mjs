import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import JSON5 from 'json5';
import os from 'os';
import path from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const validDefsPath = path.join('tests', 'test_data', 'valid');
const pixelDefinitionsFile = path.join('pixels', 'definitions', 'pixel_guide.json5');

function createDefinitionsCopy() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-schema-release-validation-'));
    fs.cpSync(validDefsPath, tempDir, { recursive: true });
    return tempDir;
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status, result.stderr).to.equal(0);
}

function addExtraParam(definitionsDir) {
    const definitionPath = path.join(definitionsDir, pixelDefinitionsFile);
    const definitions = JSON5.parse(fs.readFileSync(definitionPath, 'utf8'));
    definitions.m_my_first_pixel.parameters.push({ key: 'extraParam', type: 'integer' });
    fs.writeFileSync(definitionPath, `${JSON.stringify(definitions, null, 4)}\n`);
}

function validate(headDir, releaseDir) {
    const csvPath = path.join(headDir, 'pixels', 'release-test.csv');
    fs.writeFileSync(csvPath, 'pixel,params,version\nm.my.first.pixel,"[\'extraParam=10\']",appVersion=2.0.3\n');
    run('node', ['./live_validation_scripts/preprocess_defs.mjs', headDir]);
    run('node', ['./live_validation_scripts/preprocess_defs.mjs', releaseDir]);
    run('node', ['./live_validation_scripts/validate_live_pixel.mjs', headDir, csvPath, releaseDir]);
    return JSON5.parse(fs.readFileSync(fileUtils.getPixelErrorsPath(path.join(headDir, 'pixels')), 'utf8'));
}

describe('validate_live_pixel release snapshot comparison', () => {
    let headDir;
    let releaseDir;

    beforeEach(() => {
        headDir = createDefinitionsCopy();
        releaseDir = createDefinitionsCopy();
    });

    afterEach(() => {
        fs.rmSync(headDir, { recursive: true, force: true });
        fs.rmSync(releaseDir, { recursive: true, force: true });
    });

    it('suppresses a HEAD-only error when the release definition permits it', () => {
        addExtraParam(releaseDir);

        expect(validate(headDir, releaseDir)).to.deep.equal({});
    });

    it('suppresses an inverse-skew release-only error', () => {
        addExtraParam(headDir);

        expect(validate(headDir, releaseDir)).to.deep.equal({});
    });

    it('persists an error that occurs in both HEAD and release definitions', () => {
        const errors = validate(headDir, releaseDir);

        expect(errors.m_my_first_pixel["must NOT have additional properties. Found extra property 'extraParam'"]).to.deep.equal([
            'extraParam=10&appVersion=2.0.3',
        ]);
    });
});
