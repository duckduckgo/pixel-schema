import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseSearchExperiments, matchPixel, matchSearchExperiment, mergeParameters } from '../src/pixel_utils.mjs';
import { tokenizePixelDefs } from '../src/tokenizer.mjs';
import { ROOT_PREFIX } from '../src/constants.mjs';

describe('parseSearchExperiments', () => {
    it('should return an empty object for an empty input object', () => {
        const result = parseSearchExperiments({});
        expect(result).to.deep.equal({});
    });

    it('should parse a single experiment with string variants', () => {
        const searchExperiments = {
            test_exp: {
                description: 'A test experiment',
                variants: ['control', 'treatment'],
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        const expected = {
            key: 'test_exp',
            description: 'A test experiment',
            enum: ['control', 'treatment'],
            type: 'string',
        };

        const expectedPrebounce = {
            key: 'prebounce_test_exp',
            description: 'A test experiment',
            enum: ['control', 'treatment'],
            type: 'string',
        };

        expect(result).to.have.all.keys('test_exp', 'prebounce_test_exp');
        expect(result.test_exp).to.deep.equal(expected);
        expect(result.prebounce_test_exp).to.deep.equal(expectedPrebounce);
    });

    it('should infer "string" type for string variants', () => {
        const searchExperiments = {
            num_exp: {
                description: 'A string experiment',
                variants: ['a', 'b'],
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        expect(result.num_exp.type).to.equal('string');
        expect(result.prebounce_num_exp.type).to.equal('string');
    });

    it('should infer "boolean" type for boolean variants', () => {
        const searchExperiments = {
            bool_exp: {
                description: 'A boolean experiment',
                variants: [true, false],
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        expect(result.bool_exp.type).to.equal('boolean');
        expect(result.prebounce_bool_exp.type).to.equal('boolean');
    });

    it('should handle experiments with an empty variants array', () => {
        const searchExperiments = {
            empty_vars_exp: {
                description: 'An experiment with empty variants',
                variants: [],
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        expect(result.empty_vars_exp.enum).to.deep.equal([]);
        expect(result.empty_vars_exp).to.not.have.property('type');
        expect(result.prebounce_empty_vars_exp.enum).to.deep.equal([]);
        expect(result.prebounce_empty_vars_exp).to.not.have.property('type');
    });

    it('should handle experiments without a variants property', () => {
        const searchExperiments = {
            no_vars_exp: {
                description: 'An experiment without variants',
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        expect(result.no_vars_exp).to.not.have.property('enum');
        expect(result.no_vars_exp).to.not.have.property('type');
        expect(result.prebounce_no_vars_exp).to.not.have.property('enum');
        expect(result.prebounce_no_vars_exp).to.not.have.property('type');
    });

    it('should handle multiple experiments', () => {
        const searchExperiments = {
            exp1: {
                description: 'First experiment',
                variants: ['a', 'b'],
            },
            exp2: {
                description: 'Second experiment',
                variants: [10, 20],
            },
        };

        const result = parseSearchExperiments(searchExperiments);

        expect(result).to.have.all.keys('exp1', 'prebounce_exp1', 'exp2', 'prebounce_exp2');

        expect(result.exp1.type).to.equal('string');
        expect(result.exp1.description).to.equal('First experiment');

        expect(result.prebounce_exp2.type).to.equal('number');
        expect(result.prebounce_exp2.key).to.equal('prebounce_exp2');
        expect(result.prebounce_exp2.description).to.equal('Second experiment');
    });

    it('should handle experiment definitions with missing properties', () => {
        const searchExperiments = {
            valid_exp: {
                description: 'A valid experiment',
                variants: ['on', 'off'],
            },
            valid_exp_empty: {},
        };

        expect(() => parseSearchExperiments(searchExperiments)).to.not.throw();
    });

    it('should throw on experiment definitions that are null or undefined', () => {
        const searchExperiments = {
            null_exp: null,
            undef_exp: undefined,
        };

        expect(() => parseSearchExperiments(searchExperiments)).to.throw(TypeError);
    });
});

describe('matchPixel', () => {
    const testPixels = {
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
        },
    };

    const allPixels = {};
    tokenizePixelDefs(testPixels, allPixels);

    const expectedTokens = {
        m: allPixels.m[ROOT_PREFIX],
        m_l: allPixels.m.l[ROOT_PREFIX],
        m_lp: allPixels.m.lp[ROOT_PREFIX],
        m_lp_c: allPixels.m.lp.c[ROOT_PREFIX],
        none: undefined,
    };

    it('should return the longest matching prefix and the matched pixel object', () => {
        const [prefix, pixelMatch] = matchPixel('m_lp_a_b', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(expectedTokens.m_lp);
    });

    it('should handle a pixel that has no match', () => {
        const [prefix, pixelMatch] = matchPixel('lp', allPixels);
        expect(prefix).to.equal('');
        expect(pixelMatch).to.deep.equal(expectedTokens.none);
    });

    it('should handle a pixel that is an exact match - shorter', () => {
        const [prefix, pixelMatch] = matchPixel('m_l', allPixels);
        expect(prefix).to.equal('m_l');
        expect(pixelMatch).to.deep.equal(expectedTokens.m_l);
    });

    it('should handle a pixel that is an exact match - longer', () => {
        const [prefix, pixelMatch] = matchPixel('m_lp', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(expectedTokens.m_lp);
    });

    it('should handle an empty pixel string', () => {
        const [prefix, pixelMatch] = matchPixel('', allPixels);
        expect(prefix).to.equal('');
        expect(pixelMatch).to.deep.equal(expectedTokens.none);
    });

    it('should handle an empty allPixels object', () => {
        const [prefix, pixelMatch] = matchPixel('m_lp_a', {});
        expect(prefix).to.equal('');
        expect(pixelMatch).to.deep.equal(expectedTokens.none);
    });

    it('should handle a pixel with a trailing delimiter', () => {
        const [prefix, pixelMatch] = matchPixel(`m_lp_`, allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(expectedTokens.m_lp);
    });
});

describe('matchSearchExperiment', () => {
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
        },
    };

    it('should return the longest matching prefix and the matched pixel object', () => {
        const [prefix, pixelMatch] = matchSearchExperiment('m_lp_a_b', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel that has no match', () => {
        const [prefix, pixelMatch] = matchSearchExperiment('lp', allPixels);
        expect(prefix).to.deep.equal('');
        expect(pixelMatch).to.deep.equal(allPixels);
    });

    it('should handle a pixel that is an exact match - shorter', () => {
        const [prefix, pixelMatch] = matchSearchExperiment('m_l', allPixels);
        expect(prefix).to.equal('m_l');
        expect(pixelMatch).to.deep.equal(allPixels.m_l);
    });

    it('should handle a pixel that is an exact match - longer', () => {
        const [prefix, pixelMatch] = matchSearchExperiment('m_lp', allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });

    it('should handle a pixel with a trailing delimiter', () => {
        const [prefix, pixelMatch] = matchSearchExperiment(`m_lp_`, allPixels);
        expect(prefix).to.equal('m_lp');
        expect(pixelMatch).to.deep.equal(allPixels.m_lp);
    });
});

describe('mergeParameters', () => {
    it('should merge two disjoint lists of string parameters', () => {
        const params1 = ['a', 'b'];
        const params2 = ['c', 'd'];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal(['a', 'b', 'c', 'd']);
    });

    it('should not add duplicate string parameters', () => {
        const params1 = ['a', 'b'];
        const params2 = ['b', 'c'];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('should merge two disjoint lists of object parameters', () => {
        const params1 = [{ key: 'a' }, { key: 'b' }];
        const params2 = [{ key: 'c' }, { key: 'd' }];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal([{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]);
    });

    it('should ensure param1 takes precedence over param2', () => {
        const params1 = [{ key: 'a', value: '1' }, { key: 'b' }];
        const params2 = [{ key: 'b', value: '2' }, { key: 'c' }];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal([{ key: 'a', value: '1' }, { key: 'b' }, { key: 'c' }]);
    });

    it('should not add duplicate object parameters based on keyPattern', () => {
        const params1 = [{ keyPattern: 'a*' }, { key: 'b' }];
        const params2 = [{ keyPattern: 'a*' }, { key: 'c' }];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal([{ keyPattern: 'a*' }, { key: 'b' }, { key: 'c' }]);
    });

    it('should handle mixed string and object parameters', () => {
        const params1 = ['a', { key: 'b' }];
        const params2 = ['b', { key: 'a' }, 'c'];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal(['a', { key: 'b' }, 'c']);
    });

    it('should handle an empty parameters list', () => {
        const params1 = [];
        const params2 = ['a', 'b'];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal(['a', 'b']);
    });

    it('should handle an empty extraParams list', () => {
        const params1 = ['a', 'b'];
        const params2 = [];
        const result = mergeParameters(params1, params2);
        expect(result).to.deep.equal(['a', 'b']);
    });

    it('should handle both lists being empty', () => {
        const result = mergeParameters([], []);
        expect(result).to.deep.equal([]);
    });

    it('should throw an error if extraParams is not an array', () => {
        const params1 = ['a', 'b'];
        const invalidExtraParams = { c: 'd' };
        expect(() => mergeParameters(params1, invalidExtraParams)).to.throw(TypeError);
    });

    it('should throw an error if parameters is not an array', () => {
        const invalidParams = { a: 'b' };
        const extraParams = ['c', 'd'];
        expect(() => mergeParameters(invalidParams, extraParams)).to.throw(TypeError);
    });
});
