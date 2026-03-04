import { exec } from 'child_process';
import { expect } from 'chai';
import path from 'path';

describe('Validate wide event debug logs', () => {
    it('validates mixed wide event log lines', (done) => {
        const defsPath = path.join('tests', 'test_data', 'valid');
        const logPath = path.join(defsPath, 'wide_events', 'wide_event_validation_log.jsonl');

        exec(`node ./bin/validate_wide_event_debug_logs.mjs ${defsPath} ${logPath}`, (error, stdout, stderr) => {
            expect(error).to.equal(null);
            expect(stdout).to.include("✅ Valid: 'w_wide_import_summary@1.0.0'");
            expect(stderr).to.include("⚠️  Undocumented wide event: 'w_unknown_event@1.0.0'");
            expect(stderr).to.include("❌ Invalid: 'w_wide_import_summary@1.0.0' - see below for details");
            expect(stderr).to.include('Invalid wide event payload (missing meta.type or meta.version)');
            expect(stderr).to.include('Invalid log line - skipping validation');
            done();
        });
    });
});
