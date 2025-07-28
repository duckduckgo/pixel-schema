import { expect } from 'chai';

import { tokenizePixelDefs } from '../src/tokenizer.mjs';
import { LivePixelsValidator, PixelValidationResult } from '../src/live_pixel_validator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { PIXEL_DELIMITER } from '../src/constants.mjs';

const productDef = {
    target: {
        key: 'appVersion',
        version: '1.0.0',
    },
    forceLowerCase: false,
};

describe('No common params nor suffixes', () => {
    const paramsValidator = new ParamsValidator({}, {}, {});
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

    it('no params should pass', () => {
        const prefix = 'simplePixel';
        const pixelStatus = liveValidator.validatePixel(prefix, '');
        expect(pixelStatus.errors).to.be.empty;
    });

    it('conforming pixel should pass', () => {
        const prefix = 'simplePixel';
        const params = 'param1=true';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('wrong type should fail', () => {
        const prefix = 'simplePixel';
        const params = 'param1=not_a_bool';
        const pixelStatus = liveValidator.validatePixel(prefix, params);

        const expectedErrors = ['/param1 must be boolean'];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
    });

    it('extra param should fail', () => {
        const prefix = 'simplePixel';
        const params = 'param1=true&param2=x';
        const pixelStatus = liveValidator.validatePixel(prefix, params);

        const expectedErrors = ["must NOT have additional properties. Found extra property 'param2'"];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
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
    const paramsValidator = new ParamsValidator(commonParams, {}, {});
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

    it('common param only should pass', () => {
        const params = 'common=42';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('both common and custom params should pass', () => {
        const params = 'param1=false&common=0';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('wrong common type should fail', () => {
        const params = 'common=200';
        const pixelStatus = liveValidator.validatePixel(prefix, params);

        const expectedErrors = ['/common must be <= 100'];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
    });
});

describe('Common suffixes', () => {
    const commonSuffixes = {
        exception: {
            key: 'exception',
        },
    };
    const paramsValidator = new ParamsValidator({}, commonSuffixes, {});
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
    const params = '';

    it('both common and custom suffix should pass', () => {
        const pixel = `${prefix}${PIXEL_DELIMITER}exception${PIXEL_DELIMITER}anystring${PIXEL_DELIMITER}1`;
        const pixelStatus = liveValidator.validatePixel(pixel, params);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('unexpected value should fail', () => {
        const pixel = `${prefix}${PIXEL_DELIMITER}wrongkey${PIXEL_DELIMITER}anystring${PIXEL_DELIMITER}1`;
        const pixelStatus = liveValidator.validatePixel(pixel, params);

        const expectedErrors = ["Suffix 'wrongkey' must be equal to one of the allowed values"];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
    });

    it('missing part of name should NOT fail', () => {
        const pixel = `${prefix}${PIXEL_DELIMITER}exception${PIXEL_DELIMITER}1`;
        const pixelStatus = liveValidator.validatePixel(pixel, params);

        expect(pixelStatus.errors).to.be.empty;
    });

    it('extra suffix should fail', () => {
        const pixel = `${prefix}${PIXEL_DELIMITER}exception${PIXEL_DELIMITER}anystring${PIXEL_DELIMITER}1${PIXEL_DELIMITER}extra`;
        const pixelStatus = liveValidator.validatePixel(pixel, params);

        const expectedErrors = ["must NOT have additional properties. Found extra suffix 'extra'"];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
    });
});

// Case sensitivity is especially tricky when base64 is involved,
// so the below tests test various scenarios
const testCases = [
    { base64Encoded: true, caseInsensitive: true },
    { base64Encoded: true, caseInsensitive: false },
    { base64Encoded: false, caseInsensitive: true },
    { base64Encoded: false, caseInsensitive: false },
];

testCases.forEach((scenario) => {
    describe(`Object param with scenario=${scenario}`, () => {
        const paramsValidator = new ParamsValidator({}, {}, {});
        const prefix = 'simplePixel';
        const pixelDefs = {
            simplePixel: {
                parameters: [
                    {
                        key: 'basicParam',
                        type: 'boolean',
                    },
                    {
                        key: 'objParamKey',
                        type: 'object',
                        properties: {
                            p1: {
                                type: 'boolean',
                            },
                            p2: {
                                type: 'object',
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
                ],
            },
        };

        // Setup according to scenario
        productDef.forceLowerCase = scenario.caseInsensitive;
        if (scenario.base64Encoded) {
            pixelDefs.simplePixel.parameters[1].encoding = 'base64';
        }

        function getStrObjParam(paramObj) {
            let paramStr = JSON.stringify(paramObj);
            if (scenario.base64Encoded) {
                paramStr = Buffer.from(paramStr).toString('base64');
            }
            return `objParamKey=${paramStr}`;
        }

        function getNoramlizedError(error) {
            return scenario.caseInsensitive ? error.toLowerCase() : error;
        }

        const tokenizedDefs = {};
        tokenizePixelDefs(pixelDefs, tokenizedDefs);
        const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);

        it('wrong types within obj schema', () => {
            const paramObj = {
                p1: 10,
                p2: {
                    nestedParam1: 'valid str',
                    nestedParam2: 'invalid',
                },
            };

            const pixelStatus = liveValidator.validatePixel(prefix, `${getStrObjParam(paramObj)}`);
            const expectedErrors = [
                getNoramlizedError('/objParamKey/p1 must be boolean'),
                getNoramlizedError('/objParamKey/p2/nestedParam2 must be integer'),
            ];
            expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
        });

        it('valid params', () => {
            const paramObj = {
                p1: false,
                p2: {
                    nestedParam1: 'valid str',
                    nestedParam2: 42,
                },
            };

            const pixelStatus = liveValidator.validatePixel(prefix, `${getStrObjParam(paramObj)}&basicParam=true`);
            expect(pixelStatus.errors).to.be.empty;
        });
    });
});

describe('Base64 simple param', () => {
    const paramsValidator = new ParamsValidator({}, {}, {});
    const prefix = 'simplePixel';
    const pixelDefs = {
        simplePixel: {
            parameters: [
                {
                    key: 'base64SimpleParam',
                    type: 'boolean',
                    encoding: 'base64',
                },
            ],
        },
    };

    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDef, {}, paramsValidator);

    it('invalid param', () => {
        const pixelStatus = liveValidator.validatePixel(prefix, `base64SimpleParam=${Buffer.from('123').toString('base64')}`);
        const expectedErrors = ['/base64SimpleParam must be boolean'];
        expect(Object.keys(pixelStatus.errors)).to.have.members(expectedErrors);
    });

    it('valid param', () => {
        const pixelStatus = liveValidator.validatePixel(prefix, `base64SimpleParam=${Buffer.from('false').toString('base64')}`);
        expect(pixelStatus.errors).to.be.empty;
    });
});

describe('DDG App Version Outdated', () => {
    const productDefWithVersion = {
        target: {
            key: 'appVersion',
            version: '2.0.0',
        },
        forceLowerCase: false,
    };

    const paramsValidator = new ParamsValidator({}, {}, {});
    const pixelDefs = {
        versionedPixel: {
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
    const tokenizedDefs = {};
    tokenizePixelDefs(pixelDefs, tokenizedDefs);
    const liveValidator = new LivePixelsValidator(tokenizedDefs, productDefWithVersion, {}, paramsValidator);

    it('older app version should return OLD_APP_VERSION status', () => {
        const prefix = 'versionedPixel';
        const params = 'appVersion=1.5.0&param1=test';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        
        expect(pixelStatus.status).to.equal(PixelValidationResult.OLD_APP_VERSION);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('current app version should pass validation', () => {
        const prefix = 'versionedPixel';
        const params = 'appVersion=2.0.0&param1=test';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        
        expect(pixelStatus.status).to.equal(PixelValidationResult.VALIDATION_PASSED);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('newer app version should pass validation', () => {
        const prefix = 'versionedPixel';
        const params = 'appVersion=2.1.0&param1=test';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        
        expect(pixelStatus.status).to.equal(PixelValidationResult.VALIDATION_PASSED);
        expect(pixelStatus.errors).to.be.empty;
    });

    it('invalid version format should continue with normal validation', () => {
        const prefix = 'versionedPixel';
        const params = 'appVersion=invalid&param1=test';
        const pixelStatus = liveValidator.validatePixel(prefix, params);
        
        // Should not trigger OLD_APP_VERSION since version is invalid
        expect(pixelStatus.status).to.equal(PixelValidationResult.VALIDATION_PASSED);
        expect(pixelStatus.errors).to.be.empty;
    });
});
