import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import { fileURLToPath } from 'url';

describe('prop_schema array property defs', () => {
    const propSchemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'prop_schema.json5');
    const propSchema = JSON5.parse(fs.readFileSync(propSchemaPath, 'utf8'));

    // Build a metaschema: every property in the input must match the requested $def.
    const buildMetaValidator = (defName) => {
        // eslint-disable-next-line new-cap
        const ajv = new Ajv2020.default({ allErrors: true });
        addFormats.default(ajv);
        ajv.addSchema(propSchema);
        return ajv.compile({
            type: 'object',
            additionalProperties: { $ref: `prop_schema.json#/$defs/${defName}` },
        });
    };

    // Build an AJV validator from a property def itself, so we can confirm runtime payloads validate.
    const buildPayloadValidator = (propertyDef) => {
        // eslint-disable-next-line new-cap
        const ajv = new Ajv2020.default({ allErrors: true });
        addFormats.default(ajv);
        return ajv.compile(propertyDef);
    };

    [
        { defName: 'stringArrayProperty', itemType: 'string', itemEnum: ['a', 'b'], goodItems: ['a', 'b'], badItems: ['c'], wrongItem: 1 },
        { defName: 'integerArrayProperty', itemType: 'integer', itemEnum: [1, 2], goodItems: [1, 2], badItems: [3], wrongItem: 'x' },
        {
            defName: 'numberArrayProperty',
            itemType: 'number',
            itemEnum: [1.5, 2.5],
            goodItems: [1.5, 2.5],
            badItems: [3.5],
            wrongItem: 'x',
        },
    ].forEach(({ defName, itemType, itemEnum, goodItems, badItems, wrongItem }) => {
        describe(defName, () => {
            const validateMeta = buildMetaValidator(defName);

            it(`accepts a basic ${itemType} array property`, () => {
                const def = { p: { type: 'array', description: `An array of ${itemType}s`, items: { type: itemType } } };
                expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
            });

            it('accepts enum on items', () => {
                const def = {
                    p: { type: 'array', description: `An array of ${itemType}s`, items: { type: itemType, enum: itemEnum } },
                };
                expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
            });

            it('accepts minItems/maxItems', () => {
                const def = {
                    p: { type: 'array', description: `An array of ${itemType}s`, items: { type: itemType }, minItems: 1, maxItems: 5 },
                };
                expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
            });

            it('rejects when items.type does not match', () => {
                const def = { p: { type: 'array', description: `An array of ${itemType}s`, items: { type: 'boolean' } } };
                expect(validateMeta(def)).to.be.false;
            });

            it('rejects when items is missing', () => {
                const def = { p: { type: 'array', description: `An array of ${itemType}s` } };
                expect(validateMeta(def)).to.be.false;
            });

            it('rejects unknown keywords on the item schema', () => {
                const def = {
                    p: {
                        type: 'array',
                        description: `An array of ${itemType}s`,
                        items: { type: itemType, unexpected: 'nope' },
                    },
                };
                expect(validateMeta(def)).to.be.false;
            });

            it('compiles into a runtime validator that enforces item enums', () => {
                const def = { type: 'array', description: `An array of ${itemType}s`, items: { type: itemType, enum: itemEnum } };
                const validate = buildPayloadValidator(def);
                expect(validate(goodItems), JSON.stringify(validate.errors)).to.be.true;
                expect(validate(badItems)).to.be.false;
                expect(validate([wrongItem])).to.be.false;
                expect(validate(wrongItem)).to.be.false;
            });
        });
    });

    it('integerArrayProperty supports minimum/maximum on items', () => {
        const validateMeta = buildMetaValidator('integerArrayProperty');
        const def = { p: { type: 'array', description: 'bounded ints', items: { type: 'integer', minimum: 0, maximum: 10 } } };
        expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
    });

    it('numberArrayProperty supports minimum/maximum on items', () => {
        const validateMeta = buildMetaValidator('numberArrayProperty');
        const def = { p: { type: 'array', description: 'bounded nums', items: { type: 'number', minimum: 0, maximum: 1 } } };
        expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
    });

    it('stringArrayProperty supports pattern on items', () => {
        const validateMeta = buildMetaValidator('stringArrayProperty');
        const def = { p: { type: 'array', description: 'patterned strings', items: { type: 'string', pattern: '^[a-z]+$' } } };
        expect(validateMeta(def), JSON.stringify(validateMeta.errors)).to.be.true;
    });
});
