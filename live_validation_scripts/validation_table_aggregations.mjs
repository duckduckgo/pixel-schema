import { spawnSync } from 'child_process';
import { dirname } from 'path';

import * as fileUtils from '../src/file_utils.mjs';

const [date, dirPath] = process.argv.slice(2);

async function main(date, dirPath) {
    const productDef = fileUtils.readProductDef(dirPath);
    console.log(`Aggregating validation results for day: ${date}, for ${dirname(dirPath)}`);
    
    const query = `
    INSERT INTO pixels.daily_validation_results 
    SELECT
        date,
        agent,
        SUM(freq) AS total_impressions,
        SUM(CASE WHEN status = 3 THEN freq ELSE 0 END) AS valid, 
        SUM(CASE WHEN status = 2 THEN freq ELSE 0 END) AS invalid,
        SUM(CASE WHEN status = 1 THEN freq ELSE 0 END) AS old_app_version,
        SUM(CASE WHEN status = 0 THEN freq ELSE 0 END) AS undocumented,
        COUNT(DISTINCT params) AS parameter_permutations
    FROM pixels.validation_results
    WHERE date = '${date}' AND agent IN (${productDef.agents.map((agent) => `'${agent}'`).join(',')})
    GROUP BY date, agent
    ORDER BY agent, date
    `
    const query2 = `
    INSERT INTO pixels.daily_valid_prefix_results
    SELECT
        date,
        agent,
        prefix, 
        SUM(freq) AS total_impressions,
        SUM(CASE WHEN status = 3 THEN freq ELSE 0 END) AS valid, 
        SUM(CASE WHEN status = 2 THEN freq ELSE 0 END) AS invalid,
        SUM(CASE WHEN status = 1 THEN freq ELSE 0 END) AS old_app_version,
        SUM(CASE WHEN status = 0 THEN freq ELSE 0 END) AS undocumented,
        COUNT(DISTINCT params) AS parameter_perms,
        arrayFlatten(groupUniqArray(owners)) as owners,
        arrayFlatten(groupUniqArray(errors)) as errors
    FROM pixels.validation_results
    WHERE date = '${date}' AND agent IN (${productDef.agents.map((agent) => `'${agent}'`).join(',')})
    GROUP BY date, agent, prefix`;

    spawnSync('ddg-rw-ch', ['-h', 'clickhouse', '--query', query]);
    spawnSync('ddg-rw-ch', ['-h', 'clickhouse', '--query', query2]);
}

main(date, dirPath).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
