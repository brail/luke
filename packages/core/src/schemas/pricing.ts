import { z } from 'zod';

/**
 * Valute supportate dal sistema di pricing
 */
export const PRICING_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CNY'] as const;
export type PricingCurrency = (typeof PRICING_CURRENCIES)[number];

/**
 * Schema per la creazione/modifica di un set di parametri
 */
export const PricingParameterSetInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Il nome è obbligatorio')
    .max(100, 'Il nome non può superare 100 caratteri'),
  countryCode: z
    .string({ required_error: 'Il codice paese è obbligatorio' })
    .regex(
      /^[A-Z]{2}$/,
      'Inserire un codice paese ISO 3166-1 alpha-2 valido (es. IT, CN, TR)'
    ),
  purchaseCurrency: z.string().min(1, 'La valuta di acquisto è obbligatoria'),
  sellingCurrency: z.string().min(1, 'La valuta di vendita è obbligatoria'),
  qualityControlPercent: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'Il controllo qualità non può essere negativo')
    .max(100, 'Il controllo qualità non può superare il 100%'),
  transportInsuranceCost: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'Il costo di trasporto non può essere negativo'),
  duty: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'Il dazio non può essere negativo')
    .max(100, 'Il dazio non può superare il 100%'),
  exchangeRate: z
    .number({ required_error: 'Campo obbligatorio' })
    .positive('Il tasso di cambio deve essere positivo'),
  italyAccessoryCosts: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'I costi accessori non possono essere negativi'),
  tools: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'I costi stampi non possono essere negativi'),
  retailMultiplier: z
    .number({ required_error: 'Campo obbligatorio' })
    .positive('Il moltiplicatore retail deve essere positivo'),
  optimalMargin: z
    .number({ required_error: 'Campo obbligatorio' })
    .min(0, 'Il margine ottimale non può essere negativo')
    .max(99.9, 'Il margine ottimale non può raggiungere il 100%'),
});

export type PricingParameterSetInput = z.infer<
  typeof PricingParameterSetInputSchema
>;

/**
 * Schema per l'aggiornamento (include l'id)
 */
export const PricingParameterSetUpdateSchema =
  PricingParameterSetInputSchema.extend({
    id: z.string().uuid('ID non valido'),
  });

export type PricingParameterSetUpdate = z.infer<
  typeof PricingParameterSetUpdateSchema
>;

/**
 * Modalità di calcolo disponibili
 */
export const PricingModeSchema = z.enum(['forward', 'inverse', 'margin']);
export type PricingMode = z.infer<typeof PricingModeSchema>;

/**
 * Schema per la richiesta di calcolo
 */
export const PricingCalculateInputSchema = z
  .object({
    mode: PricingModeSchema,
    purchasePrice: z.number().positive().optional(),
    retailPrice: z.number().positive().optional(),
    parameterSetId: z.string().uuid('ID set parametri non valido'),
    brandId: z.string().uuid('Brand ID non valido'),
    seasonId: z.string().uuid('Season ID non valido'),
  })
  .refine(
    data => {
      if (data.mode === 'forward') return data.purchasePrice !== undefined;
      if (data.mode === 'inverse') return data.retailPrice !== undefined;
      if (data.mode === 'margin')
        return (
          data.purchasePrice !== undefined && data.retailPrice !== undefined
        );
      return false;
    },
    {
      message:
        'forward richiede purchasePrice, inverse richiede retailPrice, margin richiede entrambi',
    }
  );

export type PricingCalculateInput = z.infer<typeof PricingCalculateInputSchema>;
