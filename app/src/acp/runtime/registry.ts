import type { AcpRuntime } from './types.js';

export interface AcpRuntimeRegistration {
  id: string;
  name: string;
  runtime: AcpRuntime;
  priority?: number;
}

export class AcpRuntimeRegistry {
  private runtimes: Map<string, AcpRuntimeRegistration> = new Map();

  register(registration: AcpRuntimeRegistration): void {
    this.runtimes.set(registration.id, registration);
  }

  unregister(id: string): boolean {
    return this.runtimes.delete(id);
  }

  get(id: string): AcpRuntime | undefined {
    return this.runtimes.get(id)?.runtime;
  }

  getRegistration(id: string): AcpRuntimeRegistration | undefined {
    return this.runtimes.get(id);
  }

  getAll(): AcpRuntimeRegistration[] {
    return Array.from(this.runtimes.values());
  }

  has(id: string): boolean {
    return this.runtimes.has(id);
  }

  clear(): void {
    this.runtimes.clear();
  }
}

let defaultRegistry: AcpRuntimeRegistry | null = null;

export function getAcpRuntimeRegistry(): AcpRuntimeRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new AcpRuntimeRegistry();
  }
  return defaultRegistry;
}

export function resetAcpRuntimeRegistryForTests(): void {
  defaultRegistry = null;
}
