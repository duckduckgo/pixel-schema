#!/usr/bin/env node

// Resolves the live app version in product.json to the release tag Jenkins should check out.
import { getArgParserReleaseTag } from '../src/args_utils.mjs';
import { readProductDef } from '../src/file_utils.mjs';
import { resolveReleaseTag } from '../src/pixel_utils.mjs';

const argv = getArgParserReleaseTag('Resolve a product release tag from its live app version').parse();

async function main(mainDir, tagTemplate) {
    const productDef = readProductDef(mainDir);
    const release = await resolveReleaseTag(productDef.target, tagTemplate);
    // Empty output means this product has no app version, so callers validate HEAD only.
    if (release) {
        process.stdout.write(`${release.tag}\n`);
    }
}

main(argv.dirPath, argv.tagTemplate).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
