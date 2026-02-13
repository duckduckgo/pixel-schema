import { expect } from 'chai';
import nock from 'nock';
import { resolveTargetVersion } from '../src/pixel_utils.mjs';

describe('resolveTargetVersion', () => {
    afterEach(() => {
        nock.cleanAll();
    });

    describe('static version', () => {
        it('should return static version when specified', async () => {
            const target = {
                key: 'appVersion',
                version: '1.0.0',
            };
            const version = await resolveTargetVersion(target);
            expect(version).to.equal('1.0.0');
        });

        it('should throw when both version and versionUrl are specified', async () => {
            const target = {
                key: 'appVersion',
                version: '1.0.0',
                versionUrl: 'https://example.com/version.json',
                versionRef: 'version',
            };
            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('Cannot specify both');
            }
        });
    });

    describe('versionUrl/versionRef validation', () => {
        it('should throw when versionUrl is specified without versionRef', async () => {
            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/version.json',
            };
            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('versionRef is required');
            }
        });

        it('should throw when versionRef is specified without versionUrl', async () => {
            const target = {
                key: 'appVersion',
                versionRef: 'latest_version',
            };
            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('versionUrl is required');
            }
        });

        it('should throw when neither version info nor queryWindowInDays are specified', async () => {
            const target = {
                key: 'appVersion',
            };
            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('must have either "version", both "versionUrl" and "versionRef", or "queryWindowInDays"');
            }
        });
    });

    describe('remote version fetching', () => {
        it('should fetch version from URL with simple key path', async () => {
            nock('https://example.com').get('/version.json').reply(200, { version: '2.5.0' });

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/version.json',
                versionRef: 'version',
            };

            const version = await resolveTargetVersion(target);
            expect(version).to.equal('2.5.0');
        });

        it('should fetch version from URL with nested key path', async () => {
            nock('https://example.com')
                .get('/metadata.json')
                .reply(200, {
                    latest_appstore_version: {
                        latest_version: '1.104.0',
                        release_date: '2025-01-10',
                    },
                });

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/metadata.json',
                versionRef: 'latest_appstore_version.latest_version',
            };

            const version = await resolveTargetVersion(target);
            expect(version).to.equal('1.104.0');
        });

        it('should throw when URL returns 404', async () => {
            nock('https://example.com').get('/notfound.json').reply(404, 'Not Found');

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/notfound.json',
                versionRef: 'version',
            };

            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('Failed to fetch version');
            }
        });

        it('should throw when URL returns 500', async () => {
            nock('https://example.com').get('/error.json').reply(500, 'Internal Server Error');

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/error.json',
                versionRef: 'version',
            };

            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('Failed to fetch version');
            }
        });

        it('should throw when version key is missing from response', async () => {
            nock('https://example.com').get('/incomplete.json').reply(200, { other_key: '1.0.0' });

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/incomplete.json',
                versionRef: 'version',
            };

            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('not found in response');
            }
        });

        it('should throw when nested key path is missing', async () => {
            nock('https://example.com')
                .get('/partial.json')
                .reply(200, {
                    latest_appstore_version: {
                        release_date: '2025-01-10',
                    },
                });

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/partial.json',
                versionRef: 'latest_appstore_version.latest_version',
            };

            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('not found in response');
            }
        });

        it('should throw when version value is not a string', async () => {
            nock('https://example.com').get('/number.json').reply(200, { version: 123 });

            const target = {
                key: 'appVersion',
                versionUrl: 'https://example.com/number.json',
                versionRef: 'version',
            };

            try {
                await resolveTargetVersion(target);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('must be a string');
            }
        });
    });

    describe('queryWindowInDays only', () => {
        it('should return null when only queryWindowInDays is specified', async () => {
            const target = {
                key: 'appVersion',
                queryWindowInDays: 7,
            };
            const version = await resolveTargetVersion(target);
            expect(version).to.equal(null);
        });
    });
});
