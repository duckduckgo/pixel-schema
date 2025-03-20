#!/usr/bin/env node

import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { getArgParser } from '../src/args_utils.mjs';
import { getTokenizedPixelsPath } from '../src/file_utils.mjs';
import { tokenizePixelDefs } from '../src/tokenizer.mjs';

const argv = getArgParser('preprocess (tokenize) pixel definitions').parse();

function processPixelDefs(mainDir) {
    const tokenizedDefs = {};
    const pixelDir = path.join(mainDir, 'pixels');
    fs.readdirSync(pixelDir, { recursive: true }).forEach((file) => {
        const fullPath = path.join(pixelDir, file);
        if (fs.statSync(fullPath).isDirectory() || file.startsWith('TEMPLATE')) {
            return;
        }

        console.log(`...Reading pixel def file: ${fullPath}`);
        const pixelsDefs = JSON5.parse(fs.readFileSync(fullPath).toString());
        tokenizePixelDefs(pixelsDefs, tokenizedDefs);
    });

    // Write out tokenized pixel defs to a file
    const outFile = getTokenizedPixelsPath(mainDir);
    console.log(`Writing out tokenized pixel defs to ${outFile}`);
    fs.writeFileSync(outFile, JSON.stringify(tokenizedDefs, null, 4));
}

processPixelDefs(argv.dirPath);
