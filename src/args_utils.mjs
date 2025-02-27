import fs from 'fs';
import yargs from 'yargs';

import { hideBin } from 'yargs/helpers';

function getArgParser(description) {
    return yargs(hideBin(process.argv))
        .command('$0 [dirPath]', description, (yargs) => {
            return yargs.positional('dirPath', {
                    describe: 'path to directory containing the pixels folder and common_[params/suffixes].json in the root',
                    type: 'string',
                    demandOption: true,
                    coerce: (dirPath) => {
                        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                            throw new Error(`Directory path ${dirPath} does not exist!`);
                        }
                        return dirPath;
                    },
                })
        })
        .demandOption('dirPath')
}

export { getArgParser };
