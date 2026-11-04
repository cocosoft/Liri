// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 流式路径的**工具准备**（P1 收口，2026-11-05）：按会话 `chatMode` 裁剪后构建工具定义。
 *
 * 为什么单独成模块：
 * ① 与续跑路径共用同一口径（`filterToolSchemasByChatMode` 是唯一实现，不得各写一遍）；
 * ② `streamMessageFlow.ts` 与其中的 `runStreamMessage` 都顶在行数棘轮上（**只允许缩小**），
 *    逻辑内联会让门禁直接拦下。
 *
 * 边界：只做"哪些工具对模型可见"的减法；权限判定（`PermissionChecker` / 审批 / 路径边界）
 * 完全不受影响 —— 被裁掉的工具即便被模型点名，也仍由权限链决定是否执行。
 */

import type { ToolDefinition } from '@modules/ai';
import type { ChatOrchestratorHost } from './ChatOrchestratorHost.js';
import {
  filterToolSchemasByChatMode,
  resolveChatModePolicy,
} from '../chatModePolicy.js';

export function prepareStreamTools(
  host: Pick<
    ChatOrchestratorHost,
    'getToolRegistry' | 'buildToolDefinitions' | 'recordToolsSnapshot'
  >,
  session: { id?: string; metadata?: unknown }
): { visibleSchemas: { name: string }[]; toolDefinitions: ToolDefinition[] } {
  const registry = host.getToolRegistry();
  const visibleSchemas = filterToolSchemasByChatMode(
    registry?.getToolSchemas() ?? [],
    resolveChatModePolicy(
      (session.metadata as Record<string, unknown> | undefined)?.['chatMode']
    )
  );
  // TR-12-B（2026-09-22）／§1.6 红线：本轮工具清单落事件，且必须是**过滤后**清单
  //（模型可见 ⇔ 已落盘）。空清单不落（与改造前同一条件）。
  if (session.id && visibleSchemas.length > 0) {
    host.recordToolsSnapshot(session.id, visibleSchemas);
  }
  return {
    visibleSchemas,
    // 注册表缺失 ⇒ 无工具可用（与改造前一致的告警分支由调用方处理）
    toolDefinitions: registry ? host.buildToolDefinitions(visibleSchemas) : [],
  };
}
