/**
 * Test di Security Headers HTTP
 * Verifica che tutti gli header di sicurezza siano presenti e corretti
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestServer } from './helpers';
import type { FastifyInstance } from 'fastify';

describe('Security Headers', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Header di sicurezza base (tutti gli ambienti)', () => {
    it('dovrebbe includere X-Content-Type-Options: nosniff', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('dovrebbe includere Referrer-Policy: no-referrer', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });

    it('dovrebbe includere X-DNS-Prefetch-Control: off', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      expect(response.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('dovrebbe includere X-Frame-Options: DENY', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Header specifici per ambiente test', () => {
    it('dovrebbe includere Content-Security-Policy in test', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
    });

    it('NON dovrebbe includere Strict-Transport-Security in test', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('Verifica su route root', () => {
    it('dovrebbe applicare gli stessi header su route root', async () => {
      const response = await request(server.server).get('/').expect(200);

      // Verifica header base
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['x-frame-options']).toBe('DENY');

      // Verifica CSP in test
      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");

      // Verifica assenza HSTS
      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('Snapshot test per configurazione completa', () => {
    it('dovrebbe avere configurazione headers invariabile', async () => {
      const response = await request(server.server)
        .get('/api/health')
        .expect(200);

      // Snapshot degli header di sicurezza per verificare invariabilità
      const securityHeaders = {
        'x-content-type-options': response.headers['x-content-type-options'],
        'referrer-policy': response.headers['referrer-policy'],
        'x-dns-prefetch-control': response.headers['x-dns-prefetch-control'],
        'x-frame-options': response.headers['x-frame-options'],
        'content-security-policy': response.headers['content-security-policy'],
        'strict-transport-security':
          response.headers['strict-transport-security'],
      };

      expect(securityHeaders).toMatchSnapshot();
    });
  });
});
