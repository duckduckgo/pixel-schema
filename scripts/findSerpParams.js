#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.argv.length !== 4) {
    console.error('Usage: node find_params.js <live_pixels.csv> <search_dir>');
    process.exit(1);
}

const inputPath = process.argv[2];
const searchDir = process.argv[3];

if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
}
if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
    console.error(`Search directory not found: ${searchDir}`);
    process.exit(1);
}

// Read CSV and extract param names from 2nd field.
// Handles lines like: "ad.bingv7aa","['atbva=b']",""
const text = fs.readFileSync(inputPath, 'utf8');

// Simple CSV 3-field split by commas at top level (your sample is consistent).
// We only need the 2nd field.
function splitTopLevelCSV(line) {
    // Split into up to 3 fields, respecting double quotes.
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            // toggle on unescaped quotes
            inQuotes = !inQuotes;
            cur += ch;
        } else if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

const params = new Set();
for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const fields = splitTopLevelCSV(line);
    if (fields.length < 2) continue;

    // Strip outer double quotes around field 2
    let f2 = fields[1].trim();
    if (f2.startsWith('"') && f2.endsWith('"')) {
        f2 = f2.slice(1, -1);
    }
    // f2 should look like ['atbva=b'] possibly with spaces
    // Extract the name before '=' inside the brackets and optional single quotes
    // Examples matched: ['atbva=b'], [ 'atb=REDACTED' ], ['bing_market=cs-CZ']
    const m = f2.match(/\[\'([^=]*)/)[1]
    if (m) {
        params.add(m);
    }
}

if (params.size === 0) {
    console.log(`No parameter names found in ${inputPath}`);
    process.exit(0);
}

function* walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(full);
        else if (e.isFile()) yield full;
    }
}

function wordRegex(word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Whole word using \b; if params can contain underscores, \b still works.
    return new RegExp(`\\b${esc}\\b`, 'g');
}

const regexByParam = {};
for (const p of params) regexByParam[p] = wordRegex(p);

function runGrep(term) {
    const cmd =
        `/usr/bin/grep -Irlw -- ${term} ${searchDir} ` +
        `| /usr/bin/fgrep -v "/pixel-definitions/"` +
        `| /usr/bin/fgrep -v "/ParseNginx.pm"` +
        `| /usr/bin/fgrep -v "ddg/.git"` +
        `| /usr/bin/grep -v ".*\.csv$"`
        ;

    const res = spawnSync('/bin/bash', ['-c', cmd], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 200,
    });

    if (res.error) {
        console.warn(res.error, args)
        if (res.error.code === 'ENOENT') {
            console.error('Error: grep not found on PATH. Install GNU grep.');
            process.exit(2);
        }
        throw res.error;
    }
    return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() };
}

for (const p of params) {
    console.log(`=== Searching for whole word: ${p} and ${p}_.* ===`);
    try {
        const { code, out } = runGrep(p);
        if (code === 0 && out) {
            console.log(out);
        } else {
            // fallback to _ suffix
            const { code, out } = runGrep(p + '_.*');
            if (code === 0 && out) {
                console.log(out);
            } else {
                console.log(`No matches for: ${p}`);
            }
        }
    } catch (e) {
        console.error(`Search failed for ${p}: ${e.message}`);
    }
    console.log();
}
