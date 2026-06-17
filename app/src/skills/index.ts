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
 * 技能系统索引文件
 */

// 统一类型定义
export * from './types/index.js';

// SkillRegistry（事件化运行时）
export { SkillRegistry } from './SkillRegistry.js';
export type { RegistryEvent, RegistryEventHandler } from './SkillRegistry.js';

// 抽象基类
export { SkillLoader as SkillLoaderBase } from './loaders/SkillLoader.js';

// 具体 Loader 实现
export { BundledSkillLoader } from './loaders/sources/BundledSkillLoader.js';
export { FileSkillLoader } from './loaders/sources/FileSkillLoader.js';
export type { FileSkillLoaderConfig } from './loaders/sources/FileSkillLoader.js';

// 第三方适配器体系
export type { ThirdPartySkillAdapter } from './loaders/adapter/ThirdPartySkillAdapter.js';
export type { ThirdPartySkillSearchResult } from './loaders/adapter/ThirdPartySkillAdapter.js';
export {
  ThirdPartyAdapterRegistry,
  thirdPartyAdapterRegistry,
} from './loaders/adapter/ThirdPartyAdapterRegistry.js';
export { AggregatedSkillSearch } from './loaders/adapter/AggregatedSkillSearch.js';
export type { AggregatedSearchItem } from './loaders/adapter/AggregatedSkillSearch.js';

export {
  SkillPreprocessor,
  getSkillPreprocessor,
  resetSkillPreprocessor,
} from './SkillPreprocessor';
export type { PreprocessOptions } from './SkillPreprocessor';
export { DEFAULT_PREPROCESS_OPTIONS } from './SkillPreprocessor';
export {
  SkillConditionMatcher,
  createDefaultConditionContext,
} from './SkillConditionMatcher';
export type { ConditionContext } from './SkillConditionMatcher';
export {
  SkillCurator,
  getSkillCurator,
  resetSkillCurator,
} from './SkillCurator';
export type {
  CuratorAction,
  SkillCurationState,
  CuratorActionRecord,
  CuratorConfig,
} from './SkillCurator';
export { DEFAULT_CURATOR_CONFIG } from './SkillCurator';
export { SkillHub, getSkillHub, resetSkillHub } from './SkillHub';
export type { SkillHubEntry, SkillHubSearchFilter } from './SkillHub';
export {
  SkillUsageTracker,
  getSkillUsageTracker,
  resetSkillUsageTracker,
} from './SkillUsageTracker';
export type { SkillUsageRecord, SkillUsageSummary } from './SkillUsageTracker';
export { SkillGuard, skillGuard } from './SkillGuard';
export type { SkillGuardResult } from './SkillGuard';
export {
  SkillProvenanceTracker,
  skillProvenanceTracker,
  getSkillProvenanceTracker,
} from './SkillProvenanceTracker';
export type {
  SkillProvenanceEntry,
  ProvenanceSource,
} from './SkillProvenanceTracker';

// 持久化层
export { SkillDB, getSkillDB } from './persistence/index.js';
