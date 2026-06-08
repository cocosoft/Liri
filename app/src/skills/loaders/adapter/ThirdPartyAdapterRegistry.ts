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
 * 第三方适配器注册表
 *
 * 参照 ProviderRegistry 模式管理所有 ThirdPartySkillAdapter 实例。
 * 适配器动态注册后，可在启动流程中被 SkillRegistry 统一消费。
 */

import type { ThirdPartySkillAdapter } from './ThirdPartySkillAdapter';

/**
 * 第三方适配器注册表
 * 单例模式，全局唯一
 */
export class ThirdPartyAdapterRegistry {
  private static _instance: ThirdPartyAdapterRegistry;
  private adapters: Map<string, ThirdPartySkillAdapter> = new Map();

  /**
   * 获取单例
   */
  static getInstance(): ThirdPartyAdapterRegistry {
    if (!ThirdPartyAdapterRegistry._instance) {
      ThirdPartyAdapterRegistry._instance = new ThirdPartyAdapterRegistry();
    }
    return ThirdPartyAdapterRegistry._instance;
  }

  /**
   * 注册适配器
   * @param adapter 适配器实例
   */
  register(adapter: ThirdPartySkillAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * 注销适配器
   * @param name 适配器名称
   */
  unregister(name: string): void {
    this.adapters.delete(name);
  }

  /**
   * 获取指定适配器
   * @param name 适配器名称
   */
  get(name: string): ThirdPartySkillAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 获取所有已注册适配器
   */
  getAll(): ThirdPartySkillAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * 是否已注册指定适配器
   * @param name 适配器名称
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * 清除所有适配器
   */
  clear(): void {
    this.adapters.clear();
  }
}

/** 全局单例引用 */
export const thirdPartyAdapterRegistry = ThirdPartyAdapterRegistry.getInstance();
