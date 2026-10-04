import { expect } from 'chai';

import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';
import { formatAjvErrors } from '../src/error_utils.mjs';
import { compareLiveValidationResults } from '../src/live_validation_comparator.mjs';

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
});
