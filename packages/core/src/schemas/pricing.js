"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingCalculateInputSchema = exports.PricingModeSchema = exports.PricingParameterSetUpdateSchema = exports.PricingParameterSetInputSchema = exports.PRICING_CURRENCIES = void 0;
const zod_1 = require("zod");
/**
 * Valute supportate dal sistema di pricing
 */
exports.PRICING_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CNY'];
/**
 * Schema per la creazione/modifica di un set di parametri
 */
exports.PricingParameterSetInputSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(1, 'Il nome è obbligatorio')
        .max(100, 'Il nome non può superare 100 caratteri'),
    countryCode: zod_1.z
        .string({ error: 'Il codice paese è obbligatorio' })
        .regex(/^[A-Z]{2}$/, 'Inserire un codice paese ISO 3166-1 alpha-2 valido (es. IT, CN, TR)'),
    purchaseCurrency: zod_1.z.string().min(1, 'La valuta di acquisto è obbligatoria'),
    sellingCurrency: zod_1.z.string().min(1, 'La valuta di vendita è obbligatoria'),
    qualityControlPercent: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'Il controllo qualità non può essere negativo')
        .max(100, 'Il controllo qualità non può superare il 100%'),
    transportInsuranceCost: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'Il costo di trasporto non può essere negativo'),
    duty: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'Il dazio non può essere negativo')
        .max(100, 'Il dazio non può superare il 100%'),
    exchangeRate: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .positive('Il tasso di cambio deve essere positivo'),
    italyAccessoryCosts: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'I costi accessori non possono essere negativi'),
    tools: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'I costi stampi non possono essere negativi'),
    retailMultiplier: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .positive('Il moltiplicatore retail deve essere positivo'),
    optimalMargin: zod_1.z
        .number({ error: 'Campo obbligatorio' })
        .min(0, 'Il margine ottimale non può essere negativo')
        .max(99.9, 'Il margine ottimale non può raggiungere il 100%'),
});
/**
 * Schema per l'aggiornamento (include l'id)
 */
exports.PricingParameterSetUpdateSchema = exports.PricingParameterSetInputSchema.extend({
    id: zod_1.z.string().uuid('ID non valido'),
});
/**
 * Modalità di calcolo disponibili
 */
exports.PricingModeSchema = zod_1.z.enum(['forward', 'inverse', 'margin']);
/**
 * Schema per la richiesta di calcolo
 */
exports.PricingCalculateInputSchema = zod_1.z
    .object({
    mode: exports.PricingModeSchema,
    purchasePrice: zod_1.z.number().positive().optional(),
    retailPrice: zod_1.z.number().positive().optional(),
    parameterSetId: zod_1.z.string().uuid('ID set parametri non valido'),
    brandId: zod_1.z.string().uuid('Brand ID non valido'),
    seasonId: zod_1.z.string().uuid('Season ID non valido'),
})
    .refine(data => {
    if (data.mode === 'forward')
        return data.purchasePrice !== undefined;
    if (data.mode === 'inverse')
        return data.retailPrice !== undefined;
    if (data.mode === 'margin')
        return (data.purchasePrice !== undefined && data.retailPrice !== undefined);
    return false;
}, {
    message: 'forward richiede purchasePrice, inverse richiede retailPrice, margin richiede entrambi',
});
//# sourceMappingURL=pricing.js.map