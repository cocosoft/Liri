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
 * 第三方技能适配器 — 统一导出
 */

export { ThirdPartySkillAdapter } from './ThirdPartySkillAdapter.js';
export type { ThirdPartySkillSearchResult } from './ThirdPartySkillAdapter.js';
export {
  ThirdPartyAdapterRegistry,
  thirdPartyAdapterRegistry,
} from './ThirdPartyAdapterRegistry.js';
export { AggregatedSkillSearch } from './AggregatedSkillSearch.js';
export type { AggregatedSearchItem } from './AggregatedSkillSearch.js';

// 通用基础类型
export type {
  ThirdPartySkillMeta,
  InstalledThirdPartySkill,
  LocalSkillSearchResult,
} from './types.js';

// 通用基类
export { BaseThirdPartyAdapter } from './BaseThirdPartyAdapter.js';
export { LocalSkillStore } from './LocalSkillStore.js';
export type { LocalSkillStoreConfig, SearchFieldExtractor } from './LocalSkillStore.js';
export { SkillAuditService, SkillAuditAction } from './SkillAuditService.js';
export type { SkillAuditEntry } from './SkillAuditService.js';

// ClawHub 适配器
export { ClawHubAdapter } from './clawhub/ClawHubAdapter.js';
export type { ClawHubAdapterConfig } from './clawhub/ClawHubAdapter.js';
export { ClawHubConverter } from './clawhub/ClawHubConverter.js';
export { ClawHubAPIClient } from './clawhub/ClawHubAPIClient.js';
export type { ClawHubAPIClientConfig } from './clawhub/ClawHubAPIClient.js';
export { ClawHubInstaller } from './clawhub/ClawHubInstaller.js';
export type { ClawHubInstallerConfig } from './clawhub/ClawHubInstaller.js';
export type {
  ClawHubSkillMeta,
  InstalledClawHubSkill,
  ClawHubSearchResult,
} from './clawhub/ClawHubMeta.js';
