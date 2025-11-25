/**
 * Helper functions for formatting and logging errors
 */

/**
 * Formats AJV validation errors
 *
 * @param {Array<import("ajv").ErrorObject> | null | undefined} validationErrors - array of AJV error objects
 * @param {*} suffixes - object containing request suffixes
 * @returns {Array<string>} - array of formatted error messages
 */
function formatAjvErrors(validationErrors, suffixes = null) {
    const errors = [];
    if (!Array.isArray(validationErrors)) {
        return errors;
    }

    validationErrors.forEach((error) => {
        // Omit confusing errors
        if (error.message === 'must NOT be valid') return;

        let formattedError = `${error.instancePath} ${error.message}`;
        if (suffixes) {
            if (error.params.additionalProperty) {
                formattedError += `. Found extra suffix '${suffixes[error.params.additionalProperty]}'`;
            } else if (error.params.allowedValues) {
                const idx = Number(error.instancePath.split('/')[1]);
                formattedError = `Suffix '${suffixes[idx]}' ${error.message}`;
            }
        } else {
            if (error.params.additionalProperty) formattedError += `. Found extra property '${error.params.additionalProperty}'`;

            if (error.message === 'property name must be valid') {
                formattedError = `Invalid property name '${error.params.propertyName}'. If this is a pixel:`;
                formattedError += `\n\t* pixel names must not contain '.' --> use '_' instead`;
                formattedError += `\n\t* experiments must be defined in the 'native_experiments.json' file`;
            }
        }

        errors.push(formattedError.trim());
    });

    return errors;
}

/**
 * Logs the errors (if any) and sets exit code to failing
 *
 * @param prefix {string} - prefix for the error messages
 * @param {Array<string>} errors
 * @returns
 */
function logErrors(prefix, errors) {
    if (errors.length <= 0) return;

    process.exitCode = 1;
    errors.forEach((error) => {
        console.error(`${prefix} ${error}`);
    });
}

export { formatAjvErrors, logErrors };
