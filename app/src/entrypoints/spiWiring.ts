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
 * SPI 装配（**推送模型**）—— 2026-09-30 台账 D-128（`R00-003` ② 改造）
 *
 * **为什么放在 `entrypoints/`**：原各 SPI 文件（`core/spi/*`）在自身内部**动态导入**实现方
 * （`ai` / `services` / `channels` …）⇒ 每个文件各产生 **1 个 `core -> app|service` 动态跨层对**
 * （`R00-003` 的 ② 家族）。改为**推送模型**：**实现体在本文件构建 → 主动注册进 core 端口**。
 * 本文件位于 **entry** 层（可依赖任意层）⇒ **零新增跨层对**，且 SPI 文件不再反向导入。
 *
 * **时机**：由 `DIContainer.bootstrap()` 在**原注册点**调用（经 `BootstrapOptions.registerSpis`
 * 回调注入）⇒ **注册顺序与时机逐字不变**；实现体内部的动态导入保持**惰性**。
 *
 * **未注册时**：各端口回退 noop / 空值（消费方均有降级路径）—— 与改造前一致。
 */

/** DI 容器的最小结构（避免与本模块无谓耦合） */
export interface SpiRegistrationContainer {
  registerDescriptor: <T>(desc: {
    id: string;
    factory: () => T;
    scope: 'singleton' | 'transient' | 'request';
  }) => void;
}

/**
 * 装配全部 SPI 实现（推送模型）
 *
 * ⚠️ 顺序敏感：`AiAccess` 先于 `Knowledge`（后者经 `resolveAiAccess()` 取 `aiService`）。
 *
 * 2026-10-08（架构治理 P1 · D3 订正）：**全部 15 个可注册端口均在本文件注册** ——
 * 含 Logger / OTel / Profiler 三件套、Broadcast、PluginSystem、Knowledge。
 * 原文「其余（…）仍在 `DIContainer` 内注册」为**迁移期描述，已失实**（`DIContainer` 侧
 * 无任何 `register*Spi` 调用，全仓仅本文件装配）。本文件即 SPI 的**唯一注入点**
 * （由 `main.ts` 经 `BootstrapOptions.registerSpis` 调用）。
 */
export async function registerAllSpis(
  container: SpiRegistrationContainer
): Promise<void> {
  // ---- Logger SPI（三件套；2026-09-30 D-129 转推送模型）----
  {
    const { getLogger, setGlobalConfigProvider } =
      await import('@modules/monitoring/logs/Logger');
    const { registerLoggerSpi } = await import('@modules/core/spi');
    await registerLoggerSpi(container, {
      getLogger: (module) => getLogger(module),
      setGlobalConfigProvider: (provider) => setGlobalConfigProvider(provider),
    });
  }

  // ---- OTel Tracing SPI（三件套）----
  {
    const { getOTelTracing } =
      await import('@modules/monitoring/otel/OTelTracing');
    const { isSpanCovered, markSpanCovered } =
      await import('@modules/monitoring/tracing/SpanCoverageRegistry');
    const { registerOTelSpi } = await import('@modules/core/spi');
    await registerOTelSpi(container, {
      getTracing: () => {
        const tracing = getOTelTracing();
        return {
          getActiveSpan: () => tracing.getActiveSpan(),
          recordError: (span, error) => tracing.recordError(span, error),
          isSpanCovered: (parentSpan, name) => isSpanCovered(parentSpan, name),
          markSpanCovered: (parentSpan, name) =>
            markSpanCovered(parentSpan, name),
          startSpan: (name, attributes, parentSpan) =>
            tracing.startSpan(name, attributes, parentSpan),
          endSpan: (span, status, message) =>
            tracing.endSpan(span, status, message),
        };
      },
    });
  }

  // ---- 启动剖析 SPI（三件套）----
  {
    const { profileCheckpoint, profilePhaseStart, profilePhaseEnd } =
      await import('@modules/performance/StartupProfiler');
    const { registerStartupProfilerSpi } = await import('@modules/core/spi');
    await registerStartupProfilerSpi(container, {
      profileCheckpoint: (name) => profileCheckpoint(name),
      profilePhaseStart: (phase) => profilePhaseStart(phase),
      profilePhaseEnd: (phase) => profilePhaseEnd(phase),
    });
  }

  // ---- SSE 广播 SPI（2026-09-30 D-121；D-129 转推送模型）----
  {
    const { broadcastEvent } =
      await import('@modules/infrastructure/http/LocalHTTPServiceSSE');
    const { registerBroadcastSpi } = await import('@modules/core/spi');
    await registerBroadcastSpi(container, {
      broadcast: (event, payload) => broadcastEvent(event, payload),
    });
  }

  // ---- Agent 执行端口 SPI（2026-10-01 D-144）----
  // core/Coordinator 原直接 import `@modules/tools`（core → app 倒挂 BULK-012）；
  // 现改为经 `IAgentToolPort` 解析，实现在此注册（组合根，沿用注册表共享实例语义）。
  {
    const { resolveAgentToolInstance } = await import('@modules/tools');
    const { registerAgentToolSpi } = await import('@modules/core/spi');
    const agentTool = resolveAgentToolInstance();
    if (agentTool) {
      await registerAgentToolSpi(container, agentTool);
    }
    // else：工具管理器尚未就绪 ⇒ 本时点无法注册。**不静默降级**（CS03）——
    // `resolveAgentTool()` 在未注册时**调用即抛错**，错误不会被"任务永不执行"掩盖。
  }

  // ---- 插件系统 SPI（2026-09-30 D-122；D-129 转推送模型）----
  {
    const { pluginSystem } = await import('@modules/plugins');
    const { registerPluginSystemSpi } = await import('@modules/core/spi');
    await registerPluginSystemSpi(container, {
      getLoadedPlugins: () => pluginSystem.getLoader().getAllPlugins(),
    });
  }

  // ---- AI 能力访问 SPI（2026-09-30 D-124；D-128 转推送模型）----
  {
    const {
      aiService,
      providerRegistry,
      modelRouter,
      // 2026-10-01 D-146（`infra -> app` 收口批次 1）：memory / chronos 所需能力
      trackUsage,
      globalEmbeddingManager,
      ToolAwareClient,
      credentialStore,
      // 2026-10-01 D-155（`cost -> ai` 倒挂收口）：cost 所需模型定价投影的数据源
      ModelRegistry,
      getModelConfigById,
    } = await import('@modules/ai');
    const { BalanceStore } =
      await import('@modules/ai/providers/BalanceStore.js');
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    const { checkBalance } =
      await import('@modules/ai/providers/BalanceChecker.js');
    const { registerAiAccessSpi } = await import('@modules/core/spi');

    await registerAiAccessSpi(container, {
      getAiService: () => aiService,
      listActiveProviders: async () => {
        await providerManager.initialize();
        const providers = await providerManager.listProviders();
        return providers
          .filter((p) => p.isActive)
          .map((p) => ({
            id: p.id,
            name: p.name,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
          }));
      },
      refreshProviderBalance: async (
        providerId,
        baseUrl,
        apiKey,
        threshold
      ) => {
        const store = BalanceStore.getInstance();
        await store.initialize();

        const result = await checkBalance(baseUrl, apiKey);
        if (!result.success || result.data.length === 0) return null;

        const d = result.data[0];
        const remaining = d.remaining ?? null;
        const belowThreshold = remaining !== null && remaining < threshold;

        await store.setBalance(providerId, {
          remaining,
          total: d.total ?? null,
          used: d.used ?? null,
          unit: d.unit || 'CNY',
          isSupported: true,
          belowThreshold,
        });

        return {
          remaining,
          total: d.total ?? null,
          used: d.used ?? null,
          unit: d.unit || 'CNY',
        };
      },
      chatWithRole: async (role, messages, options) => {
        // 显式通过模型路由解析（DB 唯一事实来源）并匹配对应 provider，
        // 避免 model: undefined 回退默认 provider 的不可控默认模型（曾导致 Kimi-K2.6 400）
        const model = await modelRouter.resolveAsync(role as never);
        const provider =
          (model && providerRegistry.getByModel(model)) ||
          providerRegistry.getDefaultProvider();
        if (!provider) return null;

        const opts = options as Record<string, unknown>;
        const response = await provider.chat(
          messages as never,
          {
            ...opts,
            model,
          } as never
        );

        return {
          content: typeof response.content === 'string' ? response.content : '',
          model: response.model || provider.id || 'unknown',
          providerId: provider.id,
          raw: response,
        };
      },
      // ── 2026-10-01 D-146（`infra -> app` 收口批次 1）：memory / chronos 所需能力 ──
      trackUsage: (raw, meta) => {
        trackUsage(raw as never, meta as never);
      },
      getEmbeddingManager: () => globalEmbeddingManager,
      getModelRouter: () => modelRouter,
      getProviderRegistry: () => providerRegistry,
      createToolAwareClient: (provider) =>
        new ToolAwareClient(provider as never, null, null),
      getCredentialStore: () => credentialStore,
      // ── 2026-10-01 D-155（`cost -> ai` 倒挂收口）：模型定价 + 规范名投影 ──
      // 三个数据源同属 `ai` 层（`ModelRegistry` 定价缓存 / 模型定义 / `ModelConfigs` 规范名），
      // 在此**边界处**合成 cost 所需的最小结构；注册表查无此模型时返回 `null`。
      getModelPricing: (modelName) => {
        const registry = ModelRegistry.getInstance();
        const pricing = registry.getModelPricing(modelName);
        const model = registry.getModel(modelName);
        const config = getModelConfigById(modelName);
        if (!pricing && !model && !config) return null;
        return {
          inputPer1M: pricing?.inputPer1M ?? 0,
          outputPer1M: pricing?.outputPer1M ?? 0,
          billingMode: pricing?.billingMode ?? 'token',
          pricePerRequest: pricing?.pricePerRequest ?? 0,
          timeBasedPricing: pricing?.timeBasedPricing ?? [],
          cacheReadPer1M: model?.pricing?.cacheReadPer1M ?? 0,
          cacheWritePer1M: model?.pricing?.cacheWritePer1M ?? 0,
          canonicalName: config?.firstParty ?? modelName,
        };
      },
    });
  }

  // ---- 任务注册表 SPI（2026-10-01 D-147）----
  // chronos / daemon 原直接 import `@modules/tasks`（infra → app 倒挂 BULK-007，共 9 处）；
  // 现改为经 `ITaskRegistryPort` 解析，实现在此注册（子类化 BaseTask 的细节封在实现侧）。
  {
    const { taskRegistry, BaseTask } = await import('@modules/tasks');
    const { TaskType } = await import('@modules/tasks/types');
    const { registerTaskRegistrySpi } = await import('@modules/core/spi');

    await registerTaskRegistrySpi(container, {
      registerLightweightTask: (kind, id, description) => {
        const type =
          kind === 'cron'
            ? TaskType.CRON
            : kind === 'dream'
              ? TaskType.DREAM
              : TaskType.DAEMON_PROCESS;
        // 轻量登记任务：仅用于 TaskRegistry 展示/追踪，无实际执行体
        class LightweightRegistryTask extends BaseTask {
          readonly type = type;
          async spawn(): Promise<void> {
            /* no-op */
          }
          async kill(): Promise<void> {
            /* no-op */
          }
        }
        return taskRegistry.register(
          new LightweightRegistryTask(id, description, '', type)
        );
      },
      updateState: (registryTaskId, state) => {
        // 值区间一致（`TaskStatus` 为字符串枚举）⇒ 边界处收窄即可
        taskRegistry.updateState(registryTaskId, state as never);
      },
    });
  }

  // ---- 知识图谱 SPI（2026-10-01 D-148）----
  // chronos/autoDream/DreamGraphPhase 原直接 import `@modules/knowledge/*`（infra → app 倒挂，3 处）；
  // 现改为经 `IKnowledgeGraphPort` 解析（端口只暴露"能拿到哪些对象"，业务语义留在消费方）。
  {
    const { KnowledgeGraph } =
      await import('@modules/knowledge/graph/KnowledgeGraph');
    const { SchemaLoader } =
      await import('@modules/knowledge/schema/SchemaLoader');
    const { DomainManager } =
      await import('@modules/knowledge/domain/DomainManager');
    const { registerKnowledgeGraphSpi } = await import('@modules/core/spi');

    await registerKnowledgeGraphSpi(container, {
      createGraph: (dbPath) => new KnowledgeGraph(dbPath),
      createSchemaLoader: (domain) => new SchemaLoader(undefined, domain),
      listDomains: async () => (await new DomainManager().list()) as never,
      generateEntityId: (domain, kind, slug) =>
        KnowledgeGraph.generateEntityId(domain, kind, slug),
    });
  }

  // ---- 会话在线质量 SPI（2026-10-06 U4，`.trae/specs/online-quality-evaluation.md` §D6）----
  // chronos/autoDream 需按"在线质量分"取进化素材，而 `turn/quality` 事件落在 **chat（app）
  // 层持有**的事件日志里 ⇒ 梦境直读即构成 `infra → app` 倒挂（同 D-148 的 KnowledgeGraph 动因）。
  // 实现装配在此：读事件（经 chat 的 `readSessionEvents`）+ 纯函数摘要（`evals/online`）。
  {
    const { registerSessionQualitySpi } = await import('@modules/core/spi');
    const { summarizeTurnQuality } = await import('@modules/evals');
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');

    await registerSessionQualitySpi(container, {
      getTurnQualitySummary: async (sessionId) => {
        const chat = getCoreAPI().getChatManager();
        const events = await chat.readSessionEvents(sessionId, {
          types: ['turn/quality'],
          limit: 1000,
        });
        // 无数据 ⇒ **null**（消费方跳过该路输入；不造 0 分假摘要，CS04）
        if (events.length === 0) return null;
        const s = summarizeTurnQuality(events);
        if (s.total === 0) return null;
        return {
          total: s.total,
          avgScore: s.avgScore,
          highValueTurns: s.highValueTurns,
          lowValueTurns: s.lowValueTurns,
        };
      },
    });
  }

  // ---- 协作编排统一层 · 薄端口（2026-10-07；`.trae/specs/collaboration-orchestration-port.md`）----
  // ⚠️ **预留端口**：生产中**无消费者**（消费入口未定，见 spec §5；**勿视为既有能力**）。
  // 本期只装配「**能力自述**」：三通道适配器（`agent/orchestration/` 的 SwarmChannelAdapter /
  // SchedulerChannelAdapter / RemoteChannelAdapter）的**引擎实例与 executor 是构造实参**，
  // 其提供方由**第一消费入口**决定 ⇒ 当前无提供方 ⇒ 不构造任何 adapter ⇒
  // `listChannels()` 返回 `[]`、`dispatch()` 返回 `null`（未注入依赖的通道不出现在清单）。
  // 待第一消费入口提供引擎 / executor 后，在此 `new SwarmChannelAdapter({ swarm, executor })`
  // 等并纳入通道清单。
  {
    const { registerCollaborationSpi } = await import('@modules/core/spi');
    await registerCollaborationSpi(container, {
      listChannels: async () => [],
      dispatch: async () => null,
    });
  }

  // ---- 诊断采集 SPI（2026-09-30 D-123；D-128 转推送模型）----
  {
    const { STTRegistry } =
      await import('@modules/services/voice/services/sttRegistry');
    const { TTSRegistry } =
      await import('@modules/services/voice/services/ttsProvider');
    const { channelRegistry } = await import('@modules/channels');
    const { mcpSystem } = await import('@modules/services/mcp');
    const { registerDiagnosticsProbeSpi } = await import('@modules/core/spi');

    await registerDiagnosticsProbeSpi(container, {
      getProvidersSnapshot: () => {
        let sttProviders: string[] = [];
        let ttsProviders: string[] = [];
        let channelNames: string[] = [];
        // 逐能力隔离：任一 provider 未初始化/抛错都不影响其余（原调用点即此语义）
        try {
          sttProviders = STTRegistry.getProviderIds();
        } catch {
          // @ignore-catch — provider 未注册属正常（延迟注册）
        }
        try {
          ttsProviders = TTSRegistry.getProviderNames();
        } catch {
          // @ignore-catch — 同上
        }
        try {
          channelNames = channelRegistry.getAll().map((ch) => ch.name);
        } catch {
          // @ignore-catch — 同上
        }
        return { sttProviders, ttsProviders, channelNames };
      },
      getMcpSnapshot: () => {
        const servers = mcpSystem.getServers();
        return {
          serverCount: Array.isArray(servers) ? servers.length : 0,
          toolCount: mcpSystem.getRegisteredMcpToolCount(),
        };
      },
    });
  }

  // ---- 沙箱 SPI（2026-10-01 D-154；D-157 扩展 `hasWorkspacePermission`；D-200 扩展两个）----
  // security 原直接 import `@modules/sandbox`（infra → app 倒挂 BULK），
  // 现改为经 `ISandboxPort` 解析，实现在此注册（组合根，动态导入避免静态跨层依赖）。
  // D-157：permission 侧的文件权限判定（原直连 `globalWorkspaceManager`）并入**同一端口**。
  // D-200：infrastructure 侧两个 handler（`handler-utils` / `sandbox-handlers`）的取用面并入同一端口。
  {
    const {
      SandboxManager,
      globalWorkspaceManager,
      processRegistry,
      resourceLimitManager,
    } = await import('@modules/sandbox');
    const { registerSandboxSpi } = await import('@modules/core/spi');
    const sandboxManager = SandboxManager.getInstance();

    // S1（2026-10-09）：创建默认工作区。
    // 原 `globalWorkspaceManager.create()` 全仓零调用 ⇒ `get('default')` 恒 `undefined`，
    // 端口 `hasWorkspacePermission` / `isWorkspacePermissionDenied` / `activeWorkspaceCount`
    // 恒取「工作区不存在」分支（**状态面空转**）。在此（组合根，唯一注入点）建默认工作区，
    // 使权限级别（`config.sandbox.permissionLevel` → `WorkspaceManager.getDefaultPermissions()`）
    // 真正参与判定。适配器创建**无 IO**（`LocalWorkspace` / `DockerWorkspace` 均用基类
    // `initialize()`）⇒ 启动安全；`has('default')` 守卫保证幂等。
    if (!globalWorkspaceManager.has('default')) {
      await globalWorkspaceManager.create('default', {
        workingDirectory: process.cwd(),
      });
    }

    await registerSandboxSpi(container, {
      // 端口输入为 `Record<string, unknown>`，SandboxManager 期望具名字段
      // （`{ command?: string; dangerouslyDisableSandbox?: boolean }`）⇒ 边界处收窄断言
      shouldUseSandbox: (input) =>
        sandboxManager.shouldUseSandbox(input as never),
      isSandboxingEnabled: () => sandboxManager.isSandboxingEnabled(),
      // 同上：端口为 `Record<string, unknown>`，实现侧为 `Partial<SandboxSettings>`
      updateSettings: (settings) =>
        sandboxManager.updateSettings(settings as never),
      // 默认工作区缺失 ⇒ false（fail-closed）
      hasWorkspacePermission: (permission) =>
        globalWorkspaceManager.get('default')?.hasPermission(permission) ??
        false,
      // D-200：默认工作区缺失 ⇒ false（**放行**，保持 `handler-utils` 既有行为，
      // 与上一行的 fail-closed 方向**相反**，见端口文档）
      isWorkspacePermissionDenied: (permission) => {
        const workspace = globalWorkspaceManager.get('default');
        return workspace ? !workspace.hasPermission(permission) : false;
      },
      // D-200：`GET /v1/sandbox/status` 的读取面（最小投影，子字段原样进 JSON）
      getRuntimeStatus: () => ({
        runtimeEnabled: sandboxManager.isSandboxingEnabled(),
        settings: sandboxManager.getSettings(),
        constraints: sandboxManager.getConstraints(),
        violationCount: sandboxManager.getViolations().length,
        processStats: processRegistry.getStats(),
        resourceSummary: resourceLimitManager.getSummary(),
        activeWorkspaceCount: globalWorkspaceManager.list().size,
      }),
    });
  }

  // ---- Hook 链 SPI（2026-10-01 D-155）----
  // cost 原直接 import `@modules/hooks`（infra -> app 倒挂），
  // 现改为经 `IHookChainPort` 解析，实现在此注册（组合根，动态导入避免静态跨层依赖）。
  {
    const { HookChainManager } = await import('@modules/hooks');
    const { registerHookChainSpi } = await import('@modules/core/spi');
    const hookChainManager = HookChainManager.getInstance();
    await registerHookChainSpi(container, {
      // 端口载荷 `{ event, data, sessionId }` 与 `HookContext` 值相容，边界处收窄
      // （`HookContext` 带索引签名，端口不引 app 类型）。
      // 2026-10-01 D-168：返回值投影为 `{ blocked }`（`memory` 需要 before 阻断语义，
      // 投影 `result.before` 的"失败或阻止继续"，不把 app 侧 `HookResult` 泄进 core）。
      execute: async (hookName, payload) => {
        const result = await hookChainManager.execute(
          hookName,
          payload as never
        );
        return {
          blocked: result.before.some(
            (hookResult) =>
              !hookResult.success || hookResult.preventContinuation === true
          ),
        };
      },
    });
  }

  // ---- 知识库运维 SPI（2026-09-30 D-125；D-129 转推送模型）----
  // ⚠️ 依赖 `AiAccess` 已注册（编译经 `resolveAiAccess()` 取 `aiService`）
  {
    const { runKnowledgeCompile } =
      await import('@modules/knowledge/KnowledgeCompiler');
    const { runKnowledgeLint } =
      await import('@modules/knowledge/KnowledgeLinter');
    const { getDefaultDigestService } =
      await import('@modules/knowledge/KnowledgeDigestService');
    const { registerKnowledgeSpi, resolveAiAccess } =
      await import('@modules/core/spi');

    await registerKnowledgeSpi(container, {
      runCompile: async (options) => {
        // `aiService` 经 AiAccessService SPI 取得（core → core）；未注册时无 AI 能力 ⇒ 跳过编译
        const aiService = resolveAiAccess().getAiService();
        if (!aiService) return { compiled: 0, skipped: 0, errors: [] };

        const r = await runKnowledgeCompile(aiService as never, {
          force: options?.force ?? false,
          model: options?.model,
        });
        return { compiled: r.compiled, skipped: r.skipped, errors: r.errors };
      },
      runLint: async () => {
        const r = await runKnowledgeLint();
        return { issues: r.issues.map((i) => ({ message: i.message })) };
      },
      buildDigest: async () => {
        const digestService = getDefaultDigestService();
        await digestService.buildDigest();
      },
    });
  }
}
