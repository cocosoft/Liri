/**
 * ModuleHealthRegistry.ts — 模块健康检查注册表
 *
 * 所有模块统一实现 ModuleHealthCheck 接口，
 * 通过 HealthRegistry 注册后可用于 /status 命令和守护进程健康检查。
 */

export interface ModuleHealth {
  module: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  lastError?: string;
  taskCount: number;
  metadata?: Record<string, unknown>;
}

export type ModuleHealthCheck = () => Promise<ModuleHealth>;

export class ModuleHealthRegistry {
  private checks = new Map<string, ModuleHealthCheck>();

  register(name: string, check: ModuleHealthCheck): void {
    this.checks.set(name, check);
  }

  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  async getAll(): Promise<ModuleHealth[]> {
    const results: ModuleHealth[] = [];
    for (const [name, check] of this.checks) {
      try {
        results.push(await check());
      } catch {
        results.push({
          module: name,
          status: 'unhealthy',
          uptime: 0,
          taskCount: 0,
          lastError: 'Health check failed',
        });
      }
    }
    return results;
  }

  getRegisteredModules(): string[] {
    return Array.from(this.checks.keys());
  }

  getModuleCount(): number {
    return this.checks.size;
  }
}

export const moduleHealthRegistry = new ModuleHealthRegistry();
