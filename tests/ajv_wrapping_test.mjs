/**
 * Test to identify which properties in a generated wide event schema
 * need to be wrapped to produce a valid AJV schema.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { expect } from 'chai';

describe('AJV Schema Wrapping Requirements', () => {
    // Sample generated schema structure (after mergeWithBaseEvent and expandShortcuts)
    const generatedEventSchema = {
        description: 'Test event description',
        owners: ['tester'],
        meta: {
            type: 'w_test_event',
            version: '1.0.0',
        },
        app: {
            name: { type: 'string', description: 'App name', enum: ['TestApp'] },
            version: { type: 'string', description: 'Version', pattern: '^[0-9]+' },
        },
        global: {
            platform: { type: 'string', description: 'Platform', enum: ['Windows'] },
            type: { type: 'string', description: 'Type', enum: ['app'] },
            sample_rate: { type: 'number', description: 'Sample rate' },
        },
        feature: {
            name: { type: 'string', description: 'Feature', enum: ['test-feature'] },
            status: { type: 'string', description: 'Status', enum: ['SUCCESS'] },
            data: {
                ext: {
                    custom_field: { type: 'string', description: 'Custom' },
                },
            },
        },
        context: {
            name: { type: 'string', description: 'Context', enum: ['test-context'] },
        },
    };

    const ajvStrict = new Ajv2020({ allErrors: true }); // strict: true by default

    describe('Root-level properties that ARE valid JSON Schema keywords', () => {
        it('description - valid annotation keyword, no wrapping needed', () => {
            const schema = { description: 'Test description' };
            expect(() => ajvStrict.compile(schema)).to.not.throw();
        });
    });

    describe('Root-level properties that are NOT valid JSON Schema keywords (need wrapping)', () => {
        it('owners - unknown keyword, fails in strict mode', () => {
            const schema = { owners: ['tester'] };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });

        it('meta - unknown keyword, fails in strict mode', () => {
            const schema = { meta: { type: 'event_name', version: '1.0.0' } };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });

        it('app - unknown keyword, fails in strict mode', () => {
            const schema = { app: generatedEventSchema.app };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });

        it('global - unknown keyword, fails in strict mode', () => {
            const schema = { global: generatedEventSchema.global };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });

        it('feature - unknown keyword, fails in strict mode', () => {
            const schema = { feature: generatedEventSchema.feature };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });

        it('context - unknown keyword, fails in strict mode', () => {
            const schema = { context: generatedEventSchema.context };
            expect(() => ajvStrict.compile(schema)).to.throw(/unknown keyword/);
        });
    });

    describe('Property definitions (leaf nodes) ARE already valid JSON Schema', () => {
        it('app.name - has type:"string", valid as-is', () => {
            const schema = generatedEventSchema.app.name;
            expect(() => ajvStrict.compile(schema)).to.not.throw();
        });

        it('global.sample_rate - has type:"number", valid as-is', () => {
            const schema = generatedEventSchema.global.sample_rate;
            expect(() => ajvStrict.compile(schema)).to.not.throw();
        });

        it('feature.data.ext.custom_field - has type:"string", valid as-is', () => {
            const schema = generatedEventSchema.feature.data.ext.custom_field;
            expect(() => ajvStrict.compile(schema)).to.not.throw();
        });
    });

    describe('Wrapping strategy', () => {
        it('container objects need {type:"object", properties:{...}} wrapping', () => {
            // app is a container (no "type" property with JSON Schema type value)
            // Its children ARE property definitions
            const wrappedApp = {
                type: 'object',
                properties: generatedEventSchema.app,
            };
            expect(() => ajvStrict.compile(wrappedApp)).to.not.throw();
        });

        it('full schema needs recursive wrapping of all containers', () => {
            // This is what #convertToAjvSchema does
            const fullyWrappedSchema = {
                type: 'object',
                properties: {
                    description: { const: generatedEventSchema.description },
                    owners: { const: generatedEventSchema.owners },
                    meta: {
                        type: 'object',
                        properties: {
                            type: { const: generatedEventSchema.meta.type },
                            version: { const: generatedEventSchema.meta.version },
                        },
                    },
                    app: {
                        type: 'object',
                        properties: generatedEventSchema.app, // children are already valid
                    },
                    global: {
                        type: 'object',
                        properties: generatedEventSchema.global,
                    },
                    feature: {
                        type: 'object',
                        properties: {
                            name: generatedEventSchema.feature.name,
                            status: generatedEventSchema.feature.status,
                            data: {
                                type: 'object',
                                properties: {
                                    ext: {
                                        type: 'object',
                                        properties: generatedEventSchema.feature.data.ext,
                                    },
                                },
                            },
                        },
                    },
                    context: {
                        type: 'object',
                        properties: generatedEventSchema.context,
                    },
                },
            };
            expect(() => ajvStrict.compile(fullyWrappedSchema)).to.not.throw();
        });
    });

    describe('Summary: Properties requiring wrapping', () => {
        /**
         * Properties that need wrapping (not valid JSON Schema keywords):
         *   - owners (array literal → {const: [...]})
         *   - meta (container → {type:"object", properties:{...}})
         *   - meta.type (string literal → {const: "..."})
         *   - meta.version (string literal → {const: "..."})
         *   - app (container → {type:"object", properties:{...}})
         *   - global (container → {type:"object", properties:{...}})
         *   - feature (container → {type:"object", properties:{...}})
         *   - feature.data (container)
         *   - feature.data.ext (container)
         *   - context (container → {type:"object", properties:{...}})
         *
         * Properties that do NOT need wrapping (already valid JSON Schema):
         *   - description (annotation keyword)
         *   - Any object with "type" set to a valid JSON Schema type
         *     (string, number, integer, boolean, array, object, null)
         */
        it('documents the wrapping rules', () => {
            const needsWrapping = (value) => {
                if (value === null || value === undefined) return true; // → {const: value}
                if (typeof value !== 'object') return true; // primitives → {const: value}
                if (Array.isArray(value)) return true; // arrays → {const: value}

                // Objects with valid JSON Schema "type" don't need wrapping
                const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
                if ('type' in value && validTypes.includes(value.type)) {
                    return false; // Already valid JSON Schema
                }

                return true; // Container object → needs {type:"object", properties:{...}}
            };

            // Test the detection
            expect(needsWrapping('literal string')).to.be.true;
            expect(needsWrapping(['array'])).to.be.true;
            expect(needsWrapping({ type: 'string', description: 'test' })).to.be.false;
            expect(needsWrapping({ type: 'number', description: 'test' })).to.be.false;
            expect(needsWrapping({ name: { type: 'string' } })).to.be.true; // container
            expect(needsWrapping(generatedEventSchema.app)).to.be.true; // container
            expect(needsWrapping(generatedEventSchema.app.name)).to.be.false; // property def
        });
    });
});
