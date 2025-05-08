import { expect } from 'chai';
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { buildTokenizedPixels, buildLivePixelValidator, validateSinglePixel } from '../main.mjs';

// **************************************************
// NOTE: if you find yourself modifying these smoke tests,
// beware that consumers of this library may need updates!
// **************************************************

const testPixelDefs = {
    m_my_first_pixel: {
        parameters: [
            {
                key: 'count',
                type: 'number',
            },
        ],
        suffixes: [
            {
                enum: ['suffix1', 'suffix2'],
            },
        ],
    },
};
const validDefsPath = path.join('tests', 'test_data', 'valid');
const productDef = JSON5.parse(fs.readFileSync(path.join(validDefsPath, 'product.json')));
const validator = buildLivePixelValidator({}, {}, productDef, {}, buildTokenizedPixels([testPixelDefs]));

describe('main.mjs - proper pixels', () => {
    it('valid pixel', () => {
        const url = 'https://example.com/t/m_my_first_pixel_suffix1?1234&count=10';
        expect(() => validateSinglePixel(validator, url)).to.not.throw();
    });
});

describe('main.mjs - invalid pixels', () => {
    it('invalid suffix', () => {
        const url = 'https://example.com/t/m_my_first_pixel_wrongSuffix?1234=&count=10';
        expect(() => validateSinglePixel(validator, url)).to.throw();
    });

    it('invalid param', () => {
        const url = 'https://example.com/t/m_my_first_pixel?x=10';
        expect(() => validateSinglePixel(validator, url)).to.throw();
    });

    it('unknown pixel', () => {
        const url = 'https://example.com/t/unknown?x=10';
        expect(() => validateSinglePixel(validator, url)).to.throw();
    });
});
