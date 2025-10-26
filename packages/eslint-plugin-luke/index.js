/**
 * @luke/eslint-plugin-luke - Custom ESLint rules for Luke monorepo
 *
 * Provides project-specific linting rules to enforce coding standards
 * and prevent common issues in the Luke codebase.
 *
 * @version 0.1.0
 * @author Luke Team
 */

module.exports = {
  rules: {
    'no-hardcoded-url': require('./rules/no-hardcoded-url'),
  },
  configs: {
    recommended: {
      plugins: ['@luke/eslint-plugin-luke'],
      rules: {
        '@luke/no-hardcoded-url': 'error',
      },
    },
  },
};
