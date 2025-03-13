#!/usr/bin/env node
import { getArgParser } from '../src/args_utils.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

const argv = getArgParser('Fetches pixel data from Clickhouse into a temporary CSV file').parse();

preparePixelsCSV(argv.dirPath);
