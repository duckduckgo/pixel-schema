import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseSearchExperiments } from '../src/pixel_utils.mjs';

describe('parseSearchExperiments', () => {
    it('should return an empty object when given no input', () => {
        const result = parseSearchExperiments();
        expect(result).to.deep.equal({});
    });

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
                variants: ["a", "b"],
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
            valid_exp_empty: {
            }
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
