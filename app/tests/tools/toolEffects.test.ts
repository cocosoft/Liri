// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P1-2（2026-10-05）：工具幂等/副作用声明 —— 不变量测试。
 *
 * 「漏声明 ⇒ 失败」的第一道闸是**编译期**（`TOOL_EFFECTS: Record<ToolName, ToolEffect>`），
 * 本测试补运行时守卫：① 声明覆盖全部内建工具；② 与实际元数据一致（`readOnly ⇒ idempotent`，
 * 例外显式登记）；③ 重试策略 `shouldBlindRetryTool` 语义正确。
 */
import { describe, it, expect } from 'bun:test';
import {
  TOOL_EFFECTS,
  TOOL_EFFECTS_COUNT,
  resolveToolEffect,
  shouldBlindRetryTool,
} from '../../src/tools/toolEffects.js';
import {
  TOOL_NAMES,
  TOOL_NAMES_COUNT,
} from '../../src/constants/toolNames.generated.js';
import { getAllBuiltinToolLoaders } from '../../src/tools/utils/ToolManagerUtils.js';

/**
 * `readOnly === true` 但**刻意**声明为非幂等的工具（有用户可见副作用 ⇒ 不可盲目重放）。
 * 目前仅 `ask_user_question`（重复提问 = 重复打扰用户）。
 */
const READONLY_NON_IDEMPOTENT_EXCEPTIONS = new Set<string>([
  'ask_user_question',
]);

describe('TOOL_EFFECTS 声明覆盖（13-P1-2 不变量）', () => {
  it('覆盖全部内建工具名（数量与生成清单一致）', () => {
    expect(TOOL_EFFECTS_COUNT).toBe(TOOL_NAMES_COUNT);
    for (const name of TOOL_NAMES) {
      expect(resolveToolEffect(name)).toBeDefined();
    }
  });

  it('声明表不含生成清单之外的名字（防拼写漂移）', () => {
    const known = new Set<string>(TOOL_NAMES);
    for (const key of Object.keys(TOOL_EFFECTS)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it('运行时一致性：readOnly ⇒ idempotent（例外仅 ask_user_question）', () => {
    for (const loader of getAllBuiltinToolLoaders()) {
      if (!loader) continue;
      const tool = (
        loader as unknown as () => {
          getInfo?: () => {
            name: string;
            readOnly: boolean;
            idempotent?: boolean;
          };
        } | null
      )();
      if (!tool) continue;
      const info = tool.getInfo?.();
      // 未走 BaseTool 的工具（模块/适配器自有 getInfo）不带本字段 ⇒ 跳过（消费方按保守处理）
      if (!info || info.idempotent === undefined) continue;
      if (info.readOnly && !READONLY_NON_IDEMPOTENT_EXCEPTIONS.has(info.name)) {
        expect(info.idempotent).toBe(true);
      }
    }
  });

  it('运行时一致性：暴露 idempotent 的工具其 sideEffect 亦必须存在且取值合法', () => {
    for (const loader of getAllBuiltinToolLoaders()) {
      if (!loader) continue;
      const tool = (
        loader as unknown as () => {
          getInfo?: () => { idempotent?: boolean; sideEffect?: string };
        } | null
      )();
      if (!tool) continue;
      const info = tool.getInfo?.();
      if (!info || info.idempotent === undefined) continue;
      expect(['none', 'local', 'external']).toContain(
        info.sideEffect as string
      );
    }
  });
});

describe('shouldBlindRetryTool（非幂等禁盲重试）', () => {
  it('只读工具 ⇒ 允许盲重试', () => {
    expect(shouldBlindRetryTool('file_read')).toBe(true);
    expect(shouldBlindRetryTool('grep')).toBe(true);
    expect(shouldBlindRetryTool('web_search')).toBe(true);
  });

  it('写 / 对外工具 ⇒ 禁止盲重试', () => {
    expect(shouldBlindRetryTool('file_write')).toBe(false);
    expect(shouldBlindRetryTool('bash')).toBe(false);
    expect(shouldBlindRetryTool('agent')).toBe(false);
    expect(shouldBlindRetryTool('ask_user_question')).toBe(false);
  });

  it('**未声明**（MCP / 插件工具）⇒ 保守禁止（无法证明幂等即不重试）', () => {
    expect(resolveToolEffect('some_mcp_tool_not_declared')).toBeUndefined();
    expect(shouldBlindRetryTool('some_mcp_tool_not_declared')).toBe(false);
  });

  it('对外副作用工具被标为 external（供调用方决定询问/补偿）', () => {
    expect(resolveToolEffect('bash')?.sideEffect).toBe('external');
    expect(resolveToolEffect('file_write')?.sideEffect).toBe('local');
    expect(resolveToolEffect('file_read')?.sideEffect).toBe('none');
  });
});
