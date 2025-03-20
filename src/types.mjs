/**
 * @typedef {Object} ProductTarget
 * @property {string} key - The param key used to specify the product version (e.g. "appVersion")
 * @property {string} version - The product target version (e.g. "0.98.4")
 */

/**
 * @typedef {Object} ProductDefinition
 * @property {string[]} agents - The agents (e.g. Chrome) corresponding to the product
 * @property {ProductTarget} target - Product version to target
 * @property {boolean} forceLowerCase - Whether the definitions are case insensitive
 */

export {};
