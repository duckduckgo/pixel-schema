import { expect } from 'chai';

import { DefinitionsValidator } from '../src/definitions_validator.mjs';

describe('Validating commons', () => {
    const commons = {
        invalid: {},
    };
    const validator = new DefinitionsValidator(commons, commons);

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

describe('Pixel with no params and no suffixes', () => {
    const validator = new DefinitionsValidator('{}', '{}');

    it('must have required properties', () => {
        const errors = validator.validatePixelsDefinition({ pixel: {} });
        const expectedErrors = [
            "/pixel must have required property 'description'",
            "/pixel must have required property 'owners'",
            "/pixel must have required property 'triggers'",
        ];

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

        const validator = new DefinitionsValidator(commonParams, '{}');
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
    const validator = new DefinitionsValidator('{}', commonSuffixes);

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
