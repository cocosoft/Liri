// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ModuleManager — 模块管理器
 *
 * @deprecated 请使用 @modules/modules/ModuleRegistry 替代。
 *   此实现为遗留版本，与 modules/ModuleRegistry 功能重叠。
 *   新代码不应使用此模块。此文件将在未来版本中移除。
 *
 * 管理模块的注册、加载、启动、停止、卸载及依赖解析。
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { Module, ModuleState } from './types.js';

const logger = new Logger({
  module: 'core:extensibility:moduleManager',
  level: LogLevel.INFO,
});

/**
 * 模块管理器
 */
export class ModuleManager {
  private modules: Map<string, Module> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();
  private lazyModules: Map<
    string,
    { loader: () => Promise<Module>; loaded: boolean }
  > = new Map();

  /**
   * 注册模块
   */
  async registerModule(module: Module): Promise<void> {
    if (this.modules.has(module.metadata.id)) {
      throw new AppError(
        `Module ${module.metadata.id} already registered`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    const dependencies = module.metadata.dependencies || [];
    for (const dependency of dependencies) {
      if (!this.modules.has(dependency) && !this.lazyModules.has(dependency)) {
        throw new AppError(
          `Dependency ${dependency} not found for module ${module.metadata.id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }

      if (
        this.lazyModules.has(dependency) &&
        !this.lazyModules.get(dependency)!.loaded
      ) {
        await this.loadLazyModule(dependency);
      }
    }

    module.state = ModuleState.LOADING;
    try {
      await module.init();
      module.state = ModuleState.LOADED;
      this.modules.set(module.metadata.id, module);
      this.dependencyGraph.set(module.metadata.id, dependencies);
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 注册懒加载模块
   */
  registerLazyModule(moduleId: string, loader: () => Promise<Module>): void {
    if (this.modules.has(moduleId) || this.lazyModules.has(moduleId)) {
      throw new AppError(
        `Module ${moduleId} already registered`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    this.lazyModules.set(moduleId, { loader, loaded: false });
  }

  /**
   * 加载懒加载模块
   */
  private async loadLazyModule(moduleId: string): Promise<Module> {
    const lazyModule = this.lazyModules.get(moduleId);
    if (!lazyModule) {
      throw new AppError(
        `Lazy module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (lazyModule.loaded) {
      const module = this.modules.get(moduleId);
      if (!module) {
        throw new AppError(
          `Module ${moduleId} not found after loading`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }
      return module;
    }

    const module = await lazyModule.loader();
    await this.registerModule(module);
    lazyModule.loaded = true;
    return module;
  }

  /**
   * 启动模块
   */
  async startModule(moduleId: string): Promise<void> {
    const module = await this.getModule(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (module.state === ModuleState.ACTIVATED) {
      return;
    }

    if (module.state === ModuleState.FAILED) {
      throw new AppError(
        `Module ${moduleId} is in failed state`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    try {
      await module.start();
      module.state = ModuleState.ACTIVATED;
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 停止模块
   */
  async stopModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (module.state !== ModuleState.ACTIVATED) {
      return;
    }

    try {
      await module.stop();
      module.state = ModuleState.DEACTIVATED;
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 卸载模块
   */
  async unregisterModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    for (const [id, dependencies] of this.dependencyGraph.entries()) {
      if (dependencies.includes(moduleId)) {
        throw new AppError(
          `Module ${moduleId} is required by ${id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }
    }

    if (module.state === ModuleState.ACTIVATED) {
      await this.stopModule(moduleId);
    }

    try {
      await module.destroy();
    } catch (error) {
      await handleError(error, {
        module: 'core:ext',
        action: 'destroy_module',
      });
    }

    this.modules.delete(moduleId);
    this.dependencyGraph.delete(moduleId);

    if (this.lazyModules.has(moduleId)) {
      this.lazyModules.get(moduleId)!.loaded = false;
    }
  }

  /**
   * 获取模块
   */
  async getModule(moduleId: string): Promise<Module | undefined> {
    if (this.modules.has(moduleId)) {
      return this.modules.get(moduleId);
    }

    if (this.lazyModules.has(moduleId)) {
      try {
        return await this.loadLazyModule(moduleId);
      } catch (error) {
        await handleError(error, {
          module: 'core:ext',
          action: 'load_lazy',
        });
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * 列出所有模块
   */
  listModules(): Module[] {
    return Array.from(this.modules.values());
  }

  /**
   * 列出所有懒加载模块
   */
  listLazyModules(): string[] {
    return Array.from(this.lazyModules.keys());
  }

  /**
   * 获取提供者
   *
   * @deprecated 请使用 @modules/modules/ModuleRegistry 的 resolve 方法替代。
   *   本方法遍历所有模块查找提供者，是三套服务定位入口之一。
   *   统一服务定位入口为 modules/ModuleRegistry。
   *   此方法将在未来版本中移除。
   */
  async getProvider<T>(name: string): Promise<T | undefined> {
    for (const module of this.modules.values()) {
      const provider = module.getProvider<T>(name);
      if (provider) {
        return provider;
      }
    }

    for (const [moduleId, lazyModule] of this.lazyModules.entries()) {
      if (!lazyModule.loaded) {
        try {
          const module = await this.loadLazyModule(moduleId);
          const provider = module.getProvider<T>(name);
          if (provider) {
            return provider;
          }
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  /**
   * 注册全局提供者
   */
  registerGlobalProvider(name: string, provider: unknown): void {
    logger.info(`Registered global provider: ${name}`);
  }

  /**
   * 销毁模块管理器
   */
  async destroy(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.destroy();
      } catch (error) {
        await handleError(error, {
          module: 'core:ext',
          action: 'destroy_all',
        });
      }
    }
    this.modules.clear();
    this.dependencyGraph.clear();
    this.lazyModules.clear();
  }
}

/**
 * 创建默认的模块管理器
 */
export function createModuleManager(): ModuleManager {
  return new ModuleManager();
}
