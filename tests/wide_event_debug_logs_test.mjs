import { exec } from 'child_process';
import { expect } from 'chai';
import path from 'path';

describe('Wide event debug logs', () => {
    it('validates JSONL log lines', (done) => {
        const defsPath = path.join('tests', 'test_data', 'valid');
        const logPath = path.join(defsPath, 'wide_events', 'wide_event_validation_log.jsonl');
        exec(`node ./bin/validate_wide_event_debug_logs.mjs ${defsPath} ${logPath}`, (error, stdout, stderr) => {
            expect(error).to.equal(null);
            expect(stderr.trim()).to.equal('');
            expect(stdout).to.include("✅ Valid: 'w_wide_import_summary@1.0.0'");
            done();
        });
    });
});
