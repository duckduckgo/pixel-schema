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
    return formatAjvErrorDetails(validationErrors, suffixes).map(({ error }) => error);
}

/**
 * Formats AJV validation errors with a transient semantic identity.
 *
 * @param {Array<import("ajv").ErrorObject> | null | undefined} validationErrors - array of AJV error objects
 * @param {*} suffixes - object containing request suffixes
 * @param {string} domain - validation domain that emitted the error
 * @returns {Array<{error: string, identity: string}>} formatted error details
 */
function formatAjvErrorDetails(validationErrors, suffixes = null, domain = 'ajv') {
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

        errors.push({
            error: formattedError.trim(),
            identity: createValidationErrorIdentity(domain, error.keyword, error.instancePath, error.params),
        });
    });

    return errors;
}

/**
 * Creates an identity independent of presentation text and example values.
 * @param {string} domain validation domain or custom category.
 * @param {string} keyword validation keyword.
 * @param {string} instancePath location in the validated value.
 * @param {*} params defining validation values.
 * @returns {string} stable identity.
 */
function createValidationErrorIdentity(domain, keyword, instancePath, params) {
    return JSON.stringify([domain, keyword, instancePath, sortObject(normalizeIdentityParams(keyword, params))]);
}

/**
 * Removes schema expectation payloads that may change without changing the invalid value's error category.
 * @param {string} keyword validation keyword.
 * @param {*} params defining validation values.
 * @returns {*} normalized identity parameters.
 */
function normalizeIdentityParams(keyword, params) {
    if (keyword !== 'enum' || !params || typeof params !== 'object') return params;

    const { allowedValues, ...identityParams } = params;
    return identityParams;
}

/**
 * Recursively sorts object keys for deterministic identity serialization.
 * @param {*} value value to canonicalize.
 * @returns {*} canonicalized value.
 */
function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, sortObject(value[key])]),
    );
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

export { createValidationErrorIdentity, formatAjvErrorDetails, formatAjvErrors, logErrors };
