import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeControl,
} from '../runtime/types.js';
import { AcpRuntimeError } from '../runtime/errors.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'acp:control-plane:manager.runtime-controls', level: LogLevel.INFO });

export interface RuntimeControlRequest {
  control: AcpRuntimeControl;
  handle: AcpRuntimeHandle;
  payload?: Record<string, string>;
}

export interface RuntimeControlResult {
  success: boolean;
  error?: string;
}

const SUPPORTED_CONTROLS: AcpRuntimeControl[] = [
  'session/set_mode',
  'session/set_config_option',
  'session/status',
];

export function isSupportedRuntimeControl(
  control: string
): control is AcpRuntimeControl {
  return SUPPORTED_CONTROLS.includes(control as AcpRuntimeControl);
}

export function getSupportedRuntimeControls(): AcpRuntimeControl[] {
  return [...SUPPORTED_CONTROLS];
}

export async function executeRuntimeControl(
  runtime: AcpRuntime,
  request: RuntimeControlRequest
): Promise<RuntimeControlResult> {
  if (!isSupportedRuntimeControl(request.control)) {
    return {
      success: false,
      error: `unsupported runtime control: ${request.control}`,
    };
  }

  try {
    switch (request.control) {
      case 'session/set_mode': {
        if (!runtime.setMode) {
          return { success: false, error: 'runtime does not support setMode' };
        }
        const mode = request.payload?.mode;
        if (!mode) {
          return {
            success: false,
            error: 'mode is required for session/set_mode',
          };
        }
        await runtime.setMode({ handle: request.handle, mode });
        return { success: true };
      }

      case 'session/set_config_option': {
        if (!runtime.setConfigOption) {
          return {
            success: false,
            error: 'runtime does not support setConfigOption',
          };
        }
        const key = request.payload?.key;
        const value = request.payload?.value;
        if (!key || value === undefined) {
          return {
            success: false,
            error: 'key and value are required for session/set_config_option',
          };
        }
        await runtime.setConfigOption({ handle: request.handle, key, value });
        return { success: true };
      }

      case 'session/status': {
        if (!runtime.getStatus) {
          return {
            success: false,
            error: 'runtime does not support getStatus',
          };
        }
        await runtime.getStatus({ handle: request.handle });
        return { success: true };
      }

      default:
        return {
          success: false,
          error: `unhandled control: ${request.control}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function setSessionMode(
  runtime: AcpRuntime,
  handle: AcpRuntimeHandle,
  mode: string
): Promise<void> {
  const result = await executeRuntimeControl(runtime, {
    control: 'session/set_mode',
    handle,
    payload: { mode },
  });

  if (!result.success) {
    throw new AcpRuntimeError(
      'ACP_BACKEND_UNSUPPORTED_CONTROL',
      result.error || 'setMode failed'
    );
  }
}

export async function setSessionConfigOption(
  runtime: AcpRuntime,
  handle: AcpRuntimeHandle,
  key: string,
  value: string
): Promise<void> {
  const result = await executeRuntimeControl(runtime, {
    control: 'session/set_config_option',
    handle,
    payload: { key, value },
  });

  if (!result.success) {
    throw new AcpRuntimeError(
      'ACP_BACKEND_UNSUPPORTED_CONTROL',
      result.error || 'setConfigOption failed'
    );
  }
}

export async function getSessionStatus(
  runtime: AcpRuntime,
  handle: AcpRuntimeHandle
): Promise<RuntimeControlResult> {
  return executeRuntimeControl(runtime, {
    control: 'session/status',
    handle,
  });
}
