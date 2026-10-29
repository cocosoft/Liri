// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * verifierModel — 「verifier 角色独立模型」解析外移（issue #17 · D7，2026-10-29）
 *
 * 迁出来源：`ChatManager._ensureVerifierCallModel` 的方法体（原 1164–1202，约 39 行）。
 *
 * G-3（2026-10-18）语义（与迁移前逐字一致）：
 * - **幂等**：成功/失败都只尝试一次（`state.resolved` 缓存同一个 Promise）；
 * - 未配置角色（`resolveRoleModel('verifier')` 返回空串）⇒ `callModel` 保持 `null` ⇒
 *   主对话 TAOR 配置**不注入** `verifierModel`（行为零变化）；
 * - 解析失败（DB / 端口不可用）⇒ warn + 不注入（fail-open 到现状，不阻断主对话）。
 *
 * 解析状态由宿主持有（实例级），以 {@link VerifierModelState} 传入。
 */

import { getLogger } from '@modules/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

const logger = getLogger('chat:manager');

/** verifier 独立模型的调用函数（与 `TAORLoopConfig.verifierModel` 同形） */
export type VerifierCallModel = (
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal
) => AsyncGenerator<{ content?: string }>;

export interface VerifierModelState {
  /** 解析产物；`null` = 未配置角色（不注入） */
  callModel: VerifierCallModel | null;
  /** 幂等标记：成功/失败都只尝试一次 */
  resolved: Promise<void> | null;
}

/**
 * 解析 `verifier` 角色模型（幂等）。
 */
export function ensureVerifierCallModel(
  state: VerifierModelState
): Promise<void> {
  if (state.resolved) return state.resolved;
  state.resolved = (async () => {
    try {
      const aiOps = await getCoreAPI().getAiOpsPort();
      const modelId = await aiOps.resolveRoleModel('verifier');
      if (!modelId) {
        logger.debug(
          'verifier 角色未配置模型，主对话验证器保持现状（不注入独立模型）'
        );
        return;
      }
      // 与 `research-handlers` 的 verifier 正例同构：流式聚合正文（思考模型非流会空响应）
      const service = await aiOps.createAiService({
        defaultModel: '',
        apiKey: '',
      });
      state.callModel = async function* (messages, signal) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const gen = service.stream(messages as never, modelId, {
          max_tokens: 4000,
        });
        for await (const chunk of gen) {
          const content = (chunk as { content?: unknown })?.content;
          if (typeof content === 'string' && content) yield { content };
        }
      };
      logger.info('verifier 角色模型已解析：主对话验证器将使用独立模型', {
        modelId,
      });
    } catch (error) {
      // G-3：解析失败 ⇒ 不注入（保持现状），不阻断主对话
      logger.warn('verifier 角色模型解析失败，主对话验证器保持现状', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return state.resolved;
}
