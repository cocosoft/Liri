// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWorkspaceRootSection,
  listTopLevelDirs,
} from '../../src/chat/services/context/systemPromptAssembly';
import {
  windowStartForBudget,
  computePaginationPoint,
} from '../../src/chat/services/context/contextTruncation';
// 2026-11-18（§48 拆分批 2/3）：分层判定与提示、think 标签已外移到独立模块
import {
  isCodeContextMessage,
  LAYERING_HINT,
  LAYERING_HINT_CODE,
} from '../../src/chat/services/context/contextLayering';
import {
  stripOrphanToolTags,
  stripThinkResponseTags,
  ensureThinkResponseTags,
} from '../../src/chat/services/context/thinkTags';

describe('D5② 取回增强 — 代码/长文档会话判定与提示', () => {
  test('代码库/重构类 user 消息判定为 code-context', () => {
    expect(
      isCodeContextMessage([
        { role: 'user', content: '帮我重构整个项目里所有跨文件的引用' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '继续' },
      ])
    ).toBe(true);
  });
  test('普通闲聊消息判定为非 code-context', () => {
    expect(
      isCodeContextMessage([
        { role: 'user', content: '帮我扫描 AI 动态做一份日报' },
      ])
    ).toBe(false);
  });
  test('代码版提示存在且与通用提示不同（更强取回语义）', () => {
    expect(LAYERING_HINT_CODE.length).toBeGreaterThan(0);
    expect(LAYERING_HINT_CODE).not.toBe(LAYERING_HINT);
  });
});

describe('stripOrphanToolTags — 孤立工具调用标签残片剥离', () => {
  test('剥离残缺工具调用闭合标签（P3 场景：模型输出 </parameter></invoke></tool_calls>）', () => {
    const input = `<response>继续读取数字化建设方案和部门职责文件：</parameter>
</invoke>
</tool_calls>`;
    const stripped = stripThinkResponseTags(input);
    const result = stripOrphanToolTags(stripped);
    expect(result).toBe('继续读取数字化建设方案和部门职责文件：');
  });

  test('剥离 scrubber REJECT 后残留的工具调用开标签', () => {
    const input = `继续读取其余文件：
<tool_calls>
<invoke name="file_convert">
<parameter name="file_path">E:\\docs\\a.docx</parameter>
</invoke>
</tool_calls>`;
    const result = stripOrphanToolTags(input);
    // 所有工具调用标签被剥离，参数内容保留（结尾 trim 去除多余换行）
    expect(result).toBe('继续读取其余文件：\n\n\nE:\\docs\\a.docx');
  });

  test('正常文本不受影响', () => {
    const input = '已完成前两份招标文件的转换，继续处理。';
    expect(stripOrphanToolTags(input)).toBe(input);
  });

  test('剥离 DeepSeek DSML 特殊 token 残渣（2026-11-06）', () => {
    // 真机 session_mw4n94q10d049b6b3e 07:31:08Z 的正文形态
    const input = `<bash">
<parameter name="command">cd && dir /b</｜｜DSML｜｜ parameter>
</invoke>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;
    const result = stripOrphanToolTags(input);
    expect(result).not.toContain('｜｜DSML｜｜');
    expect(result).toContain('cd && dir /b');
  });

  test('空内容不崩', () => {
    expect(stripOrphanToolTags('')).toBe('');
    expect(stripOrphanToolTags('   ')).toBe('');
    expect(stripOrphanToolTags(undefined as unknown as string)).toBe(undefined);
  });

  test('与 ensureThinkResponseTags + stripThinkResponseTags 组合还原真实场景', () => {
    // 模拟模型输出残缺工具调用（开标签丢失）
    const raw =
      '<response>继续读取数字化建设方案和部门职责文件：</parameter>\n</invoke>\n</tool_calls>';
    const repaired = ensureThinkResponseTags(repairLike(raw));
    const stripped = stripThinkResponseTags(repaired);
    const cleaned = stripOrphanToolTags(stripped);
    expect(cleaned).toBe('继续读取数字化建设方案和部门职责文件：');
  });
});

function repairLike(content: string): string {
  // 模拟 repairImageUrls（此处无图片 URL，原样返回）
  return content;
}

// ─── C-2（2026-09-02，v4 §7.2）：map 前置预算切窗 ──────────────────────

function rounds(
  n: number,
  contentLen: number
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  const content = 'x'.repeat(contentLen);
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', content: `第${i}轮 ${content}` });
    out.push({ role: 'assistant', content: `回答${i} ${content}` });
  }
  return out;
}

describe('buildWorkspaceRootSection — 聊天链工作区基准提示（2026-11-10）', () => {
  test('缺省/空工作区 ⇒ 空串（不注入，零行为变更）', () => {
    expect(buildWorkspaceRootSection()).toBe('');
    expect(buildWorkspaceRootSection('')).toBe('');
  });

  test('显式工作区 ⇒ 给出相对路径基准与越界后果', () => {
    const text = buildWorkspaceRootSection(
      'C:\\Users\\u\\.pyapp\\workspaces\\s1'
    );
    expect(text).toContain('C:\\Users\\u\\.pyapp\\workspaces\\s1');
    expect(text).toContain('相对路径基准');
    expect(text).toContain('人工确认');
  });
});

/**
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30` 复盘，P3）：工作区一级目录注入。
 *
 * 真机：模型被告知基准是仓库根，但真实工程根是 `app/` ⇒ 每轮先探一层目录，白耗 1–2 轮。
 */
describe('工作区一级目录（P3，2026-11-24）', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'liri-ws-layout-'));
    for (const d of ['app', 'client', 'docs', 'node_modules', '.git']) {
      mkdirSync(join(root, d));
    }
  });
  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 清理失败不影响断言
    }
  });

  test('listTopLevelDirs：只列目录，排除 node_modules/.git，按名称排序', () => {
    expect(listTopLevelDirs(root)).toEqual(['app', 'client', 'docs']);
  });

  test('listTopLevelDirs：目录不存在 ⇒ 空数组（不抛错、不臆造）', () => {
    expect(listTopLevelDirs(join(root, 'not-exist'))).toEqual([]);
  });

  test('listTopLevelDirs：limit 生效', () => {
    expect(listTopLevelDirs(root, 2)).toEqual(['app', 'client']);
  });

  test('提示段附带一级目录 + 防"仓库根=工程根"误判的指引', () => {
    const text = buildWorkspaceRootSection('/ws', ['app', 'client']);
    expect(text).toContain('一级目录');
    expect(text).toContain('`app`');
    expect(text).toContain('`client`');
    expect(text).toContain('不要按"仓库根 = 工程根"的习惯猜路径');
  });

  test('未提供目录 ⇒ 与旧文案一致（不出现一级目录段）', () => {
    expect(buildWorkspaceRootSection('/ws')).not.toContain('一级目录');
  });
});

describe('windowStartForBudget — C-2 构建期预算切窗', () => {
  test('未超窗 → 0（零开销，语义不变）', async () => {
    const msgs = rounds(3, 50);
    const start = await windowStartForBudget(msgs, 128_000);
    expect(start).toBe(0);
  });

  test('超窗大会话 → 切掉头部旧轮次，切点对齐用户轮次且不侵入尾保护区', async () => {
    const msgs = rounds(60, 800);
    const start = await windowStartForBudget(msgs, 2000);
    expect(start).toBeGreaterThan(0);
    // C-3：切点落在 user 消息上（不切开 user→assistant 轮配对）
    expect(msgs[start].role).toBe('user');
    // 尾保护区：至少保留 3 条以上（含当前轮）
    expect(start).toBeLessThan(msgs.length - 3);
    // 头部确实被丢弃（映射侧只处理幸存窗口）
    const kept = msgs.slice(start);
    expect(kept[0]).toBe(msgs[start]);
    expect(kept.length).toBe(msgs.length - start);
  });

  test('无/非法预算 → 0（不启用）', async () => {
    const msgs = rounds(20, 800);
    expect(await windowStartForBudget(msgs, 0)).toBe(0);
    expect(await windowStartForBudget(msgs, -1)).toBe(0);
    expect(await windowStartForBudget([], 128_000)).toBe(0);
  });

  test('C-3 配对硬约束：切点落在 user 轮次起点，保留段头部不允许孤立 tool/result', async () => {
    // 每轮 = [user, assistant(大正文), tool(结果), tool(结果)]（模拟 1 个 assistant 带 2 个 tool_call）
    const big = 'y'.repeat(1600);
    const msgs: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < 40; i++) {
      msgs.push({ role: 'user', content: `第${i}轮指令 ${big}` });
      msgs.push({ role: 'assistant', content: `第${i}轮执行 ${big}` });
      msgs.push({ role: 'tool', content: `第${i}轮结果A ${big}` });
      msgs.push({ role: 'tool', content: `第${i}轮结果B ${big}` });
    }
    const { cutIndex } = await computePaginationPoint(msgs, 3000);
    if (cutIndex === 0) return; // 极端情形不切也安全（全量交给 compact/truncate）
    // 切点必须是完整用户轮次起点（user）——轮内 [user,assistant,tool,tool] 配对整体保留，
    // 保留段不可能以"孤立 tool/result"开头（其 assistant(tool_calls) 已随整轮保留）
    expect(msgs[cutIndex].role).toBe('user');
    const kept = msgs.slice(cutIndex);
    expect(kept[0].role).toBe('user');
  });
});
