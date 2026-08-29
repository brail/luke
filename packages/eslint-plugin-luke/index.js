import noBareClientRandomUuid from './rules/no-bare-client-random-uuid.js';
import noBareZodPartial from './rules/no-bare-zod-partial.js';
import noDialogInputOutsideForm from './rules/no-dialog-input-outside-form.js';
import noRawQueryClient from './rules/no-raw-query-client.js';
import noUncommentedAny from './rules/no-uncommented-any.js';
import noUncommentedTailwindArbitrary from './rules/no-uncommented-tailwind-arbitrary.js';
import noUnreachableDisabledTooltip from './rules/no-unreachable-disabled-tooltip.js';

export default {
  rules: {
    'no-bare-client-random-uuid': noBareClientRandomUuid,
    'no-bare-zod-partial': noBareZodPartial,
    'no-dialog-input-outside-form': noDialogInputOutsideForm,
    'no-raw-query-client': noRawQueryClient,
    'no-uncommented-any': noUncommentedAny,
    'no-uncommented-tailwind-arbitrary': noUncommentedTailwindArbitrary,
    'no-unreachable-disabled-tooltip': noUnreachableDisabledTooltip,
  },
};
