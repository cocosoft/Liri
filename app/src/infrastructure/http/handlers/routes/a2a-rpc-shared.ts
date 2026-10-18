/**
 * A2A JSON-RPC 共用纯函数（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：`a2a-rpc.ts` 以**动态 import** 懒加载
 * `a2a-rpc-stream.ts`（合规的懒加载），但 madge 仍把动态导入计为边；
 * 而 `a2a-rpc-stream.ts` 又静态 import 本文件的三个助手 ⇒ 静态环。
 * 把助手下沉为叶子模块后，两端均只依赖叶子 ⇒ 环消失（行为逐字不变）。
 */
import type http from 'http';
import { json } from '../handler-utils';
import type { A2AArtifact, A2AMessage } from '@modules/types/a2a';

/**
 * 把委派文本包成 A2A 的 artifact + message（§2.2 / §2.4）。
 *
 * **导出**供 `a2a-routes.ts` 的 REST 委派共用（CS01）。
 */
export function toDeliverables(text: string): {
  artifacts: A2AArtifact[];
  message: A2AMessage;
} {
  const parts = [{ text }];
  return {
    artifacts: [{ artifactId: 'reply', name: 'agent-reply', parts }],
    message: { messageId: 'reply', role: 'agent', parts },
  };
}

/** JSON-RPC 失败响应（HTTP 200 + `error`；**不含 `data`** —— 本仓不产 ProtoJSON `Any`） */
export function rpcError(
  res: http.ServerResponse,
  id: unknown,
  code: number,
  message: string
): void {
  json(res, 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

/**
 * 取 `params.message.parts[].text` 拼接（**REST/RPC 共用**，CS01）。
 *
 * 本项目当前只处理文本（`defaultInputModes = ['text/plain']`）⇒ 无有效文本返回 `null`
 * （调用方映射 `-32602`）。
 */
export function extractTextParts(
  params: Record<string, unknown>
): string | null {
  const message = params['message'];
  if (typeof message !== 'object' || message === null) return null;
  const parts = (message as Record<string, unknown>)['parts'];
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>)['text'] === 'string'
        ? ((p as Record<string, unknown>)['text'] as string)
        : ''
    )
    .join('')
    .trim();
  return text ? text : null;
}
