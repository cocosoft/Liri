import type { AcpRuntimeHandle } from '../runtime/types.js';
import {
  getAcpRuntimeRegistry,
  type AcpRuntimeRegistry,
} from '../runtime/registry.js';
import {
  formatSessionIdentity,
  type AcpSessionIdentity,
} from '../runtime/session-identity.js';

export interface PendingSessionIdentity {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  registeredAt: number;
}

export interface IdentityReconcileResult {
  reconciled: number;
  errors: string[];
  pendingIdentities: PendingSessionIdentity[];
}

const pendingIdentities = new Map<string, PendingSessionIdentity>();

export function registerPendingSessionIdentity(
  identity: AcpSessionIdentity
): void {
  const key = formatSessionIdentity(identity);
  pendingIdentities.set(key, {
    sessionKey: identity.sessionKey,
    backend: identity.backend,
    runtimeSessionName: identity.runtimeSessionName,
    registeredAt: Date.now(),
  });
}

export function unregisterPendingSessionIdentity(
  identity: AcpSessionIdentity
): void {
  const key = formatSessionIdentity(identity);
  pendingIdentities.delete(key);
}

export function getPendingSessionIdentities(): PendingSessionIdentity[] {
  return Array.from(pendingIdentities.values());
}

export function clearPendingSessionIdentities(): void {
  pendingIdentities.clear();
}

export async function reconcilePendingSessionIdentities(
  registry?: AcpRuntimeRegistry
): Promise<IdentityReconcileResult> {
  const runtimeRegistry = registry || getAcpRuntimeRegistry();
  const errors: string[] = [];
  const reconciled: string[] = [];

  for (const [key, identity] of pendingIdentities) {
    const runtime = runtimeRegistry.get(identity.backend);
    if (!runtime) {
      errors.push(
        `runtime backend "${identity.backend}" not found for session ${identity.sessionKey}`
      );
      continue;
    }

    try {
      const handle: AcpRuntimeHandle = {
        sessionKey: identity.sessionKey,
        backend: identity.backend,
        runtimeSessionName: identity.runtimeSessionName,
      };

      if (runtime.prepareFreshSession) {
        await runtime.prepareFreshSession({ sessionKey: identity.sessionKey });
      }

      pendingIdentities.delete(key);
      reconciled.push(key);
    } catch (error) {
      errors.push(
        `failed to reconcile session ${identity.sessionKey}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    reconciled: reconciled.length,
    errors,
    pendingIdentities: getPendingSessionIdentities(),
  };
}

export async function reconcileAllSessions(): Promise<IdentityReconcileResult> {
  return reconcilePendingSessionIdentities();
}
