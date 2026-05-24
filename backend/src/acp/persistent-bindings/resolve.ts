import type { PersistentBindingConfig, PersistentBindingState } from './types.js';
import type { AcpRuntimeEnsureInput } from '../runtime/types.js';

export function resolveBindingConfigToEnsureInput(
  config: PersistentBindingConfig
): AcpRuntimeEnsureInput {
  return {
    sessionKey: config.sessionKey,
    agent: config.backend,
    mode: 'persistent',
    cwd: config.cwd,
  };
}

export function createInitialBindingState(config: PersistentBindingConfig): PersistentBindingState {
  return {
    config,
    active: false,
    lastActivityAt: Date.now(),
    createdAt: Date.now(),
    errorCount: 0,
  };
}
