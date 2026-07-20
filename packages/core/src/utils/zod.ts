import { z, ZodDefault, type ZodObject, type ZodRawShape, type ZodOptional } from 'zod';

type StripDefault<T> = T extends ZodDefault<infer Inner> ? Inner : T;
type StrippedPartialShape<S extends ZodRawShape> = { [K in keyof S]: ZodOptional<StripDefault<S[K]>> };

/**
 * Like `schema.partial()`, but fields with `.default()` are NOT re-defaulted when omitted.
 *
 * Zod v4's `.partial()` still applies a field's own `.default()` to a key missing from the
 * input — so "the caller omitted this field, meaning don't touch it" silently becomes "reset
 * to the schema default" once that partial schema feeds a Prisma update. Use this instead of
 * `.partial()` for any partial-update input schema built from a base schema that has
 * `.default()` fields, so omitted really means omitted.
 */
export function partialWithoutDefaults<S extends ZodRawShape>(
  schema: ZodObject<S>
): ZodObject<StrippedPartialShape<S>> {
  const stripped = {} as { [K in keyof S]: StripDefault<S[K]> };
  for (const key in schema.shape) {
    const field = schema.shape[key];
    // ZodDefault is the only wrapper type with `.removeDefault()` — every other field type is
    // used as-is. Cast is required because TS can't narrow `S[K]` from the runtime `instanceof`
    // check alone.
    stripped[key] = (field instanceof ZodDefault ? field.removeDefault() : field) as StripDefault<S[typeof key]>;
  }
  return z.object(stripped).partial() as unknown as ZodObject<StrippedPartialShape<S>>;
}
