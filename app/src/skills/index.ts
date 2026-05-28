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

export * from './SkillManager.js';
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
export { SkillSyncService, skillSyncService } from './SkillSyncService';
export type { SkillSyncResult } from './SkillSyncService';
export { SkillGuard, skillGuard } from './SkillGuard';
export type { SkillGuardResult } from './SkillGuard';
export {
  SkillProvenanceTracker,
  skillProvenanceTracker,
} from './SkillProvenanceTracker';
export type {
  SkillProvenanceEntry,
  ProvenanceSource,
} from './SkillProvenanceTracker';
