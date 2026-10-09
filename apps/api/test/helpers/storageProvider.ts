/** Test doubles for `IStorageProvider`. */

import type { IStorageProvider } from '@luke/core';

/** A provider with only the methods a test exercises; the code under test calls no other. */
export function partialProvider(methods: Partial<Record<keyof IStorageProvider, unknown>>): IStorageProvider {
  return methods as unknown as IStorageProvider; // the listed methods are the only ones reached
}
