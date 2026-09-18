// Obsidian's review rules, run over everything the community directory scans.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
    { ignores: ['obsidian-plugin/main.js', 'dist*/', 'dev-dist/', 'scripts/', '*.config.*', 'src/**/*.test.ts'] },
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: { project: ['tsconfig.obsidian.json', 'tsconfig.ext.json'], tsconfigRootDir: import.meta.dirname },
        },
        // The review reports this one as a warning; it misreads assertions that steer a generic call.
        rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'warn' },
    },
    { files: ['ext/**'], languageOptions: { globals: { chrome: 'readonly' } } },
]);
