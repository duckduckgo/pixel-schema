import { expect } from 'chai';

import { tokenizePixelDefs } from '../src/tokenizer.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';

const productDef = {
    target: {
        key: 'appVersion',
        version: '1.0.0',
    },
    forceLowerCase: false,
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
    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('no params should pass', () => {
        const prefix = 'simplePixel';
        liveValidator.validatePixel(prefix, '[]');
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('conforming pixel should pass', () => {
        const prefix = 'simplePixel';
        const params = "['param1=true']";
        liveValidator.validatePixel(prefix, params);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('wrong type should fail', () => {
        const prefix = 'simplePixel';
        const params = "['param1=not_a_bool']";
        liveValidator.validatePixel(prefix, params);

        const expectedErrors = ['/param1 must be boolean'];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });

    it('extra param should fail', () => {
        const prefix = 'simplePixel';
        const params = "['param1=true','param2=x']";
        liveValidator.validatePixel(prefix, params);

        const expectedErrors = ["must NOT have additional properties. Found extra property 'param2'"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
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
    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('common param only should pass', () => {
        const params = "['common=42']";
        liveValidator.validatePixel(prefix, params);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('both common and custom params should pass', () => {
        const params = "['param1=false','common=0']";
        liveValidator.validatePixel(prefix, params);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('wrong common type should fail', () => {
        const params = "['common=200']";
        liveValidator.validatePixel(prefix, params);

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
    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);
    const params = '[]';

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    it('both common and custom suffix should pass', () => {
        const pixel = `${prefix}.exception.anystring.1`;
        liveValidator.validatePixel(pixel, params);
        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('unexpected value should fail', () => {
        const pixel = `${prefix}.wrongkey.anystring.1`;
        liveValidator.validatePixel(pixel, params);

        const expectedErrors = ["Suffix 'wrongkey' at index 0 /0 must be equal to one of the allowed values"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });

    it('missing part of name should NOT fail', () => {
        const pixel = `${prefix}.exception.1`;
        liveValidator.validatePixel(pixel, params);

        expect(liveValidator.pixelErrors).to.be.empty;
    });

    it('extra suffix should fail', () => {
        const pixel = `${prefix}.exception.anystring.1.extra`;
        liveValidator.validatePixel(pixel, params);

        const expectedErrors = ["must NOT have additional properties. Found extra suffix 'extra' at index 3"];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.include.all.members(expectedErrors);
    });
});

describe('Base64 params', () => {
    const paramsValidator = new ParamsValidator({}, {});
    const prefix = 'simplePixel';
    const pixelDefs = {
        simplePixel: {
            parameters: [
                {
                    key: 'basicParam',
                    type: 'boolean',
                },
                {
                    key: 'base64ParamKey',
                    base64DataSchema: {
                        properties: {
                            p1: {
                                type: 'boolean',
                            },
                            p2: {
                                properties: {
                                    nestedParam1: {
                                        type: 'string',
                                    },
                                    nestedParam2: {
                                        type: 'integer',
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        },
    };
    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);

    beforeEach(function () {
        liveValidator.pixelErrors = {};
        liveValidator.undocumentedPixels.clear();
    });

    function getStrBase64Param(paramObj) {
        return `'base64ParamKey=${Buffer.from(JSON.stringify(paramObj)).toString('base64')}'`;
    }

    it('wrong types within base64 schema', () => {
        const paramObj = {
            p1: 10,
            p2: {
                nestedParam1: 'valid str',
                nestedParam2: 'invalid',
            },
        };

        liveValidator.validatePixel(prefix, `[${getStrBase64Param(paramObj)}]`);
        const expectedErrors = ['/p1 must be boolean', '/p2/nestedParam2 must be integer'];
        expect(liveValidator.pixelErrors).to.have.property(prefix);
        expect(Object.keys(liveValidator.pixelErrors[prefix])).to.have.members(expectedErrors);
    });

    it('valid param with valid base64 param', () => {
        const paramObj = {
            p1: false,
            p2: {
                nestedParam1: 'valid str',
                nestedParam2: 42,
            },
        };

        liveValidator.validatePixel(prefix, `[${getStrBase64Param(paramObj)},'basicParam=true']`);
        expect(liveValidator.pixelErrors).to.be.empty;
    });
});
