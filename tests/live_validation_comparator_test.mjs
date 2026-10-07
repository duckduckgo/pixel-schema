import { expect } from 'chai';

import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';
import { PixelDefinitionsValidator } from '../src/definitions_validator.mjs';
import { formatAjvErrors } from '../src/error_utils.mjs';
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

function error(message, example = 'example') {
    return { error: message, example };
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
    it('keeps only HEAD errors with a matching release error, retaining the HEAD example', () => {
        const result = compareLiveValidationResults(
            failedResult([error('A', 'head-a'), error('B', 'head-b')]),
            failedResult([error('B', 'release-b'), error('C', 'release-c')]),
        );

        expect(result.errors).to.deep.equal([error('B', 'head-b')]);
    });

    it('intersects enum errors when release allowed values drift', () => {
        const [headMessage] = formatAjvErrors([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b', 'c'] },
            },
        ]);
        const [releaseMessage] = formatAjvErrors([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b'] },
            },
        ]);

        expect(
            compareLiveValidationResults(failedResult([error(headMessage)]), failedResult([error(releaseMessage)])).errors,
        ).to.deep.equal([error(headMessage)]);
    });

    it('applies status rules before comparing errors', () => {
        const undocumented = { status: PIXEL_VALIDATION_RESULT.UNDOCUMENTED, errors: [] };
        const passed = { status: PIXEL_VALIDATION_RESULT.VALIDATION_PASSED, errors: [] };
        const oldVersion = { status: PIXEL_VALIDATION_RESULT.OLD_APP_VERSION, errors: [] };
        const failed = failedResult([error('A')]);

        expect(compareLiveValidationResults(undocumented, undocumented)).to.equal(undocumented);
        expect(compareLiveValidationResults(undocumented, failed)).to.equal(null);
        expect(compareLiveValidationResults(failed, passed)).to.equal(null);
        expect(compareLiveValidationResults(failed, oldVersion)).to.equal(null);
    });

    it('keeps membership stable when examples and row order differ before the example cap', () => {
        const rows = [
            [failedResult([error('B', 'head-1')]), failedResult([error('B', 'release-1')])],
            [failedResult([error('A', 'head-2'), error('B', 'head-2')]), failedResult([error('B', 'release-2'), error('C', 'release-2')])],
        ];
        const aggregate = (orderedRows) => {
            const messages = new Set();
            for (const [head, release] of orderedRows) {
                const result = compareLiveValidationResults(head, release);
                result?.errors.forEach(({ error: message }) => messages.add(message));
            }
            return messages;
        };

        expect(aggregate(rows)).to.deep.equal(new Set(['B']));
        expect(aggregate(rows.reverse())).to.deep.equal(new Set(['B']));
    });

    it('does not intersect identical text from parameter and suffix validation domains', () => {
        const head = buildValidator(
            pixelDefinition(
                [{ key: '0', description: 'Numeric parameter', type: 'integer' }],
                [{ description: 'String suffix', type: 'string' }],
            ),
        );
        const release = buildValidator(
            pixelDefinition(
                [{ key: '0', description: 'String parameter', type: 'string' }],
                [{ description: 'Numeric suffix', type: 'integer' }],
            ),
        );

        const headResult = head.validatePixel('pixel_abc', '0=abc');
        const releaseResult = release.validatePixel('pixel_abc', '0=abc');

        expect(headResult.errors[0].error).to.equal('/0 must be integer');
        expect(releaseResult.errors[0].error).to.equal('/0 must be integer');
        expect(compareLiveValidationResults(headResult, releaseResult)).to.equal(null);
    });

    it('does not intersect const errors when the required constants differ', () => {
        const head = buildValidator(pixelDefinition([{ key: 'mode', description: 'HEAD mode', const: 'a' }]));
        const release = buildValidator(pixelDefinition([{ key: 'mode', description: 'Release mode', const: 'b' }]));

        const headResult = head.validatePixel('pixel', 'mode=z');
        const releaseResult = release.validatePixel('pixel', 'mode=z');

        expect(headResult.errors[0].error).to.equal('/mode must be equal to constant');
        expect(releaseResult.errors[0].error).to.equal('/mode must be equal to constant');
        expect(compareLiveValidationResults(headResult, releaseResult)).to.equal(null);
    });

    it('intersects enum errors when the allowed values differ', () => {
        const head = buildValidator(pixelDefinition([{ key: 'mode', description: 'HEAD mode', enum: ['a', 'b'] }]));
        const release = buildValidator(pixelDefinition([{ key: 'mode', description: 'Release mode', enum: ['a', 'c'] }]));

        const headResult = head.validatePixel('pixel', 'mode=z');
        const releaseResult = release.validatePixel('pixel', 'mode=z');

        expect(compareLiveValidationResults(headResult, releaseResult)?.errors).to.deep.equal(headResult.errors);
    });

    it('intersects oneOf errors when equivalent branches are reordered', () => {
        const head = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'HEAD mode',
                    oneOf: [{ const: 'x' }, { pattern: '^x$' }, { pattern: '^y$' }],
                },
            ]),
        );
        const release = buildValidator(
            pixelDefinition([
                {
                    key: 'mode',
                    description: 'Release mode',
                    oneOf: [{ const: 'x' }, { pattern: '^y$' }, { pattern: '^x$' }],
                },
            ]),
        );

        const headResult = head.validatePixel('pixel', 'mode=x');
        const releaseResult = release.validatePixel('pixel', 'mode=x');
        const result = compareLiveValidationResults(headResult, releaseResult);

        expect(result?.errors.map(({ error: message }) => message)).to.include('/mode must match exactly one schema in oneOf');
    });
});
