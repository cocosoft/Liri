import type { AcpApprovalClass } from './types.js';

export interface ApprovalClassificationInput {
  toolName: string;
  toolServer?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
}

const BLOCKED_TOOLS = new Set<string>([]);

// C5（2026-11-21）：移除 `search_codebase` —— 本仓无该工具（无实现 / 无注册）。
// 放行表里的死名永不命中，留着只会让"到底允不允许搜索代码"的判读失真。
const ALWAYS_ALLOW_TOOLS = new Set<string>(['read', 'grep', 'glob']);

const ALWAYS_ALLOW_PREFIXES = ['vscode_', 'browser_', 'notifier_'];

const EXPLICIT_APPROVAL_TOOLS = new Set<string>([
  'create_file',
  'delete_file',
  'overwrite_file',
]);

export function classifyAcpToolApproval(
  input: ApprovalClassificationInput
): AcpApprovalClass {
  const { toolName } = input;

  if (BLOCKED_TOOLS.has(toolName)) {
    return 'blocked';
  }

  if (ALWAYS_ALLOW_TOOLS.has(toolName)) {
    return 'always_allow';
  }

  for (const prefix of ALWAYS_ALLOW_PREFIXES) {
    if (toolName.startsWith(prefix)) {
      return 'always_allow';
    }
  }

  if (EXPLICIT_APPROVAL_TOOLS.has(toolName)) {
    return 'requires_explicit_approval';
  }

  if (toolName.startsWith('edit_') || toolName.startsWith('file_')) {
    return 'requires_approval';
  }

  if (toolName.startsWith('write_') || toolName.startsWith('upload_')) {
    return 'requires_approval_and_audit';
  }

  return 'requires_approval';
}
