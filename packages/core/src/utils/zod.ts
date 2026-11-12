import { z, ZodDefault, ZodNullable, ZodOptional, type ZodObject, type ZodRawShape } from 'zod';

type AnySchema = z.core.$ZodType;

/** `T` without any `ZodDefault` in its chain of `optional` / `nullable` / `default` wrappers. */
type StripDefault<T> =
  T extends ZodDefault<infer Inner extends AnySchema> ? StripDefault<Inner>
  : T extends ZodOptional<infer Inner extends AnySchema> ? ZodOptional<StripDefault<Inner>>
  : T extends ZodNullable<infer Inner extends AnySchema> ? ZodNullable<StripDefault<Inner>>
  : T;
type StrippedPartialShape<S extends ZodRawShape> = { [K in keyof S]: ZodOptional<StripDefault<S[K]>> };

/**
 * Removes every `.default()` from a field's wrapper chain, at any depth: `x.default(v)`,
 * `x.default(v).optional()`, `x.default(v).nullable().optional()`. A nested object is left as it is:
 * a provided object is a whole value, so its own defaults still apply.
 */
function stripDefault(field: AnySchema): AnySchema {
  if (field instanceof ZodDefault) return stripDefault(field.removeDefault());
  if (field instanceof ZodOptional || field instanceof ZodNullable) {
    const original = field.unwrap();
    const inner = stripDefault(original);
    // Rebuilt only when a default was removed under it: rebuilding drops what was attached to it.
    if (inner === original) return field;
    return field instanceof ZodOptional ? z.optional(inner) : z.nullable(inner);
  }
  return field;
}

/**
 * Like `schema.partial()`, but fields with `.default()` are NOT re-defaulted when omitted.
 *
 * Zod v4's `.partial()` still applies a field's own `.default()` to a key missing from the
 * input — so "the caller omitted this field, meaning don't touch it" silently becomes "reset
 * to the schema default" once that partial schema feeds a Prisma update. Use this instead of
 * `.partial()` for any partial-update input schema built from a base schema that has
 * `.default()` fields, so omitted really means omitted. A default is removed wherever it sits in
 * the field's `optional` / `nullable` chain (`stripDefault`).
 */
export function partialWithoutDefaults<S extends ZodRawShape>(
  schema: ZodObject<S>
): ZodObject<StrippedPartialShape<S>> {
  const stripped: Record<string, AnySchema> = {};
  for (const key in schema.shape) {
    stripped[key] = stripDefault(schema.shape[key]);
  }
  // The runtime shape is what `StrippedPartialShape` describes; TS cannot follow `stripDefault`'s
  // recursion from the value to the mapped type.
  return z.object(stripped).partial() as unknown as ZodObject<StrippedPartialShape<S>>;
}
