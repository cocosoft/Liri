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
 * 第三方技能适配器 —— **服务层端口**（C1「口径 C」站点 7；2026-09-30 台账 D-90）
 *
 * **为什么需要**：`infrastructure/http/handlers/skills-handlers.ts` 原先直接动态导入 app 层
 * `skills/loaders/adapter/clawhub/ClawHubAdapter` 与 `…/ThirdPartyAdapterRegistry`
 * （`service → app` 跨层引用，仅在 `R00-003` 可见），且该文件 **19 处**调用点、需要 **12+ 个方法**。
 * 若照前 6 个站点的配方往 `CoreAPI` 平铺 12+ 方法，会**撑爆 CoreAPI**（正是 C 方案要防的）⇒ 故改为：
 * **服务层只声明端口（本文件）+ `CoreAPI` 只加 1 个取用方法**（`getClawHubSkillAdapter()`），
 * 编排与 app 类引用**内聚在 `CoreAPIImpl`**。
 *
 * ⚠️ **端口按"handler 实际调用面"派生**，不是 app 类的全量 API；且**禁止引用 app 类型**
 * （`R00-001` 连类型导入也计）—— 返回 app 对象处一律用 `unknown`，由调用方按需收窄
 * （这也复刻了原 `ClawHubAdapterLike` 的既有做法）。
 */

/** 技能搜索引擎端口（handler 实际用到的 4 个方法） */
export interface SkillSearchEnginePort {
  /** 远端搜索（条目为 app 侧结构，调用方逐元素收窄 ⇒ `unknown[]`） */
  searchRemote(
    query: string,
    opts: Record<string, unknown>
  ): Promise<unknown[]>;
  /** 来源名列表（app 侧返回类型不稳定 ⇒ `unknown`，调用方自行收窄） */
  getSourceNames(): unknown;
  /** 新增自定义源 */
  addCustomSource(name: string, apiBaseUrl: string): void;
  /** 移除自定义源 */
  removeCustomSource(name: string): void;
}

/**
 * 技能注册表端口（**只读**）
 *
 * 镜像 handler 原 `SkillRegistryLike`（该接口自述"5.6：system 列表 status 反映真实启用状态"，
 * 且已与真实实现对齐）—— ⚠️ 注意 app 侧 `SkillRegistry` **本身没有 `name` 属性**，
 * 只有 `get(name, opts?)` 方法（首版误加 `name` ⇒ 实测 `TS2416`）。
 */
export interface SkillRegistryPort {
  get(
    name: string,
    opts?: { includeDisabled?: boolean }
  ): { name: string; isEnabled?: () => boolean } | undefined;
}

/** 本地技能存储端口（handler 实际只用 `getSkill`） */
export interface LocalSkillStorePort {
  getSkill(id: string): Promise<unknown>;
}

/** 第三方技能适配器端口（= handler 原 `ClawHubAdapterLike` 的服务层版本） */
export interface ThirdPartySkillAdapterPort {
  initialize(): Promise<void>;
  getInstalledSkills(): Promise<unknown[]>;
  searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<unknown[]>;
  getSearchEngine(): SkillSearchEnginePort;
  getSkillDetail(id: string): Promise<unknown>;
  getRemoteVersion(id: string): Promise<string | null>;
  getSkillRegistry(): SkillRegistryPort | null;
  installSkill(id: string, sourceUrl?: string): Promise<unknown>;
  uninstallSkill(id: string): Promise<unknown>;
  updateSkill(id: string): Promise<unknown>;
  enableSkill(id: string): Promise<void>;
  disableSkill(id: string): Promise<void>;
  getLocalStore(): LocalSkillStorePort;
}
