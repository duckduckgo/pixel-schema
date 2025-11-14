import { expect } from 'chai';
import { meetsDeletionCriteria } from '../live_validation_scripts/delete_attachments.mjs';
import { DAYS_TO_DELETE_ATTACHMENTS, ASANA_ATTACHMENT_PREFIX } from '../src/constants.mjs';

describe('delete_attachments.mjs - meetsDeletionCriteria', () => {
    // Calculate the cutoff date same way as the main script
    const cutoffDate = new Date(Date.now() - DAYS_TO_DELETE_ATTACHMENTS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const cutoffDateObj = new Date(cutoffDate);

    // Helper to create a date string relative to the cutoff
    const getDaysBeforeCutoff = (days) => {
        const date = new Date(cutoffDateObj);
        date.setDate(date.getDate() - days);
        return date.toISOString();
    };

    const getDaysAfterCutoff = (days) => {
        const date = new Date(cutoffDateObj);
        date.setDate(date.getDate() + days);
        return date.toISOString();
    };

    describe('attachments that should be deleted', () => {
        it('should return true for old attachment with correct prefix and .json extension', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_test_data.json`,
                created_at: getDaysBeforeCutoff(1),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.true;
        });

        it('should return true for attachment created exactly on cutoff date boundary', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_data.json`,
                created_at: getDaysBeforeCutoff(0.5), // Half day before cutoff
            };
            expect(meetsDeletionCriteria(attachment)).to.be.true;
        });

        it('should return true for very old attachment (multiple months)', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_ancient.json`,
                created_at: getDaysBeforeCutoff(100),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.true;
        });
    });

    describe('attachments that should NOT be deleted - wrong date', () => {
        it('should return false for recent attachment with correct name', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_recent_data.json`,
                created_at: getDaysAfterCutoff(1),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });

        it('should return false for attachment created today', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_today.json`,
                created_at: new Date().toISOString(),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });
    });

    describe('attachments that should NOT be deleted - wrong prefix', () => {
        it('should return false for old attachment with wrong prefix but correct extension', () => {
            const attachment = {
                name: 'wrong_prefix_data.json',
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });
    });

    describe('attachments that should NOT be deleted - wrong extension', () => {
        it('should return false for old attachment with correct prefix but .txt extension', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_data.txt`,
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });

        it('should return false for old attachment with correct prefix but no extension', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_data`,
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });
    });

    describe('edge cases and combinations', () => {
        it('returns false for old attachment with correct prefix but uppercase .JSON', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_data.JSON`,
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });

        it('should return false when prefix appears in middle of filename', () => {
            const attachment = {
                name: `some_${ASANA_ATTACHMENT_PREFIX}_data.json`,
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });

        it('should return false when old enough and has .json but wrong prefix', () => {
            const attachment = {
                name: 'manual_upload.json',
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });

        it('should return false when old enough and has correct prefix but wrong extension', () => {
            const attachment = {
                name: `${ASANA_ATTACHMENT_PREFIX}_report.pdf`,
                created_at: getDaysBeforeCutoff(10),
            };
            expect(meetsDeletionCriteria(attachment)).to.be.false;
        });
    });
});
