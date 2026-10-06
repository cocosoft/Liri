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
 * 模块管理模块入口文件
 * 统一导出所有模块管理相关功能
 *
 * ⚠️ 2026-10-06 注释订正（P2-8 ② D 类消歧）：原文写「请使用 `ModuleRegistry.bootstrap()`
 * 替代 `quickInitialize()`」—— **`quickInitialize()` 早已不存在**（桶内现导出
 * `moduleInitializer` / `initializeModules` 等）。方向仍成立：**新代码优先使用
 * `moduleRegistry` / `ModuleInitializer` 的显式 API**，而非从本桶取便利导出。
 * 本桶**仍有生产消费者**（`tools/DependencyGraphScanner.ts` 取
 * `MODULE_DEFINITIONS` / `MODULE_INITIALIZATION_ORDER`）⇒ **保留（非死码）**。
 */

import { moduleInitializer } from './ModuleInitializer';

// 导出模块注册表
export type { ModuleDefinition } from './ModuleRegistry';
export { ModuleCategory, moduleRegistry } from './ModuleRegistry';

// 导出导入管理器
export {
  importManager,
  importModule,
  importFromRegistry,
} from './ImportManager';

// 导出模块定义
export {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
  getModuleDefinition,
  getAllModuleDefinitions,
} from './ModuleDefinitions';

// 导出模块初始化器
export {
  moduleInitializer,
  initializeModules,
  destroyModules,
  checkModuleInitialization,
} from './ModuleInitializer';

// 导出按需加载方法（别名，方便使用）
export const requestOnDemandModule = (moduleId: string) =>
  moduleInitializer.requestOnDemandModule(moduleId);

// 导出延迟加载策略
export {
  ModuleLoadPriority,
  DynamicLoadMode,
  DeferredLoader,
  deferredLoader,
  getEssentialModuleIds,
  getDeferredModuleIds,
  getOnDemandModuleIds,
  getModulePriority,
  getModuleLoadMode,
  isModuleDeferred,
  isModuleOnDemand,
  requestModule,
  hasDynamicImport,
} from '@modules/core/LazyModuleStrategy';
