/**
 * a2a-delegator.ts — **CoreAPI 对话轮**委派后端（方案①，2026-09-29）
 *
 * 把 A2A 委派映射为**一次 CoreAPI 对话轮**：
 *  - 每次委派**新建独立会话**（隔离外部调用者之间的上下文，贴合 A2A「contextId 新建任务」语义）；
 *  - 若给了 `agentId` 且注册表命中 ⇒ 用该 Agent 的 `systemPrompt` 作为本轮系统提示
 *    （贴合卡片 `skills`＝agents 的语义）；**未命中 ⇒ 如实 WARN** 并按默认人格执行；
 *  - 返回**助手正文**（`ChatResponse.content`）。
 *
 * ⚠️ **边界（如实）**：这是一条**完整对话轮** ⇒ 会走既有模型路由 / 工具执行 / 权限门 / 成本记账。
 * 对外暴露前**必须先开 `A2A_ENABLED`**（默认关闭），且必须配 `A2A_API_KEY`（未配 ⇒ 401）。
 *
 * **鉴权（结论已定，勿再引旧注释）**：2026-09-29 裁定「**专用密钥 + fail-closed**」；
 * 2026-10-07（R07-4②）把密钥比较改为**常量时间**（`verifyRequestAuth`）。
 * 完整口径见 `.trae/specs/a2a-external-exposure.md` §7 / §8。
 */

import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getLogger } from '@modules/monitoring';
import { setA2ADelegator, type A2ADelegator } from './a2a-routes';

const logger = getLogger('http:a2a:delegator');

/**
 * 委派所需的 CoreAPI **窄端口**（只声明本模块真正用到的两个方法）。
 *
 * 刻意**不**依赖完整 `CoreAPI` 接口：既避免把宽契约拉进来，也让本模块**可注入假实现**（可测）。
 * `CoreAPIImpl` 在结构上满足本接口。
 */
export interface A2ADelegationCore {
  createSession(params?: {
    title?: string;
    mode?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  chat(request: {
    content: string;
    sessionId?: string;
    stream?: boolean;
    systemPrompt?: string;
  }): Promise<{ content: string }>;
}

/**
 * 构建"CoreAPI 对话轮"委派后端。
 *
 * @param core CoreAPI 窄端口；缺省取全局单例 `getCoreAPI()`（**调用时**求值，便于测试注入）
 */
export function createCoreApiDelegator(
  core: A2ADelegationCore = getCoreAPI()
): A2ADelegator {
  return async (message, agentId) => {
    const session = await core.createSession({
      title: agentId ? `A2A 委派 · ${agentId}` : 'A2A 委派',
      mode: 'a2a',
      metadata: { source: 'a2a' },
    });

    // D-204：原静态 `getAgentRegistry()`（app 层）⇒ 改经 **A2A 端口**取用。
    // ⚠️ 人格查询**不经**注入的 `core`（窄端口只覆盖"对话轮"两个方法）：人格数据来自
    // agent 注册表，原本也是**全局**取用（非注入）⇒ 行为与测试语义均不变。
    const persona = agentId
      ? (await getCoreAPI().getA2APort()).getAgentSystemPrompt(agentId)
      : undefined;
    if (agentId && !persona) {
      logger.warning('A2A 指定的 agentId 未命中注册表，按默认人格执行', {
        agentId,
      });
    }

    const response = await core.chat({
      content: message,
      sessionId: session.id,
      stream: false,
      ...(persona ? { systemPrompt: persona } : {}),
    });

    logger.info('A2A 委派轮完成', {
      sessionId: session.id,
      agentId: agentId ?? null,
      replyChars: response.content?.length ?? 0,
    });
    return response.content ?? '';
  };
}

/**
 * 把 CoreAPI 委派后端装配进 A2A 路由（由 HTTP 组装点调用）。
 *
 * **同步**装配（静态 import）—— 避免"首个请求早于装配"的竞态；重复调用等价于覆盖为同一实现。
 */
export function installA2ADelegator(): void {
  setA2ADelegator(createCoreApiDelegator());
}
