import type { StateEffectType } from '@luke/core';

import { lockCollectionLayoutHandler } from './handlers/lockCollectionLayout.js';
import { unlockCollectionLayoutHandler } from './handlers/unlockCollectionLayout.js';
import type { StateEffectHandler } from './types.js';

// Exhaustive record: TS error if StateEffectType is extended without adding a handler
const REGISTRY: Record<StateEffectType, StateEffectHandler> = {
  LOCK_COLLECTION_LAYOUT:   lockCollectionLayoutHandler,
  UNLOCK_COLLECTION_LAYOUT: unlockCollectionLayoutHandler,
};

export function getEffectHandler(type: StateEffectType): StateEffectHandler {
  return REGISTRY[type];
}
