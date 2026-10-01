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
 * 本文件为**分阶段迁移**的落地：先迁 `AiAccess` / `DiagnosticsProbe`（本战役新增者），
 * 其余（Logger/OTel/Profiler 三件套 + Broadcast/PluginSystem/Knowledge）仍在 `DIContainer` 内注册。
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
