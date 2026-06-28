import { z } from 'zod';
/**
 * Valute supportate dal sistema di pricing
 */
export declare const PRICING_CURRENCIES: readonly ["USD", "EUR", "GBP", "CHF", "CNY"];
export type PricingCurrency = (typeof PRICING_CURRENCIES)[number];
/**
 * Schema per la creazione/modifica di un set di parametri
 */
export declare const PricingParameterSetInputSchema: z.ZodObject<{
    name: z.ZodString;
    countryCode: z.ZodString;
    purchaseCurrency: z.ZodString;
    sellingCurrency: z.ZodString;
    qualityControlPercent: z.ZodNumber;
    transportInsuranceCost: z.ZodNumber;
    duty: z.ZodNumber;
    exchangeRate: z.ZodNumber;
    italyAccessoryCosts: z.ZodNumber;
    tools: z.ZodNumber;
    retailMultiplier: z.ZodNumber;
    optimalMargin: z.ZodNumber;
}, z.core.$strip>;
export type PricingParameterSetInput = z.infer<typeof PricingParameterSetInputSchema>;
/**
 * Schema per l'aggiornamento (include l'id)
 */
export declare const PricingParameterSetUpdateSchema: z.ZodObject<{
    name: z.ZodString;
    countryCode: z.ZodString;
    purchaseCurrency: z.ZodString;
    sellingCurrency: z.ZodString;
    qualityControlPercent: z.ZodNumber;
    transportInsuranceCost: z.ZodNumber;
    duty: z.ZodNumber;
    exchangeRate: z.ZodNumber;
    italyAccessoryCosts: z.ZodNumber;
    tools: z.ZodNumber;
    retailMultiplier: z.ZodNumber;
    optimalMargin: z.ZodNumber;
    id: z.ZodString;
}, z.core.$strip>;
export type PricingParameterSetUpdate = z.infer<typeof PricingParameterSetUpdateSchema>;
/**
 * Modalità di calcolo disponibili
 */
export declare const PricingModeSchema: z.ZodEnum<{
    forward: "forward";
    inverse: "inverse";
    margin: "margin";
}>;
export type PricingMode = z.infer<typeof PricingModeSchema>;
/**
 * Schema per la richiesta di calcolo
 */
export declare const PricingCalculateInputSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        forward: "forward";
        inverse: "inverse";
        margin: "margin";
    }>;
    purchasePrice: z.ZodOptional<z.ZodNumber>;
    retailPrice: z.ZodOptional<z.ZodNumber>;
    parameterSetId: z.ZodString;
    brandId: z.ZodString;
    seasonId: z.ZodString;
}, z.core.$strip>;
export type PricingCalculateInput = z.infer<typeof PricingCalculateInputSchema>;
//# sourceMappingURL=pricing.d.ts.map