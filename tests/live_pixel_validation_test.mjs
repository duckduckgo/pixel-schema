import { expect } from 'chai';

import { DefsTokenizer } from '../src/tokenizer.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';

const productDef = {
    target: {
        key: 'appVersion',
        version: '1.0.0',
    },
    forceLowerCase: true,
};

describe('No common params nor suffixes', () => {
    const paramsValidator = new ParamsValidator('{}', '{}');
    const pixelDefs = {
        simplePixel: {
            parameters: [
                {
                    key: 'param1',
                    type: 'boolean',
                },
            ],
        },
    };
    const defsTokenizer = new DefsTokenizer();
    defsTokenizer.processPixelDefs(pixelDefs);
    const liveValidator = new LivePixelsValidator(defsTokenizer.getTokenizedDefs(), productDef, {}, paramsValidator);

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('no params should pass', () => {
        const prefix = 'simplePixel';
        const url = `/t/${prefix}`;
        liveValidator.validatePixel(prefix, url);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('conforming pixel should pass', () => {
        const prefix = 'simplePixel';
        const url = `/t/${prefix}?param1=true`;
        liveValidator.validatePixel(prefix, url);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('wrong type should fail', () => {
        const prefix = 'simplePixel';
        const url = `/t/${prefix}?param1=not_a_bool`;
        liveValidator.validatePixel(prefix, url);

        const expectedErrors = ['/param1 must be boolean'];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });

    it('extra param should fail', () => {
        const prefix = 'simplePixel';
        const url = `/t/${prefix}?param1=true&param2=x`;
        liveValidator.validatePixel(prefix, url);

        const expectedErrors = ["must NOT have additional properties. Found extra property 'param2'"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });

    it('ignores cache buster', () => {
        const prefix = 'simplePixel';
        const url = `/t/${prefix}?12345&param1=true`;
        liveValidator.validatePixel(prefix, url);
        expect(liveValidator.pixelErrors).to.be.empty;
    });
});

describe('Common params', () => {
    const commonParams = {
        common: {
            key: 'common',
            type: 'integer',
            minimum: 0,
            maximum: 100,
        },
    };
    const paramsValidator = new ParamsValidator(commonParams, '{}');
    const prefix = 'simplePixel';
    const pixelDefs = {
        simplePixel: {
            parameters: [
                'common',
                {
                    key: 'param1',
                    type: 'boolean',
                },
            ],
        },
    };
    const defsTokenizer = new DefsTokenizer();
    defsTokenizer.processPixelDefs(pixelDefs);
    const liveValidator = new LivePixelsValidator(defsTokenizer.getTokenizedDefs(), productDef, {}, paramsValidator);

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('common param only should pass', () => {
        const url = `/t/${prefix}?common=42`;
        liveValidator.validatePixel(prefix, url);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('both common and custom params should pass', () => {
        const url = `/t/${prefix}?param1=false&common=0`;
        liveValidator.validatePixel(prefix, url);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('wrong common type should fail', () => {
        const url = `/t/${prefix}?common=200`;
        liveValidator.validatePixel(prefix, url);

        const expectedErrors = ['/common must be <= 100'];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });
});

describe('Common suffixes', () => {
    const commonSuffixes = {
        exception: {
            key: 'exception',
        },
    };
    const paramsValidator = new ParamsValidator('{}', commonSuffixes);
    const prefix = 'simplePixel';
    const pixelDefs = {
        simplePixel: {
            suffixes: [
                'exception',
                {
                    enum: [1, 2, 3],
                },
            ],
        },
    };
    const defsTokenizer = new DefsTokenizer();
    defsTokenizer.processPixelDefs(pixelDefs);
    const liveValidator = new LivePixelsValidator(defsTokenizer.getTokenizedDefs(), productDef, {}, paramsValidator);
    const request = '/t/pixel'; // request doesn't matter here as we won't have any params

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('both common and custom suffix should pass', () => {
        const pixel = `${prefix}.exception.anystring.1`;
        liveValidator.validatePixel(pixel, request);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('unexpected value should fail', () => {
        const pixel = `${prefix}.wrongkey.anystring.1`;
        liveValidator.validatePixel(pixel, request);

        const expectedErrors = ["Suffix 'wrongkey' at index 0 /0 must be equal to one of the allowed values"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });

    it('missing part of name should NOT fail', () => {
        const pixel = `${prefix}.exception.1`;
        liveValidator.validatePixel(pixel, request);

        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('extra suffix should fail', () => {
        const pixel = `${prefix}.exception.anystring.1.extra`;
        liveValidator.validatePixel(pixel, request);

        const expectedErrors = ["must NOT have additional properties. Found extra suffix 'extra' at index 3"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });
});
