import { expect } from 'chai';
import fs from 'fs';

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

    it('keeps production report defaults explicit and overrideable per Jenkins job', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        expect(jenkinsfile).to.match(/ASANA_PROJECT="\$\{params\.ASANA_PROJECT \?: '1210856607616307'\}"/);
        expect(jenkinsfile).to.match(
            /defaultValue: '1210856607616307',[\s\S]*?name: 'ASANA_PROJECT'[\s\S]*?defaultValue: true,[\s\S]*?name: 'NOTIFY_PIXEL_OWNERS'/,
        );
    });

    it('uses one shared configuration for HEAD checkout, release checkout, and validation', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        for (const parameter of [
            'EXTENSION_RELEASE_TAG_TEMPLATE',
            'WINDOWS_BROWSER_RELEASE_TAG_TEMPLATE',
            'APPLE_MACOS_RELEASE_TAG_TEMPLATE',
            'APPLE_IOS_RELEASE_TAG_TEMPLATE',
            'ANDROID_RELEASE_TAG_TEMPLATE',
        ]) {
            expect(jenkinsfile).to.include(`tagTemplate: params.${parameter}`);
        }

        expect(jenkinsfile.match(/^def validationConfigs\(params\)/gm)).to.have.length(1);
        expect(jenkinsfile.match(/stage\('Checkout repositories'\)/g)).to.have.length(1);
        expect(jenkinsfile.match(/stage\('Validate products'\)/g)).to.have.length(1);
        expect(jenkinsfile).to.include('configs.groupBy { it.repo }.each { repo, repoConfigs ->');
        expect(jenkinsfile).to.include('configs.each { config ->');
        expect(jenkinsfile).to.include('dir(releaseCheckoutDir) {');
        expect(jenkinsfile).to.include('deleteDir()');
        expect(jenkinsfile).to.include('validationConfigs(params).findAll { it.enabled }.each { config ->');
        expect(jenkinsfile).to.include('fnm exec node ./scripts/resolve_release_tag.mjs "$MAIN_DIR" "$RELEASE_TAG_TEMPLATE"');
        expect(jenkinsfile).to.match(/branches: \[\[name: "refs\/tags\/\$\{releaseTag\}"\]\]/);
        expect(jenkinsfile.match(/\.\/scripts\/validateRepo\.sh/g)).to.have.length(1);
        expect(jenkinsfile).to.not.match(/stage\('Validate pixels for/);
        expect(jenkinsfile).to.not.match(/stage\('clone (windows|apple|android|duckduckgo)/);
    });

    it('aborts the checkout stage when a release tag cannot be resolved or checked out', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        expect(jenkinsfile).to.include('Release resolution/checkout is all-or-nothing');
        expect(jenkinsfile).to.not.include('catchError');
        expect(jenkinsfile).to.not.include('unstable("Release checkout failed');
    });

    it('uses Jenkins checkout credentials for the private Windows release', () => {
        const jenkinsfile = fs.readFileSync('Jenkinsfiles/Jenkinsfile.params', 'utf8');

        expect(jenkinsfile).to.match(/name: 'windows-browser',[\s\S]*?credentialsId: 'windows-browser-rw'/);
        expect(jenkinsfile).to.include('userRemoteConfigs: [remoteConfig(config)]');
    });

    it('keeps git operations out of validateRepo.sh', () => {
        const script = fs.readFileSync('scripts/validateRepo.sh', 'utf8');

        expect(script).to.not.match(/\bgit\b/);
        expect(script).to.not.include('RELEASE_TAG_TEMPLATE');
        expect(script).to.match(/RELEASE_MAIN_DIR="\$\{4:-\}"/);
        expect(script).to.not.include('realpath');
    });

    it('runs HEAD-only validation when no release directory is provided', () => {
        const script = fs.readFileSync('scripts/validateRepo.sh', 'utf8');

        expect(script).to.match(/RELEASE_MAIN_DIR="\$\{4:-\}"/);
        expect(script).to.include('No release definitions provided; validating HEAD definitions only');
    });

    it('keeps validateAllRepos.sh HEAD-only without repository checkout logic', () => {
        const script = fs.readFileSync('scripts/validateAllRepos.sh', 'utf8');

        expect(script).to.not.include('{version}');
        expect(script).to.not.match(/\bgit\b/);
    });
});
