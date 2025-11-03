import { describe, it } from 'mocha';
import { expect } from 'chai';
import { matchPixel_old, matchPixel } from '../src/pixel_utils.mjs';
import { tokenizePixelDefs } from '../src/tokenizer.mjs';


describe('matchPixel_old', () => {
    let allPixels = {
        m: {
            // ...
        },
        m_l: {
            // ...
        },
        m_lp: {
            // ...
        },
        m_lp_c: {
            // ...
        }
    };

    tokenizePixelDefs(allPixels, allPixels);

    it('should return the longest matching prefix and the matched pixel object', () => {
        const [prefix, pixelMatch] = matchPixel_old('m_lp_a_b', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel that has no match', () => {
        const [prefix, pixelMatch] = matchPixel_old('lp', allPixels);
        expect(prefix).to.deep.equal('');
        expect(pixelMatch).to.deep.equal(allPixels);
    });

    it('should handle a pixel that is an exact match - shorter', () => {
        const [prefix, pixelMatch] = matchPixel_old('m_l', allPixels);
        expect(prefix).to.equal('m_l');
        expect(pixelMatch).to.deep.equal(allPixels.m_l);
    });

    it('should handle a pixel that is an exact match - longer', () => {
        const [prefix, pixelMatch] = matchPixel_old('m_lp', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel with a trailing delimiter', () => {
        const [prefix, pixelMatch] = matchPixel_old(`m_lp_`, allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });
});

describe('matchPixel', () => {
    const allPixels = {
        m: {
            // ...
        },
        m_l: {
            // ...
        },
        m_lp: {
            // ...
        },
        m_lp_c: {
            // ...
        }
    };

    it('should return the longest matching prefix and the matched pixel object', () => {
        const [prefix, pixelMatch] = matchPixel('m_lp_a_b', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel that has no match', () => {
        const [prefix, pixelMatch] = matchPixel('lp', allPixels);
        expect(prefix).to.deep.equal('');
        expect(pixelMatch).to.deep.equal(allPixels);
    });

    it('should handle a pixel that is an exact match - shorter', () => {
        const [prefix, pixelMatch] = matchPixel('m_l', allPixels);
        expect(prefix).to.equal('m_l');
        expect(pixelMatch).to.deep.equal(allPixels.m_l);
    });

    it('should handle a pixel that is an exact match - longer', () => {
        const [prefix, pixelMatch] = matchPixel('m_lp', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel with a trailing delimiter', () => {
        const [prefix, pixelMatch] = matchPixel(`m_lp_`, allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });
});