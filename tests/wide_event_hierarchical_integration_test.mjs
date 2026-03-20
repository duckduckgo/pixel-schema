import { exec } from 'child_process';
import { expect } from 'chai';
import path from 'path';

describe('Validate hierarchical wide event payloads', () => {
    it('validates nested action metrics and error objects', (done) => {
        const defsPath = path.join('tests', 'test_data', 'wide_events_hierarchical');
        const logPath = path.join(defsPath, 'wide_event_hierarchical_validation_log.jsonl');

        exec(`node ./bin/validate_wide_event_debug_logs.mjs ${defsPath} ${logPath}`, (error, stdout, stderr) => {
            expect(error).to.equal(null);
            expect(stdout).to.include("✅ Valid: 'w_data_clearing_hierarchical@1.0.2'");
            expect(stderr).to.include("❌ Invalid: 'w_data_clearing_hierarchical@1.0.2' - see below for details");
            expect(stderr).to.include("must have required property 'underlying_code'");
            expect(stderr).to.include("⚠️  Undocumented wide event: 'w_data_clearing_hierarchical@9.9.9'");
            done();
        });
    });
});
