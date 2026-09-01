import type { AcpRuntime } from './types.js';
import type { AcpRuntimeHandle } from './types.js';
import { AcpRuntimeError } from './errors.js';
import { handleError } from '@modules/error';

export interface RuntimeAvailabilityResult {
  available: boolean;
  reason?: string;
  latencyMs?: number;
}

export async function checkRuntimeAvailability(
  runtime: AcpRuntime,
  handle?: AcpRuntimeHandle
): Promise<RuntimeAvailabilityResult> {
  const start = Date.now();

  try {
    if (runtime.doctor) {
      const report = await runtime.doctor();
      const latencyMs = Date.now() - start;
      if (report.healthy) {
        return { available: true, latencyMs };
      }
      const failedChecks = report.checks.filter((c) => !c.passed);
      return {
        available: false,
        reason: failedChecks.map((c) => c.message || c.name).join('; '),
        latencyMs,
      };
    }

    if (runtime.getStatus && handle) {
      const status = await runtime.getStatus({ handle });
      const latencyMs = Date.now() - start;
      if (status.connected) {
        return { available: true, latencyMs };
      }
      return {
        available: false,
        reason: status.error || 'runtime not connected',
        latencyMs,
      };
    }

    return { available: true, latencyMs: Date.now() - start };
  } catch (error) {
    void handleError(error, {
      module: 'acp:availability',
      action: 'checkRuntimeAvailability',
    });
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

export async function waitForRuntimeReady(
  runtime: AcpRuntime,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    handle?: AcpRuntimeHandle;
  }
): Promise<RuntimeAvailabilityResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await checkRuntimeAvailability(runtime, options?.handle);
    if (result.available) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const finalResult = await checkRuntimeAvailability(runtime, options?.handle);
  if (!finalResult.available) {
    return {
      available: false,
      reason: `runtime not ready within ${timeoutMs}ms: ${finalResult.reason || 'timeout'}`,
    };
  }

  return finalResult;
}

export async function assertRuntimeReady(
  runtime: AcpRuntime,
  options?: {
    timeoutMs?: number;
    handle?: AcpRuntimeHandle;
  }
): Promise<void> {
  const result = await waitForRuntimeReady(runtime, options);
  if (!result.available) {
    throw new AcpRuntimeError(
      'ACP_BACKEND_UNAVAILABLE',
      result.reason || 'runtime unavailable'
    );
  }
}
