import { expect } from 'chai';

import { DefinitionsValidator } from '../src/definitions_validator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';

describe('Validating commons', () => {
    const commons = {
        invalid: {},
    };
    const validator = new DefinitionsValidator(commons, commons, {});

    it('params must have required properties', () => {
        const errors = validator.validateCommonParamsDefinition();
        const expectedErrors = [
            "/invalid must have required property 'key'",
            "/invalid must have required property 'description'",
            '/invalid must match a schema in anyOf',
        ];
        expect(errors).to.include.members(expectedErrors);
    });

    it('suffixes must have required properties', () => {
        const errors = validator.validateCommonSuffixesDefinition();
        const expectedErrors = ["/invalid must have required property 'description'", '/invalid must match a schema in anyOf'];
        expect(errors).to.include.members(expectedErrors);
    });
});

describe('Pixel with no owner', () => {
    const validator = new DefinitionsValidator({}, {}, {});

    it('no owner', () => {
        const pixel = {
            description: 'Pixel with owners field but no owner',
            owners: [],
            triggers: ['other'],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        const expectedErrors = ['/pixel/owners must NOT have fewer than 1 items'];
        expect(errors).to.have.members(expectedErrors);
    });
});

describe('Pixel with no params and no suffixes', () => {
    const validator = new DefinitionsValidator({}, {}, {});

    // We no longer require a trigger, if one is not specified, it defaults to 'other'
    it('must have required properties', () => {
        const errors = validator.validatePixelsDefinition({ pixel: {} });
        const expectedErrors = ["/pixel must have required property 'description'", "/pixel must have required property 'owners'"];

        expect(errors).to.have.members(expectedErrors);
    });

    it('invalid trigger', () => {
        const pixel = {
            description: 'A simple pixel',
            owners: ['owner'],
            triggers: ['invalid_trigger'],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        const expectedErrors = ['/pixel/triggers/0 must be equal to one of the allowed values'];
        expect(errors).to.have.members(expectedErrors);
    });

    it('valid pixel', () => {
        const pixel = {
            description: 'A simple pixel',
            owners: ['owner'],
            triggers: ['other'],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        expect(errors).to.be.empty;
    });

    it('extra property', () => {
        const pixel = {
            description: 'A simple pixel',
            owners: ['owner'],
            triggers: ['other'],
            unexpected: 'property',
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        const expectedErrors = ["/pixel must NOT have additional properties. Found extra property 'unexpected'"];
        expect(errors).to.have.members(expectedErrors);
    });
});

describe('Pixel with params', () => {
    const commonParams = {
        common_param: {
            key: 'common_param',
            description: 'A common parameter',
        },
    };

    function validateErrors(params, expectedErrors, strict = true) {
        const pixel = {
            description: 'A simple pixel',
            owners: ['owner'],
            triggers: ['other'],
            parameters: params,
        };

        const validator = new DefinitionsValidator(commonParams, {}, {});
        const errors = validator.validatePixelsDefinition({ pixel });
        if (strict) {
            expect(errors).to.have.members(expectedErrors);
        } else {
            expect(errors).to.include.members(expectedErrors);
        }
    }

    it('invalid shortcut', () => {
        validateErrors(['invalid_shortcut'], ["pixel --> invalid shortcut 'invalid_shortcut' - please update common params/suffixes"]);
    });

    it('valid shortcut', () => {
        validateErrors(['common_param'], []);
    });

    it('invalid custom param - empty', () => {
        validateErrors(
            [{}],
            [
                "/pixel/parameters/0 must have required property 'key'",
                "/pixel/parameters/0 must have required property 'description'",
                '/pixel/parameters/0 must match a schema in anyOf',
            ],
            false,
        );
    });

    it('invalid custom param - missing description', () => {
        validateErrors([{ key: 'custom_param' }], ["/pixel/parameters/0 must have required property 'description'"], false);
    });

    it('invalid custom param - using both key and keyPattern', () => {
        validateErrors(
            [
                {
                    key: 'custom_param',
                    keyPattern: 'a pattern',
                    description: 'A custom parameter',
                },
            ],
            ['/pixel/parameters/0 must match a schema in anyOf'],
            false,
        );
    });

    it('invalid custom params - duplicate keys', () => {
        validateErrors(
            [
                {
                    key: 'custom_param',
                    description: 'A custom parameter',
                },
                {
                    key: 'custom_param',
                    description: 'duplicated custom parameter',
                },
            ],
            ["pixel --> duplicate key 'custom_param' found!"],
        );
    });

    it('invalid custom params - duplicate keyPatterns', () => {
        validateErrors(
            [
                {
                    keyPattern: '^param[0-9]$',
                    description: 'A custom parameter',
                },
                {
                    keyPattern: '^param[0-9]$',
                    description: 'duplicated custom parameter',
                },
            ],
            ["pixel --> duplicate keyPattern '^param[0-9]$' found!"],
        );
    });

    it('invalid custom params - key matches keyPattern', () => {
        validateErrors(
            [
                {
                    keyPattern: '^param[0-9]$',
                    description: 'A custom parameter',
                },
                {
                    key: 'param1',
                    description: 'duplicated custom parameter',
                },
            ],
            ['pixel --> strict mode: property param1 matches pattern ^param[0-9]$ (use allowMatchingProperties)'],
        );
    });

    it('invalid custom params - custom param matches common', () => {
        validateErrors(
            [
                'common_param',
                {
                    key: 'common_param',
                    description: 'duplicated custom parameter',
                },
            ],
            ["pixel --> duplicate key 'common_param' found!"],
        );
    });

    it('valid pixel with both custom and common params', () => {
        validateErrors(
            [
                'common_param',
                {
                    key: 'custom_param',
                    description: 'custom parameter',
                },
            ],
            [],
        );
    });
});

describe('Pixel with suffixes', () => {
    const commonSuffixes = {
        common_suffix: {
            description: 'A common suffix',
        },
    };
    const validator = new DefinitionsValidator({}, commonSuffixes, {});

    // Most of the logic is shared with params, so just run a smoke-test
    it('valid pixel with both custom and common suffix', () => {
        const pixel = {
            description: 'A simple pixel',
            owners: ['owner'],
            triggers: ['other'],
            suffixes: [
                'common_suffix',
                {
                    description: 'custom suffix',
                },
                {
                    key: 'custom_suffix2',
                    description: 'custom suffix with key and type',
                    type: 'boolean',
                },
            ],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        expect(errors).to.be.empty;
    });
});

describe('Object-based params', () => {
    const paramsValidator = new ParamsValidator({}, {}, {});
    it('incorrect type for propertied object', () => {
        const param = {
            key: 'objKey',
            description: 'An object param',
            type: 'string',
            properties: {
                p1: { type: 'string' },
            },
        };

        expect(() => paramsValidator.compileParamsSchema([param])).to.throw(
            'strict mode: missing type "object" for keyword "properties" at "#/properties/objKey"',
        );
    });

    it('additionalProperties not allowed', () => {
        const param = {
            key: 'objKey',
            description: 'An object param',
            type: 'object',
            additionalProperties: true,
        };

        expect(() => paramsValidator.compileParamsSchema([param])).to.throw('additionalProperties are not allowed');
    });

    it('unknown keyword', () => {
        const param = {
            key: 'objKey',
            description: 'An object param',
            type: 'object',
            properties: {
                p1: {
                    type: 'string',
                    unexpected: 'property',
                },
            },
        };

        expect(() => paramsValidator.compileParamsSchema([param])).to.throw('strict mode: unknown keyword: "unexpected"');
    });

    it('valid schema', () => {
        const param = {
            key: 'objKey',
            description: 'An object param',
            type: 'object',
            properties: {
                p1: {
                    type: 'string',
                },
            },
        };

        expect(() => paramsValidator.compileParamsSchema([param])).to.not.throw();
    });
});

describe('Suffix alternatives schema (ParamsValidator)', () => {
    const paramsValidator = new ParamsValidator({}, { exception: { key: 'exception' } }, {});

    it('nested arrays are compiled (anyOf) without error', () => {
        const suffixes = [['exception', { enum: [1, 2, 3] }], [{ enum: [4, 5] }]];
        expect(() => paramsValidator.compileSuffixesSchema(suffixes)).to.not.throw();
    });

    it('flat array is compiled without error', () => {
        const suffixes = ['exception', { enum: [1, 2, 3] }];
        expect(() => paramsValidator.compileSuffixesSchema(suffixes)).to.not.throw();
    });

    it('mixed array types should throw', () => {
        const suffixes = ['exception', ['platform', 'form_factor']];
        expect(() => paramsValidator.compileSuffixesSchema(suffixes)).to.throw(
            'Invalid suffixes definition: when using nested arrays, provide only arrays of suffix sequences.',
        );
    });

    it('non-array suffixes should throw', () => {
        // @ts-ignore - intentionally invalid type
        expect(() => paramsValidator.compileSuffixesSchema('invalid')).to.throw(
            'suffixes must be an array (either a list or a list of lists)',
        );
    });
});

describe('castEnumsToString (ParamsValidator)', () => {
    const validator = new ParamsValidator({}, {}, {});

    it('casts numeric enum values to strings when no type is provided', () => {
        const item = { enum: [1, 2, '3'] };
        validator.castEnumsToString(item);
        expect(item.enum).to.deep.equal(['1', '2', '3']);
    });

    it('does not cast enum values when a type is defined', () => {
        const item = { type: 'number', enum: [1, 2, 3] };
        validator.castEnumsToString(item);
        expect(item.enum).to.deep.equal([1, 2, 3]);
    });
});

describe('ParamsValidator.compileParamsSchema', () => {
    it('merges ignoreParams with parameters and allows ignored keys', () => {
        const ignoreParams = {
            ignored: { key: 'ignored', description: 'Ignored param' },
        };
        const validator = new ParamsValidator({}, {}, ignoreParams);

        const validate = validator.compileParamsSchema([]);

        expect(validate({ ignored: 'value' })).to.be.true;
        expect(validate({ other: 'value' })).to.be.false;
    });

    it('parameters take precedence over ignoreParams on duplicate keys', () => {
        const ignoreParams = {
            dup: { key: 'dup', description: 'Number only', type: 'number', enum: [1] },
        };
        const parameters = [{ key: 'dup', description: 'String dup', enum: ['a', 'b'] }];
        const validator = new ParamsValidator({}, {}, ignoreParams);

        const validate = validator.compileParamsSchema(parameters);

        expect(validate({ dup: 'a' })).to.be.true;
        expect(validate({ dup: 1 })).to.be.false; // would have been valid if ignore param took precedence
    });

    describe('with searchExpParams', () => {
        const ignoreParams = {
            ignore: { key: 'ignore', description: 'Number only', type: 'number', enum: [1] },
        };
        it('adds experiment params when pixel prefix matches and feature is enabled', () => {
            const searchExpParams = {
                enabled: true,
                expPixels: {
                    'm.foo.exp': true,
                },
                expDefs: {
                    exp_param: { key: 'exp_param', description: 'Experiment param' },
                },
            };
            const validator = new ParamsValidator({}, {}, ignoreParams, searchExpParams);
            const validate = validator.compileParamsSchema([], 'm.foo.exp');
            expect(validate({ exp_param: 'test' })).to.be.true;
            expect(validate({ other_param: 'test' })).to.be.false;
        });

        it('does not add experiment params when pixel prefix does not match', () => {
            const searchExpParams = {
                enabled: true,
                expPixels: {
                    'm.foo.exp': true,
                },
                expDefs: {
                    exp_param: { key: 'exp_param', description: 'Experiment param' },
                },
            };
            const validator = new ParamsValidator({}, {}, ignoreParams, searchExpParams);
            const validate = validator.compileParamsSchema([], 'm.bar.baz');
            expect(validate({ exp_param: 'test' })).to.be.false;
        });

        it('does not add experiment params when feature is disabled', () => {
            const searchExpParams = {
                enabled: false,
                expPixels: {
                    'm.foo.exp': true,
                },
                expDefs: {
                    exp_param: { key: 'exp_param', description: 'Experiment param' },
                },
            };
            const validator = new ParamsValidator({}, {}, ignoreParams, searchExpParams);
            const validate = validator.compileParamsSchema([], 'm.foo.exp');
            expect(validate({ exp_param: 'test' })).to.be.false;
        });

        it('merges experiment params with ignoreParams', () => {
            const searchExpParams = {
                enabled: true,
                expPixels: {
                    'm.foo.exp': true,
                },
                expDefs: {
                    exp_param: { key: 'exp_param', description: 'Experiment param' },
                },
            };
            const validator = new ParamsValidator({}, {}, ignoreParams, searchExpParams);
            const validate = validator.compileParamsSchema([], 'm.foo.exp');
            expect(validate({ exp_param: 'test', ignore: 1 })).to.be.true;
            expect(validate({ exp_param: 'test' })).to.be.true;
            expect(validate({ ignore: '1' })).to.be.true;
        });

        it('pixel parameters take precedence over experiment params', () => {
            const searchExpParams = {
                enabled: true,
                expPixels: {
                    'm.foo.exp': true,
                },
                expDefs: {
                    exp_param: { key: 'exp_param', description: 'Experiment param' },
                },
            };
            const parameters = [{ key: 'exp_param', description: 'Pixel-defined param', enum: ['override'] }];
            const validator = new ParamsValidator({}, {}, ignoreParams, searchExpParams);
            const validate = validator.compileParamsSchema(parameters, 'm.foo.exp');
            expect(validate({ exp_param: 'override' })).to.be.true;
            expect(validate({ exp_param: 'test' })).to.be.false;
        });
    });
});

// Cover params + ignoreParams merge via DefinitionsValidator
describe('Params merging with ignoreParams (DefinitionsValidator)', () => {
    it('parameters take precedence over ignoreParams (no duplicate key error)', () => {
        const ignoreParams = {
            duplicate: { key: 'duplicate', description: 'ignored param' },
        };
        const validator = new DefinitionsValidator({}, {}, ignoreParams);

        const pixel = {
            description: 'Pixel with param also present in ignoreParams',
            owners: ['owner'],
            triggers: ['other'],
            parameters: [{ key: 'duplicate', description: 'custom overrides' }],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        expect(errors).to.be.empty;
    });

    it('ignoreParams keyPattern collides with concrete key (strict mode error)', () => {
        const ignoreParams = {
            patterned: { keyPattern: '^param[0-9]$', description: 'pattern in ignore' },
        };
        const validator = new DefinitionsValidator({}, {}, ignoreParams);

        const pixel = {
            description: 'Pixel where key matches ignore pattern',
            owners: ['owner'],
            triggers: ['other'],
            parameters: [{ key: 'param1', description: 'concrete key' }],
        };

        const errors = validator.validatePixelsDefinition({ pixel });
        const expectedErrors = ['pixel --> strict mode: property param1 matches pattern ^param[0-9]$ (use allowMatchingProperties)'];
        expect(errors).to.have.members(expectedErrors);
    });
});

