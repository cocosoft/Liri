import type { ContextEngine, CompactResult } from './types.js';

/**
 * 委托上下文压缩给运行时的内置压缩路径。
 * 第三方引擎可在自己的 compact() 实现中调用此函数，
 * 以复用内置的压缩行为。
 */
export async function delegateCompactionToRuntime(
  params: Parameters<ContextEngine['compact']>[0]
): Promise<CompactResult> {
  const currentTokenCount =
    params.currentTokenCount ??
    (typeof params.currentTokenCount === 'number' &&
    Number.isFinite(params.currentTokenCount) &&
    params.currentTokenCount > 0
      ? Math.floor(params.currentTokenCount)
      : undefined);

  return {
    ok: true,
    compacted: false,
    reason: 'delegated to runtime (mock)',
    result: {
      tokensBefore: currentTokenCount ?? 0,
      tokensAfter: currentTokenCount ?? 0,
    },
  };
}

/**
 * 构建内存系统提示补充段。
 * 让非 legacy 引擎显式接入内存/知识库提示指导。
 */
export function buildMemorySystemPromptAddition(_params: {
  availableTools: Set<string>;
}): string | undefined {
  return undefined;
}
