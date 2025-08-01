#!/usr/bin/env node
import { getArgParser } from '../src/args_utils.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

const argv = getArgParser('Fetches pixel data from Clickhouse into a temporary CSV file').parse();

const DAYS_TO_FETCH = 7;

// Will get more repeatable results run to run if we don't include current day
// because the current day is still changing
const endDate = new Date();
endDate.setDate(endDate.getDate() - 1);
endDate.setHours(0, 0, 0, 0);

console.log(`End date ${endDate.toISOString()}`);

const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
startDate.setDate(startDate.getDate() - DAYS_TO_FETCH);
startDate.setHours(0, 0, 0, 0);

console.log(`Start date ${startDate.toISOString()}`);

preparePixelsCSV(argv.dirPath, startDate, endDate);
