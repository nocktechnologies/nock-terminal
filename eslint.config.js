const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

// Correctness-focused lint gate: js recommended + React hooks rules.
// Deliberately no stylistic/formatting rules — the gate exists to catch
// real bugs (unused code, undefined vars, broken hook usage), not to
// argue about whitespace.
module.exports = [
  {
    ignores: ['dist/**', 'dist-react/**', 'node_modules/**', '.claude/**', '.memsearch/**'],
  },
  // Electron main process + scripts + tests: CommonJS under Node
  {
    files: ['electron/**/*.js', 'scripts/**/*.{js,mjs,cjs}', 'test/**/*.{cjs,mjs}', '*.config.js', 'postcss.config.js', 'tailwind.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Stripping C0 control chars is a core sanitizer pattern here
      // (terminal input staging, dispatch text, IPC string validation).
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'vite.config.js'],
    languageOptions: { sourceType: 'module' },
  },
  // Renderer: ESM + JSX in the browser
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Stripping C0 control chars is a core sanitizer pattern here
      // (terminal input staging, dispatch text, IPC string validation).
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
