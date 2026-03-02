import fs from 'node:fs';

export function readLogLines(filePath) {
    return fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function printValidationErrors(errors) {
    for (const error of errors) {
        console.error(`\t${error}`);
    }
}
