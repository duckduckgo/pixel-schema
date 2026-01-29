import { spawnSync } from 'child_process';
import { dirname } from 'path';

import * as fileUtils from '../src/file_utils.mjs';
import { resolveTargetVersion } from '../src/pixel_utils.mjs';

const [date, dirPath, csvFile] = process.argv.slice(2);

async function main(day, mainDir, csvFile) {
    const productDef = fileUtils.readProductDef(mainDir);
    const resolvedVersion = await resolveTargetVersion(productDef.target);
    productDef.target.version = resolvedVersion;
    console.log(`Importing pixels for day: ${day}, for ${dirname(mainDir)}`);
    console.log(`Using minimum version: ${resolvedVersion}`);

    const query = `WITH
        extractURLParameters(request) AS params_raw,
        has(params_raw, 'test=1') AS is_test,
        arrayFilter(x -> NOT match(x, '^\\d+=?$'), params_raw) AS params_filtered,
        arrayFirst(x -> match(x, '^(appVersion|extensionVersion)='), params_filtered) as version

    SELECT date, agent, version, pixel_id, pixel, params_filtered AS params, COUNT(*) AS freq
    FROM metrics.pixels
    WHERE date = '${day}' AND 
        (request LIKE '%appVersion=%' OR request LIKE '%extensionVersion=%') AND
        agent IN (${productDef.agents.map((agent) => `'${agent}'`).join(',')}) AND 
        pixel_id IN (
            SELECT DISTINCT pixel_id FROM metrics.pixels_validation_pixel_ids
        ) AND
        NOT is_test
    GROUP BY date, agent, version, pixel_id, pixel, params_filtered
    INTO OUTFILE '${csvFile}'
    FORMAT CSVWithNames
    `
    const result = spawnSync('ddg-ro-ch', ['-h', 'clickhouse', '--query', query]);
    console.log(result.stderr.toString());
    console.log(result.stdout.toString());
}

main(date, dirPath, csvFile).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});