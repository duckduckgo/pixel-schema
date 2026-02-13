/**
 * @typedef {Object} ProductTarget
 * @property {string} key - The param key used to specify the product version (e.g. "appVersion")
 * @property {string} [version] - The product target version (e.g. "0.98.4"). Either version, versionUrl/versionRef, or queryWindowInDays must be specified.
 * @property {string} [versionUrl] - URL to a JSON file containing version info. Used with versionRef.
 * @property {string} [versionRef] - Dot-notation key path to extract version from versionUrl response (e.g. "latest_appstore_version.latest_version")
 * @property {number} [queryWindowInDays] - Use a smaller CH query window than the default 28 days
 */

/**
 * @typedef {Object} ProductDefinition
 * @property {string[]} agents - The agents (e.g. Chrome) corresponding to the product
 * @property {ProductTarget} target - Product version to target
 * @property {boolean} [forceLowerCase] - Whether the definitions are case insensitive
 */

/**
 * @typedef {Object} PixelDefinition
 * @property {string[]} owners
 * @property {string[]} [suffixes]
 * @property {string[]} [parameters]
 */

/**
 * @typedef {Record<string, PixelDefinition>} PixelDefinitions
 */

export {};
