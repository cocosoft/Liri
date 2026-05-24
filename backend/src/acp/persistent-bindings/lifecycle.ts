import type { PersistentBindingConfig, PersistentBindingState } from './types.js';
import type { AcpRuntime, AcpRuntimeHandle } from '../runtime/types.js';

export interface BindingLifecycle {
  activate(binding: PersistentBindingConfig): Promise<AcpRuntimeHandle | null>;
  deactivate(bindingKey: string): Promise<void>;
  isActive(bindingKey: string): boolean;
}

export class PersistentBindingLifecycle implements BindingLifecycle {
  private activeBindings: Map<string, { handle: AcpRuntimeHandle; state: PersistentBindingState }> = new Map();
  private runtime: AcpRuntime;

  constructor(runtime: AcpRuntime) {
    this.runtime = runtime;
  }

  async activate(binding: PersistentBindingConfig): Promise<AcpRuntimeHandle | null> {
    const existing = this.activeBindings.get(binding.sessionKey);

    if (existing) {
      return existing.handle;
    }

    const handle = await this.runtime.ensureSession({
      sessionKey: binding.sessionKey,
      agent: binding.backend,
      mode: 'persistent',
      cwd: binding.cwd,
    });

    const state: PersistentBindingState = {
      config: binding,
      active: true,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      errorCount: 0,
    };

    this.activeBindings.set(binding.sessionKey, { handle, state });

    return handle;
  }

  async deactivate(bindingKey: string): Promise<void> {
    const entry = this.activeBindings.get(bindingKey);

    if (entry) {
      await this.runtime.close({
        handle: entry.handle,
        reason: 'binding_deactivated',
        discardPersistentState: true,
      });
      this.activeBindings.delete(bindingKey);
    }
  }

  isActive(bindingKey: string): boolean {
    return this.activeBindings.has(bindingKey);
  }

  getActiveCount(): number {
    return this.activeBindings.size;
  }
}
