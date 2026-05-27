import { EventEmitter } from 'events';
import type {
  ContextEngine,
  ContextEngineFactory,
  ContextEngineFactoryContext,
  ContextEngineRegistrationResult,
} from './types.js';

const factories = new Map<
  string,
  { factory: ContextEngineFactory; owner?: string }
>();
const instances = new Map<string, ContextEngine>();

const emitter = new EventEmitter();

export function on(
  event: 'registered' | 'unregistered',
  listener: (engineId: string) => void
): void {
  emitter.on(event, listener);
}

export function off(
  event: 'registered' | 'unregistered',
  listener: (engineId: string) => void
): void {
  emitter.off(event, listener);
}

export function registerContextEngine(
  engineId: string,
  factory: ContextEngineFactory
): ContextEngineRegistrationResult {
  if (factories.has(engineId)) {
    return {
      ok: false,
      existingOwner: factories.get(engineId)!.owner ?? 'unknown',
    };
  }

  factories.set(engineId, { factory });
  emitter.emit('registered', engineId);
  return { ok: true };
}

export function registerContextEngineForOwner(
  engineId: string,
  factory: ContextEngineFactory,
  owner: string,
  options?: { allowSameOwnerRefresh?: boolean }
): ContextEngineRegistrationResult {
  const existing = factories.get(engineId);
  if (existing) {
    if (existing.owner === owner && options?.allowSameOwnerRefresh) {
      factories.set(engineId, { factory, owner });
      instances.delete(engineId);
      return { ok: true };
    }
    return { ok: false, existingOwner: existing.owner ?? 'unknown' };
  }

  factories.set(engineId, { factory, owner });
  emitter.emit('registered', engineId);
  return { ok: true };
}

export function unregisterContextEngine(engineId: string): boolean {
  const existed = factories.delete(engineId);
  instances.delete(engineId);
  if (existed) {
    emitter.emit('unregistered', engineId);
  }
  return existed;
}

export function getContextEngineFactory(
  engineId: string
): ContextEngineFactory | undefined {
  return factories.get(engineId)?.factory;
}

export function listContextEngineIds(): string[] {
  return Array.from(factories.keys());
}

export async function resolveContextEngine(
  engineId: string,
  ctx?: ContextEngineFactoryContext
): Promise<ContextEngine | undefined> {
  if (instances.has(engineId)) {
    return instances.get(engineId);
  }

  const factory = factories.get(engineId)?.factory;
  if (!factory) {
    return undefined;
  }

  const engine = await factory(ctx ?? {});
  instances.set(engineId, engine);
  return engine;
}

export function clearContextEngines(): void {
  factories.clear();
  instances.clear();
}

export function hasContextEngine(engineId: string): boolean {
  return factories.has(engineId);
}
