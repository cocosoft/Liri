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
 * LlmChatOps —— LLM 客户端懒初始化 / 模型解析 / 非流式 `chat`（拆分自 `CoreAPIImpl`）
 *
 * 2026-10-09（文件规模债拆分，见 `.trae/specs/core-api-impl-split.md` S3）：自 `CoreAPIImpl.ts`
 * **纯搬迁**（只搬不改，CS01）—— 行为与注释逐行保留。`CoreAPIImpl` 侧仅留**薄转发**。
 *
 * 依赖经**惰性 getter / 读写端口**注入（对照 `sessionMessagesRead.ts` / `sessionTitling.ts`），
 * 避免构造期求值与循环依赖。
 */

import { configManager } from '@modules/config';
import { DEFAULT_MODEL_SENTINEL } from '@modules/constants';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { createPermissionManager } from '@modules/permission';
import type { ChatManager } from '@modules/chat';
import type { ToolManager } from '@modules/tools';
import type { SmartRouter, RouteDecision } from '@modules/ai';
import type { ChatRequest, ChatResponse, QuestionData } from './CoreAPI';
import type { SessionTitling } from './sessionTitling';

const logger = getLogger('runtime:api:CoreAPIImpl');

/** 模型路由窄契约（与 `CoreAPIImpl.ModelRouteResolver` 同形；此处不引入 app 依赖） */
export interface LlmChatRouter {
  resolveDefault(): string;
  resolveWithPhase(phase: unknown): string | null;
  resolveChat(): Promise<string>;
}

/** 惰性依赖端口（每次调用求值 ⇒ 与宿主注册/创建时序解耦） */
export interface LlmChatOpsDeps {
  getChatManager(): ChatManager;
  getToolManager(): ToolManager;
  getSessionTitling(): SessionTitling;
  getRouter(): LlmChatRouter;
  isLlmReady(): boolean;
  setLlmReady(ready: boolean): void;
  getSmartRouter(): SmartRouter | null;
  setLastRouteDecision(decision: RouteDecision | null): void;
}

export class LlmChatOps {
  constructor(private readonly deps: LlmChatOpsDeps) {}

  /**
   * 延迟初始化 LLM 客户端
   *
   * 确保 ChatManager 的 LLM 客户端在使用前已初始化。
   * 若 ChatManager 已有 LLM 客户端（如 REPL 路径已调用 initializeChatManager），则跳过。
   * 这是 HTTP API 路径下 LLM 客户端缺失的补救机制。
   */
  async ensureLLMClientInitialized(): Promise<void> {
    if (this.deps.isLlmReady()) return;

    const chatManager = this.deps.getChatManager();

    // 通过 try-catch 探测 ChatManager 是否已有 LLM 客户端
    try {
      chatManager.getLLMClient();
      // 已有 LLM client：补齐工具注册表（若缺失）。
      // 修复：此前此处直接 return，若 ChatManager 的 client 是未注入工具注册表的
      // 路径创建的，工具定义将永远为 [] → LLM 收不到工具 → 模型"想调工具却无工具"
      // → 只输出 think 无 response（think-only 卡死）。
      if (!chatManager.getToolRegistry()) {
        // D-227（2026-10-02）：`getToolManager()` → `this.toolManager.getInner()`（懒解析注入值；
        // 本仓 `@modules/tools` 的 `ToolManager` 是 CC 兼容包装层，其 `getInner()` 即
        // `getToolManager()` 的同一实例 —— 与 §1.16 记载一致）。
        const toolManager = this.deps.getToolManager().getInner();
        toolManager.loadBuiltinTools();
        const registry = toolManager.getRegistry();
        if (registry) {
          chatManager.setToolRegistry(registry);
          logger.info(
            'ensureLLMClientInitialized: 已为已有 LLM client 补齐工具注册表'
          );
        } else {
          logger.warning(
            'ensureLLMClientInitialized: 工具注册表为空，本次会话将无法调用工具'
          );
        }
      }
      this.deps.setLlmReady(true);
      return;
    } catch (_err) {
      // LLM 客户端未初始化，继续执行初始化
    }

    try {
      // D-227（2026-10-02）：app 层符号改为**方法内动态导入**（仅 R00-003 上报），消除静态值导入。
      const {
        syncDBProvidersToRegistry,
        detectUnifiedProviders,
        resolveModelRoute,
        RouteKey,
        providerRegistry,
        ToolAwareClient,
      } = await import('@modules/ai');

      // 从 DB 同步所有活跃 Provider 到运行时 ProviderRegistry
      await syncDBProvidersToRegistry();

      // 从 ModelRouter 获取当前全局模型，按模型匹配 Provider
      const currentModel = await resolveModelRoute(RouteKey.CHAT);
      let provider = currentModel
        ? providerRegistry.getByModel(currentModel)
        : undefined;

      // 模型未匹配时，按已注册的 Provider 依次尝试
      if (!provider) {
        const allProviders = providerRegistry.list();
        if (allProviders.length > 0) {
          provider = allProviders[0];
        }
      }

      // DB 中无 Provider 时，从环境变量检测创建
      if (!provider) {
        const envProviders = detectUnifiedProviders();
        const envProvider = envProviders[0];

        if (envProvider) {
          provider = providerRegistry.getOrCreate(envProvider.providerType, {
            apiKey: envProvider.apiKey || '',
            baseUrl: envProvider.baseUrl,
            model: envProvider.model || currentModel,
          });

          if (envProvider.apiKey) {
            provider.setApiKey?.(envProvider.apiKey);
          }
        }
      }

      if (!provider) {
        throw new Error('未找到可用的 API Provider，请在 .env 中配置 API 密钥');
      }

      const toolManager = this.deps.getToolManager().getInner();
      toolManager.loadBuiltinTools();
      const registry = toolManager.getRegistry();

      const llmClient = new ToolAwareClient(
        provider,
        registry as unknown as import('@modules/ai').ToolRegistry,
        null
      );

      chatManager.setLLMClient(llmClient);
      // 无条件设置工具注册表（含 null）：保证 streamMessageFlow 能明确感知工具状态，
      // 而非静默退化 —— 工具缺失时应能看到 warning 而非"模型想调工具却无工具"
      chatManager.setToolRegistry(registry);
      // P0-1: 装配权限管理器 —— 激活 ChatManager 工具执行点权限检查（工具执行审批链路）
      chatManager.setPermissionManager(createPermissionManager());

      await chatManager.initialize();

      this.deps.setLlmReady(true);
      logger.info('LLM 客户端已通过 CoreAPIImpl 延迟初始化');
    } catch (error) {
      logger.warning('CoreAPIImpl 延迟初始化 LLM 客户端失败', {
        error: String(error),
      });
    }
  }

  /**
   * 使用 SmartRouter 决策模型（若 SmartRouter 启用且可用）。
   * 若前端已指定 model（用户在状态栏选择的默认模型），直接使用。
   * SmartRouter tiers 保持独立，用户选择不覆盖分级配置。
   * @returns 模型名；若 SmartRouter 未启用则返回从 modelRouter 解析的模型
   */
  async resolveSmartModel(
    content: string,
    sessionId?: string,
    preferredModel?: string,
    phaseContext?: import('@modules/ai').PhaseContext
  ): Promise<{ model: string; tier: string }> {
    // 用户在前端显式选择了模型 → 直接使用
    if (preferredModel && preferredModel !== DEFAULT_MODEL_SENTINEL) {
      return { model: preferredModel, tier: 'user-selected' };
    }

    // D-227（2026-10-02）：app 层符号改为**方法内动态导入**（仅 R00-003 上报）。
    // 置于「用户显式选择」早返回之后 ⇒ 不改变既有懒加载时机。
    const { detectPhase, RouteKey } = await import('@modules/ai');

    // S3: 自动检测 PDCA 阶段（当调用方未显式传入 phaseContext 时）
    const effectivePhase = phaseContext ?? detectPhase(content);

    const smartRouter = this.deps.getSmartRouter();
    if (smartRouter?.isEnabled()) {
      try {
        const decision = await smartRouter.resolve(RouteKey.CHAT, {
          message: content,
          sessionId,
          phaseContext: effectivePhase,
        });
        this.deps.setLastRouteDecision({
          ...decision,
          target: decision.target ?? 'cloud',
        });
        if (decision.model) {
          return { model: decision.model, tier: decision.tier };
        }
      } catch (error) {
        logger.warning('SmartRouter 决策失败，回退 modelRouter', { error });
      }
    }
    // S3: 回退到 modelRouter，支持阶段感知
    // D-227：`modelRouter.resolveWithPhase(RouteKey.CHAT, …)` → 注入路由器（隐藏 app 符号）。
    if (effectivePhase) {
      const phaseModel = this.deps.getRouter().resolveWithPhase(effectivePhase);
      if (phaseModel) return { model: phaseModel, tier: 'phase-routed' };
    }
    // D-227：`resolveModelRoute(RouteKey.CHAT)` → 注入路由器的已绑定 `resolveChat()`。
    return {
      model: await this.deps.getRouter().resolveChat(),
      tier: 'fallback',
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const otel = getOTelTracing();
    const span = otel.startSpan('coreapi.chat', {
      'session.id': request.sessionId ?? '',
    });
    try {
      await this.ensureLLMClientInitialized();
      // E-3（2026-08-23，方案 D2-B）：发消息时立即设占位标题（LLM 调用前，不阻塞主路径）。
      // 清洗截断 userMessage 作为 preliminary 标题，回复完成后由 autoGenerateTitle LLM 精化覆盖。
      // 回滚开关（规格书 §二 回滚）：TITLE_STAGE='false' 时跳过占位标题（回退单阶段精化）。
      if (
        configManager.env('TITLE_STAGE') !== 'false' &&
        request.sessionId &&
        request.content &&
        this.deps.getSessionTitling().shouldAutoTitle(request.sessionId)
      ) {
        const titling = this.deps.getSessionTitling();
        void titling
          .setPreliminaryTitle(
            request.sessionId,
            titling.sanitizePlaceholderTitle(request.content)
          )
          .catch(() => {});
      }
      const { model, tier } = await this.resolveSmartModel(
        request.content,
        request.sessionId,
        request.model
      );
      const message = await this.deps
        .getChatManager()
        .sendMessage(request.content, {
          sessionId: request.sessionId,
          messageId: request.messageId,
          metadata: { ...request.metadata, routerTier: tier },
          stream: request.stream,
          model,
          onProgress: request.onProgress,
          images: request.images,
          temperature: request.temperature,
          maxTokens: request.max_tokens,
          top_p: request.top_p,
          systemPrompt: request.systemPrompt,
        });

      // 检查是否返回了待处理的用户交互（非流式路径）
      const pendingInteraction = (
        message.metadata as Record<string, unknown> | undefined
      )?.pendingInteraction as QuestionData | undefined;
      if (pendingInteraction) {
        logger.info('CoreAPI.chat 返回待处理交互', {
          sessionId: request.sessionId,
          questionId: pendingInteraction.questionId,
        });
        otel.endSpan(span, SpanStatusCode.OK);
        return {
          content: pendingInteraction.question,
          sessionId: message.sessionId || request.sessionId || '',
          messageId: message.id,
          finishReason: 'pending_interaction',
          pendingInteraction,
        };
      }

      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => ('value' in block ? block.value : ''))
              .join('');

      // 非流式路径也触发自动标题生成（fire-and-forget，不阻塞响应）
      if (content && request.sessionId) {
        this.deps
          .getSessionTitling()
          .autoGenerateTitle(request.sessionId, request.content, content);
      }

      otel.endSpan(span, SpanStatusCode.OK);
      return {
        content,
        sessionId: message.sessionId || request.sessionId || '',
        messageId: message.id,
        finishReason: 'stop',
      };
    } catch (error) {
      otel.recordError(
        span,
        error instanceof Error ? error : new Error(String(error))
      );
      otel.endSpan(span, SpanStatusCode.ERROR, String(error));
      await handleError(error, { module: 'core:api', action: 'chat' });

      return {
        content: '',
        sessionId: request.sessionId || '',
        messageId: '',
        finishReason: 'error',
      };
    }
  }
}
