import type { StateEffectType } from '@luke/core';

import { lockCollectionLayoutHandler } from './handlers/lockCollectionLayout.js';
import { unlockCollectionLayoutHandler } from './handlers/unlockCollectionLayout.js';

import type { StateEffectHandler } from './types.js';

// Exhaustive record: TS error if StateEffectType is extended without adding a handler
const REGISTRY: Record<StateEffectType, StateEffectHandler> = {
  LOCK_COLLECTION_LAYOUT:   lockCollectionLayoutHandler,
  UNLOCK_COLLECTION_LAYOUT: unlockCollectionLayoutHandler,
};

/**
 * Returns the StateEffectHandler for the given effect type.
 * The registry is exhaustive: TypeScript will error if a new StateEffectType is added without a handler.
 */
export function getEffectHandler(type: StateEffectType): StateEffectHandler {
  return REGISTRY[type];
}
