/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-console': 'warn', // Warn per permettere fix graduale
  },
  overrides: [
    {
      files: ['instrument.ts'], // Eccezione per bootstrap
      rules: { 'no-console': 'off' },
    },
  ],
};
