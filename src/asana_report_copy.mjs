const INSTRUCTIONS_TASK_URL = 'https://app.asana.com/1/137249556945/project/1210856607616307/task/1210948723611775?focus=true';

const VERSION_WARNING =
    "If you've changed the pixel post this release, you may see a false positive alert for any parameters that were removed from the schema but are still present in the currently released version. This should be resolved by the next app release.";

/**
 * Escape text interpolated into Asana HTML notes.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build the introductory copy for a live validation report.
 * @param {number} numFailures
 * @param {boolean} isPerOwnerTask
 * @param {string|null} targetVersion
 * @returns {string}
 */
export function getPixelFailureMessage(numFailures, isPerOwnerTask, targetVersion) {
    let message;

    if (numFailures === 0) {
        message = 'No errors found.';
    } else {
        let pixelPhrase = `${numFailures}`;
        pixelPhrase += numFailures === 1 ? ' pixel' : ' pixels';
        if (isPerOwnerTask) {
            pixelPhrase += ' that you own';
        }
        pixelPhrase += numFailures === 1 ? ' has' : ' have';
        pixelPhrase += ' failed live validation.';

        if (isPerOwnerTask) {
            pixelPhrase += ' Table below lists the errors encountered - check the attachment for examples of pixels triggering each error.';
        } else {
            pixelPhrase += ' Check per-owner subtasks and/or the attachment for details.';
        }

        message = `${pixelPhrase}

New to these reports? See <a href="${INSTRUCTIONS_TASK_URL}">View task</a>`;
    }

    if (targetVersion) {
        message += `

<strong>Target app version:</strong> ${escapeHtml(targetVersion)}

${VERSION_WARNING}`;
    }

    return message;
}
