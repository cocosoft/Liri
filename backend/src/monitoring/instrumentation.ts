//
/**
 * OpenTelemetry  instrumentation 配置
 * 基于CC源码实现
 */

import { DiagLogLevel, diag, trace } from '@opentelemetry/api';
import {
  envDetector,
  hostDetector,
  osDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources';

import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_ARCH,
} from '@opentelemetry/semantic-conventions';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { getPlatform, getWslVersion } from '../utils/platform.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { getProxyUrl, shouldBypassProxy } from '../utils/proxy.js';
import { getCACertificates } from '../utils/caCerts.js';
import { getMTLSConfig } from '../utils/mtls.js';
import { errorMessage } from '../utils/errors.js';
import { logForDebugging } from '../utils/debug.js';

const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000;
const DEFAULT_TRACES_EXPORT_INTERVAL_MS = 5000;

class TelemetryTimeoutError extends Error {}

function telemetryTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      (rej: (e: Error) => void, msg: string) =>
        rej(new TelemetryTimeoutError(msg)),
      ms,
      reject,
      message,
    ).unref();
  });
}

export function bootstrapTelemetry() {
  if (process.env.USER_TYPE === 'ant') {
    // Read from ANT_ prefixed variables that are defined at build time
    if (process.env.ANT_OTEL_METRICS_EXPORTER) {
      process.env.OTEL_METRICS_EXPORTER = process.env.ANT_OTEL_METRICS_EXPORTER;
    }
    if (process.env.ANT_OTEL_LOGS_EXPORTER) {
      process.env.OTEL_LOGS_EXPORTER = process.env.ANT_OTEL_LOGS_EXPORTER;
    }
    if (process.env.ANT_OTEL_TRACES_EXPORTER) {
      process.env.OTEL_TRACES_EXPORTER = process.env.ANT_OTEL_TRACES_EXPORTER;
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL) {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL;
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT;
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS) {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS;
    }
  }

  // Set default tempoality to 'delta' because it's the more sane default
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
  }
}

// Per OTEL spec, "none" means "no automatically configured exporter for this signal".
export function parseExporterTypes(value: string | undefined): string[] {
  return (value || '')
    .trim()
    .split(',')
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t !== 'none');
}

async function getOtlpReaders() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_METRICS_EXPORTER);
  const exportInterval = parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ||
      DEFAULT_METRICS_EXPORT_INTERVAL_MS.toString(),
  );

  const exporters = [];
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      // Custom console exporter that shows resource attributes
      const consoleExporter = new ConsoleMetricExporter();
      const originalExport = consoleExporter.export.bind(consoleExporter);

      consoleExporter.export = (metrics, callback) => {
        // Log resource attributes once at the start
        if (metrics.resource && metrics.resource.attributes) {
          logForDebugging('\n=== Resource Attributes ===');
          logForDebugging(JSON.stringify(metrics.resource.attributes));
          logForDebugging('===========================\n');
        }

        return originalExport(metrics, callback);
      };

      exporters.push(consoleExporter);
    } else if (exporterType === 'otlp') {
      const protocol = process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL?.trim() ||
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim();

      const httpConfig = getOTLPExporterConfig();

      switch (protocol) {
        case 'http/json': {
          const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
          exporters.push(new OTLPMetricExporter(httpConfig));
          break;
        }
        case 'http/protobuf': {
          const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-proto');
          exporters.push(new OTLPMetricExporter(httpConfig));
          break;
        }
        default:
          throw new Error(
            `Unknown protocol set in OTEL_EXPORTER_OTLP_METRICS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
          );
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_EXPORTER_OTLP_METRICS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${exporterType}`,
      );
    }
  }

  return exporters.map(exporter => {
    if ('export' in exporter) {
      return new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: exportInterval,
      });
    }
    return exporter;
  });
}



async function getOtlpTraceExporters() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_TRACES_EXPORTER);

  const exporters = [];
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      exporters.push(new ConsoleSpanExporter());
    } else if (exporterType === 'otlp') {
      const protocol = process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL?.trim() ||
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim();

      const httpConfig = getOTLPExporterConfig();

      switch (protocol) {
        case 'http/json': {
          const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
          exporters.push(new OTLPTraceExporter(httpConfig));
          break;
        }
        case 'http/protobuf': {
          const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
          exporters.push(new OTLPTraceExporter(httpConfig));
          break;
        }
        default:
          throw new Error(
            `Unknown protocol set in OTEL_EXPORTER_OTLP_TRACES_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
          );
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_TRACES_EXPORTER env var: ${exporterType}`,
      );
    }
  }

  return exporters;
}

export function isTelemetryEnabled() {
  return isEnvTruthy(process.env.PY_APP_ENABLE_TELEMETRY);
}

function parseOtelHeadersEnvVar(): Record<string, string> {
  const headers: Record<string, string> = {};
  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (envHeaders) {
    for (const pair of envHeaders.split(',')) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
  return headers;
}

/**
 * Get configuration for OTLP exporters including:
 * - HTTP agent options (proxy, mTLS)
 * - Dynamic headers via otelHeadersHelper or static headers from env var
 */
function getOTLPExporterConfig() {
  const proxyUrl = getProxyUrl();
  const mtlsConfig = getMTLSConfig();

  // Build base config
  const config: Record<string, unknown> = {};

  // Parse static headers from env var once (doesn't change at runtime)
  const staticHeaders = parseOtelHeadersEnvVar();

  if (Object.keys(staticHeaders).length > 0) {
    config.headers = async (): Promise<Record<string, string>> => staticHeaders;
  }

  // Check if we should bypass proxy for OTEL endpoint
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!proxyUrl || (otelEndpoint && shouldBypassProxy(otelEndpoint))) {
    // No proxy configured or OTEL endpoint should bypass proxy
    const caCerts = getCACertificates();
    if (mtlsConfig || caCerts) {
      config.httpAgentOptions = {
        ...mtlsConfig,
        ...(caCerts && { ca: caCerts }),
      };
    }
    return config;
  }

  // Return an HttpAgentFactory function that creates our proxy agent
  const caCerts = getCACertificates();
  const agentFactory = (_protocol: string) => {
    // Create and return the proxy agent with mTLS and CA cert config
    const proxyAgent = mtlsConfig || caCerts
      ? new HttpsProxyAgent(proxyUrl, {
          ...(mtlsConfig && {
            cert: mtlsConfig.cert,
            key: mtlsConfig.key,
            passphrase: mtlsConfig.passphrase,
          }),
          ...(caCerts && { ca: caCerts }),
        })
      : new HttpsProxyAgent(proxyUrl);

    return proxyAgent;
  };

  config.httpAgentOptions = agentFactory;
  return config;
}

/**
 * Initialize OpenTelemetry telemetry
 */
export async function initializeTelemetry() {
  bootstrapTelemetry();

  // Set up diagnostic logger
  diag.setLogger(
    {
      error: (message, ...args) => logForDebugging(message, { level: 'error' }),
      warn: (message, ...args) => logForDebugging(message, { level: 'warn' }),
      info: (message, ...args) => logForDebugging(message, { level: 'info' }),
      debug: (message, ...args) => logForDebugging(message, { level: 'debug' }),
    },
    DiagLogLevel.ERROR
  );

  const readers = [];

  // Add customer exporters (if enabled)
  const telemetryEnabled = isTelemetryEnabled();
  logForDebugging(
    `[3P telemetry] isTelemetryEnabled=${telemetryEnabled} (PY_APP_ENABLE_TELEMETRY=${process.env.PY_APP_ENABLE_TELEMETRY})`,
  );
  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders()));
  }

  // Create base resource with service attributes
  const platform = getPlatform();
  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: 'py-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  };

  // Add WSL-specific attributes if running on WSL
  if (platform === 'wsl') {
    const wslVersion = getWslVersion();
    if (wslVersion) {
      baseAttributes['wsl.version'] = wslVersion;
    }
  }

  const baseResource = resourceFromAttributes(baseAttributes);

  // Use OpenTelemetry detectors
  const osResource = resourceFromAttributes(
    osDetector.detect().attributes || {},
  );

  // Extract only host.arch from hostDetector
  const hostDetected = hostDetector.detect();
  const hostArchAttributes = hostDetected.attributes?.[SEMRESATTRS_HOST_ARCH]
    ? {
        [SEMRESATTRS_HOST_ARCH]: hostDetected.attributes[SEMRESATTRS_HOST_ARCH],
      }
    : {};
  const hostArchResource = resourceFromAttributes(hostArchAttributes);

  const envResource = resourceFromAttributes(
    envDetector.detect().attributes || {},
  );

  // Merge resources - later resources take precedence
  const resource = baseResource
    .merge(osResource)
    .merge(hostArchResource)
    .merge(envResource);

  const meterProvider = new MeterProvider({
    resource,
    views: [],
    readers,
  });

  // 'beforeExit' is emitted when Node.js empties its event loop and has no additional work to schedule.
  process.on('beforeExit', async () => {
    // Flush traces - they use BatchSpanProcessor which needs explicit flush
    const tracerProvider = trace.getTracerProvider();
    await tracerProvider?.forceFlush();
  });

  process.on('exit', () => {
    // Final attempt to flush traces
    void trace.getTracerProvider()?.forceFlush();
  });

  // Initialize tracing if enhanced telemetry is enabled
  if (telemetryEnabled) {
    const traceExporters = await getOtlpTraceExporters();
    if (traceExporters.length > 0) {
      // Create span processors for each exporter
      const spanProcessors = traceExporters.map(
        exporter =>
          new BatchSpanProcessor(exporter, {
            scheduledDelayMillis: parseInt(
              process.env.OTEL_TRACES_EXPORT_INTERVAL ||
                DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
            ),
          }),
      );

      const tracerProvider = new BasicTracerProvider({
        resource,
        spanProcessors,
      });

      // Register the tracer provider globally
      trace.setGlobalTracerProvider(tracerProvider);
    }
  }

  return {
    meterProvider,
    getMeter: (name: string, version: string) => meterProvider.getMeter(name, version),
    getTracer: (name: string, version: string) => trace.getTracer(name, version),
  };
}

/**
 * Flush all pending telemetry data immediately.
 */
export async function flushTelemetry(): Promise<void> {
  const meterProvider = (global as any).meterProvider;
  if (!meterProvider) {
    return;
  }

  const timeoutMs = parseInt(
    process.env.PY_APP_OTEL_FLUSH_TIMEOUT_MS || '5000',
  );

  try {
    const flushPromises = [meterProvider.forceFlush()];
    const tracerProvider = trace.getTracerProvider();
    if (tracerProvider) {
      flushPromises.push(tracerProvider.forceFlush());
    }

    await Promise.race([
      Promise.all(flushPromises),
      telemetryTimeout(timeoutMs, 'OpenTelemetry flush timeout'),
    ]);

    logForDebugging('Telemetry flushed successfully');
  } catch (error) {
    if (error instanceof TelemetryTimeoutError) {
      logForDebugging(
        `Telemetry flush timed out after ${timeoutMs}ms. Some metrics may not be exported.`,
        { level: 'warn' },
      );
    } else {
      logForDebugging(`Telemetry flush failed: ${errorMessage(error)}`, {
        level: 'error',
      });
    }
    // Don't throw - allow logout to continue even if flush fails
  }
}
