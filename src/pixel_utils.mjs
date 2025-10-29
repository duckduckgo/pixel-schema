export function parseSearchExperiments(searchExperiments = {}) {
    const out = {};

    for (const [name, def] of Object.entries(searchExperiments)) {
        out[name] = {
            key: name,
            description: def.description,
        };

        let type = 'string';
        if (Array.isArray(def?.variants)) {
            out[name].enum = def.variants;
            if (def.variants.length > 0) {
                type = typeof def.variants[0];
            }
        }
        out[name].type = type;
    }

    return out;
}