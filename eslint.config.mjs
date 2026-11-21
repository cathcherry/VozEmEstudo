import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      // Local agent worktrees (never committed).
      '.claude/**',
      '**/vendor/**',
      '**/artifacts/**',
      '**/evidence/**',
      '**/dist/**',
      '**/build/**',
      '**/.env*',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { ecmaVersion: 2023 },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-shadow': 'error',
      'no-duplicate-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['backend/**/*.js', 'scripts/**/*.mjs', '**/*.cjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/js/**/*.js', 'scripts/presentation/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  { files: ['frontend/js/utils/theme-init.js'], languageOptions: { sourceType: 'script' } },
  // Functions executed by Playwright evaluate/addInitScript run in the browser.
  {
    files: ['frontend/tests/*.{cjs,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // axe-core is injected into the page before Playwright evaluates the callback.
  {
    files: ['frontend/tests/browser-check.cjs'],
    languageOptions: { globals: { axe: 'readonly' } },
  },
];
