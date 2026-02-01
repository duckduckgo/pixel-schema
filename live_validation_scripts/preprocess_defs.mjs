#!/usr/bin/env node
import { getArgParser } from '../src/args_utils.mjs';
import { processPixelDefs } from '../src/live_validation_utils.mjs';

const argv = getArgParser('preprocess (tokenize) pixel definitions').parse();
processPixelDefs(argv.dirPath);
