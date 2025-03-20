import { ROOT_PREFIX } from './constants.mjs';

/**
 * Tokenizes provided pixel definitions and saves them to the provided tokenized object.
 * @param {object} pixelDefs standard pixel definitions, following schemas/pixel_schema.json5
 * @param {object} existingTokenizedDefs object to save tokenized definitions to.
 * Similar in format to pixelDefs, but each part of the pixel name is used to create a node in a tree structure.
 * See tests/test_data/valid/expected_processing_results/tokenized_pixels.json for an example.
 */
export function tokenizePixelDefs(pixelDefs, existingTokenizedDefs) {
    for (const prefix of Object.keys(pixelDefs)) {
        const prefixParts = prefix.split('.');

        let pixelParent = existingTokenizedDefs;
        for (let i = 0; i < prefixParts.length - 1; i++) {
            const part = prefixParts[i];
            if (!pixelParent[part]) {
                pixelParent[part] = {};
            }
            pixelParent = pixelParent[part];
        }

        const lastPart = prefixParts[prefixParts.length - 1];
        if (!pixelParent[lastPart]) {
            pixelParent[lastPart] = { [ROOT_PREFIX]: {} };
        } else if (pixelParent[lastPart][ROOT_PREFIX]) {
            // Should not happen (we assume valid defs at this point):
            throw new Error(`Duplicate pixel definition found for ${prefix}`);
        }

        // We only care about saving params and suffixes
        pixelParent[lastPart][ROOT_PREFIX].parameters = pixelDefs[prefix].parameters;
        pixelParent[lastPart][ROOT_PREFIX].suffixes = pixelDefs[prefix].suffixes;
    }
}
