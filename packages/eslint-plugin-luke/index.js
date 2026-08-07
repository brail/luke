import noBareZodPartial from './rules/no-bare-zod-partial.js';
import noUncommentedAny from './rules/no-uncommented-any.js';
import noUncommentedTailwindArbitrary from './rules/no-uncommented-tailwind-arbitrary.js';

export default {
  rules: {
    'no-bare-zod-partial': noBareZodPartial,
    'no-uncommented-any': noUncommentedAny,
    'no-uncommented-tailwind-arbitrary': noUncommentedTailwindArbitrary,
  },
};
