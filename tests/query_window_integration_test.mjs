import { expect } from 'chai';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { buildLivePixelValidator, buildTokenizedPixels } from '../main.mjs';
import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';

describe('queryWindowInDays integration', () => {
    it('skips version checks when product.json only has queryWindowInDays', () => {
        const pixelDefs = {
            versionRequiredPixel: {
                requireVersion: true,
                parameters: [
                    {
                        key: 'appVersion',
                        type: 'string',
                    },
                    {
                        key: 'param1',
                        type: 'string',
                    },
                ],
            },
        };
        const tokenized = buildTokenizedPixels([pixelDefs]);

        // Test only queryWindowInDays
        const productDefPath = path.join('tests', 'test_data', 'query_window', 'product.json');
        const queryWindowDef = JSON5.parse(fs.readFileSync(productDefPath));
        const queryWindowValidator = buildLivePixelValidator({}, {}, queryWindowDef, {}, tokenized);
        const queryWindowResult = queryWindowValidator.validatePixel('versionRequiredPixel', 'param1=test');

        // Test queryWindowInDays + version
        const productDefWithVersion = JSON.parse(JSON.stringify(queryWindowDef));
        productDefWithVersion.target.version = '2.0.0';
        productDefWithVersion.target.key = 'appVersion';
        const versionValidator = buildLivePixelValidator({}, {}, productDefWithVersion, {}, tokenized);
        const versionResult = versionValidator.validatePixel('versionRequiredPixel', 'appVersion=1.0.0&param1=test');

        expect(versionResult.status).to.equal(PIXEL_VALIDATION_RESULT.OLD_APP_VERSION);
        expect(queryWindowResult.status).to.equal(PIXEL_VALIDATION_RESULT.VALIDATION_PASSED);
        expect(queryWindowResult.status).to.not.equal(PIXEL_VALIDATION_RESULT.OLD_APP_VERSION);
        expect(queryWindowResult.errors).to.be.empty;
    });
});
