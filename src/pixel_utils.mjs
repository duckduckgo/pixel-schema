export function parseSearchExperiments(searchExperiments = {}) {
    const out = {};

    for (const [name, def] of Object.entries(searchExperiments)) {
        const pixelName = `exp_${name}`;
        out[pixelName] = {
            key: pixelName,
            description: def.description,
        };

        let type = 'string';
        if (Array.isArray(def?.variants)) {
            out[pixelName].enum = def.variants;
            if (def.variants.length > 0) {
                type = typeof def.variants[0];
            }
        }
        out[pixelName].type = type;
    }

    return out;
}