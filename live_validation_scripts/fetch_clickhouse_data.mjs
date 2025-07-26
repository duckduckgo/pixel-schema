#!/usr/bin/env node
import { getArgParser } from '../src/args_utils.mjs';
import { preparePixelsCSV } from '../src/clickhouse_fetcher.mjs';

const argv = getArgParser('Fetches pixel data from Clickhouse into a temporary CSV file').parse();

// Audit DAYS_TO_FETCH full days in chunks, not including the current day
const DAYS_TO_FETCH = 7; // Number of days to fetch pixels for; Reduce this (e.g. to 7) if hit limit on JSON size in validate_live_pixel.mjs

const endDate = new Date();
// Will get more repeatable results run to run if we don't include current day
// because the current day is still changing
endDate.setDate(endDate.getDate() - 1);

// This sets the time to midnight so we get full days starting at midnight
// endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
endDate.setHours(0, 0, 0, 0);

// console.log(`End date ${endDate.toISOString().split('T')[0]}`);
console.log(`End date ${endDate.toISOString()}`);

const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
startDate.setDate(startDate.getDate() - DAYS_TO_FETCH);
// Ensure pastDate starts at exactly 0:00:00.000
startDate.setHours(0, 0, 0, 0);

// console.log(`Start date ${startDate.toISOString().split('T')[0]}`);
console.log(`Start date ${startDate.toISOString()}`);

preparePixelsCSV(argv.dirPath, startDate, endDate);
