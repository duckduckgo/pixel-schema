import { expect } from 'chai';

import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';
import { PixelDefinitionsValidator } from '../src/definitions_validator.mjs';
import { formatAjvErrorDetails } from '../src/error_utils.mjs';
import { LivePixelsValidator } from '../src/live_pixel_validator.mjs';
import { compareLiveValidationResults } from '../src/live_validation_comparator.mjs';
import { ParamsValidator } from '../src/params_validator.mjs';
import { tokenizePixelDefs } from '../src/tokenizer.mjs';

const productDef = {
    target: {},
    agents: [],
    forceLowerCase: false,
};

function failedResult(errors) {
    return {
        status: PIXEL_VALIDATION_RESULT.VALIDATION_FAILED,
        prefixForErrors: 'pixel',
        owners: [],
        errors,
    };
}

function error(identity, example = 'example') {
    return { identity, error: `message for ${identity}`, example };
}

function pixelDefinition(parameters, suffixes) {
    return {
        pixel: {
            description: 'Comparator regression test',
            owners: ['owner'],
            parameters,
            suffixes,
        },
    };
}

function buildValidator(definition) {
    expect(new PixelDefinitionsValidator({}, {}, {}).validatePixelsDefinition(definition)).to.deep.equal([]);

    const tokenized = {};
    tokenizePixelDefs(definition, tokenized);
    return new LivePixelsValidator(tokenized, productDef, {}, new ParamsValidator({}, {}, {}));
}

describe('compareLiveValidationResults', () => {
    it('keeps errors found in both branches and retains branch A report details', () => {
        const result = compareLiveValidationResults(
            failedResult([error('A', 'branch-a-example-a'), error('B', 'branch-a-example-b')]),
            failedResult([error('B', 'branch-b-example-b'), error('C', 'branch-b-example-c')]),
        );

        expect(result.errors).to.deep.equal([error('B', 'branch-a-example-b')]);
    });

    it('does not match errors that display the same message but describe different failures', () => {
        const branchAResult = failedResult([{ identity: 'params|type|/a|{}', error: 'must be string', example: 'branch-a' }]);
        const branchBResult = failedResult([{ identity: 'params|type|/b|{}', error: 'must be string', example: 'branch-b' }]);

        expect(compareLiveValidationResults(branchAResult, branchBResult)).to.equal(null);
    });

    it('matches invalid enum values when the allowed values differ between branches', () => {
        const branchAError = formatAjvErrorDetails([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b', 'c'] },
            },
        ])[0];
        const branchBError = formatAjvErrorDetails([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b'] },
            },
        ])[0];

        expect(compareLiveValidationResults(failedResult([branchAError]), failedResult([branchBError])).errors).to.deep.equal([
            branchAError,
        ]);
    });

    it('reports only failures that require comparison in both branches', () => {
        const undocumented = { status: PIXEL_VALIDATION_RESULT.UNDOCUMENTED, errors: [] };
        const passed = { status: PIXEL_VALIDATION_RESULT.VALIDATION_PASSED, errors: [] };
        const oldVersion = { status: PIXEL_VALIDATION_RESULT.OLD_APP_VERSION, errors: [] };
        const failed = failedResult([error('A')]);

        expect(compareLiveValidationResults(undocumented, undocumented)).to.equal(undocumented);
        expect(compareLiveValidationResults(undocumented, failed)).to.equal(null);
        expect(compareLiveValidationResults(failed, passed)).to.equal(null);
        expect(compareLiveValidationResults(failed, oldVersion)).to.equal(null);
    });

    it('matches the same failures regardless of example values or input row order', () => {
        const rows = [
            [failedResult([error('B', 'branch-a-row-1')]), failedResult([error('B', 'branch-b-row-1')])],
            [
                failedResult([error('A', 'branch-a-row-2'), error('B', 'branch-a-row-2')]),
                failedResult([error('B', 'branch-b-row-2'), error('C', 'branch-b-row-2')]),
            ],
        ];
        const aggregate = (orderedRows) => {
            const identities = new Set();
            for (const [branchAResult, branchBResult] of orderedRows) {
                const result = compareLiveValidationResults(branchAResult, branchBResult);
                result?.errors.forEach(({ identity }) => identities.add(identity));
            }
            return identities;
        };

        expect(aggregate(rows)).to.deep.equal(new Set(['B']));
        expect(aggregate(rows.reverse())).to.deep.equal(new Set(['B']));
    });

    it('does not match a parameter failure with an identically worded suffix failure', () => {
        const branchAValidator = buildValidator(
            pixelDefinition(
                [{ key: '0', description: 'Numeric parameter', type: 'integer' }],
                [{ description: 'String suffix', type: 'string' }],
            ),
        );
        const branchBValidator = buildValidator(
            pixelDefinition(
                [{ key: '0', description: 'String parameter', type: 'string' }],
                [{ description: 'Numeric suffix', type: 'integer' }],
            ),
        );

        const branchAResult = branchAValidator.validatePixel('pixel_abc', '0=abc');
        const branchBResult = branchBValidator.validatePixel('pixel_abc', '0=abc');

        expect(branchAResult.errors[0].error).to.equal('/0 must be integer');
        expect(branchBResult.errors[0].error).to.equal('/0 must be integer');
        expect(compareLiveValidationResults(branchAResult, branchBResult)).to.equal(null);
    });

    it('does not match constant-value failures when each branch requires a different value', () => {
        const branchAValidator = buildValidator(pixelDefinition([{ key: 'mode', description: 'Branch A mode', const: 'a' }]));
        const branchBValidator = buildValidator(pixelDefinition([{ key: 'mode', description: 'Branch B mode', const: 'b' }]));

        const branchAResult = branchAValidator.validatePixel('pixel', 'mode=z');
        const branchBResult = branchBValidator.validatePixel('pixel', 'mode=z');

        expect(branchAResult.errors[0].error).to.equal('/mode must be equal to constant');
        expect(branchBResult.errors[0].error).to.equal('/mode must be equal to constant');
        expect(compareLiveValidationResults(branchAResult, branchBResult)).to.equal(null);
    });

    it('matches invalid enum values when each branch allows a different set', () => {
        const branchAValidator = buildValidator(pixelDefinition([{ key: 'mode', description: 'Branch A mode', enum: ['a', 'b'] }]));
        const branchBValidator = buildValidator(pixelDefinition([{ key: 'mode', description: 'Branch B mode', enum: ['a', 'c'] }]));

        const branchAResult = branchAValidator.validatePixel('pixel', 'mode=z');
        const branchBResult = branchBValidator.validatePixel('pixel', 'mode=z');

        expect(compareLiveValidationResults(branchAResult, branchBResult)?.errors).to.deep.equal(branchAResult.errors);
    });

    it('matches oneOf failures when equivalent schemas change position in the oneOf array', () => {
        const branchAValidator = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'Branch A mode',
                    oneOf: [{ const: 'x' }, { pattern: '^x$' }, { pattern: '^y$' }],
                },
            ]),
        );
        const branchBValidator = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'Branch B mode',
                    oneOf: [{ const: 'x' }, { pattern: '^y$' }, { pattern: '^x$' }],
                },
            ]),
        );

        const branchAResult = branchAValidator.validatePixel('pixel', 'mode=x');
        const branchBResult = branchBValidator.validatePixel('pixel', 'mode=x');
        const result = compareLiveValidationResults(branchAResult, branchBResult);

        expect(result, 'equivalent oneOf failures should match when schema positions change').to.not.equal(null);
        expect(result.errors.map(({ error: message }) => message)).to.include('/mode must match exactly one schema in oneOf');
    });

    it('does not match oneOf failures when no schema matches in one branch and multiple schemas match in the other', () => {
        const branchAValidator = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'Branch A mode',
                    oneOf: [{ const: 'a' }, { const: 'b' }],
                },
            ]),
        );
        const branchBValidator = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'Branch B mode',
                    oneOf: [{ const: 'x' }, { pattern: '^x$' }],
                },
            ]),
        );

        const branchAResult = branchAValidator.validatePixel('pixel', 'mode=x');
        const branchBResult = branchBValidator.validatePixel('pixel', 'mode=x');

        expect(branchAResult.errors.map(({ error: message }) => message)).to.include('/mode must match exactly one schema in oneOf');
        expect(branchBResult.errors.map(({ error: message }) => message)).to.include('/mode must match exactly one schema in oneOf');
        expect(compareLiveValidationResults(branchAResult, branchBResult)).to.equal(null);
    });
});
