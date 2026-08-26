import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('validateRepo.sh release preparation', () => {
    it('configures stable per-product release tag templates in Jenkins', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        for (const [name, defaultValue] of [
            ['WINDOWS_BROWSER_RELEASE_TAG_TEMPLATE', 'v{version}'],
            ['EXTENSION_RELEASE_TAG_TEMPLATE', '{version}'],
            ['APPLE_MACOS_RELEASE_TAG_TEMPLATE', '{version}+macos'],
            ['APPLE_IOS_RELEASE_TAG_TEMPLATE', '{version}+ios'],
            ['ANDROID_RELEASE_TAG_TEMPLATE', '{version}'],
        ]) {
            expect(jenkinsfile).to.include(`defaultValue: '${defaultValue}'`);
            expect(jenkinsfile).to.include(`name: '${name}'`);
        }

        expect(jenkinsfile).to.not.include('RELEASE_REF');
    });

    it('passes every Jenkins release template through withEnv instead of Groovy interpolation in Bash', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        for (const name of [
            'EXTENSION_RELEASE_TAG_TEMPLATE',
            'WINDOWS_BROWSER_RELEASE_TAG_TEMPLATE',
            'APPLE_MACOS_RELEASE_TAG_TEMPLATE',
            'APPLE_IOS_RELEASE_TAG_TEMPLATE',
            'ANDROID_RELEASE_TAG_TEMPLATE',
        ]) {
            expect(jenkinsfile).to.include(`withEnv(["RELEASE_TAG_TEMPLATE=${'${'}params.${name}}"]`);
        }

        expect(jenkinsfile).to.not.match(/validateRepo\.sh[^\n]*\$\{params\./);
        expect(jenkinsfile.match(/validateRepo\.sh[^\n]*"\$RELEASE_TAG_TEMPLATE"/g)).to.have.length(5);
    });

    it('passes stable release tag templates from validateAllRepos.sh', () => {
        const script = fs.readFileSync('scripts/validateAllRepos.sh', 'utf8');

        expect(script).to.match(/duckduckgo-privacy-extension\/pixel-definitions.*'\{version\}'/);
        expect(script).to.match(/windows-browser\/PixelDefinitions\/.*'v\{version\}'/);
    });

    it('fails a missing or invalid release tag template before downstream commands', () => {
        const result = spawnSync(
            'bash',
            ['./scripts/validateRepo.sh', 'tests/test_data/valid', 'user-map.yml', '123', 'invalid-template'],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
            },
        );

        expect(result.status).to.not.equal(0);
        expect(result.stdout).to.not.include('Preprocess defs');
        expect(result.stdout).to.not.include('Fetch Clickhouse');
        expect(result.stdout).to.not.include('Generate Asana reports');
    });

    it('fails an unresolvable derived release tag before downstream commands', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-repo-test-'));
        const binDir = path.join(tempDir, 'bin');
        fs.mkdirSync(binDir);
        fs.writeFileSync(
            path.join(binDir, 'git'),
            `#!/bin/bash\nif [[ "$*" == *'rev-parse --show-toplevel'* ]]; then\n    pwd\n    exit 0\nfi\nexit 1\n`,
        );
        fs.chmodSync(path.join(binDir, 'git'), 0o755);

        const result = spawnSync(
            'bash',
            ['./scripts/validateRepo.sh', 'tests/test_data/valid', 'user-map.yml', '123', 'v{version}-missing'],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
            },
        );

        expect(result.status).to.not.equal(0);
        expect(result.stdout).to.include("Resolving release tag 'v1.0.0-missing'");
        expect(result.stdout).to.not.include('Preprocess release defs');
        expect(result.stdout).to.not.include('Preprocess defs');
        expect(result.stdout).to.not.include('Fetch Clickhouse');
        expect(result.stdout).to.not.include('Generate Asana reports');
    });

    it('does not fetch a release or invoke a second validator for query-window targets', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-repo-test-'));
        const binDir = path.join(tempDir, 'bin');
        const logFile = path.join(tempDir, 'calls.log');
        fs.mkdirSync(binDir);
        fs.writeFileSync(path.join(binDir, 'git'), `#!/bin/bash\necho git "$@" >> "$CALL_LOG"\nexit 1\n`);
        fs.writeFileSync(path.join(binDir, 'fnm'), `#!/bin/bash\necho fnm "$@" >> "$CALL_LOG"\n`);
        fs.chmodSync(path.join(binDir, 'git'), 0o755);
        fs.chmodSync(path.join(binDir, 'fnm'), 0o755);

        const result = spawnSync(
            'bash',
            ['./scripts/validateRepo.sh', 'tests/test_data/query_window', 'user-map.yml', '123', 'v{version}'],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, CALL_LOG: logFile },
            },
        );

        expect(result.status).to.equal(0);
        expect(result.stdout).to.include('HEAD definitions only');
        const calls = fs.readFileSync(logFile, 'utf8');
        expect(calls).to.not.match(/^git /m);
        expect(calls.match(/validate-live-pixels/g)).to.have.length(1);
    });

    it('fetches the derived release tag instead of the raw template', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-repo-test-'));
        const binDir = path.join(tempDir, 'bin');
        const logFile = path.join(tempDir, 'calls.log');
        fs.mkdirSync(binDir);
        fs.writeFileSync(
            path.join(binDir, 'git'),
            `#!/bin/bash\necho git "$@" >> "$CALL_LOG"\ncase "$*" in\n  *'rev-parse --show-toplevel'*) pwd ;;\n  *'rev-parse FETCH_HEAD^{commit}'*) echo release-sha ;;\n  *'show -s --format=%cI'*) echo 2026-01-01T00:00:00+00:00 ;;\nesac\n`,
        );
        fs.writeFileSync(path.join(binDir, 'fnm'), `#!/bin/bash\necho fnm "$@" >> "$CALL_LOG"\n`);
        fs.chmodSync(path.join(binDir, 'git'), 0o755);
        fs.chmodSync(path.join(binDir, 'fnm'), 0o755);

        const result = spawnSync('bash', ['./scripts/validateRepo.sh', 'tests/test_data/valid', 'user-map.yml', '123', 'v{version}'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, CALL_LOG: logFile },
        });

        expect(result.status).to.equal(0);
        const calls = fs.readFileSync(logFile, 'utf8');
        expect(calls).to.include('fetch origin refs/tags/v1.0.0');
        expect(calls).to.include('rev-parse FETCH_HEAD^{commit}');
    });
});
