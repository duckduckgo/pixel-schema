import { PIXEL_VALIDATION_RESULT } from './constants.mjs';

// Statuses whose rows can survive a HEAD/release intersection. Any other HEAD status is dropped
// outright, so the release definitions never need to be consulted for it.
const COMPARED_STATUSES = new Set([PIXEL_VALIDATION_RESULT.UNDOCUMENTED, PIXEL_VALIDATION_RESULT.VALIDATION_FAILED]);

/**
 * Reports whether a HEAD result can survive comparison, and so needs a release result at all.
 *
 * @param {object} headResult validation result produced from HEAD definitions.
 * @returns {boolean} true when the row must be validated against the release definitions.
 */
function requiresReleaseComparison(headResult) {
    return COMPARED_STATUSES.has(headResult.status);
}

/**
 * Intersects two same-row live-validation results.
 *
 * @param {object} headResult validation result produced from HEAD definitions.
 * @param {object} releaseResult validation result produced from release definitions.
 * @returns {object|null} result to aggregate, or null when the row has no common result.
 */
function compareLiveValidationResults(headResult, releaseResult) {
    if (!requiresReleaseComparison(headResult)) return null;

    if (headResult.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
        return releaseResult.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED ? headResult : null;
    }

    // HEAD failed validation: keep it only where the release definitions failed the same way.
    if (releaseResult.status !== PIXEL_VALIDATION_RESULT.VALIDATION_FAILED) return null;

    const releaseIdentities = new Set(releaseResult.errors.map(({ identity }) => identity));
    const errors = headResult.errors.filter(({ identity }) => releaseIdentities.has(identity));
    if (errors.length === 0) return null;

    return {
        ...headResult,
        errors,
    };
}

export { compareLiveValidationResults, requiresReleaseComparison };
