import { expect } from 'chai';

import { PIXEL_VALIDATION_RESULT } from '../src/constants.mjs';
import { formatAjvErrorDetails } from '../src/error_utils.mjs';
import { compareLiveValidationResults } from '../src/live_validation_comparator.mjs';

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

describe('compareLiveValidationResults', () => {
    it('keeps only HEAD errors with a matching release identity, retaining the HEAD example', () => {
        const result = compareLiveValidationResults(
            failedResult([error('A', 'head-a'), error('B', 'head-b')]),
            failedResult([error('B', 'release-b'), error('C', 'release-c')]),
        );

        expect(result.errors).to.deep.equal([error('B', 'head-b')]);
    });

    it('does not intersect errors with the same human message but different identities', () => {
        const head = failedResult([{ identity: 'params|type|/a|{}', error: 'must be string', example: 'head' }]);
        const release = failedResult([{ identity: 'params|type|/b|{}', error: 'must be string', example: 'release' }]);

        expect(compareLiveValidationResults(head, release)).to.equal(null);
    });

    it('intersects enum errors when release allowed values drift', () => {
        const headError = formatAjvErrorDetails([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b', 'c'] },
            },
        ])[0];
        const releaseError = formatAjvErrorDetails([
            {
                keyword: 'enum',
                instancePath: '/value',
                message: 'must be equal to one of the allowed values',
                params: { allowedValues: ['a', 'b'] },
            },
        ])[0];

        expect(compareLiveValidationResults(failedResult([headError]), failedResult([releaseError])).errors).to.deep.equal([headError]);
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
            const identities = new Set();
            for (const [head, release] of orderedRows) {
                const result = compareLiveValidationResults(head, release);
                result?.errors.forEach(({ identity }) => identities.add(identity));
            }
            return identities;
        };

        expect(aggregate(rows)).to.deep.equal(new Set(['B']));
        expect(aggregate(rows.reverse())).to.deep.equal(new Set(['B']));
    });
});
