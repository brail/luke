/**
 * OpenTelemetry instrumentation bootstrap.
 *
 * Must be imported before any other module so that auto-instrumentation patches
 * (Fastify, HTTP, Undici, Prisma) are applied from the very start of the process.
 *
 * Initialization is skipped when `OTEL_ENABLED=false` or when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is not set. Preloaded in every mode — `--require` in production,
 * `--import` under tsx in development — so `server.ts` importing `shutdownTelemetry` gets this same
 * instance. It registers no signal handler: `lib/gracefulShutdown.ts` calls `shutdownTelemetry`
 * after the server has closed.
 */

import FastifyOtelInstrumentation from '@fastify/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import pino from 'pino';

import { isDevelopment } from '@luke/core';

import { appVersion } from './lib/appVersion';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: label => ({ level: label }),
  },
});

// Config via env vars (12-factor)
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
const otelEnabled = process.env.OTEL_ENABLED !== 'false' && otelEndpoint !== '';

let sdk: NodeSDK | null = null;

if (otelEnabled) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: '@luke/api',
    [ATTR_SERVICE_VERSION]: appVersion(),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: isDevelopment() ? 'development' : 'production',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: otelEndpoint, // es. localhost:4317 (gRPC)
      // credentials: grpc.credentials.createInsecure(), // auto in dev
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      // @opentelemetry/instrumentation-fastify is deprecated in favor of this,
      // the Fastify-authors-maintained package; registerOnInitialization keeps
      // the same NodeSDK auto-registration behavior the old package had.
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  logger.info({ endpoint: otelEndpoint }, '✅ OpenTelemetry SDK started');
} else {
  logger.info('ℹ️  OpenTelemetry disabled (no endpoint configured)');
}

/** Flushes and stops the OpenTelemetry SDK; does nothing when telemetry is disabled. Never throws. */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  logger.info('Shutting down OpenTelemetry SDK...');
  try {
    await sdk.shutdown();
  } catch (err) {
    logger.error({ err }, 'Error shutting down OpenTelemetry SDK');
  }
}
