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
 * DomainSnapshotOps —— 领域只读快照 / 梦境 / 知识库文档 / 技能·插件·通道端口 / Ops 端口聚合
 *
 * 2026-10-05（文件规模债拆分，CoreAPIImpl 批 B1）：自 `CoreAPIImpl.ts` **纯搬迁**（只搬不改）。
 * 本类实现**零宿主依赖**（不访问宿主 `this` 成员）⇒ 无 deps 对象、可无参构造。
 */

import type http from 'http';
import type { TaskOpsPort } from './taskOpsPorts';
import type {
  AiOpsPort,
  LlamaDownloadProgressDto,
  SystemPromptContextDto,
} from './aiOpsPorts';
import type {
  QueryOpsPort,
  ResearchOrchestrationConfigDto,
} from './queryOpsPorts';
import type { BuddyOpsPort } from './buddyOpsPorts';
import type { CommandsOpsPort } from './commandsOpsPorts';
import type { WorkspaceOpsPort } from './workspaceOpsPorts';
import type {
  AgentRoleStorePort,
  TeamStorePort,
  OrchIntelligencePort,
  WorkspaceContextPort,
  CouncilEnginePort,
  RuleEnginePort,
  LiriDetectionResultDto,
  TaskStorePort,
  ProjectItemStorePort,
} from './workspaceOpsPorts';
import type {
  ProjectOpsPort,
  ArtifactKindDto,
  ProjectArtifactDto,
  ProjectArtifactStorePort,
} from './projectOpsPorts';
import type { SkillsOpsPort } from './skillsOpsPorts';
import type { AutoReplyPort } from './autoReplyPorts';
import type { A2APort } from './a2aPorts';
import type { BridgePort } from './bridgePorts';

export class DomainSnapshotOps {
  /**
   * Git 上下文快照（只读）—— 供 HTTP 等 service 侧消费的门面。
   *
   * 2026-09-30（台账 D-85，C1「口径 C」）：原先由 HTTP handler 自行动态导入 app 层
   * `context/GitContextService`（`service → app`，只在 `R00-003` 可见）⇒ 该导入**收敛到此处**
   * （本仓既有的 sanctioned `service → app` 缝）。**行为与 handler 原实现逐字等价**。
   */
  async getGitContextSnapshot(): Promise<{
    isGitRepo: boolean;
    status: {
      branch: string;
      mainBranch: string;
      status: string;
      recentCommits: string;
      userName: string | null;
    } | null;
  }> {
    const { getGitContextService } =
      await import('@modules/context/GitContextService');
    const git = getGitContextService();
    const isGitRepo = await git.isGitRepository();
    if (!isGitRepo) {
      return { isGitRepo: false, status: null };
    }
    return { isGitRepo: true, status: await git.getGitStatus() };
  }

  /** PathGuard 指标快照（只读）—— HTTP 等 service 侧消费；见 `CoreAPI` 声明处沿革 */
  async getPathGuardMetrics(): Promise<Record<string, unknown>> {
    const { getPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    return getPathGuardMetrics();
  }

  /** 重置 PathGuard 指标（写侧） */
  async resetPathGuardMetrics(): Promise<void> {
    const { resetPathGuardMetrics } =
      await import('@modules/chat/services/PathGuardService');
    resetPathGuardMetrics();
  }

  /** 列出工作空间条目（摊平 `meta`，字段与 handler 原有映射逐字对应） */
  async listWorkspaceEntries(): Promise<
    Array<{
      id: string;
      name: string;
      path: string;
      description: string | undefined;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const { buildEntries } =
      await import('@modules/workspaces/WorkspaceStorage');
    const entries = await buildEntries();
    return entries.map((e) => ({
      id: e.meta.id,
      name: e.name,
      path: e.path,
      description: e.meta.description,
      createdAt: e.meta.createdAt,
      updatedAt: e.meta.updatedAt,
    }));
  }

  /** 按 id 取工作空间物理路径（不存在时 null；等价 handler 原实现） */
  async getWorkspacePath(workspaceId: string): Promise<string | null> {
    const { buildEntries } =
      await import('@modules/workspaces/WorkspaceStorage');
    const entries = await buildEntries();
    const entry = entries.find((e) => e.meta.id === workspaceId);
    return entry ? entry.path : null;
  }

  /** 删除工作空间（按物理路径；与 app 层 `deleteWorkspace(path)` 同义） */
  async deleteWorkspace(path: string): Promise<void> {
    const { deleteWorkspace } =
      await import('@modules/workspaces/WorkspaceStorage');
    await deleteWorkspace(path);
  }

  // ---- 梦境（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-87）----
  // 路径用**相对 2 段**（`../../dream/X`）：R03-002 对 `parts.length < 3` 直接跳过；
  // 若改用 `@modules/dream/X` 别名会被 R03-002 判违规（`dream` 有 index.ts）。

  async listDreamCycles(params: {
    page: number;
    pageSize: number;
    triggerSource?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<object> {
    const { DreamPersistence } = await import('../../dream/DreamPersistence');
    return new DreamPersistence().listCycles(params);
  }

  async queryDreamCycles(filter: {
    from?: number;
    to?: number;
    triggerSource?: string;
    status?: string;
    limit?: number;
  }): Promise<{ cycles: unknown; stats: unknown }> {
    const { getDreamCycleDb } = await import('../../dream/DreamCycleDb');
    const db = await getDreamCycleDb();
    const [cycles, stats] = await Promise.all([
      db.queryCycles(filter),
      db.aggregateCycles(filter),
    ]);
    return { cycles, stats };
  }

  async getDreamCycle(cycleId: string): Promise<unknown | null> {
    const { DreamPersistence } = await import('../../dream/DreamPersistence');
    return new DreamPersistence().getCycle(cycleId);
  }

  async readDreamMetrics(): Promise<unknown | null> {
    const { readMetrics } = await import('../../dream/DreamMetrics');
    return readMetrics();
  }

  // ---- 知识库文档（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-88）----

  async buildKnowledgeDocsIndex(): Promise<
    Array<{
      relativePath: string;
      content?: string | undefined;
      title?: string | undefined;
      source?: string | undefined;
      category?: string | undefined;
      tags?: string[] | undefined;
    }>
  > {
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    return knowledgeDocsProvider.buildIndex();
  }

  async clearKnowledgeDocsCache(): Promise<void> {
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    knowledgeDocsProvider.clearCache();
  }

  // ---- 第三方技能适配器（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-90）----

  /**
   * 取得 ClawHub 适配器 —— **编排自 `skills-handlers.ts` 原 `getClawHubAdapter()` 等价搬迁**
   * （逻辑与调用顺序逐字一致，仅 `catch` 形参省略）：
   * 优先从第三方注册表取（`instanceof` 收窄到真实类型 + `initialize()` 幂等），否则回退单例。
   * `instanceof` 需要 app 类 ⇒ 只有本文件（sanctioned 的 `service → app` 缝）能持有。
   */
  async getClawHubSkillAdapter() {
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered instanceof ClawHubAdapter) {
        await registered.initialize();
        return registered;
      }
    } catch {
      // 注册表不可用时 fallback（与原实现一致：静默回退）
    }

    const adapter = ClawHubAdapter.getInstance();
    await adapter.initialize();
    return adapter;
  }

  // ---- 技能 ID 安全 / 权限解析（同批；见 CoreAPI 声明处沿革 D-91）----

  async validateSkillId(id: string): Promise<string | null> {
    const { validateSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    return validateSkillId(id);
  }

  async sanitizeSkillId(name: string): Promise<string> {
    const { sanitizeSkillId } =
      await import('@modules/skills/loaders/adapter/safeSkillId');
    return sanitizeSkillId(name);
  }

  async skillMdRequiresApproval(skillMdText: string): Promise<boolean> {
    const { parseSkillPermissions, hasSensitivePermission } =
      await import('@modules/skills/loaders/adapter/SkillPermission');
    return hasSensitivePermission(parseSkillPermissions(skillMdText));
  }

  async parseSkillFrontmatter(content: string): Promise<{
    frontmatter?: { description?: string | undefined } | undefined;
  }> {
    const { parseSkillFrontmatter } =
      await import('@modules/skills/utils/skillParser');
    return parseSkillFrontmatter(content);
  }

  // ---- 插件管理（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-92）----

  async getPluginAdminPort() {
    const { pluginSystem, NpmDistributor } = await import('@modules/plugins');
    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const { PLUGIN_CATEGORIES } =
      await import('@modules/plugins/categories/PluginCategories');

    return {
      // 市场
      searchMarket: async (params: {
        query: string;
        page: number;
        pageSize: number;
      }) => pluginMarketplace.search(params),
      getMarketCategories: async () => pluginMarketplace.getCategories(),
      getMarketPlugin: async (pluginId: string) =>
        pluginMarketplace.getPlugin(pluginId),
      getMarketPluginVersions: async (pluginId: string) =>
        pluginMarketplace.getPluginVersions(pluginId),

      // 插件系统
      getPluginInfoList: async () => pluginSystem.getPluginInfoList(),
      checkPendingSdkTimeouts: async () => {
        pluginSystem.checkPendingSdkTimeouts();
      },
      getPendingSdkPlugins: async () => pluginSystem.getPendingSdkPlugins(),
      loadPlugin: async (pluginId: string) => pluginSystem.loadPlugin(pluginId),
      stopAndUnloadPlugin: async (pluginId: string) => {
        await pluginSystem.stopPlugin(pluginId);
        await pluginSystem.unloadPlugin(pluginId);
      },

      // npm 分发（与原实现一致：每次**新建实例**）
      listInstalledPackages: async () => new NpmDistributor().listInstalled(),
      installPackage: async (packageName: string) =>
        new NpmDistributor().install(packageName),
      removePackage: async (packageName: string) =>
        new NpmDistributor().remove(packageName),

      // 分类常量
      getPluginCategories: async () => PLUGIN_CATEGORIES,
    };
  }

  // ---- 工具运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-93）----

  async getToolsPort() {
    const {
      getVideoTaskPersistence,
      getConverterEngine,
      getMediaTemplates,
      refreshAvailableSubagentTypeNames,
      getSpawnPauseState,
      setSpawnPaused,
      getAgentRunStore,
      resolveAgentToolInstance,
    } = await import('@modules/tools');

    return {
      // 2026-10-01 D-192：媒体模板列表。`media-template-handlers.ts` 原先**静态**导入
      // `@modules/tools` 的 `getMediaTemplates`（service -> app 倒挂）；现按本文件既有模式
      // **动态**取用（仅 R00-003 可见），并对字段做最小投影。
      listMediaTemplates: async () =>
        getMediaTemplates()
          .list()
          .map((t) => ({
            templateId: t.templateId,
            name: t.name,
            type: t.type,
            category: t.category,
            thumbnailUrl: t.thumbnailUrl || null,
            promptTemplate: t.promptTemplate || null,
            requiresImage: t.requiresImage,
            sortOrder: t.sortOrder,
          })),
      // 2026-10-01 D-194：刷新「可用子代理类型名」快照（`agent-role-handlers` 原静态导入，
      // 角色变更后需重算工具 schema 可用清单）
      refreshAvailableSubagentTypeNames: async () =>
        refreshAvailableSubagentTypeNames(),
      // ---- 子代理控制（2026-10-01 D-199；原 `agent-control-handlers` 静态导入同一批符号）----
      getSpawnPauseState: () => getSpawnPauseState(),
      setSpawnPaused: (paused: boolean, reason?: string | undefined) =>
        setSpawnPaused(paused, reason),
      listAgentRuns: async () => getAgentRunStore().listRuns(),
      getActiveAgents: () =>
        resolveAgentToolInstance()?.getActiveAgents() ?? [],
      stopAgent: (
        agentId: string,
        opts: {
          requesterSessionId?: string | undefined;
          privileged?: boolean | undefined;
        }
      ) => resolveAgentToolInstance()?.stopAgent(agentId, opts),
      isAgentToolAvailable: () => resolveAgentToolInstance() !== null,
      listVideoTasksBySourceImagePath: async (imagePath: string) =>
        getVideoTaskPersistence().listBySourceImagePath(imagePath),
      listVideoTasksByStatus: async (
        statuses: Array<'pending' | 'queued' | 'running' | 'completed'>,
        limit: number
      ) => getVideoTaskPersistence().listByStatus(statuses, limit),
      updateVideoTask: async (
        id: string,
        patch: {
          sourceImageUrl?: string | undefined;
          sourceImageId?: string | undefined;
          mode?: 'text-to-video' | 'image-to-video' | undefined;
        }
      ) => {
        getVideoTaskPersistence().update(id, patch);
      },
      // D-197：`video-task-handlers.ts` 剩余 3 个方法面（get / list / cleanupStaleTasks）
      getVideoTask: async (id: string) =>
        getVideoTaskPersistence().get(id) ?? null,
      listVideoTasks: async (limit: number) =>
        getVideoTaskPersistence().list(limit),
      cleanupStaleTasks: () => {
        getVideoTaskPersistence().cleanupStaleTasks();
      },

      detectFileInfo: async (fileName: string, size: number) =>
        getConverterEngine().getDetector().detect(fileName, size),
      convertContent: async (fileInfo: unknown, buffer: Buffer) =>
        // fileInfo 由 detectFileInfo 回传（不透明句柄）⇒ 此处唯一必要的收窄点
        getConverterEngine().convertContent(fileInfo as never, buffer),
      convertFile: async (filePath: string) =>
        getConverterEngine().convertFile(filePath),

      executeVideoGenerateTool: async (args: {
        prompt: unknown;
        imageUrl?: unknown;
        imagePath?: unknown;
        duration?: unknown;
        aspectRatio?: unknown;
        model?: unknown;
      }) => {
        const { createVideoGenerateTool } =
          await import('@modules/tools/VideoGenerateTool/VideoGenerateTool');
        const tool = createVideoGenerateTool();
        // 保持原 handler 行为：`async: true` + 空 ctx（原为 `{} as unknown as ToolUseContext`）
        return tool.execute(
          { ...args, async: true },
          {} as unknown as Parameters<typeof tool.execute>[1]
        );
      },
      cancelVideoTask: async (taskId: string) => {
        const { VideoGenerateTool } =
          await import('@modules/tools/VideoGenerateTool/VideoGenerateTool');
        VideoGenerateTool.cancelTask(taskId);
      },
    };
  }

  // ---- 自动回复运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-202）----

  /**
   * 自动回复端口（2026-10-01 D-202，子批 C）
   *
   * `auto-reply-handlers.ts` 原先以**相对路径**静态导入 app 层 `'../../../auto-reply'`
   * （`autoReplyEngine` + `ReplyRule` / `StoredPattern`）⇒ `infrastructure -> app` 倒挂。
   * 现按本文件既有模式**动态**取用（仅 R00-003 可见）。
   *
   * ⚠️ `auto-reply` 模块**无 `@modules/*` 别名**（tsconfig 为逐模块显式声明，见 `tsconfig.json:26+`）
   * ⇒ 此处只能用**相对路径**动态导入（`src/runtime/api/` → `src/auto-reply/index.js`）。
   */
  async getAutoReplyPort(): Promise<AutoReplyPort> {
    const { autoReplyEngine } = await import('../../auto-reply/index.js');

    return {
      getAllRules: () => autoReplyEngine.getAllRules(),
      getStats: () => autoReplyEngine.getStats(),
      registerRule: (rule) => autoReplyEngine.registerRule(rule as never),
      updateRule: (ruleId, updates) =>
        autoReplyEngine.updateRule(ruleId, updates as never),
      deleteRule: (ruleId) => autoReplyEngine.deleteRule(ruleId),
    };
  }

  // ---- A2A 对外面运行时（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-204）----

  /**
   * A2A 对外面端口（2026-10-01 D-204，子批 C）
   *
   * `infrastructure/http/handlers/routes/` 下 2 个文件原静态导入 app 层 `@modules/agent`
   * （`getAgentRegistry` / `buildAgentCard` / `computeAgentCardEtag` / `a2aTaskStore` /
   * `A2A_PROTOCOL_VERSION`）⇒ `infrastructure -> app` 倒挂。现按既有模式**动态**取用
   * （仅 R00-003 可见）；协议**类型**已下沉 core `types/a2a.ts` ⇒ 端口用真实类型。
   */
  async getA2APort(): Promise<A2APort> {
    const {
      getAgentRegistry,
      buildAgentCard,
      computeAgentCardEtag,
      a2aTaskStore,
      A2A_PROTOCOL_VERSION,
    } = await import('@modules/agent');

    return {
      // 折叠"取注册表 → buildAgentCard → 算 etag"三步为**一个投影方法**
      buildCard: (baseUrl: string) => {
        const definitions = getAgentRegistry().listAll();
        const card = buildAgentCard(definitions, {
          baseUrl,
          version: A2A_PROTOCOL_VERSION,
        });
        return {
          card,
          etag: computeAgentCardEtag(card),
          agentCount: definitions.length,
        };
      },
      getAgentSystemPrompt: (agentId: string) =>
        getAgentRegistry().getAgent(agentId)?.systemPrompt,
      createTask: () => a2aTaskStore.create(),
      completeTask: (taskId, state, artifacts, message) =>
        a2aTaskStore.complete(taskId, state, artifacts, message),
      getTask: (taskId: string) => a2aTaskStore.get(taskId),
    };
  }

  // ---- Bridge 运行时（worktree 隔离；见 CoreAPI 声明处沿革 D-207）----

  /**
   * Bridge 域端口（2026-10-01 D-207，子批 D）
   *
   * `bridge/BridgeMain.ts` 原静态导入 app 层 `@modules/workspaces/...`
   * （`createWorkspaceGit` · `pruneOrphanWorktrees`）⇒ `bridge -> workspaces` 倒挂。
   * 现按既有模式**动态**取用（仅 R00-003 可见），并把返回值按调用方读取面**最小投影**。
   */
  async getBridgePort(): Promise<BridgePort> {
    const { createWorkspaceGit } =
      await import('@modules/workspaces/WorkspaceGit.js');
    const { pruneOrphanWorktrees } =
      await import('@modules/workspaces/WorkspacePruner.js');

    return {
      createWorktreeManager: ({ baseDir }) => {
        const manager = createWorkspaceGit({ baseDir });
        return {
          createWorktree: async (sessionId: string) => {
            const info = await manager.createWorktree(sessionId);
            // 最小投影：BridgeMain 只读 worktreePath
            return { worktreePath: info.worktreePath };
          },
          removeWorktree: async (sessionId: string) => {
            await manager.removeWorktree(sessionId);
          },
          clearAllWorktrees: async () => {
            await manager.clearAllWorktrees();
          },
        };
      },
      pruneOrphanWorktrees: (gitRoot: string) => pruneOrphanWorktrees(gitRoot),
    };
  }

  // ---- 知识库运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-95）----

  async getKnowledgeOpsPort() {
    /** FAQ 单例取用（原 handler 每处都 `getFAQService()`） */
    const faq = async () =>
      (await import('@modules/knowledge/faq/FAQService')).getFAQService();
    /** 知识图谱：原实现每次 `new` + `init()` */
    const graph = async () => {
      const { KnowledgeGraph } =
        await import('@modules/knowledge/graph/KnowledgeGraph');
      const g = new KnowledgeGraph();
      await g['init']();
      return g;
    };
    /** 知识库注册表单例取用（原 handler 每处 `getDefaultKnowledgeBaseRegistry()`） */
    const registry = async () =>
      (
        await import('@modules/knowledge/KnowledgeBaseRegistry')
      ).getDefaultKnowledgeBaseRegistry();

    return {
      // ---- 数据源 ----
      syncRssDataSource: async (config: {
        intervalMs?: number | undefined;
        url?: unknown;
        maxItems?: number | undefined;
      }) => {
        const { RSSConnector } =
          await import('@modules/knowledge/datasource/RSSConnector');
        const connector = new RSSConnector({
          type: 'rss',
          enabled: true,
          intervalMs: config.intervalMs || 3600000,
          url: config.url,
          maxItems: config.maxItems ?? 20,
        });
        return connector.sync();
      },

      // ---- 知识图谱 ----
      queryKnowledgeGraphEdges: async (params: {
        domain?: string | undefined;
        entityId?: string | undefined;
        type?: string | undefined;
        limit: number;
      }) => (await graph()).queryEdges(params),
      getKnowledgeGraphStats: async () => (await graph()).getStats(),

      // ---- 编译调度（回调与编排内聚于此）----
      startKnowledgeCompileScheduler: async (
        aiService: unknown,
        opts: { model?: string | undefined; runOnStart: boolean },
        registerNotifyFileChanged: (notify: () => void) => void
      ) => {
        const { runKnowledgeCompile } =
          await import('@modules/knowledge/KnowledgeCompiler');
        const { KnowledgeCompileScheduler } =
          await import('@modules/knowledge/KnowledgeCompileScheduler');
        const scheduler = new KnowledgeCompileScheduler(
          // aiService 为 service 层持有对象（原 handler 亦直接透传）⇒ 边界收窄
          (force?: boolean) =>
            runKnowledgeCompile(aiService as never, {
              force,
              model: opts.model,
            }),
          { runOnStart: opts.runOnStart }
        );
        scheduler.start();
        registerNotifyFileChanged(scheduler.notifyFileChanged.bind(scheduler));
        // 原函数声明返回 `{ stop: () => void } | null`（实现里返回 scheduler 实例）⇒ 回传等价句柄
        return { stop: () => scheduler.stop() };
      },

      // ---- FAQ ----
      listFaqEntries: async (params: {
        knowledgeBaseName: string;
        category: string | undefined;
        offset: number;
        limit: number;
      }) => (await faq()).list(params),
      countFaqEntries: async (knowledgeBaseName: string) =>
        (await faq()).count(knowledgeBaseName),
      createFaqEntry: async (params: {
        knowledgeBaseName: string;
        question: string;
        answer: string;
        similarQuestions?: string[] | undefined;
        tags?: string[] | undefined;
        category?: string | undefined;
        recommended?: boolean | undefined;
      }) => (await faq()).create(params),
      updateFaqEntry: async (id: string, params: Record<string, unknown>) =>
        // params 源自 JSON.parse（无静态类型）⇒ 边界收窄
        (await faq()).update(id, params as never),
      deleteFaqEntry: async (id: string) => {
        await (await faq()).delete(id);
      },
      deleteFaqEntries: async (ids: unknown[]) =>
        (await faq()).deleteBatch(ids as never),
      importFaqEntries: async (knowledgeBaseName: string, items: unknown[]) =>
        (await faq()).importBatch(knowledgeBaseName, items as never),
      searchFaqEntries: async (params: {
        query: string;
        knowledgeBaseName: string;
        category: string | undefined;
        topK: number;
      }) => (await faq()).search(params),
      getFaqCategories: async (knowledgeBaseName: string) =>
        (await faq()).getCategories(knowledgeBaseName),

      // ---- 语义索引（P2）----
      readSemanticIndexStamp: async (indexDir: string) => {
        const { readIndexMeta } =
          await import('@modules/knowledge/semantic/store');
        const meta = await readIndexMeta(indexDir);
        return meta?.updatedAt ?? '';
      },
      readSemanticIndexMeta: async (indexDir: string) => {
        const { readIndexMeta } =
          await import('@modules/knowledge/semantic/store');
        return readIndexMeta(indexDir);
      },
      createSemanticStore: async (indexDir: string) => {
        const { SemanticStore } =
          await import('@modules/knowledge/semantic/store');
        const store = new SemanticStore(indexDir, {
          provider: 'local',
          model: 'nomic-embed-text',
        });
        await store.load();
        return store;
      },
      wipeSemanticStoreFiles: async (indexDir: string) => {
        const { wipeStoreFiles } =
          await import('@modules/knowledge/semantic/store');
        await wipeStoreFiles(indexDir);
      },
      createSemanticIndexBuilder: async () => {
        const { IndexBuilder } =
          await import('@modules/knowledge/semantic/builder');
        return new IndexBuilder();
      },
      getDefaultKnowledgeRoot: async () => {
        const { getDefaultKnowledgeBaseRegistry } =
          await import('@modules/knowledge/KnowledgeBaseRegistry');
        return getDefaultKnowledgeBaseRegistry().getKnowledgeRoot();
      },

      // ---- 知识库注册表（P3：根目录复用上文 getDefaultKnowledgeRoot）----
      listKnowledgeBases: async () => (await registry()).listBases(),
      createKnowledgeBase: async (name: string, label: string, icon?: string) =>
        (await registry()).createBase(name, label, icon),
      updateKnowledgeBase: async (
        baseName: string,
        updates: { label?: string; enabled?: boolean; icon?: string }
      ) => (await registry()).updateBase(baseName, updates),
      deleteKnowledgeBase: async (baseName: string) => {
        await (await registry()).deleteBase(baseName);
      },
      cloneKnowledgeBase: async (baseName: string, target: string) =>
        (await registry()).cloneBase(baseName, target),
      duplicateKnowledgeBaseConfig: async (baseName: string, target: string) =>
        (await registry()).duplicateConfig(baseName, target),

      // ---- frontmatter（P3）----
      parseKnowledgeFrontmatter: async (content: string) => {
        const { parseFrontmatter } =
          await import('@modules/knowledge/frontmatter');
        return parseFrontmatter(content);
      },
      parseKnowledgeTags: async (raw: string) => {
        const { parseTags } = await import('@modules/knowledge/frontmatter');
        return parseTags(raw);
      },

      // ---- 混合搜索（P3：共享路由单例取用内聚于此）----
      searchKnowledgeRoutes: async (
        query: string,
        opts: {
          maxResults: number;
          onlyKnowledge: boolean;
          domain?: string | undefined;
        }
      ) => {
        const { getKnowledgeRouter } =
          await import('@modules/knowledge/KnowledgeRouter');
        const router = await getKnowledgeRouter();
        return router.search(query, {
          maxResults: opts.maxResults,
          onlyKnowledge: opts.onlyKnowledge,
          domain: opts.domain,
        });
      },
      searchKnowledgeBuckets: async (
        query: string,
        opts: {
          limit: number;
          base?: string | undefined;
          domain?: string | undefined;
        }
      ) => {
        const { getKnowledgeRouter } =
          await import('@modules/knowledge/KnowledgeRouter');
        const { createUnifiedSearchService } =
          await import('@modules/knowledge/search/UnifiedSearchService');
        const router = await getKnowledgeRouter();
        const svc = createUnifiedSearchService(router);
        return svc.searchBucketed(query, {
          limit: opts.limit,
          base: opts.base,
          domain: opts.domain,
        });
      },

      // ---- 摘要 / 编译 / 血缘 / 体检（P3）----
      rebuildKnowledgeDigest: async () => {
        const { getDefaultDigestService } =
          await import('@modules/knowledge/KnowledgeDigestService');
        await getDefaultDigestService().buildDigest();
      },
      runKnowledgeCompile: async (
        aiService: unknown,
        opts: { force?: boolean | undefined }
      ) => {
        const { runKnowledgeCompile: runCompile } =
          await import('@modules/knowledge/KnowledgeCompiler');
        // aiService 为 service 层持有对象（原 handler 亦直接透传）⇒ 边界收窄
        await runCompile(aiService as never, { force: opts.force });
      },
      getKnowledgeCompileProgress: async () => {
        const { getCompileProgress } =
          await import('@modules/knowledge/CompileProgressTracker');
        return getCompileProgress();
      },
      queryKnowledgeLineage: async (query: {
        docPath?: string | undefined;
        artifactType?: 'page' | 'record' | 'rule' | 'node' | undefined;
        artifactId?: string | undefined;
        domain?: string | undefined;
        version?: number | undefined;
      }) => {
        const { LineageStore } =
          await import('@modules/knowledge/lineage/LineageStore');
        const store = new LineageStore();
        try {
          await store.init();
          return await store.query(query);
        } finally {
          await store.close();
        }
      },
      runKnowledgeLint: async () => {
        const { runKnowledgeLint: runLint } =
          await import('@modules/knowledge/KnowledgeLinter.js');
        return runLint();
      },
      getKnowledgePdfOcrInfo: async () => {
        const { isPdfOcrEnabled, SCAN_MIN_CHARS_PER_PAGE } =
          await import('@modules/knowledge/ingestion/extractors/PdfOcrExtractor.js');
        return {
          enabled: isPdfOcrEnabled(),
          scanMinCharsPerPage: SCAN_MIN_CHARS_PER_PAGE,
        };
      },

      // ---- 快照 / 配置（P3）----
      listKnowledgeSnapshots: async (title: string) => {
        const { KnowledgeBaseWriter } =
          await import('@modules/knowledge/KnowledgeBaseWriter.js');
        const writer = new KnowledgeBaseWriter();
        return writer.listSnapshots(title);
      },
      restoreKnowledgeSnapshot: async (title: string, snapshot: string) => {
        const { KnowledgeBaseWriter } =
          await import('@modules/knowledge/KnowledgeBaseWriter.js');
        const writer = new KnowledgeBaseWriter();
        return writer.restoreSnapshot(title, snapshot);
      },
      getKnowledgeConfig: async () => {
        const { KnowledgeConfig } =
          await import('@modules/knowledge/KnowledgeConfig');
        const config = await KnowledgeConfig.load();
        return config.toJSON();
      },
      updateKnowledgeConfig: async (partial: Record<string, unknown>) => {
        const { KnowledgeConfig } =
          await import('@modules/knowledge/KnowledgeConfig');
        const config = await KnowledgeConfig.load();
        // partial 源自 JSON.parse（无静态类型）⇒ 边界收窄
        const updated = config.update(partial as never);
        await config.save();
        return updated;
      },
    };
  }

  // ---- 任务运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-98）----

  /**
   * ⚠️ **必须显式标注返回类型**（实测 D-101）：`getCoreAPI()` 返回的是本**实现类**（非 `CoreAPI`
   * 接口），而 `implements` **不提供**方法体的上下文类型 ⇒ 若不加标注，端口实现里含 `as never` 的
   * 边界收窄会让返回被**推导**为 `never`，调用方随即报一片 `TS2339`（property does not exist on `never`）。
   */
  async getTaskOpsPort(): Promise<TaskOpsPort> {
    /**
     * 任务状态存储：原调用点均为 `new SqliteTaskStore()`（默认库路径）+ `init()` + 单次动作，
     * 且**均未调用 `close()`** ⇒ 此处**保持不关闭**（与改动前行为逐字一致）。
     * ⚠️ 该「未关闭」本身是**预存问题**（每条请求新建 sqlite 连接不复用），已另案登记，不在本批修复。
     */
    const taskStore = async () => {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      return store;
    };
    /** `@modules/tasks` barrel 取用（P1–P3 共用入口） */
    const tasksModule = async () => import('@modules/tasks');
    /** PDCA 检查点桥接层取用（P3-b） */
    const pdcaBridge = async () => import('@modules/tasks/PdcaWorkItemBridge');
    /** 目标任务模块取用（P4；含 `getTaskGoalStore` / `isTerminalGoalStatus`） */
    const goalModule = async () => import('@modules/tasks/goal/TaskGoalStore');
    /** 目标生命周期事件模块取用（P4） */
    const goalEvents = async () => import('@modules/tasks/goal/GoalEvents');
    /** 自唤醒服务取用（P4；原 `getCg3SelfWakeService()`，可能为 `null`） */
    const selfWakeService = async () =>
      (await import('@modules/tasks/Cg3Bootstrap')).getCg3SelfWakeService();
    /** 任务注册表**单例**取用（原 handler 每处各自取值）—— 取用内聚于此（规则 21） */
    const registry = async () => (await tasksModule()).taskRegistry;
    /** 任务编排器**单例**取用（原 handler 每处 `import { taskOrchestrator }`） */
    const orchestrator = async () => (await tasksModule()).taskOrchestrator;
    /** 任务流注册表**单例**取用（原 handler 每处 `import { taskFlowRegistry }`） */
    const flowRegistry = async () =>
      (await import('@modules/tasks/TaskFlowRegistry')).taskFlowRegistry;

    return {
      // ---- 任务状态存储 ----
      listTaskStates: async () => (await taskStore()).loadTaskStates(),
      getTaskState: async (taskId: string) =>
        (await taskStore()).getTaskState(taskId),
      queryTaskAuditLogs: async (taskId: string) =>
        (await taskStore()).queryAuditLogs(taskId),

      // ---- 看板卡片 ----
      listKanbanCards: async () => (await taskStore()).loadKanbanCards(),
      saveKanbanCard: async (card: {
        id: string;
        title: string;
        description?: string | undefined;
        columnId?: string | undefined;
        assignee?: string | undefined;
        priority?: string | undefined;
        tags?: string[] | undefined;
        sortOrder?: number | undefined;
      }) => {
        await (await taskStore()).saveKanbanCard(card);
      },
      deleteKanbanCard: async (cardId: string) => {
        await (await taskStore()).deleteKanbanCard(cardId);
      },
      moveKanbanCard: async (
        cardId: string,
        columnId: string,
        sortOrder: number
      ) => {
        await (
          await taskStore()
        ).updateKanbanCardColumn(cardId, columnId, sortOrder);
      },

      // ---- 任务注册表（单例取用内聚于此）----
      listAllTasks: async () => (await registry()).getAllTasks(),
      getRegisteredTask: async (taskId: string) =>
        (await registry()).getTask(taskId),
      killTask: async (taskId: string) => {
        await (await registry()).kill(taskId);
      },
      removeTask: async (taskId: string) => {
        await (await registry()).remove(taskId);
      },
      recoverLostTask: async (taskId: string) =>
        (await registry()).recoverLostTask(taskId),

      // ---- Cron（P2：句柄**自持会话**，生命周期由调用方管理，与改动前一致）----
      createCronJobStore: async () => {
        const { CronJobStore } =
          await import('@modules/tasks/cron/CronJobStore');
        const { resolveDbPath } = await import('@modules/core/paths');
        const store = new CronJobStore(resolveDbPath());
        return {
          init: () => store.init(),
          // 下列 2 处为**边界收窄**：app 侧 CronJob 是 interface（无隐式索引签名），
          // 结构上不可直接赋给端口的"松散可变记录" ⇒ 按既有约定在 Impl 内收窄
          loadJobs: async () => (await store.loadJobs()) as never,
          getJob: async (cronId: string) =>
            ((await store.getJob(cronId)) ?? null) as never,
          upsertJob: async (
            job: Record<string, unknown> & {
              schedule?: Record<string, unknown> | undefined;
            }
          ) => {
            await store.upsertJob(job as never);
          },
          deleteJob: async (cronId: string) => {
            await store.deleteJob(cronId);
          },
          getStats: () => store.getStats(),
          listEnabledJobs: () => store.listEnabledJobs(),
          close: () => store.close(),
        };
      },
      createCronRunLog: async () => {
        const { CronRunLog } = await import('@modules/tasks/cron/CronRunLog');
        const { resolveDbPath } = await import('@modules/core/paths');
        const runLog = new CronRunLog(resolveDbPath());
        return {
          init: () => runLog.init(),
          queryPage: (opts: {
            jobId?: string | undefined;
            limit?: number | undefined;
            offset?: number | undefined;
            status?: 'ok' | 'failed' | undefined;
          }) => runLog.queryPage(opts),
          close: () => runLog.close(),
        };
      },
      wakeCronScheduler: async () => {
        const { wakeGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        wakeGlobalCronScheduler();
      },
      getCronSchedulerStatus: async () => {
        const { isGlobalCronSchedulerStarted, getGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        const started = isGlobalCronSchedulerStarted();
        const scheduler = getGlobalCronScheduler();
        // 与改动前判据逐字一致：started && scheduler 时才取状态，否则 null（调用方走静态回退）
        return started && scheduler ? scheduler.getStatus() : null;
      },
      computeNextCronRun: async (expr: string, nowMs: number) => {
        const { computeNextCronRun } = await import('@modules/utils/cron');
        return computeNextCronRun(expr, nowMs);
      },

      // ---- 任务编排 / 计划（P3：单例取用内聚 —— 规则 21）----
      initTaskOrchestrator: async () => {
        await (await orchestrator()).initialize();
      },
      getPlansByWorkspace: async (workspaceId: string) =>
        (await orchestrator()).getPlansByWorkspace(workspaceId),
      getAllPlans: async () => (await orchestrator()).getAllPlans(),
      createPlan: async (params: {
        description: string;
        stepDescriptions: string[];
        sessionId: string;
        workspaceId?: string | undefined;
      }) =>
        // 原调用点第 4/5 参恒为 undefined ⇒ 端口不收，此处按**原实参**补齐
        (await orchestrator()).createPlan(
          params.description,
          params.stepDescriptions,
          params.sessionId,
          undefined,
          undefined,
          params.workspaceId
        ),
      getPlan: async (planId: string) =>
        (await orchestrator()).getPlan(planId) ?? null,
      getPlanProgress: async (planId: string) =>
        (await orchestrator()).getPlanProgress(planId),
      markStepRunning: async (stepId: string) => {
        (await orchestrator()).markStepRunning(stepId);
      },
      markStepFailed: async (stepId: string, reason?: string | undefined) => {
        (await orchestrator()).markStepFailed(stepId, reason);
      },

      // ---- 任务流注册表（P3：单例取用内聚）----
      listTaskFlows: async () => (await flowRegistry()).getAllFlows(),
      getTaskFlow: async (flowId: string) =>
        (await flowRegistry()).getFlow(flowId),
      getTaskFlowStats: async () => (await flowRegistry()).getStats(),

      // ---- PDCA（P3-b）----
      listPdcaDecisionRows: async (limit: number) => {
        const { SqliteTaskStore } =
          await import('@modules/tasks/db/SqliteTaskStore');
        // ⚠️ 与改动前逐字一致：**不 init、不 close**（原调用点即如此；方法内部自 ensureDb）
        const store = new SqliteTaskStore();
        return store.listAuditLogByEvent('pdca_decision', limit);
      },
      readPdcaCheckpoint: async (taskId: string) =>
        (await pdcaBridge()).readPdcaCheckpoint(taskId),
      writePdcaCheckpoint: async (
        taskId: string,
        patch: Record<string, unknown>
      ) => {
        (await pdcaBridge()).writePdcaCheckpoint(taskId, patch);
      },
      syncPdcaWorkItemStatus: async (taskId: string, phase: string) => {
        // phase 原实参为字符串字面量（无端口侧静态类型可依）⇒ 边界收窄
        (await pdcaBridge()).syncPdcaWorkItemStatus(taskId, phase as never);
      },
      getPdcaCheckpointIndex: async () =>
        (await pdcaBridge()).getPdcaCheckpointIndex(),
      getPdcaStatusSets: async () => {
        const b = await pdcaBridge();
        return {
          terminal: b.PDCA_TERMINAL_STATUSES,
          active: b.PDCA_ACTIVE_STATUSES,
          awaitingApprovalPhases: b.PDCA_AWAITING_APPROVAL_PHASES,
        };
      },
      getPdcaOrchestrator: async (taskId: string) =>
        (await tasksModule()).getOrchestrator(taskId) ?? null,
      getOrCreatePdcaOrchestrator: async (taskId: string) =>
        (await tasksModule()).getOrCreateOrchestrator(taskId),
      listPdcaOrchestrators: async () =>
        (await tasksModule()).getAllOrchestrators(),

      // ---- 自唤醒 / pitfall / PDCA 直播 / 目标（P4）----
      listPendingWakes: async (sessionId: string) => {
        const svc = await selfWakeService();
        // 与改动前 `if (!selfWake) return undefined` 等价：未启动 ⇒ null（调用方省略该字段）
        if (!svc) return null;
        return svc.getPendingBySession(sessionId);
      },
      recordPitfall: async (input: {
        description: string;
        error: string;
        source: 'verifier';
        contextSig?: string | undefined;
      }) => {
        (
          await import('@modules/tasks/pitfalls/PitfallRegistry')
        ).pitfallRegistry.record(input);
      },
      emitPdcaLiveEvent: async (
        type: 'pdca:stage:phase' | 'pdca:stage:complete' | 'pdca:stage:fail',
        core: { sessionId?: string | undefined; taskId?: string | undefined },
        data: Record<string, unknown>
      ) => {
        const { emitPdcaLiveEvent } =
          await import('@modules/tasks/PdcaLiveEvents');
        // data 为 handler 侧拼装的松散字面量（无端口侧静态类型可依）⇒ 边界收窄
        await emitPdcaLiveEvent(type, core, data as never);
      },
      getTaskGoal: async (id: string) =>
        (await goalModule()).getTaskGoalStore().get(id),
      createTaskGoal: async (params: {
        objective: string;
        sessionId?: string | undefined;
        tokenBudget?: number | undefined;
        id?: string | undefined;
      }) => (await goalModule()).getTaskGoalStore().create(params),
      listActiveTaskGoals: async (sessionId?: string | undefined) =>
        (await goalModule()).getTaskGoalStore().listActive(sessionId),
      listTaskGoalsBySession: async (sessionId: string) =>
        (await goalModule()).getTaskGoalStore().listBySession(sessionId),
      updateTaskGoalFields: async (
        id: string,
        changes: {
          objective?: string | undefined;
          tokenBudget?: number | undefined;
        },
        reason?: string | undefined
      ) =>
        // reason 原为原因码联合（无端口侧静态类型可依）⇒ 边界收窄
        (await goalModule())
          .getTaskGoalStore()
          .updateFields(id, changes, reason as never),
      isTerminalGoalStatus: async (status) =>
        (await goalModule()).isTerminalGoalStatus(status),
      emitGoalCreated: async (params: {
        goalId: string;
        objective: string;
        sessionId?: string | undefined;
        tokenBudget?: number | undefined;
      }) => {
        await (await goalEvents()).emitGoalCreated(params);
      },
      emitGoalUpdated: async (params: {
        sessionId?: string | undefined;
        goalId: string;
        changes: {
          objective?: string | undefined;
          tokenBudget?: number | undefined;
          runId?: string | undefined;
        };
        reason: string;
      }) => {
        // reason 原为原因码联合（无端口侧静态类型可依）⇒ 边界收窄
        await (
          await goalEvents()
        ).emitGoalUpdated({
          ...params,
          reason: params.reason as never,
        });
      },
    };
  }

  // ---- AI 运维 P1（HTTP 等 service 侧消费；见 CoreAPI 声明处沿革 D-106）----

  async getAiOpsPort(): Promise<AiOpsPort> {
    /** `@modules/ai` barrel 取用（P1） */
    const aiModule = async () => import('@modules/ai');
    /** llama 本地模型管理模块取用（P4） */
    const llamaModule = async () =>
      import('@modules/ai/local/llama/LlamaCppServerManager.js');
    /** P5（D-214）：PromptAssembler 的**同步**能力需在构造期解析模块（方法内不可 await） */
    const ai = await aiModule();

    return {
      // ⚠️ 必须是**真对象**（原调用点将其原样透传给知识库编译端口）⇒ 不包装成替身
      getAiServiceHandle: async () => (await aiModule()).aiService,
      getDefaultAiModel: async () =>
        (await aiModule()).aiService.getDefaultModel(),
      initGlobalEmbedding: async () => {
        await (await aiModule()).globalEmbeddingManager.initialize();
      },
      embedOneText: async (query: string) =>
        (await aiModule()).globalEmbeddingManager.embedOne(query),
      createAiService: async (opts: { defaultModel: string; apiKey: string }) =>
        (await aiModule()).createAIService({
          defaultModel: opts.defaultModel,
          apiKey: opts.apiKey,
        }),
      resolveRoleModel: async (role: 'generator' | 'verifier') =>
        (await aiModule()).modelRouter.resolveRole(role),

      // ---- 系统提示词组装（P5；2026-10-01 D-214，`services -> ai` 倒挂收口）----
      // ⚠️ 这 4 个是**同步**方法（原调用点位于同步函数内）⇒ 先在端口构造期解析模块，方法内**不再 await**。
      estimateTokensOf: (text: string) => ai.estimateTokens(text),
      getCurrentModelId: () => ai.modelManager.getCurrentModel(),
      resolveProviderIdByModel: (model: string) => {
        const resolved = ai.providerRegistry.getByModel(model);
        return resolved ? { id: resolved.id } : null;
      },
      // 端口 DTO 的 `modelGuidanceMode` 收宽为 string ⇒ 边界处收窄（同 D-154/D-202 先例）
      buildSystemPromptText: (base: string, ctx: SystemPromptContextDto) =>
        ai.buildSystemPrompt(base, ctx as never),

      // ---- 用量统计 / 计费（P2）----
      initUsageStats: async () => {
        await (await aiModule()).usageStatsService.initialize();
      },
      getLatencyStats: async () =>
        (await aiModule()).usageStatsService.getLatencyStats(),
      initModelPricing: async () => {
        await (await aiModule()).modelPricingService.initialize();
      },
      getAllModelPricing: async () =>
        (await aiModule()).modelPricingService.getAllPricing(),
      initProviders: async () => {
        await (await aiModule()).providerManager.initialize();
      },
      listProviders: async () =>
        (await aiModule()).providerManager.listProviders(),

      // ---- 模型类型推导 / 路由接管 / 翻译（P3）----
      listActiveModels: async () =>
        (await aiModule()).activeModelService.getActiveModels(),
      deriveModelTypeOf: async (capabilities: readonly string[]) =>
        (await aiModule()).deriveModelType(capabilities),
      tryHandleAiModelRoute: async (
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => {
        const { tryHandleRoute } = await import('@modules/ai');
        return tryHandleRoute(req, res);
      },
      translateText: async (request: {
        text: string;
        sourceLang: string;
        targetLang: string;
        model?: string | undefined;
      }) => {
        // sourceLang/targetLang 原为语言码联合（无端口侧静态类型可依）⇒ 边界收窄
        return (await aiModule()).translationService.translate(
          request as never
        );
      },

      // ---- llama.cpp 本地模型（P4）----
      getLlamaManager: async () => {
        const mgr = (await llamaModule()).llamaCppServerManager;
        // ⚠️ 句柄方法**保持 app 侧同步/异步形态**（getConfig/getLogContent/subscribeLogs 原为同步）
        return {
          getStatus: () => mgr.getStatus(),
          getConfig: () => mgr.getConfig(),
          updateConfig: async (patch: Record<string, unknown>) =>
            // patch 源自 JSON.parse（逐字段收窄）+ 字面量 ⇒ 边界收窄
            mgr.updateConfig(patch as never),
          restart: () => mgr.restart(),
          forceKill: () => mgr.forceKill(),
          forceKillAndRestart: () => mgr.forceKillAndRestart(),
          getLogContent: (maxLines: number) => mgr.getLogContent(maxLines),
          subscribeLogs: (onLog: (chunk: string) => void) =>
            mgr.subscribeLogs(onLog),
          migrateModels: async (opts: {
            targetDir: string;
            copy: boolean;
            overwrite: boolean;
            onProgress: (progress: unknown) => void;
            signal: AbortSignal;
          }) =>
            mgr.migrateModels({
              targetDir: opts.targetDir,
              copy: opts.copy,
              overwrite: opts.overwrite,
              onProgress: opts.onProgress,
              signal: opts.signal,
            }),
        };
      },
      ensureSafeLlamaMigrationPath: async (
        targetDir: string,
        sourceDir: string
      ) => (await llamaModule()).ensureSafeMigrationPath(targetDir, sourceDir),
      ensureLlamaProviderRegistered: async () =>
        (
          await import('@modules/ai/local/llama/registerLlamaCppProvider.js')
        ).ensureLlamaCppProviderRegistered(),
      detectLlamaHardware: async (forceRefresh: boolean) => {
        const { HardwareDetector } =
          await import('@modules/ai/local/llama/HardwareDetector.js');
        return new HardwareDetector().detect({ forceRefresh });
      },
      recommendLlamaModels: async () => {
        const { HardwareDetector } =
          await import('@modules/ai/local/llama/HardwareDetector.js');
        const { ModelRecommender } =
          await import('@modules/ai/local/llama/ModelRecommender.js');
        // 原调用点：同一 HardwareDetector 实例**既产硬件又作 recommend 实参** ⇒ 编排内聚于此
        const detector = new HardwareDetector();
        const hardware = await detector.detect();
        return new ModelRecommender().recommend(hardware, detector);
      },
      downloadLlamaModel: async (
        model: Record<string, unknown>,
        opts: {
          autoStart?: boolean | undefined;
          onProgress: (p: LlamaDownloadProgressDto) => void;
        }
      ) => {
        const { ModelDownloadService } =
          await import('@modules/ai/local/llama/ModelDownloadService.js');
        // model 源自 JSON.parse（逐字段收窄）⇒ 边界收窄；
        // 返回值以 `Record` 暴露（调用方需**展开** ⇒ app 的 interface 无隐式索引签名，故此处收窄）
        return new ModelDownloadService().downloadAndConfigure(model as never, {
          autoStart: opts.autoStart,
          onProgress: opts.onProgress,
        }) as never;
      },
    };
  }

  // ---- 查询日志 / Buddy / 命令（零散单点收尾；见 CoreAPI 声明处沿革 D-111）----

  async getQueryOpsPort(): Promise<QueryOpsPort> {
    /** `@modules/query` barrel 取用 */
    const queryModule = async () => import('@modules/query');

    return {
      getToolStats: async () =>
        (await queryModule()).getQueryLogStore().getToolStats(),
      getErrorStats: async () =>
        (await queryModule()).getQueryLogStore().getErrorStats(),

      // ---- `query` 域静态面（2026-09-30 台账 D-117；A7 2026-10-01 改经装配点）----
      runCompetitiveOrchestration: async (
        description: string,
        signal: AbortSignal,
        config: ResearchOrchestrationConfigDto
      ) => {
        const { runResearchOrchestration } = await queryModule();
        // A7：构造收敛到 app 侧唯一装配点（本端口只做跨层转调，不再自建实例 ⇒
        // 原 `new + as never` 收窄随之删除，配置由类型化 DTO 在边界上守住）
        return runResearchOrchestration(description, signal, config);
      },
    };
  }

  async getBuddyOpsPort(): Promise<BuddyOpsPort> {
    /** `@modules/buddy` barrel 与子模块取用 */
    const buddyModule = async () => import('@modules/buddy');
    const dreamLogStore = async () => import('@modules/buddy/dreamLogStore');

    return {
      getBuddyCompanion: async () => (await buddyModule()).getCompanion(),
      executeBuddyInteraction: async (companion: unknown, action: string) => {
        const { InteractionManager } = await buddyModule();
        const manager = new InteractionManager();
        // companion 为 getBuddyCompanion 回传的**真对象** ⇒ 边界收窄；
        // action 原为字面量联合（原码直接透传）⇒ 边界收窄；
        // 返回值以 Record 暴露（调用方需展开/JSON）⇒ 同上（app interface 无隐式索引签名）
        return (await manager.execute(
          companion as never,
          action as never
        )) as never;
      },
      // 下列 4 处同样以 Record 暴露（调用方展开 / 仅 JSON）⇒ 边界收窄
      getBuddyDreamStats: async () =>
        (await dreamLogStore()).getDreamStats() as never,
      getBuddyDreamLogs: async (limit: number, offset?: number | undefined) =>
        (await dreamLogStore()).getDreamLogs(limit, offset) as never,
      getBuddyDreamLogsByType: async (
        type: string,
        limit: number,
        offset?: number | undefined
      ) =>
        // type 原为字面量联合（原码 `as any`）⇒ 边界收窄
        (await dreamLogStore()).getDreamLogsByType(
          type as never,
          limit,
          offset
        ) as never,
      loadBuddyGrowthState: async () =>
        (
          await import('@modules/buddy/growthPersistence')
        ).loadGrowthState() as never,
    };
  }

  async getCommandsOpsPort(): Promise<CommandsOpsPort> {
    return {
      listCommands: async () => {
        const { getCommandManager } = await import('@modules/commands');
        return getCommandManager().getAllCommands();
      },
      executeCommand: async (command: string) => {
        const { commandExecutor } =
          await import('@modules/commands/executor/CommandExecutor.js');
        return commandExecutor.execute(command);
      },
    };
  }

  async getWorkspaceOpsPort(): Promise<WorkspaceOpsPort> {
    /** `@modules/core/paths` 取用（原调用点由 handler 自行 `resolveDataDir()`） */
    const paths = async () => import('@modules/core/paths');

    return {
      listProjectItemArtifacts: async (projectId: string) => {
        const { ProjectItemStore } =
          await import('@modules/workspace/ProjectItemStore');
        const { resolveDataDir } = await paths();
        const store = new ProjectItemStore(projectId, resolveDataDir());
        try {
          await store.initialize();
          return await store.list('artifact');
        } finally {
          // 原调用点在 finally 中 `close()` ⇒ 内聚于此（逐字保持"始终关闭"语义）
          await store.close().catch(() => {});
        }
      },
      getProjectStore: async () => {
        const { createProjectStore } =
          await import('@modules/workspace/ProjectStore');
        const { WorkItemStore } =
          await import('@modules/workspace/WorkItemStore');
        const { resolveDataDir } = await paths();
        const store = createProjectStore(
          resolveDataDir(),
          new WorkItemStore(resolveDataDir())
        );
        // 句柄：`get` 在 app 侧为**同步** ⇒ 保持同步（规则 37）
        // P4 追加 `list` / `create` / `update` / `delete`（`project-handlers` 需要）
        return {
          get: (projectId: string) => store.get(projectId),
          list: (workspaceId: string) => store.list(workspaceId),
          create: (data: Record<string, unknown>) =>
            store.create(data as never),
          update: (projectId: string, updates: Record<string, unknown>) =>
            store.update(projectId, updates as never),
          delete: (projectId: string) => store.delete(projectId),
        };
      },

      // ---- P4（2 文件；2026-09-30 台账 D-116）----
      getProjectItemStore: async (
        projectId: string
      ): Promise<ProjectItemStorePort> => {
        const { ProjectItemStore } =
          await import('@modules/workspace/ProjectItemStore');
        const { resolveDataDir } = await paths();
        const store = new ProjectItemStore(projectId, resolveDataDir());
        // 句柄方法保持 app 侧**异步**形态（走 SQLite）
        return {
          initialize: () => store.initialize(),
          close: () => store.close(),
          needsMigration: () => store.needsMigration(),
          migrateFromLegacy: () => store.migrateFromLegacy(),
          list: (kind) => store.list(kind),
          upsert: (item) => store.upsert(item),
          delete: (id: string) => store.delete(id),
        };
      },

      // ---- P1（5 文件 / 5 处；2026-09-30 台账 D-113）----
      analyzeBottlenecks: async (steps: unknown) => {
        const { bottleneckAnalyzer } =
          await import('@modules/workspace/BottleneckAnalyzer');
        return bottleneckAnalyzer.analyze(steps as never);
      },
      getAgentRoleStore: async (): Promise<AgentRoleStorePort> => {
        const { getAgentRoleStore } =
          await import('@modules/workspace/AgentRoleStore');
        const store = getAgentRoleStore();
        return {
          listAll: () => store.listAll(),
          getByAgentId: (agentId: string) => store.getByAgentId(agentId),
          insert: (data: Record<string, unknown>) =>
            store.insert(data as never),
          update: async (id: string, data: Record<string, unknown>) => {
            await store.update(id, data as never);
          },
          delete: async (id: string) => {
            await store.delete(id);
          },
        };
      },
      getTeamStore: async (teamsDir: string): Promise<TeamStorePort> => {
        const { createTeamStore } =
          await import('@modules/workspace/TeamStore');
        const store = createTeamStore(teamsDir);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          list: (workspaceId: string) => store.list(workspaceId),
          create: (data: Record<string, unknown>) =>
            store.create(data as never),
          get: (teamId: string) => store.get(teamId),
          update: (teamId: string, data: Record<string, unknown>) =>
            store.update(teamId, data as never),
          delete: (teamId: string) => store.delete(teamId),
          addMember: (teamId: string, data: Record<string, unknown>) =>
            store.addMember(teamId, data as never),
          removeMember: (teamId: string, memberId: string) =>
            store.removeMember(teamId, memberId),
          updateMemberRole: (teamId: string, memberId: string, role: unknown) =>
            store.updateMemberRole(teamId, memberId, role as never),
        };
      },
      getOrchIntelligence: async (): Promise<OrchIntelligencePort> => {
        const {
          changeImpactAnalyzer,
          riskDetector,
          decisionClassifier,
          escalationManager,
          resourceScheduler,
        } = await import('@modules/workspace/OrchIntelligence');
        // 5 个单例**原样暴露**（句柄方法保持同步形态，规则 37）
        return {
          changeImpactAnalyzer: {
            analyze: (changedFiles: unknown, changedContent: string) =>
              changeImpactAnalyzer.analyze(
                changedFiles as never,
                changedContent
              ),
          },
          riskDetector: {
            detect: (
              title: string,
              description: string,
              changedFiles: unknown
            ) => riskDetector.detect(title, description, changedFiles as never),
            getRiskSummary: (risks: unknown) =>
              riskDetector.getRiskSummary(risks as never),
          },
          decisionClassifier: {
            classify: (
              title: string,
              description: string,
              impactResult: unknown,
              risks: unknown
            ) =>
              decisionClassifier.classify(
                title,
                description,
                impactResult as never,
                risks as never
              ),
          },
          escalationManager: {
            recordEscalation: (
              workItemId: string,
              type: string,
              description: string,
              suggestedDirection: string
            ) =>
              escalationManager.recordEscalation(
                workItemId,
                type as never,
                description,
                suggestedDirection
              ),
            shouldEscalate: (workItemId: string, type: string) =>
              escalationManager.shouldEscalate(workItemId, type as never),
            getEscalationAdvice: (workItemId: string) =>
              escalationManager.getEscalationAdvice(workItemId),
            getActiveEscalations: () =>
              escalationManager.getActiveEscalations(),
          },
          resourceScheduler: {
            requestResource: (
              workItemId: string,
              resources: unknown,
              priority: number
            ) =>
              resourceScheduler.requestResource(
                workItemId,
                resources as never,
                priority
              ),
            getResourceStatus: () => resourceScheduler.getResourceStatus(),
          },
        };
      },

      // ---- P2（6 文件 / 11 处；2026-09-30 台账 D-114）/ P3 扩展（台账 D-115）----
      getWorkspaceContext: async (
        wsPath: string
      ): Promise<WorkspaceContextPort> => {
        const { createLiriConfigManager } =
          await import('@modules/workspace/LiriConfigManager');
        const { createWorkItemStore } =
          await import('@modules/workspace/WorkItemStore');
        const { createChangeSetStore } =
          await import('@modules/workspace/ChangeSetStore');
        const { createProjectStore } =
          await import('@modules/workspace/ProjectStore');
        // ⚠️ 保留原调用点的**同一实例**耦合（manager → workItemStore → projectStore）
        const manager = createLiriConfigManager(wsPath);
        const workItemStore = createWorkItemStore(manager.dir, manager);
        const changeSetStore = createChangeSetStore(manager.dir);
        const projectStore = createProjectStore(manager.dir, workItemStore);
        return {
          dir: manager.dir,
          loadConfig: () => manager.loadConfig() as never,
          updateConfig: (partial: Record<string, unknown>) =>
            manager.updateConfig(partial as never),
          init: () => manager.init(),
          detect: () => manager.detect(),
          getSummary: () => manager.getSummary(),
          loadRules: () => manager.loadRules(),
          saveRules: (content: string) => manager.saveRules(content),
          getWorkItemStore: () => ({
            get: (id: string) => workItemStore.get(id) as never,
            list: (workspaceId: string) =>
              workItemStore.list(workspaceId) as never,
            create: (data: Record<string, unknown>) =>
              workItemStore.create(data as never) as never,
            update: (id: string, data: Record<string, unknown>) =>
              workItemStore.update(id, data as never) as never,
          }),
          getChangeSetStore: () => ({
            listByWorkItem: (workItemId: string) =>
              changeSetStore.listByWorkItem(workItemId),
            create: (params: Record<string, unknown>) =>
              changeSetStore.create(params as never),
            get: (id: string) => changeSetStore.get(id),
            recordFileChange: (
              changesetId: string,
              path: string,
              change: string,
              additions?: number,
              deletions?: number
            ) =>
              changeSetStore.recordFileChange(
                changesetId,
                path,
                change as never,
                additions,
                deletions
              ),
            updateStatus: (id: string, status: string) =>
              changeSetStore.updateStatus(id, status as never),
            getSummary: (changesetId: string) =>
              changeSetStore.getSummary(changesetId),
          }),
          getProjectStore: () => ({
            list: (workspaceId: string) => projectStore.list(workspaceId),
            create: (params: Record<string, unknown>) =>
              projectStore.create(params as never),
            get: (projectId: string) => projectStore.get(projectId),
            update: (projectId: string, updates: Record<string, unknown>) =>
              projectStore.update(projectId, updates as never),
            delete: (projectId: string) => projectStore.delete(projectId),
            buildBoard: (projectId: string) =>
              projectStore.buildBoard(projectId),
            getRules: (projectId: string) => projectStore.getRules(projectId),
            saveRules: (projectId: string, content: string) =>
              projectStore.saveRules(projectId, content),
            getTemplates: () => projectStore.getTemplates(),
            createWorkItemFromTemplate: (
              projectId: string,
              params: Record<string, unknown>
            ) =>
              projectStore.createWorkItemFromTemplate(
                projectId,
                params as never
              ),
          }),
        };
      },
      getCouncilEngine: async (): Promise<CouncilEnginePort> => {
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const engine = getCouncilEngine();
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          createSession: (
            workspaceId: string,
            topic: string,
            context: unknown,
            agents: unknown,
            options: { maxRounds: number }
          ) =>
            engine.createSession(
              workspaceId,
              topic,
              context as never,
              agents as never,
              options
            ) as never,
          getSession: (sessionId: string) =>
            engine.getSession(sessionId) as never,
          getActiveSessionsByWorkspace: (workspaceId: string) =>
            engine.getActiveSessionsByWorkspace(workspaceId),
        };
      },
      setCouncilEmitter: async (
        cb: (event: { sessionId: string }) => void
      ): Promise<void> => {
        const { setCouncilEmitter } =
          await import('@modules/workspace/CouncilEngine');
        setCouncilEmitter(cb as never);
      },
      runCouncilDebate: async (sessionId: string): Promise<void> => {
        const { CouncilOrchestrator } =
          await import('@modules/workspace/CouncilOrchestrator');
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const orchestrator = new CouncilOrchestrator(getCouncilEngine());
        await orchestrator.runDebate(sessionId);
      },
      emitCouncilEvent: async (event: unknown): Promise<void> => {
        const { getCouncilEngine } =
          await import('@modules/workspace/CouncilEngine');
        const engine = getCouncilEngine() as unknown as {
          emit?: (e: unknown) => void;
        };
        // 保留原 `typeof emit === 'function'` 守卫（`emit` 非公开声明方法）
        engine.emit?.(event);
      },
      getRuleEngine: async (
        workspacePath?: string
      ): Promise<RuleEnginePort> => {
        const { getRuleEngine } = await import('@modules/workspace/RuleEngine');
        const engine = getRuleEngine(workspacePath);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          listRules: () => engine.listRules(),
          readRule: (specialization) => engine.readRule(specialization),
          writeRule: (specialization, content) =>
            engine.writeRule(specialization, content),
          appendRule: (specialization, content) =>
            engine.appendRule(specialization, content),
          loadRulesForWorkItem: (title, description, changedFiles) =>
            engine.loadRulesForWorkItem(title, description, changedFiles),
          getRulesOverview: () => engine.getRulesOverview(),
        };
      },

      // ---- P3（1 文件 / 6 能力面；2026-09-30 台账 D-115）----
      detectLiriDir: async (
        startPath: string
      ): Promise<LiriDetectionResultDto> => {
        const { detectLiriDir } =
          await import('@modules/workspace/LiriConfigManager');
        return detectLiriDir(startPath);
      },
      getTaskStore: async (): Promise<TaskStorePort> => {
        const { taskStore } = await import('@modules/workspace/TaskStore');
        // 句柄方法保持 app 侧**异步**形态（`TaskStore` 走 SQLite）
        return {
          initialize: () => taskStore.initialize(),
          listByWorkspace: (workspaceId: string) =>
            taskStore.listByWorkspace(workspaceId),
          listByProject: (projectId: string) =>
            taskStore.listByProject(projectId),
          listByStatus: (workspaceId: string, status) =>
            taskStore.listByStatus(workspaceId, status),
          get: (id: string) => taskStore.get(id),
          save: (node) => taskStore.save(node),
          update: (id: string, updates: Record<string, unknown>) =>
            taskStore.update(id, updates as never),
          delete: (id: string) => taskStore.delete(id),
          listChildren: (parentId: string) => taskStore.listChildren(parentId),
        };
      },
    };
  }

  async getSkillsOpsPort(): Promise<SkillsOpsPort> {
    return {
      reloadUserSkills: async () => {
        // 2026-09-30（D-126，`R00-003` P6-b/G6-a）：实现自 `constants` 迁入 `skills`（app）
        const { reloadUserSkills } =
          await import('@modules/skills/BuiltinSkillBootstrap');
        await reloadUserSkills();
      },
    };
  }

  async getProjectOpsPort(): Promise<ProjectOpsPort> {
    return {
      getProjectHistory: async (
        projectId: string,
        since?: string | undefined
      ) => {
        // ⚠️ `project` 域**无 `@modules/project` 别名** ⇒ 用 **2 段相对路径**（同时规避 R03-002）
        const { createProjectHistoryStore } =
          await import('../../project/ProjectHistoryStore');
        return createProjectHistoryStore(projectId).getGrouped(since);
      },

      // ---- `project` 域静态面（2026-09-30 台账 D-117）----
      getProjectArtifactStore: async (
        storeDir: string
      ): Promise<ProjectArtifactStorePort> => {
        // ⚠️ `project` 域**无 `@modules/project` 别名** ⇒ 用 **2 段相对路径**（同时规避 R03-002）
        const { ProjectArtifactStore } =
          await import('../../project/ProjectArtifactStore');
        const store = new ProjectArtifactStore(storeDir);
        // 句柄方法保持 app 侧**同步**形态（规则 37）
        return {
          list: (projectId: string, kind?: ArtifactKindDto) =>
            store.list(projectId, kind),
          save: (artifact: ProjectArtifactDto) => store.save(artifact),
          delete: (projectId: string, artifactId: string) =>
            store.delete(projectId, artifactId),
        };
      },
      parseProjectRulesFile: async (rulesPath: string) => {
        const { ProjectContextService } =
          await import('../../project/ProjectContextService');
        return ProjectContextService.parseRulesFile(rulesPath);
      },
      persistImplicitEngine: async (
        projectId: string,
        text: string,
        projectsDir: string
      ) => {
        const { ImplicitEngineHook } =
          await import('../../project/ImplicitEngineHook');
        return ImplicitEngineHook.persist(projectId, text, projectsDir);
      },
      migrateLegacyFiles: async () => {
        const { migrateLegacyFiles } =
          await import('../../project/MigrationService');
        return migrateLegacyFiles();
      },
      migrateWorktrees: async (
        worktrees: Array<Record<string, unknown>>,
        workspaceId?: string
      ) => {
        const { migrateWorktrees } =
          await import('../../project/MigrationService');
        return migrateWorktrees(worktrees as never, workspaceId);
      },
    };
  }
}
