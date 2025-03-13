import {ROOT_PREFIX} from './constants.mjs';

export class DefsTokenizer {
    #tokenizedDefs = {};

    processPixelDefs(pixelDefs) {
        for (const prefix of Object.keys(pixelDefs)) {
            const prefixParts = prefix.split('.');

            let pixelParent = this.#tokenizedDefs;
            for (let i = 0; i < prefixParts.length-1; i++) {
                const part = prefixParts[i];
                if (!pixelParent[part]) {
                    pixelParent[part] = {};
                }
                pixelParent = pixelParent[part];
            }
            
            const lastPart = prefixParts[prefixParts.length-1];
            if (!pixelParent[lastPart]) {
                pixelParent[lastPart] = {[ROOT_PREFIX]: {}};
            } else if (pixelParent[lastPart][ROOT_PREFIX]) {
                // Should not happen (we assume valid defs at this point):
                throw new Error(`Duplicate pixel definition found for ${prefix}`);
            }

            // We only care about saving params and suffixes
            pixelParent[lastPart][ROOT_PREFIX].parameters = pixelDefs[prefix].parameters;
            pixelParent[lastPart][ROOT_PREFIX].suffixes = pixelDefs[prefix].suffixes;
        }
    }

    getTokenizedDefs() {
        return this.#tokenizedDefs;
    }
}