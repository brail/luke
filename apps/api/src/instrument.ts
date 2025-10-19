/**
 * OpenTelemetry Instrumentation Bootstrap
 * Eseguito prima di qualsiasi import per catturare startup completo
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

// Config via env vars (12-factor)
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
const otelEnabled = process.env.OTEL_ENABLED !== 'false' && otelEndpoint !== '';

let sdk: NodeSDK | null = null;

if (otelEnabled) {
  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: '@luke/api',
    [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
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
      new FastifyInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  console.log('✅ OpenTelemetry SDK started:', { endpoint: otelEndpoint });
} else {
  console.log('ℹ️  OpenTelemetry disabled (no endpoint configured)');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (sdk) {
    console.log('🔄 Shutting down OpenTelemetry SDK...');
    await sdk.shutdown();
  }
});

process.on('SIGINT', async () => {
  if (sdk) {
    console.log('🔄 Shutting down OpenTelemetry SDK...');
    await sdk.shutdown();
  }
});


