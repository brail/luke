/**
 * Service layer per gestione configurazioni AppConfig con cache
 * Re-export da @luke/core/server per DRY
 */

export {
  getRbacConfig,
  setRbacSectionDefaults,
  invalidateRbacCache,
  getSectionsDisabled,
} from '@luke/core/server';
