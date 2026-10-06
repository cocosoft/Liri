// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 输出护栏注册表 + 顺序管线（13-P2-1，2026-10-05）
 *
 * - `runOutputGuards(guards, text)`：纯函数管线，顺序执行（priority 升序）：
 *   `redact` 累积改写 → 后续护栏看到已打码文本；`block` 立即短路返回。
 * - `OutputGuardRegistry`：命名注册/注销 + 复用同一纯函数管线（供组合根装配）。
 *
 * 不在此层捕获护栏异常（CS03：回退最小化）—— 护栏为本仓实现、契约要求同步纯函数；
 * 调用方如需隔离，应在装配处包装。
 */

import type {
  OutputGuard,
  OutputGuardIssue,
  OutputGuardRunResult,
} from './types.js';

/** 顺序执行护栏管线（纯函数；priority 升序，同优先级按入参顺序） */
export function runOutputGuards(
  guards: readonly OutputGuard[],
  text: string
): OutputGuardRunResult {
  const ordered = [...guards].sort((a, b) => a.priority - b.priority);
  let current = text;
  const issues: OutputGuardIssue[] = [];
  const redactedBy: string[] = [];

  for (const guard of ordered) {
    const verdict = guard.check(current);
    issues.push(...verdict.issues);

    if (verdict.action === 'block') {
      return {
        text: verdict.text ?? current,
        blocked: true,
        blockReason:
          verdict.issues.find((i) => i.severity === 'block')?.message ??
          `${guard.name} 阻断`,
        issues,
        redactedBy,
      };
    }

    if (
      verdict.action === 'redact' &&
      typeof verdict.text === 'string' &&
      verdict.text !== current
    ) {
      current = verdict.text;
      redactedBy.push(guard.name);
    }
  }

  return { text: current, blocked: false, issues, redactedBy };
}

/** 命名护栏注册表（register 按 name 覆盖 ⇒ 幂等） */
export class OutputGuardRegistry {
  private guards: OutputGuard[] = [];

  register(guard: OutputGuard): void {
    const idx = this.guards.findIndex((g) => g.name === guard.name);
    if (idx >= 0) this.guards[idx] = guard;
    else this.guards.push(guard);
  }

  unregister(name: string): boolean {
    const before = this.guards.length;
    this.guards = this.guards.filter((g) => g.name !== name);
    return this.guards.length !== before;
  }

  /** 已注册护栏（按 priority 升序快照，避免外部改动内部数组） */
  list(): readonly OutputGuard[] {
    return [...this.guards].sort((a, b) => a.priority - b.priority);
  }

  /** 执行管线（与 `runOutputGuards` 同语义） */
  run(text: string): OutputGuardRunResult {
    return runOutputGuards(this.guards, text);
  }
}

let globalRegistry: OutputGuardRegistry | null = null;

/** 全局注册表（唯一实例；组合根在 app 层注册具体护栏） */
export function getOutputGuardRegistry(): OutputGuardRegistry {
  if (!globalRegistry) globalRegistry = new OutputGuardRegistry();
  return globalRegistry;
}

/** 测试用：重置全局注册表（对齐既有 `reset*ForTest` 约定） */
export function resetOutputGuardRegistryForTest(): void {
  globalRegistry = null;
}
