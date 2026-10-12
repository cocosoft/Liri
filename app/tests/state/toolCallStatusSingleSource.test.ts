/**
 * 工具调用状态**单一事实源**源码守卫（状态机规范管理方案 阶段 2.1 / 2.2，2026-10-12）。
 *
 * 背景：`execution/types.ts` 的 `ToolCallStatus` 是 G14 收敛后的唯一事实源，但 **chunk / SSE /
 * 前端契约层曾各自复写 `'running' | 'completed' | 'failed'` 字面量**（§2.1 的 5 份）。
 * 本守卫锁住"分叉不得回流"：各面必须**引用**共享类型/常量，且断言**口径精确到代码形态**
 * （不数注释里的示例字面量 ⇒ 注释说明不构成回归）。
 *
 * 另锁一条**分层裁定**：`utils/toolContract/ToolProgress.ts` 的 `SubAgentProgress.status`
 * 属**子 Agent 域**（非同一物），且 `utils`(infra) **不可**反向依赖 `execution`(service) ⇒ 必须保持独立。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** 统计字面量子串出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const CORE_API = 'app/src/runtime/api/CoreAPI.ts';
const UNIFIED_MESSAGE = 'app/src/session/types/UnifiedMessage.ts';
const CHUNK_MAPPER = 'app/src/chat/reactEventsToChunks.ts';
const SSE_HANDLER = 'app/src/infrastructure/http/handlers/chat-handlers.ts';
const CORE_API_IMPL = 'app/src/runtime/api/CoreAPIImpl.ts';
const TOOL_PROGRESS = 'app/src/utils/toolContract/ToolProgress.ts';
const EXECUTION_EXIT = 'app/src/execution/index.ts';

describe('工具调用状态单源守卫（阶段 2.1/2.2）', () => {
  it('唯一事实源出口：`@modules/execution` 暴露工具调用状态类型与常量（R03-002）', () => {
    const src = read(EXECUTION_EXIT);
    for (const symbol of [
      'TOOL_CALL_STATUSES',
      'TOOL_CALL_INITIAL_STATUS',
      'TOOL_CALL_COMPLETED_STATUS',
      'TOOL_CALL_FAILED_STATUS',
      'TOOL_CALL_UNKNOWN_STATUS',
      'ToolCallStatus',
    ]) {
      expect(src).toContain(symbol);
    }
  });

  it('HTTP 门面契约 `ToolCallSpec.status` 引用共享类型（不再自定义联合）', () => {
    const src = read(CORE_API);
    expect(src).toContain('status?: ToolCallStatus;');
    expect(src).toContain("from '@modules/execution'");
    // 旧的独立字面量联合与裸值写法均不得回流
    expect(countOccurrences(src, "status?: 'running'")).toBe(0);
    expect(countOccurrences(src, "'running' | 'completed' | 'failed'")).toBe(0);
  });

  it('前端消息块 `FrontendMessageBlock.toolCall.status` 引用共享类型', () => {
    const src = read(UNIFIED_MESSAGE);
    expect(src).toContain('status?: ToolCallStatus;');
    expect(countOccurrences(src, "'running' | 'completed' | 'failed'")).toBe(0);
  });

  it('chunk 映射层（reactEventsToChunks）无裸字面量，取值来自共享常量', () => {
    const src = read(CHUNK_MAPPER);
    expect(src).toContain('status: TOOL_CALL_INITIAL_STATUS,');
    expect(src).toContain('TOOL_CALL_FAILED_STATUS');
    expect(src).toContain('TOOL_CALL_COMPLETED_STATUS');
    // 代码形态断言（注释中的示例字面量不计）
    expect(countOccurrences(src, "status: 'running'")).toBe(0);
    expect(countOccurrences(src, "? 'failed'")).toBe(0);
    expect(countOccurrences(src, ": 'completed'")).toBe(0);
  });

  it('SSE 桥接（chat-handlers）兜底状态来自共享常量', () => {
    const src = read(SSE_HANDLER);
    // 1 处 import + 2 处兜底（两条 SSE 路径）
    expect(countOccurrences(src, 'TOOL_CALL_INITIAL_STATUS')).toBe(3);
    expect(countOccurrences(src, "|| 'running'")).toBe(0);
  });

  it('CoreAPIImpl 不再把工具调用状态断言降级为裸 string', () => {
    const src = read(CORE_API_IMPL);
    expect(countOccurrences(src, 'toolCall?: { status?: string }')).toBe(0);
    expect(src).toContain('chunk.toolCall?.status');
  });

  it('`SubAgentProgress.status` 保持独立：不跨层引用 execution，且有裁定注释', () => {
    const src = read(TOOL_PROGRESS);
    // 分层：utils(infra) 不得依赖 execution(service)
    expect(countOccurrences(src, '@modules/execution')).toBe(0);
    // 裁定显式化（防"看着像就合并"）
    expect(src).toContain('≠ 工具调用状态');
    expect(src).toContain("status: 'running' | 'completed' | 'failed';");
  });
});
