import { PIXEL_VALIDATION_RESULT } from './constants.mjs';

/**
 * Intersects two same-row live-validation results.
 *
 * @param {object} headResult validation result produced from HEAD definitions.
 * @param {object} releaseResult validation result produced from release definitions.
 * @returns {object|null} result to aggregate, or null when the row has no common result.
 */
function compareLiveValidationResults(headResult, releaseResult) {
    if (headResult.status === PIXEL_VALIDATION_RESULT.OLD_APP_VERSION || releaseResult.status === PIXEL_VALIDATION_RESULT.OLD_APP_VERSION) {
        return null;
    }

    if (headResult.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED && releaseResult.status === PIXEL_VALIDATION_RESULT.UNDOCUMENTED) {
        return headResult;
    }

    if (
        headResult.status !== PIXEL_VALIDATION_RESULT.VALIDATION_FAILED ||
        releaseResult.status !== PIXEL_VALIDATION_RESULT.VALIDATION_FAILED
    ) {
        return null;
    }

    const releaseIdentities = new Set(releaseResult.errors.map(({ identity }) => identity));
    const errors = headResult.errors.filter(({ identity }) => releaseIdentities.has(identity));
    if (errors.length === 0) return null;

    return {
        ...headResult,
        errors,
    };
}

export { compareLiveValidationResults };
