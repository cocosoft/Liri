// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatPromptAssembly —— 系统提示词组装（ChatManager 拆分批 A3）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C12 簇（D-01/D-03 文件规模债拆分）；
 * 方案与依赖验证见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §12。
 *
 * **职责（单一）**：
 *   ① `getOrAssembleSystemPrompt`：组装上下文系统提示词，并把**逐段快照**落到
 *      `context/model-input` 事件（TR-12-B「模型可见 ⇔ 已落盘」）
 *   ② `resolvePromptClientForSystemPrompt`：解析组装所用的 LLM client 并回传模型名
 *      （T-②04：路由决策可从事件重建）
 *
 * **⚠️ 与 §9.3 计划的偏差（2026-10-05）**：C12 列表里的 `getHookChainManager`（通用
 * HookChain 管理器 getter，非"提示词装配"）与 `_extractCurrentGoal`（**全仓无调用者**，
 * 预存死私有方法）**不并入本模块** ⇒ A3 收窄为 2 成员。
 *
 * **日志 module 名保持不变**：本模块不含日志输出（与原实现一致）。
 *
 * **注入依赖**（`ChatPromptAssemblyDeps`，全 getter ⇒ 无字段初始化顺序陷阱）：
 * 跨簇共享状态（图像上下文服务 / 会话访问门面 / 快照落盘 / 模型 client 解析）仍归宿主所有。
 */

import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolAwareClient } from '@modules/ai';
import { assembleContextualSystemPrompt } from '../services/MessageContextPipeline';
import type { ImageContextService } from '../services/ImageContextService';
import type { SessionAccessFacade } from '../services/SessionAccessFacade';
import type { ModelInputSnapshot } from '../services/RequestSnapshotService';

/**
 * 系统提示词组装所依据的 `ModelRouter.resolve` **路由键**（T-②04，2026-10-02）——
 * 与快照落盘的 `route` 同源 ⇒"本轮走了哪条路由"可从事件读出。
 */
export const PROMPT_ASSEMBLY_ROUTE = 'default';

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatPromptAssemblyDeps {
  /** 图像上下文服务（提示词组装需要） */
  getImageContextService: () => ImageContextService;
  /** 会话访问门面（取会话记忆上下文） */
  getSessionAccess: () => SessionAccessFacade;
  /** 模型输入快照落盘（TR-12-B，宿主转发至 `ChatRequestPrep`） */
  recordModelInputSnapshot: (
    sessionId: string,
    input: ModelInputSnapshot
  ) => Promise<void>;
  /** 按模型名取 client（宿主实现） */
  getClientForModel: (model?: string) => ToolAwareClient;
  /** 全局 llmClient（路由不可用时的回退） */
  getLlmClient: () => ToolAwareClient | undefined;
}

export class ChatPromptAssembly {
  constructor(private readonly deps: ChatPromptAssemblyDeps) {}

  /**
   * 获取或组装系统提示词（委托给 MessageContextPipeline）
   */
  async getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string> {
    // 修复（2026-08-22）：宿主 `llmClient` 可能停留在初始化时的 provider——
    // 用户切换模型后未重建，直接用它组装 system prompt 会导致 isLocal 判定错误：
    // 本地模型（llama.cpp）收到远程版"强制 think/response 标签"规则（system prompt
    // 3653 tokens，且诱导模型输出 <response> 包装 → 前端正文重复显示）。
    // 改用当前模型路由对应 client 组装，isLocal 判定与实际请求一致。
    const { client: promptClient, model: promptModel } =
      await this.resolvePromptClientForSystemPrompt();
    return assembleContextualSystemPrompt(
      session,
      currentMessage,
      promptClient,
      this.deps.getImageContextService(),
      (sessionId: string) =>
        this.deps
          .getSessionAccess()
          .getMemoryManager()
          .getMemoryContext(sessionId),
      // TR-12-B（2026-09-22）：系统提示词逐段快照 → "模型当时看到的提示词"可重建（§1.6）
      (sections, contents, mode) => {
        void this.deps.recordModelInputSnapshot(session.id, {
          sections: sections.map((s, i) => ({
            name: s.name,
            content: contents[i] ?? null,
          })),
          mode,
          // T-②04（2026-10-02）：一并落"本轮模型 / 路由键" ⇒ 路由决策可从事件重建；
          // 模型未解析出 ⇒ 两字段均省略（不写占位，CS04）
          model: promptModel,
          route: promptModel ? PROMPT_ASSEMBLY_ROUTE : undefined,
        });
      }
    );
  }

  /**
   * 解析用于组装 system prompt 的 LLM client，并**回传模型名**（T-②04：供快照落盘）。
   * 优先当前模型路由（`modelRouter.resolve(PROMPT_ASSEMBLY_ROUTE)`）对应 client；
   * 路由不可用时回退全局 llmClient（组装不阻断）。
   */
  private async resolvePromptClientForSystemPrompt(): Promise<{
    client: ToolAwareClient | undefined;
    /** 解析出的模型名；未解析出 ⇒ `undefined`（此时调用方一并省略 `route`） */
    model?: string;
  }> {
    try {
      const { modelRouter } = await import('@modules/ai');
      const modelName = modelRouter.resolve(PROMPT_ASSEMBLY_ROUTE);
      if (modelName) {
        return {
          client: this.deps.getClientForModel(modelName),
          model: modelName,
        };
      }
    } catch {
      // @ignore-catch 模型路由不可用时回退全局 llmClient
    }
    return { client: this.deps.getLlmClient() };
  }
}
