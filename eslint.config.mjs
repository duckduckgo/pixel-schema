import globals from 'globals';
import ddgConfig from '@duckduckgo/eslint-config';
import importPlugin from 'eslint-plugin-import';

export default [
    ...ddgConfig,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    {
        files: ['**/tests/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.mocha,
            },
        },
        rules: {
            'no-unused-expressions': 'off',
        },
    },
    {
        plugins: {
            import: importPlugin,
        },
        rules: {
            'import/no-cycle': ['error', { maxDepth: 1 }],
        },
    }
];
