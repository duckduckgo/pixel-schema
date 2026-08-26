#!/usr/bin/env node

import { readProductDef } from '../src/file_utils.mjs';
import { resolveReleaseTag } from '../src/pixel_utils.mjs';

async function main() {
    const [mainDir, tagTemplate] = process.argv.slice(2);
    if (!mainDir) {
        throw new Error('Usage: resolve_release_tag.mjs <definitions-dir> [release-tag-template]');
    }

    const productDef = readProductDef(mainDir);
    const release = await resolveReleaseTag(productDef.target, tagTemplate);
    if (release) {
        process.stdout.write(`${release.version}\n${release.tag}\n`);
    }
}

main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
