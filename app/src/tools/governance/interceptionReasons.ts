/**
 * 工具**拦截事件 reason 码**登记表（P2-2 / G7，2026-11-22）
 *
 * 背景：bash 域早有 `commandGateRegistry` 做 reason 码双向对账；file / network /
 * desktop / mcp 域此前**没有机器可读码**（拦截只体现在 `error` 文案里，排障只能搜字符串）。
 *
 * 口径：
 * - 本表只登记**非 bash 域**的 `metadata.reason` 码；bash 的五个门仍以
 *   `tools/bash/commandGateRegistry.ts` 为唯一事实源（不在此重复）。
 * - 登记必须同时给出**产生该码的源文件**；`lint:tool-interception-reasons` 会：
 *   ① 扫描这些文件里的 `reason: '<code>'` 字面量 ⇒ 未登记的码即失败；
 *   ② 表里每个码必须在扫描面真实存在 ⇒ 僵尸登记即失败。
 * - F6（2026-11-22）：file / mcp / policy 域已补码（PathGuard / LRO 工作区越界 /
 *   策略拒绝 / MCP 未连接）；新增拦截点必须同批登记。 bash 之外**没有码**的域
 *   不再以空登记凑数，但也不得在源码写入未登记的码。
 */

export type InterceptionDomain =
  | 'shell'
  | 'network'
  | 'desktop'
  | 'file'
  | 'mcp'
  | 'policy';

export interface InterceptionReasonSpec {
  code: string;
  domain: InterceptionDomain;
  /** 产生该码的源文件（相对仓库根） */
  sources: readonly string[];
}

export const INTERCEPTION_REASONS: readonly InterceptionReasonSpec[] = [
  {
    code: 'ssrf_blocked',
    domain: 'network',
    sources: ['app/src/tools/WebFetchTool/WebFetchTool.ts'],
  },
  {
    code: 'tool_gate_disabled',
    domain: 'desktop',
    sources: ['packages/tool-desktop/src/tool-desktop/ComputerUseTool.ts'],
  },
  {
    code: 'path_guard_blocked',
    domain: 'file',
    sources: ['app/src/chat/ReActToolLoop.ts'],
  },
  {
    code: 'workspace_escape_blocked',
    domain: 'file',
    sources: ['app/src/tasks/lro/stepExecution.ts'],
  },
  {
    code: 'policy_denied',
    domain: 'policy',
    sources: ['app/src/tools/ToolRegistry.ts'],
  },
  {
    code: 'tool_disabled',
    domain: 'policy',
    sources: ['app/src/tools/ToolRegistry.ts'],
  },
  {
    code: 'mcp_not_connected',
    domain: 'mcp',
    sources: ['packages/service/src/services/mcp/McpToolWrapper.ts'],
  },
];

/** 扫描面（由登记表派生，避免手写第二份文件清单） */
export const INTERCEPTION_REASON_SOURCES: ReadonlyArray<{
  file: string;
  domain: InterceptionDomain;
}> = (() => {
  const byFile = new Map<string, InterceptionDomain>();
  for (const spec of INTERCEPTION_REASONS) {
    for (const file of spec.sources) byFile.set(file, spec.domain);
  }
  return [...byFile].map(([file, domain]) => ({ file, domain }));
})();

/** 从源码文本提取 `reason: '<code>'` 字面量（只认小写标识符形的码） */
export function collectReasonCodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\breason:\s*'([a-z][a-z0-9_]*)'/g)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out].sort();
}

/**
 * 双向对账：
 * - 扫描面里出现的码必须已登记；
 * - 登记的码必须在扫描面真实出现；
 * - 登记的每个来源文件都必须被纳入扫描（防止"登记了但没人扫"）。
 */
export function validateInterceptionReasons(
  sources: ReadonlyArray<{ file: string; text: string }>,
  specs: readonly InterceptionReasonSpec[] = INTERCEPTION_REASONS
): string[] {
  const registered = new Set(specs.map((s) => s.code));
  const found = new Map<string, Set<string>>();
  for (const source of sources) {
    found.set(source.file, new Set(collectReasonCodes(source.text)));
  }

  const errors: string[] = [];
  for (const source of sources) {
    for (const code of found.get(source.file) ?? []) {
      if (!registered.has(code)) {
        errors.push(`未登记的拦截 reason 码：${code}（${source.file}）`);
      }
    }
  }
  for (const spec of specs) {
    const present = sources.some((s) => found.get(s.file)?.has(spec.code));
    if (!present) {
      errors.push(`登记的拦截 reason 码在扫描面不存在：${spec.code}`);
    }
    for (const file of spec.sources) {
      if (!sources.some((s) => s.file === file)) {
        errors.push(`登记来源未纳入扫描面：${file}（${spec.code}）`);
      }
    }
  }
  return errors;
}
