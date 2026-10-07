import { expect } from 'chai';

import { applyNotifyOverride, getPixelFailureMessage } from '../src/asana_report_copy.mjs';

describe('Asana report copy', () => {
    it('includes the target app version and release warning', () => {
        const message = getPixelFailureMessage(2, false, '1.2.3');

        expect(message).to.include('2 pixels have failed live validation.');
        expect(message).to.include('<strong>Target app version:</strong> 1.2.3');
        expect(message).to.include(
            "If you've changed the pixel post this release, you may see a false positive alert for any parameters that were removed from the schema but are still present in the currently released version. This should be resolved by the next app release.",
        );
    });

    it('includes the target app version on per-owner subtasks', () => {
        const message = getPixelFailureMessage(1, true, '1.2.3');

        expect(message).to.include('1 pixel that you own has failed live validation.');
        expect(message).to.include('<strong>Target app version:</strong> 1.2.3');
    });

    it('omits version copy for query-window products', () => {
        const message = getPixelFailureMessage(2, false, null);

        expect(message).not.to.include('Target app version');
        expect(message).not.to.include("If you've changed the pixel post this release");
    });

    it('escapes the target version before adding it to HTML notes', () => {
        const message = getPixelFailureMessage(0, false, '1.2.3<script>');

        expect(message).to.include('<strong>Target app version:</strong> 1.2.3&lt;script&gt;');
        expect(message).not.to.include('1.2.3<script>');
    });
});

describe('Asana report notifications', () => {
    const notify = {
        assigneeGID: 'assignee',
        followerGIDs: ['follower'],
        tagPixelOwners: false,
    };

    it('removes all human notifications when disabled', () => {
        expect(applyNotifyOverride(notify, 'false')).to.deep.equal({ tagPixelOwners: false });
    });

    it('keeps configured assignees and followers when enabled', () => {
        expect(applyNotifyOverride(notify, 'true')).to.deep.equal({ ...notify, tagPixelOwners: true });
    });

    it('does not mutate configured notifications', () => {
        applyNotifyOverride(notify, 'true');

        expect(notify).to.deep.equal({
            assigneeGID: 'assignee',
            followerGIDs: ['follower'],
            tagPixelOwners: false,
        });
    });
});
