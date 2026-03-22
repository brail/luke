/**
 * Setup globale per i test Vitest
 * Configura l'ambiente di test e le variabili necessarie
 */

import { beforeAll, afterAll } from 'vitest';

// Mock delle variabili d'ambiente per i test
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://luke:luke_dev@localhost:5432/luke';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long';

beforeAll(async () => {
  // Setup iniziale se necessario
  console.log('🧪 Test environment setup');
});

afterAll(async () => {
  // Cleanup finale se necessario
  console.log('🧹 Test environment cleanup');
});
