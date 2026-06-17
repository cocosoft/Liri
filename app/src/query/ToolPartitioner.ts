/**
 * 工具安全并行分区器
 *
 * 判断哪些 tool call 可以安全并行，哪些必须串行。
 * 参考 hermes run_agent.py 的 _PARALLEL_SAFE_TOOLS / _NEVER_PARALLEL_TOOLS / _PATH_SCOPED_TOOLS 设计。
 */
import type { ToolCallItem } from '../agent/ToolCallBatch';

/** 必须串行执行的工具（交互型 / 用户面朝工具） */
const NEVER_PARALLEL_TOOLS = new Set([
  'clarify',
  'ask_user',
  'confirm',
  'input',
]);

/** 读操作工具：无共享可变状态，天然可并行 */
const PARALLEL_SAFE_TOOLS = new Set([
  'web_search',
  'web_extract',
  'read_file',
  'search_files',
  'glob',
  'grep',
  'session_search',
  'skill_view',
  'skills_list',
  'vision_analyze',
  'ha_get_state',
  'ha_list_entities',
  'ha_list_services',
  'memory_search',
  'memory_read',
  'model_list',
]);

/** 路径作用域工具：不同路径可并行，同路径需串行 */
const PATH_SCOPED_TOOLS = new Set(['read_file', 'write_file', 'patch', 'edit']);

export interface PartitionedCalls {
  /** 可安全并行执行的第一组 */
  parallel: ToolCallItem[];
  /** 必须串行执行的后续组（每组内可并行） */
  sequential: ToolCallItem[];
}

/**
 * 从 ToolCallItem 中提取文件路径（用于冲突检测）
 */
function extractPath(item: ToolCallItem): string | null {
  const input = item.input;
  const rawPath =
    input?.path ?? input?.file ?? input?.filePath ?? input?.file_path;
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  return rawPath.trim();
}

/**
 * 判断两个路径是否可能指向同一文件（前缀匹配）
 */
function pathsOverlap(a: string, b: string): boolean {
  const pa = normalizePathForCompare(a);
  const pb = normalizePathForCompare(b);
  if (!pa || !pb) return false;
  return pa === pb;
}

function normalizePathForCompare(p: string): string {
  // 简单归一化：去掉末尾斜杠，转小写
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 对 tool call 列表进行安全分区。
 *
 * 规则：
 * 1. NEVER_PARALLEL 工具独占一组（必须串行）
 * 2. PATH_SCOPED 工具间检查路径冲突，无冲突的放同一组
 * 3. PARALLEL_SAFE 工具全部可并行
 * 4. 未分类工具默认串行（安全优先）
 *
 * @returns 分区结果：parallel 安全并行组，sequential 需逐个串行的组
 */
export function partitionToolCalls(calls: ToolCallItem[]): PartitionedCalls {
  if (calls.length <= 1) {
    return { parallel: calls, sequential: [] };
  }

  const parallel: ToolCallItem[] = [];
  const sequential: ToolCallItem[] = [];
  const seenPaths: string[] = [];

  for (const call of calls) {
    const name = call.tool.name;

    // 规则1：交互工具必须串行
    if (NEVER_PARALLEL_TOOLS.has(name)) {
      sequential.push(call);
      continue;
    }

    // 规则2：路径作用域工具检查冲突
    if (PATH_SCOPED_TOOLS.has(name)) {
      const path = extractPath(call);
      if (path) {
        const conflicts = seenPaths.some((sp) => pathsOverlap(sp, path));
        if (conflicts) {
          sequential.push(call);
          continue;
        }
        seenPaths.push(path);
      }
      parallel.push(call);
      continue;
    }

    // 规则3：读操作工具可直接并行
    if (PARALLEL_SAFE_TOOLS.has(name)) {
      parallel.push(call);
      continue;
    }

    // 规则4：未知工具保守串行
    sequential.push(call);
  }

  return { parallel, sequential };
}

/**
 * 检查整批是否可以完全并行
 */
export function canParallelizeAll(calls: ToolCallItem[]): boolean {
  const { sequential } = partitionToolCalls(calls);
  return calls.length > 1 && sequential.length === 0;
}

/**
 * 获取应并行执行的最大 worker 数
 */
export const MAX_PARALLEL_WORKERS = 8;
