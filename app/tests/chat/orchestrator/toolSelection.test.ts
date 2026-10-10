/**
 * P2-1i —— S3「本轮工具集选择」任务类型判定 + 裁剪契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1i；实现见
 * `src/chat/orchestrator/streamMessageToolSelection.ts`。
 *
 * 锁定（与拆分前逐字等价）：
 * 1. 任务类型优先级：**显式 `metadata.taskType`** > **本地 LLM 端点 ⇒ `local`** > `undefined`；
 * 2. **K4**：`!taskType && projectId && 执行意图` ⇒ 提升 `coding`（并置 `promotedByExecutionIntent`）；
 * 3. **D7/L2**：带图 ⇒ 追加 `image` 额外类别（否则 `image_analysis` 被裁 ⇒ 识图链路不可用）；
 * 4. `trimmed` / `removedNames` 与 `filterToolsByTask` 同口径（`filtered.length !== tools.length`）。
 */
import { describe, expect, it } from 'bun:test';

import { selectToolsForTurn } from '../../../src/chat/orchestrator/streamMessageToolSelection.js';
import type { ToolDefinition } from '@modules/ai';

/** 仅构造本函数读取的字段（`function.name`；类别判定只认工具名） */
const def = (name: string): ToolDefinition =>
  ({ type: 'function', function: { name } }) as unknown as ToolDefinition;

const LOCAL_URL = 'http://localhost:11434/v1';
const REMOTE_URL = 'https://api.deepseek.com/v1';

function run(over: Partial<Parameters<typeof selectToolsForTurn>[0]> = {}) {
  return selectToolsForTurn({
    tools: [def('file_read'), def('bash'), def('image_analysis')],
    explicitTaskType: undefined,
    baseUrl: REMOTE_URL,
    projectId: undefined,
    lastUserText: '你好',
    hasImages: false,
    ...over,
  });
}

describe('P2-1i S3 本轮工具集选择 · 任务类型判定 + 裁剪', () => {
  it('显式 `taskType` 优先于本地端点判定', () => {
    const r = run({ explicitTaskType: 'coding', baseUrl: LOCAL_URL });
    expect(r.taskType).toBe('coding');
    expect(r.promotedByExecutionIntent).toBe(false);
    // coding 含 shell ⇒ bash 保留；default 会裁掉（对照见下一条）
    expect(r.tools.map((t) => t.function?.name)).toEqual(['file_read', 'bash']);
  });

  it('无显式 + 本地端点 ⇒ `local`（只读轻量集：shell/image 均被裁）', () => {
    const r = run({ baseUrl: LOCAL_URL });
    expect(r.taskType).toBe('local');
    expect(r.tools.map((t) => t.function?.name)).toEqual(['file_read']);
    expect(r.trimmed).toBe(true);
    expect(r.removedNames).toEqual(['bash', 'image_analysis']);
  });

  it('K4：`projectId` + 执行意图 ⇒ 提升 `coding`（并置留痕标记）', () => {
    const r = run({
      projectId: 'proj-1',
      lastUserText: '帮我写单测并跑 bun test',
    });
    expect(r.taskType).toBe('coding');
    expect(r.promotedByExecutionIntent).toBe(true);
    expect(r.tools.map((t) => t.function?.name)).toContain('bash');
  });

  it('K4 前置不满足 ⇒ **不**提升（无 `projectId` / 非执行意图）', () => {
    const noProject = run({
      projectId: undefined,
      lastUserText: '帮我写单测并跑 bun test',
    });
    expect(noProject.taskType).toBeUndefined();
    expect(noProject.promotedByExecutionIntent).toBe(false);

    const noIntent = run({
      projectId: 'proj-1',
      lastUserText: '什么是 PDCA？',
    });
    expect(noIntent.taskType).toBeUndefined();
    expect(noIntent.promotedByExecutionIntent).toBe(false);
  });

  it('非字符串 `explicitTaskType` 视为未指定（回落端点判定）', () => {
    const r = run({ explicitTaskType: 123, baseUrl: LOCAL_URL });
    expect(r.taskType).toBe('local');
  });

  it('D7/L2：带图 ⇒ `image` 类额外保留（否则 `image_analysis` 被裁）', () => {
    const without = run({ hasImages: false });
    expect(without.tools.map((t) => t.function?.name)).not.toContain(
      'image_analysis'
    );

    const withImages = run({ hasImages: true });
    expect(withImages.tools.map((t) => t.function?.name)).toContain(
      'image_analysis'
    );
  });

  it('无裁剪（全部命中白名单）⇒ `trimmed=false` 且 `removedNames=[]`', () => {
    const r = run({ tools: [def('file_read'), def('grep')] });
    expect(r.trimmed).toBe(false);
    expect(r.removedNames).toEqual([]);
    expect(r.tools).toHaveLength(2);
  });
});
