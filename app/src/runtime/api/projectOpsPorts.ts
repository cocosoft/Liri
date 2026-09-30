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
 * 项目运维 —— **服务层端口**（C1「口径 C」：`project` 域**动态组**收尾；2026-09-30 台账 D-111）
 *
 * **范围（本批仅 `project-artifact-handlers.ts` 的**动态**取用）**：
 * `createProjectHistoryStore(projectId)` + `store.getGrouped(since)` × 1。
 * ⚠️ `project` 域其余并集（`project-handlers` · `project-artifact-handlers` 的 **静态**
 * `ProjectArtifactStore` / `ProjectContextService` / `ImplicitEngineHook` / `MigrationService`，
 * 共 6 处）**未纳入本批**，见 spec §3.14。
 */

// ==================== `project` 域静态面（2026-09-30 台账 D-117）====================

/** 构件类型（逐字镜像 `ArtifactKind`） */
export type ArtifactKindDto = 'input' | 'output';

/** 项目构件（逐字镜像 `ProjectArtifact`） */
export interface ProjectArtifactDto {
  id: string;
  projectId: string;
  kind: ArtifactKindDto;
  sessionId?: string | undefined;
  refId?: string | undefined;
  title: string;
  content: string;
  createdAt: string;
}

/** 构件存储**句柄**（`new ProjectArtifactStore(storeDir)`；方法均 app 侧**同步** ⇒ 规则 37） */
export interface ProjectArtifactStorePort {
  list(
    projectId: string,
    kind?: ArtifactKindDto | undefined
  ): ProjectArtifactDto[];
  save(artifact: ProjectArtifactDto): void;
  delete(projectId: string, artifactId: string): boolean;
}

/** 隐式引擎持久化结果（调用方读 `contexts` / `deliverables`，其余字段展开透传 ⇒ 不必声明） */
export interface ImplicitPersistResultDto {
  contexts: number;
  deliverables: number;
}

/** 迁移结果 —— 文件级（调用方仅整体 `JSON.stringify` ⇒ 字段照 app 侧） */
export interface MigrateFilesResultDto {
  copied: number;
  skipped: number;
}

/** 迁移结果 —— worktree 级 */
export interface MigrateWorktreesResultDto {
  created: number;
  skipped: number;
}

/** 项目运维端口 */
export interface ProjectOpsPort {
  /**
   * 原 `createProjectHistoryStore(projectId)` + `store.getGrouped(since)`
   * （返回值调用方仅 `json(res, 200, groups)` ⇒ `unknown`）。
   */
  getProjectHistory(
    projectId: string,
    since?: string | undefined
  ): Promise<unknown>;

  // ---- `project` 域静态面（2026-09-30 台账 D-117）----
  /** 原 `new ProjectArtifactStore(storeDir)`（**模块级单例** ⇒ 句柄） */
  getProjectArtifactStore(storeDir: string): Promise<ProjectArtifactStorePort>;
  /**
   * 原 `ProjectContextService.parseRulesFile(rulesPath)`
   * （调用方仅读 `.length` 与整数组 `JSON.stringify` ⇒ `unknown[]`）。
   */
  parseProjectRulesFile(rulesPath: string): Promise<unknown[]>;
  /** 原 `ImplicitEngineHook.persist(projectId, text, projectsDir)` */
  persistImplicitEngine(
    projectId: string,
    text: string,
    projectsDir: string
  ): Promise<ImplicitPersistResultDto>;
  /** 原 `migrateLegacyFiles()`（app 侧**同步** ⇒ 端口仍返回 Promise） */
  migrateLegacyFiles(): Promise<MigrateFilesResultDto>;
  /** 原 `migrateWorktrees(worktrees, workspaceId?)`（app 侧**同步**） */
  migrateWorktrees(
    worktrees: Array<Record<string, unknown>>,
    workspaceId?: string | undefined
  ): Promise<MigrateWorktreesResultDto>;
}
