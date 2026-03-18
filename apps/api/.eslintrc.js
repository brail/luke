/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      files: ['instrument.ts'], // Eccezione per bootstrap
      rules: { 'no-console': 'off' },
    },
  ],
};

