import { expect } from 'chai';

import { PixelDefinitionsValidator, WideEventDefinitionsValidator } from '../src/definitions_validator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';

describe('Validating commons', () => {
    const commons = {
        invalid: {},
    };
    const validator = new PixelDefinitionsValidator(commons, commons, {});

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
    const validator = new PixelDefinitionsValidator({}, {}, {});

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
    const validator = new PixelDefinitionsValidator({}, {}, {});

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

        const validator = new PixelDefinitionsValidator(commonParams, {}, {});
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
    const validator = new PixelDefinitionsValidator({}, commonSuffixes, {});

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

// Cover params + ignoreParams merge via PixelDefinitionsValidator
describe('Params merging with ignoreParams (PixelDefinitionsValidator)', () => {
    it('parameters take precedence over ignoreParams (no duplicate key error)', () => {
        const ignoreParams = {
            duplicate: { key: 'duplicate', description: 'ignored param' },
        };
        const validator = new PixelDefinitionsValidator({}, {}, ignoreParams);

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
        const validator = new PixelDefinitionsValidator({}, {}, ignoreParams);

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

describe('Search experiments validation', () => {
    const validator = new PixelDefinitionsValidator({}, {}, {});
    const searchExperiments = {
        aaspuexp: {
            allocation: 0,
            description: 'A/A longitudinal test for searches per user framework',
            assignment: 'backend_spu',
            persistent: false,
            variants: ['a', 'b'],
            services: ['deep'],
        },
        aiheaderexp: {
            allocation: 1.0,
            description: 'Show AI chat pill in the header',
            assignment: 'backend',
            persistent: false,
            variants: ['b'],
        },
        duckplayerexp: {
            allocation: 1,
            description: 'Port Duck Player modal to React',
            assignment: 'frontend',
            persistent: false,
            variants: ['b'],
        },
    };

    it('valid search experiments pass schema validation', () => {
        const errors = validator.validateSearchExperimentsDefinition(searchExperiments);
        expect(errors).to.be.empty;
    });

    it('missing required fields surface schema errors', () => {
        const invalid = JSON.parse(JSON.stringify(searchExperiments));
        delete invalid.aiheaderexp.allocation;

        const errors = validator.validateSearchExperimentsDefinition(invalid);
        expect(errors).to.include("/aiheaderexp must have required property 'allocation'");
    });
});

describe('Wide Event Validation', () => {
    const commonProps = {
        appName: {
            type: 'string',
            description: 'Name of the application',
        },
    };
    const validator = new WideEventDefinitionsValidator(commonProps);

    const baseEvent = {
        meta: {
            version: {
                description: 'Base event version',
                value: 1,
            },
        },
        app: {
            name: {
                type: 'string',
                description: 'App name',
                enum: ['TestApp'],
            },
            version: {
                type: 'string',
                description: 'App version',
                pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$',
            },
        },
        global: {
            platform: {
                type: 'string',
                description: 'Platform',
                enum: ['Windows'],
            },
            type: {
                type: 'string',
                description: 'Type',
                enum: ['app'],
            },
            sample_rate: {
                type: 'number',
                description: 'Sample rate',
                minimum: 0,
                maximum: 1,
            },
        },
        feature: {
            name: {
                type: 'string',
                description: 'Feature name',
            },
            status: {
                type: 'string',
                description: 'Status',
            },
            data: {
                ext: {},
            },
        },
        context: {
            name: {
                type: 'string',
                description: 'Context name',
            },
        },
    };

    const validWideEvent = {
        w_test_event: {
            description: 'A test wide event',
            owners: ['tester'],
            meta: {
                type: 'w_test_event',
                version: '0.0',
            },
            context: { name: ['test-context'] },
            feature: {
                name: 'test-feature',
                status: ['SUCCESS'],
                data: {
                    ext: {
                        extra_data: {
                            type: 'string',
                            description: 'Extra data',
                        },
                    },
                },
            },
        },
    };

    it('valid wide event', () => {
        const { errors } = validator.validateWideEventDefinition(validWideEvent, baseEvent);
        expect(errors).to.be.empty;
    });

    it('missing required property', () => {
        const invalid = JSON.parse(JSON.stringify(validWideEvent));
        delete invalid.w_test_event.description;
        const { errors } = validator.validateWideEventDefinition(invalid, baseEvent);
        expect(errors).to.include("w_test_event: Generated schema does not match metaschema - must have required property 'description'");
    });

    it('invalid property type', () => {
        const invalid = JSON.parse(JSON.stringify(validWideEvent));
        invalid.w_test_event.description = 123;
        const { errors } = validator.validateWideEventDefinition(invalid, baseEvent);
        expect(errors.some((e) => e.includes('w_test_event: Generated schema does not match metaschema'))).to.be.true;
        expect(errors.some((e) => e.includes('/description must be string'))).to.be.true;
    });

    it('valid shortcut expansion', () => {
        const withShortcut = JSON.parse(JSON.stringify(validWideEvent));
        withShortcut.w_test_event.meta.type = 'w_test_event_shortcut'; // Unique type
        withShortcut.w_test_event.feature.data.ext.app_name = 'appName'; // Shortcut to commonProps

        // We need to rename the key too, although validation iterates over keys, duplicate check uses meta.type
        const event = { w_test_event_shortcut: withShortcut.w_test_event };

        const { errors } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;
    });

    it('invalid shortcut', () => {
        const withInvalidShortcut = JSON.parse(JSON.stringify(validWideEvent));
        withInvalidShortcut.w_test_event.meta.type = 'w_test_event_invalid_shortcut'; // Unique type
        withInvalidShortcut.w_test_event.feature.data.ext.invalid_field = 'invalidShortcut';

        const event = { w_test_event_invalid_shortcut: withInvalidShortcut.w_test_event };

        const { errors } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors.some((e) => e.includes('w_test_event_invalid_shortcut: Generated schema does not match metaschema'))).to.be.true;
        expect(errors.some((e) => e.includes('invalid_field'))).to.be.true;
    });

    it('duplicate meta.type', () => {
        const first = JSON.parse(JSON.stringify(validWideEvent));
        first.w_test_event.meta.type = 'w_test_event_dup';
        const firstEvent = { w_test_event_dup: first.w_test_event };

        const second = JSON.parse(JSON.stringify(validWideEvent));
        second.w_test_event.meta.type = 'w_test_event_dup';
        const secondEvent = { w_test_event_dup: second.w_test_event };

        const firstResult = validator.validateWideEventDefinition(firstEvent, baseEvent);
        expect(firstResult.errors).to.be.empty;

        const secondResult = validator.validateWideEventDefinition(secondEvent, baseEvent);
        expect(secondResult.errors).to.include('w_test_event_dup --> Conflicting/duplicated definitions found!');
    });

    it('invalid owner with userMap', () => {
        const userMap = { validUser: '123' };
        const invalidOwner = JSON.parse(JSON.stringify(validWideEvent));
        invalidOwner.w_test_event.meta.type = 'w_test_event_owner';
        invalidOwner.w_test_event.owners = ['invalidUser'];

        const event = { w_test_event_owner: invalidOwner.w_test_event };

        const { errors } = validator.validateWideEventDefinition(event, baseEvent, userMap);
        expect(errors).to.include('Owner invalidUser for wide event w_test_event_owner not in list of acceptable github user names');
    });

    it('requires meta.type and meta.version', () => {
        const missingType = JSON.parse(JSON.stringify(validWideEvent));
        missingType.w_test_event.meta.type = '';
        let result = validator.validateWideEventDefinition(missingType, baseEvent);
        expect(result.errors).to.include("w_test_event: 'meta.type' is required");

        const missingVersion = JSON.parse(JSON.stringify(validWideEvent));
        missingVersion.w_test_event.meta.version = '';
        result = validator.validateWideEventDefinition(missingVersion, baseEvent);
        expect(result.errors).to.include("w_test_event: 'meta.version' is required");
    });

    it('meta.type must match event key', () => {
        const mismatch = JSON.parse(JSON.stringify(validWideEvent));
        mismatch.w_test_event.meta.type = 'w_other_event';
        const result = validator.validateWideEventDefinition(mismatch, baseEvent);
        expect(result.errors).to.include("w_test_event: 'meta.type' must match event key");
    });

    it('rejects app defined in event', () => {
        const withApp = JSON.parse(JSON.stringify(validWideEvent));
        withApp.w_test_event.meta.type = 'w_test_event_with_app';
        withApp.w_test_event.app = { name: { type: 'string', description: 'App name' } };

        const event = { w_test_event_with_app: withApp.w_test_event };

        const { errors } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors).to.include("w_test_event_with_app: 'app' section should not be defined in event - it comes from base_event.json");
    });

    it('rejects global defined in event', () => {
        const withGlobal = JSON.parse(JSON.stringify(validWideEvent));
        withGlobal.w_test_event.meta.type = 'w_test_event_with_global';
        withGlobal.w_test_event.global = { platform: { type: 'string', description: 'Platform' } };

        const event = { w_test_event_with_global: withGlobal.w_test_event };

        const { errors } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors).to.include(
            "w_test_event_with_global: 'global' section should not be defined in event - it comes from base_event.json",
        );
    });

    it('requires baseEvent', () => {
        const { errors } = validator.validateWideEventDefinition(validWideEvent, null);
        expect(errors).to.include('base_event.json is required for wide event validation');
    });

    it('requires feature property', () => {
        const missingFeature = {
            w_no_feature: {
                description: 'Event missing feature',
                owners: ['tester'],
                meta: { type: 'w_no_feature', version: '0.0' },
                context: { name: ['test'] },
                // feature is missing - schema validation catches malformed merged result
            },
        };

        const { errors } = validator.validateWideEventDefinition(missingFeature, baseEvent);
        expect(errors.length).to.be.greaterThan(0);
        expect(errors.some((e) => e.includes('w_no_feature: Generated schema does not match metaschema'))).to.be.true;
    });

    describe('feature.data.error array support', () => {
        const buildEvent = (eventName, errorProps) => ({
            [eventName]: {
                description: 'Event with array error fields',
                owners: ['tester'],
                meta: { type: eventName, version: '0.0' },
                context: { name: ['test-context'] },
                feature: {
                    name: 'test-feature',
                    status: ['FAILURE'],
                    data: {
                        ext: {},
                        error: {
                            domain: { type: 'string', description: 'Top-level error domain' },
                            code: { type: 'integer', description: 'Top-level error code' },
                            ...errorProps,
                        },
                    },
                },
            },
        });

        it('accepts array of strings for underlying_domain', () => {
            const event = buildEvent('w_underlying_domain_array', {
                underlying_domain: {
                    type: 'array',
                    description: 'Stack of underlying error domains',
                    items: { type: 'string' },
                },
            });
            const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors).to.be.empty;
            const errorProps = generatedSchemas.w_underlying_domain_array.properties.feature.properties.data.properties.error.properties;
            expect(errorProps.underlying_domain).to.deep.equal({
                type: 'array',
                description: 'Stack of underlying error domains',
                items: { type: 'string' },
            });
        });

        it('accepts array of integers for underlying_code', () => {
            const event = buildEvent('w_underlying_code_array', {
                underlying_code: {
                    type: 'array',
                    description: 'Stack of underlying error codes',
                    items: { type: 'integer' },
                },
            });
            const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors).to.be.empty;
            const errorProps = generatedSchemas.w_underlying_code_array.properties.feature.properties.data.properties.error.properties;
            expect(errorProps.underlying_code).to.deep.equal({
                type: 'array',
                description: 'Stack of underlying error codes',
                items: { type: 'integer' },
            });
        });

        it('still accepts scalar underlying_domain and underlying_code', () => {
            const event = buildEvent('w_underlying_scalar', {
                underlying_domain: { type: 'string', description: 'Underlying error domain' },
                underlying_code: { type: 'integer', description: 'Underlying error code' },
            });
            const { errors } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors).to.be.empty;
        });

        it('rejects array underlying_domain with non-string items', () => {
            const event = buildEvent('w_underlying_domain_bad_items', {
                underlying_domain: {
                    type: 'array',
                    description: 'Stack of underlying error domains',
                    items: { type: 'integer' },
                },
            });
            const { errors } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors.some((e) => e.includes('w_underlying_domain_bad_items: Generated schema does not match metaschema'))).to.be.true;
        });

        it('rejects array underlying_code with non-integer items', () => {
            const event = buildEvent('w_underlying_code_bad_items', {
                underlying_code: {
                    type: 'array',
                    description: 'Stack of underlying error codes',
                    items: { type: 'string' },
                },
            });
            const { errors } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors.some((e) => e.includes('w_underlying_code_bad_items: Generated schema does not match metaschema'))).to.be.true;
        });

        it('accepts and enforces enum on string array items', async () => {
            const event = buildEvent('w_underlying_domain_enum', {
                underlying_domain: {
                    type: 'array',
                    description: 'Bounded set of underlying error domains',
                    items: { type: 'string', enum: ['NSURLErrorDomain', 'WebKitErrorDomain'] },
                },
            });
            const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors).to.be.empty;

            const Ajv2020 = (await import('ajv/dist/2020.js')).default;
            // eslint-disable-next-line new-cap
            const ajv = new Ajv2020.default({ allErrors: true });
            const validate = ajv.compile(generatedSchemas.w_underlying_domain_enum);
            const payload = {
                meta: { type: 'w_underlying_domain_enum', version: '1.0.0' },
                app: { name: 'TestApp', version: '1.2.3' },
                global: { platform: 'Windows', type: 'app', sample_rate: 1 },
                feature: {
                    name: 'test-feature',
                    status: 'FAILURE',
                    data: {
                        ext: {},
                        error: { domain: 'X', code: 1, underlying_domain: ['NSURLErrorDomain'] },
                    },
                },
                context: { name: 'test-context' },
            };
            expect(validate(payload), JSON.stringify(validate.errors)).to.be.true;

            payload.feature.data.error.underlying_domain = ['NotInEnum'];
            expect(validate(payload)).to.be.false;
        });

        it('accepts and enforces enum on integer array items', async () => {
            const event = buildEvent('w_underlying_code_enum', {
                underlying_code: {
                    type: 'array',
                    description: 'Bounded set of underlying error codes',
                    items: { type: 'integer', enum: [-1009, -1001, 0] },
                },
            });
            const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
            expect(errors).to.be.empty;

            const Ajv2020 = (await import('ajv/dist/2020.js')).default;
            // eslint-disable-next-line new-cap
            const ajv = new Ajv2020.default({ allErrors: true });
            const validate = ajv.compile(generatedSchemas.w_underlying_code_enum);
            const payload = {
                meta: { type: 'w_underlying_code_enum', version: '1.0.0' },
                app: { name: 'TestApp', version: '1.2.3' },
                global: { platform: 'Windows', type: 'app', sample_rate: 1 },
                feature: {
                    name: 'test-feature',
                    status: 'FAILURE',
                    data: {
                        ext: {},
                        error: { domain: 'X', code: 1, underlying_code: [-1009, 0] },
                    },
                },
                context: { name: 'test-context' },
            };
            expect(validate(payload), JSON.stringify(validate.errors)).to.be.true;

            payload.feature.data.error.underlying_code = [42];
            expect(validate(payload)).to.be.false;
        });
    });
});

describe('Wide Event Base Event Merging', () => {
    const commonProps = {
        appName: {
            type: 'string',
            description: 'Name of the application',
            enum: ['testApp'],
        },
        appVersion: {
            type: 'string',
            description: 'Version of the application',
            pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$',
        },
    };
    const validator = new WideEventDefinitionsValidator(commonProps);

    const baseEvent = {
        meta: {
            version: {
                description: 'Base event version',
                value: 1,
            },
        },
        app: {
            name: {
                type: 'string',
                description: 'The name of the application',
                enum: ['Windows'],
            },
            version: {
                type: 'string',
                description: 'The version of the application',
                pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$',
            },
        },
        global: {
            platform: {
                type: 'string',
                description: 'The platform the app is running on',
                enum: ['Windows'],
            },
            type: {
                type: 'string',
                description: 'The type of application',
                enum: ['app'],
            },
            sample_rate: {
                type: 'number',
                description: 'Sample rate for this pixel',
                minimum: 0,
                maximum: 1,
            },
        },
        feature: {
            name: {
                type: 'string',
                description: 'The feature name for this pixel',
            },
            status: {
                type: 'string',
                description: 'The overall status of the operation',
            },
            data: {
                ext: {},
            },
        },
        context: {
            name: {
                type: 'string',
                description: 'Context name for the pixel',
            },
        },
    };

    const newFormatEvent = {
        w_test_merge: {
            description: 'A test wide event for merging',
            owners: ['tester'],
            meta: {
                type: 'w_test_merge',
                version: '0.0',
            },
            context: { name: ['onboarding', 'settings'] },
            feature: {
                name: 'test-feature',
                status: ['SUCCESS', 'FAILURE'],
                data: {
                    ext: {
                        custom_field: {
                            type: 'string',
                            description: 'A custom field',
                        },
                    },
                },
            },
        },
    };

    it('should merge new format event with base event', () => {
        const { errors, generatedSchemas } = validator.validateWideEventDefinition(newFormatEvent, baseEvent);
        expect(errors).to.be.empty;
        expect(generatedSchemas).to.have.property('w_test_merge');

        const generated = generatedSchemas.w_test_merge;
        // Check that context array was transformed to context.name.enum (at root level)
        expect(generated.properties.context.properties.name.enum).to.deep.equal(['onboarding', 'settings']);
        // Check that feature.name string was transformed to feature.name.enum
        expect(generated.properties.feature.properties.name.enum).to.deep.equal(['test-feature']);
        // Check that feature.status array was transformed to feature.status.enum
        expect(generated.properties.feature.properties.status.enum).to.deep.equal(['SUCCESS', 'FAILURE']);
        // Check that custom data was merged
        expect(generated.properties.feature.properties.data.properties.ext.properties.custom_field).to.deep.equal({
            type: 'string',
            description: 'A custom field',
        });
        // Check that base event properties are preserved
        expect(generated.properties.global.properties.platform.enum).to.deep.equal(['Windows']);
        expect(generated.properties.app.properties.name.enum).to.deep.equal(['Windows']);
    });

    it('should expand shortcuts in merged event', () => {
        const eventWithShortcut = {
            w_test_shortcut_merge: {
                description: 'Event with shortcut after merge',
                owners: ['tester'],
                meta: {
                    type: 'w_test_shortcut_merge',
                    version: '0.0',
                },
                context: { name: ['settings'] },
                feature: {
                    name: 'shortcut-test',
                    status: ['SUCCESS'],
                    data: {
                        ext: {
                            app_name: 'appName', // shortcut to commonProps
                        },
                    },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(eventWithShortcut, baseEvent);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_test_shortcut_merge;
        // Check that shortcut was expanded
        expect(generated.properties.feature.properties.data.properties.ext.properties.app_name).to.deep.equal({
            type: 'string',
            description: 'Name of the application',
            enum: ['testApp'],
        });
    });

    it('should generate schemas for each event', () => {
        const multipleEvents = {
            w_event_one: {
                description: 'First event',
                owners: ['tester'],
                meta: { type: 'w_event_one', version: '0.0' },
                context: { name: ['ctx1'] },
                feature: {
                    name: 'feature-one',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
            w_event_two: {
                description: 'Second event',
                owners: ['tester'],
                meta: { type: 'w_event_two', version: '0.0' },
                context: { name: ['ctx2'] },
                feature: {
                    name: 'feature-two',
                    status: ['FAILURE'],
                    data: { ext: {} },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(multipleEvents, baseEvent);
        expect(errors).to.be.empty;
        expect(Object.keys(generatedSchemas)).to.have.lengthOf(2);
        expect(generatedSchemas).to.have.property('w_event_one');
        expect(generatedSchemas).to.have.property('w_event_two');
    });

    it('should handle event without optional context field', () => {
        const eventWithoutContext = {
            w_no_context: {
                description: 'Event without context',
                owners: ['tester'],
                meta: { type: 'w_no_context', version: '0.0' },
                feature: {
                    name: 'no-context-feature',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(eventWithoutContext, baseEvent);
        expect(errors).to.be.empty;
        expect(generatedSchemas).to.have.property('w_no_context');

        const generated = generatedSchemas.w_no_context;
        // Context should not be present in merged schema when not provided
        expect(generated.properties).to.not.have.property('context');
        // Other properties should still be merged correctly
        expect(generated.properties.feature.properties.name.enum).to.deep.equal(['no-context-feature']);
        expect(generated.properties.feature.properties.status.enum).to.deep.equal(['SUCCESS']);
    });

    it('requires metaschema keys but not event ext props', () => {
        const event = {
            w_required_base_only: {
                description: 'Event with optional ext props',
                owners: ['tester'],
                meta: { type: 'w_required_base_only', version: '0.0' },
                feature: {
                    name: 'required-base',
                    status: ['SUCCESS'],
                    data: {
                        ext: {
                            optional_field: {
                                type: 'string',
                                description: 'Optional ext field',
                            },
                        },
                    },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_required_base_only;
        expect(generated.properties.app.required).to.deep.equal(['name', 'version']);
        expect(generated.properties.global.required).to.deep.equal(['platform', 'type', 'sample_rate']);
        expect(generated.properties.feature.properties.data.properties.ext).to.not.have.property('required');
    });

    it('keeps properties defined directly under feature.data', () => {
        const event = {
            w_data_direct_props: {
                description: 'Event with data-level properties',
                owners: ['tester'],
                meta: { type: 'w_data_direct_props', version: '0.0' },
                feature: {
                    name: 'data-direct',
                    status: ['SUCCESS'],
                    data: {
                        latency_ms_bucketed: {
                            type: 'integer',
                            description: 'Latency bucketed',
                            enum: [1, 5, 10],
                        },
                        failure_detail: {
                            type: 'string',
                            description: 'Failure detail',
                            enum: ['Timeout', 'Unknown'],
                        },
                        ext: {},
                    },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEvent);
        expect(errors.length).to.be.greaterThan(0);

        const dataProps = generatedSchemas.w_data_direct_props.properties.feature.properties.data.properties;
        expect(dataProps).to.have.property('latency_ms_bucketed');
        expect(dataProps).to.have.property('failure_detail');
    });

    it('does not drop any base/event properties', () => {
        const base = JSON.parse(JSON.stringify(baseEvent));
        base.app.app_source = {
            type: 'string',
            description: 'App source',
            enum: ['store'],
        };
        base.global.session_kind = {
            type: 'string',
            description: 'Session kind',
            enum: ['new', 'returning'],
        };
        base.context.extra_context = {
            type: 'string',
            description: 'Extra context',
            enum: ['alpha'],
        };
        base.feature.status_reason = {
            type: 'string',
            description: 'Reason for status',
        };
        base.feature.extra_base_flag = {
            type: 'boolean',
            description: 'Base flag',
        };

        const event = {
            w_no_drops: {
                description: 'Event with custom feature/data props',
                owners: ['tester'],
                meta: { type: 'w_no_drops', version: '0.0' },
                context: { name: ['alpha'] },
                feature: {
                    name: 'no-drops',
                    status: ['SUCCESS'],
                    status_reason: {
                        type: 'string',
                        description: 'Event status reason',
                        enum: ['foo'],
                    },
                    event_only_flag: {
                        type: 'integer',
                        description: 'Event-only flag',
                        enum: [1, 2],
                    },
                    data: {
                        latency_ms_bucketed: {
                            type: 'integer',
                            description: 'Latency bucketed',
                            enum: [1, 5, 10],
                        },
                        failure_detail: {
                            type: 'string',
                            description: 'Failure detail',
                            enum: ['Timeout', 'Unknown'],
                        },
                        ext: {
                            extra_data: {
                                type: 'string',
                                description: 'Extra data',
                            },
                        },
                    },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, base);
        expect(errors.length).to.be.greaterThan(0);

        const generated = generatedSchemas.w_no_drops;
        const featureProps = generated.properties.feature.properties;
        expect(featureProps).to.have.property('status_reason');
        expect(featureProps).to.have.property('extra_base_flag');
        expect(featureProps).to.have.property('event_only_flag');

        const dataProps = featureProps.data.properties;
        expect(dataProps).to.have.property('latency_ms_bucketed');
        expect(dataProps).to.have.property('failure_detail');
        expect(dataProps.ext.properties).to.have.property('extra_data');

        expect(generated.properties.app.properties).to.have.property('app_source');
        expect(generated.properties.global.properties).to.have.property('session_kind');
        expect(generated.properties.context.properties).to.have.property('extra_context');
    });
});

describe('Wide Event Version Combining', () => {
    const validator = new WideEventDefinitionsValidator({});

    const baseEventWithVersion = {
        meta: {
            version: {
                description: 'Base event version',
                value: 2,
            },
        },
        app: {
            name: { type: 'string', description: 'App name', enum: ['Windows'] },
            version: { type: 'string', description: 'App version', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
        },
        global: {
            platform: { type: 'string', description: 'Platform', enum: ['Windows'] },
            type: { type: 'string', description: 'Type', enum: ['app'] },
            sample_rate: {
                type: 'number',
                description: 'Sample rate',
                minimum: 0,
                maximum: 1,
            },
        },
        feature: {
            name: { type: 'string', description: 'Feature name' },
            status: { type: 'string', description: 'Status' },
            data: { ext: {} },
        },
        context: {
            name: { type: 'string', description: 'Context name' },
        },
    };

    it('should combine base version with event two-octet version', () => {
        const event = {
            w_version_test: {
                description: 'Version test event',
                owners: ['tester'],
                meta: { type: 'w_version_test', version: '3.5' },
                context: { name: ['test'] },
                feature: {
                    name: 'version-feature',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEventWithVersion);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_version_test;
        // Base version 2 + event version 3.5 = 2.3.5
        expect(generated.properties.meta.properties.version.const).to.equal('2.3.5');
    });

    it('should handle version 0.0 correctly', () => {
        const event = {
            w_zero_version: {
                description: 'Zero version event',
                owners: ['tester'],
                meta: { type: 'w_zero_version', version: '0.0' },
                context: { name: ['test'] },
                feature: {
                    name: 'zero-feature',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };

        const { errors, generatedSchemas } = validator.validateWideEventDefinition(event, baseEventWithVersion);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_zero_version;
        // Base version 2 + event version 0.0 = 2.0.0
        expect(generated.properties.meta.properties.version.const).to.equal('2.0.0');
    });

    it('should not include base meta in generated schema', () => {
        const event = {
            w_no_base_meta: {
                description: 'Test that base meta is not included',
                owners: ['tester'],
                meta: { type: 'w_no_base_meta', version: '1.0' },
                context: { name: ['test'] },
                feature: {
                    name: 'test-feature',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };

        const { generatedSchemas } = validator.validateWideEventDefinition(event, baseEventWithVersion);
        const generated = generatedSchemas.w_no_base_meta;

        // meta should only have type and version (string), not version.value or version.description
        expect(generated.properties.meta.properties.type.const).to.equal('w_no_base_meta');
        expect(generated.properties.meta.properties.version.const).to.equal('2.1.0');
        expect(generated.properties.meta.properties.version).to.not.have.property('value');
        expect(generated.properties.meta.properties.version).to.not.have.property('description');
    });
});

describe('Wide Event required fields follow metaschema', () => {
    const makeValidator = () => new WideEventDefinitionsValidator({});

    const baseEvent = {
        meta: {
            version: {
                description: 'Base event version',
                value: 1,
            },
        },
        app: {
            name: { type: 'string', description: 'App name', enum: ['Windows'] },
            version: { type: 'string', description: 'App version', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
            form_factor: { type: 'string', description: 'Form factor', enum: ['phone', 'tablet'] },
        },
        global: {
            platform: { type: 'string', description: 'Platform', enum: ['Windows'] },
            type: { type: 'string', description: 'Type', enum: ['app'] },
            sample_rate: { type: 'number', description: 'Sample rate', minimum: 0, maximum: 1 },
            is_first_daily_occurrence: { type: 'boolean', description: 'First daily occurrence' },
        },
        feature: {
            name: { type: 'string', description: 'Feature name' },
            status: { type: 'string', description: 'Status' },
            data: { ext: {} },
        },
        context: {
            name: { type: 'string', description: 'Context name' },
        },
    };

    const eventBase = {
        description: 'Event with optional base fields',
        owners: ['tester'],
        meta: { type: 'w_optional_base_fields', version: '0.0' },
        context: { name: ['onboarding'] },
        feature: {
            name: 'optional-base-fields-feature',
            status: ['SUCCESS'],
            data: { ext: {} },
        },
    };

    it('includes non-required base fields but does not require them', () => {
        const event = {
            w_optional_base_fields: {
                ...eventBase,
            },
        };

        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_optional_base_fields;
        expect(generated.properties.global.properties).to.have.property('is_first_daily_occurrence');
        expect(generated.properties.global.required).to.not.include('is_first_daily_occurrence');
        expect(generated.properties.app.properties).to.have.property('form_factor');
        expect(generated.properties.app.required).to.not.include('form_factor');
    });

    it('uses metaschema required keys for each section', () => {
        const event = { w_optional_base_fields: { ...eventBase } };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;

        const generated = generatedSchemas.w_optional_base_fields;
        expect(generated.properties.app.required).to.deep.equal(['name', 'version']);
        expect(generated.properties.global.required).to.deep.equal(['platform', 'type', 'sample_rate']);
        expect(generated.properties.feature.required).to.deep.equal(['name', 'status', 'data']);
        expect(generated.properties.context.required).to.deep.equal(['name']);
    });
});

describe('Wide Event app/service section handling', () => {
    const makeValidator = () => new WideEventDefinitionsValidator({});
    const event = {
        w_app_or_service: {
            description: 'Validates app xor service section generation',
            owners: ['tester'],
            meta: { type: 'w_app_or_service', version: '0.0' },
            feature: {
                name: 'feature',
                status: ['SUCCESS'],
                data: { ext: {} },
            },
        },
    };

    const baseCommon = {
        meta: {
            version: {
                description: 'Base event version',
                value: 1,
            },
        },
        global: {
            platform: { type: 'string', description: 'Platform', enum: ['Linux'] },
            type: { type: 'string', description: 'Type', enum: ['service', 'app'] },
            sample_rate: { type: 'number', description: 'Sample rate', minimum: 0, maximum: 1 },
        },
        feature: {
            name: { type: 'string', description: 'Feature name' },
            status: { type: 'string', description: 'Status' },
            data: { ext: {} },
        },
    };

    it('supports app section from base_event', () => {
        const baseEvent = {
            ...baseCommon,
            app: {
                name: { type: 'string', description: 'App name', enum: ['Windows'] },
                version: { type: 'string', description: 'App version', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
            },
        };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;
        const generated = generatedSchemas.w_app_or_service;
        expect(generated.properties).to.have.property('app');
        expect(generated.properties).to.not.have.property('service');
    });

    it('supports service section from base_event', () => {
        const baseEvent = {
            ...baseCommon,
            service: {
                name: { type: 'string', description: 'Service name' },
                version: { type: 'string', description: 'Service version' },
                host: { type: 'string', description: 'Host name' },
                region: { type: 'string', description: 'Region name' },
                environment: { type: 'string', description: 'Environment name' },
            },
        };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;
        const generated = generatedSchemas.w_app_or_service;
        expect(generated.properties).to.have.property('service');
        expect(generated.properties).to.not.have.property('app');
        expect(generated.properties.service.required).to.deep.equal(['name', 'version', 'host', 'region', 'environment']);
    });

    it('rejects schema generation when both app and service are present in base_event', () => {
        const baseEvent = {
            ...baseCommon,
            app: {
                name: { type: 'string', description: 'App name', enum: ['Windows'] },
                version: { type: 'string', description: 'App version', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
            },
            service: {
                name: { type: 'string', description: 'Service name' },
                version: { type: 'string', description: 'Service version' },
                host: { type: 'string', description: 'Host name' },
                region: { type: 'string', description: 'Region name' },
                environment: { type: 'string', description: 'Environment name' },
            },
        };
        const { errors } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors.some((error) => error.includes('Generated schema does not match metaschema'))).to.be.true;
    });

    it('rejects schema generation when neither app nor service are present in base_event', () => {
        const { errors } = makeValidator().validateWideEventDefinition(event, baseCommon);
        expect(errors.some((error) => error.includes('Generated schema does not match metaschema'))).to.be.true;
    });
});

describe('Wide Event journey section handling', () => {
    const makeValidator = () => new WideEventDefinitionsValidator({});
    const baseEvent = {
        meta: {
            version: {
                description: 'Base event version',
                value: 1,
            },
        },
        app: {
            name: { type: 'string', description: 'App name', enum: ['Windows'] },
            version: { type: 'string', description: 'App version', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
        },
        global: {
            platform: { type: 'string', description: 'Platform', enum: ['Windows'] },
            type: { type: 'string', description: 'Type', enum: ['app'] },
            sample_rate: { type: 'number', description: 'Sample rate', minimum: 0, maximum: 1 },
        },
        feature: {
            name: { type: 'string', description: 'Feature name' },
            status: { type: 'string', description: 'Status' },
            data: { ext: {} },
        },
        journey: {
            name: { type: 'string', description: 'Journey name' },
        },
    };

    it('includes journey section when event definition provides it', () => {
        const event = {
            w_with_journey: {
                description: 'Event with journey',
                owners: ['tester'],
                meta: { type: 'w_with_journey', version: '0.0' },
                journey: { name: ['first_run', 'returning_user'] },
                feature: {
                    name: 'with-journey',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;
        const generated = generatedSchemas.w_with_journey;
        expect(generated.properties).to.have.property('journey');
        expect(generated.required).to.include('journey');
        expect(generated.properties.journey.required).to.deep.equal(['name']);
        expect(generated.properties.journey.properties.name.enum).to.deep.equal(['first_run', 'returning_user']);
    });

    it('omits journey section when event definition does not provide it', () => {
        const event = {
            w_without_journey: {
                description: 'Event without journey',
                owners: ['tester'],
                meta: { type: 'w_without_journey', version: '0.0' },
                feature: {
                    name: 'without-journey',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseEvent);
        expect(errors).to.be.empty;
        const generated = generatedSchemas.w_without_journey;
        expect(generated.properties).to.not.have.property('journey');
        expect(generated.required).to.not.include('journey');
    });

    it('works alongside context when both are present', () => {
        const baseWithContext = {
            ...baseEvent,
            context: {
                name: { type: 'string', description: 'Context name' },
            },
        };
        const event = {
            w_journey_and_context: {
                description: 'Event with both journey and context',
                owners: ['tester'],
                meta: { type: 'w_journey_and_context', version: '0.0' },
                context: { name: ['settings'] },
                journey: { name: ['onboarding'] },
                feature: {
                    name: 'journey-and-context',
                    status: ['SUCCESS'],
                    data: { ext: {} },
                },
            },
        };
        const { errors, generatedSchemas } = makeValidator().validateWideEventDefinition(event, baseWithContext);
        expect(errors).to.be.empty;
        const generated = generatedSchemas.w_journey_and_context;
        expect(generated.properties).to.have.property('context');
        expect(generated.properties).to.have.property('journey');
        expect(generated.properties.journey.properties.name.enum).to.deep.equal(['onboarding']);
        expect(generated.properties.context.properties.name.enum).to.deep.equal(['settings']);
    });
});
