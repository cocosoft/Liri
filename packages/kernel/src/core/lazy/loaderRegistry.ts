// MIT License
// Copyright (c) 2026 Liri
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
 * 按需加载器注册表（内核侧，**零上层引用**）。
 *
 * 背景（core 独立包 P2）：内核曾自持一张「10 个上层模块 → 动态 import」的清单
 * （`LazyModuleStrategy.ts` 的 `DYNAMIC_IMPORT_LOADERS`），这使内核在物理上无法独立成包
 * （包不能 import 消费者的模块）。本注册表把「**谁**」交给宿主：宿主在入口早期把清单 push 进来，
 * 内核只保留「**怎么加载**」的机制。
 *
 * 双 API 语义（**不要合并成一个**）：
 *   · `hasLazyLoader(id)` / `getLazyLoader(id)` —— **能力查询**。变体裁剪下某模块合法缺席
 *     （如 `DROP_UI` 的 ink/ui），此处必须返回 `false`/`undefined`，**不得抛错**；
 *   · `requireLazyLoader(id)` —— **执行路径**。缺失即 fail-closed 抛 `AppError`
 *     （错误码 `CORE_LAZY_LOADER_NOT_REGISTERED`），绝不让调用方拿到 `undefined` 再炸在别处。
 *
 * 变体裁剪：宿主侧的清单由 `app/scripts/build-variant.ts` **按变体生成**
 * （`app/src/bootstrap/generatedLazyLoaders.ts`）——未选中的模块**连 `import()` 字面量都不存在**，
 * 因此裁剪不依赖 minifier 的副作用分析（复审 A4）。
 */
import { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';

/** 按需加载器：返回目标模块的导出对象 */
export type LazyLoader = () => Promise<unknown>;

const loaders = new Map<string, LazyLoader>();

/** 注册单个加载器（重复 id ⇒ 抛 `AppError`，fail-closed） */
export function registerLazyLoader(moduleId: string, loader: LazyLoader): void {
  if (!moduleId) {
    throw new AppError(
      '按需加载器缺少 moduleId',
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'CORE_LAZY_LOADER_INVALID'
    );
  }
  if (loaders.has(moduleId)) {
    throw new AppError(
      `按需加载器重复注册：${moduleId}（同一 moduleId 只能注册一次）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'CORE_LAZY_LOADER_DUPLICATE',
      { moduleId }
    );
  }
  loaders.set(moduleId, loader);
}

/** 批量注册（宿主入口调用一次） */
export function registerLazyLoaders(record: Record<string, LazyLoader>): void {
  for (const [moduleId, loader] of Object.entries(record)) {
    registerLazyLoader(moduleId, loader);
  }
}

/** 能力查询：该 id 是否可用（变体缺席 ⇒ false，属正常结果） */
export function hasLazyLoader(moduleId: string): boolean {
  return loaders.has(moduleId);
}

/** 能力查询：取加载器（无 ⇒ undefined）；执行路径请用 `requireLazyLoader` */
export function getLazyLoader(moduleId: string): LazyLoader | undefined {
  return loaders.get(moduleId);
}

/** 执行路径：缺失即抛 `AppError`（fail-closed） */
export function requireLazyLoader(moduleId: string): LazyLoader {
  const loader = loaders.get(moduleId);
  if (!loader) {
    throw new AppError(
      `按需模块 ${moduleId} 未在宿主注册（内核执行链熔断）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'CORE_LAZY_LOADER_NOT_REGISTERED',
      { moduleId }
    );
  }
  return loader;
}

/** 已注册 id（排序；供诊断与测试） */
export function listLazyLoaderIds(): string[] {
  return [...loaders.keys()].sort();
}

/** 清空（**仅测试用**；生产入口不应调用） */
export function resetLazyLoaders(): void {
  loaders.clear();
}
