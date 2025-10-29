// Parse experiments matching schemas/search_experiments_schema.json5, remapping them to a format compatible with ignoreParams
export function parseSearchExperiments(searchExperiments = {}) {
    const out = {};

    for (const [name, def] of Object.entries(searchExperiments)) {
        out[name] = parseExperimentDef(name, def);
        const altName = `prebounce_${name}`;
        out[altName] = parseExperimentDef(altName, def);
    }

    return out;
}

function parseExperimentDef(name, def) {
    const experiment = {
        key: name,
        description: def.description,
    };

    if (Array.isArray(def?.variants)) {
        experiment.enum = def.variants;
        if (def.variants.length > 0) {
            // infer type from first variant
            experiment.type = typeof def.variants[0];
        }
    }

    return experiment;
}