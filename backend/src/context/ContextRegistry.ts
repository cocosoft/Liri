export interface ContextTypeOptions {
  description?: string;
  allowNested?: boolean;
  autoCleanup?: boolean;
}

export class ContextRegistry {
  private registry = new Map<string, ContextTypeOptions>();

  register(type: string, options?: ContextTypeOptions): void {
    this.registry.set(type, {
      allowNested: true,
      autoCleanup: true,
      ...options,
    });
  }

  unregister(type: string): void {
    this.registry.delete(type);
  }

  isRegistered(type: string): boolean {
    return this.registry.has(type);
  }

  getOptions(type: string): ContextTypeOptions | undefined {
    return this.registry.get(type);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const contextRegistry = new ContextRegistry();
