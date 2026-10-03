/**
 * mermaidLint 单测（P1-1②，2026-09-28）
 * 覆盖：合法/非法图类型、空块、仅注释、括号与引号不配平、多块定位、非 mermaid 围栏忽略、~~~ 围栏、未闭合块
 */
import { describe, expect, it } from 'bun:test';
import {
  formatMermaidIssues,
  hasMermaidIssues,
  lintMermaidBlocks,
} from '@modules/utils/mermaidLint';

describe('mermaidLint（零依赖结构预检）', () => {
  it('合法 graph / sequenceDiagram ⇒ 无问题', () => {
    expect(lintMermaidBlocks('```mermaid\ngraph TD;\nA-->B;\n```')).toEqual([]);
    expect(
      lintMermaidBlocks('```mermaid\nsequenceDiagram\nA->>B: hi\n```')
    ).toEqual([]);
  });

  it('带 init 指令与注释的合法图 ⇒ 无问题', () => {
    const text =
      '```mermaid\n%%{init: {"theme":"dark"}}%%\n%% 说明\nflowchart LR\nA-->B\n```';
    expect(lintMermaidBlocks(text)).toEqual([]);
  });

  it('图类型拼错/臆造 ⇒ 报「无法识别」', () => {
    const issues = lintMermaidBlocks('```mermaid\ngraphx TD\nA-->B\n```');
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain('无法识别');
  });

  it('空块 ⇒ 报「为空」', () => {
    const issues = lintMermaidBlocks('```mermaid\n\n```');
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain('为空');
  });

  it('只有注释 ⇒ 报「缺少图形定义」', () => {
    const issues = lintMermaidBlocks('```mermaid\n%% 待补\n```');
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain('缺少图形定义');
  });

  it('括号 / 引号不配平 ⇒ 分别报出', () => {
    expect(
      lintMermaidBlocks('```mermaid\ngraph TD;\nA[label --> B;\n```')[0].reason
    ).toContain('配平');
    expect(
      lintMermaidBlocks('```mermaid\ngraph TD;\nA["x] --> B;\n```')[0].reason
    ).toContain('引号');
  });

  it('多块 ⇒ 只报出有问题的那块，且 blockIndex 正确定位', () => {
    const text = [
      '```mermaid',
      'graph TD;',
      'A-->B;',
      '```',
      '正文',
      '```mermaid',
      'graphx TD;',
      'A-->B;',
      '```',
    ].join('\n');
    const issues = lintMermaidBlocks(text);
    expect(issues).toHaveLength(1);
    expect(issues[0].blockIndex).toBe(1);
  });

  it('非 mermaid 围栏与正文中的字面量 ⇒ 忽略', () => {
    const text = '```js\nconst a = "```mermaid";\n```\n普通文字 graphx TD';
    expect(lintMermaidBlocks(text)).toEqual([]);
  });

  it('~~~mermaid 围栏同样识别', () => {
    const issues = lintMermaidBlocks('~~~mermaid\ngraphx TD\n~~~');
    expect(issues).toHaveLength(1);
  });

  it('未闭合的 mermaid 块也要检查（不因缺收尾而漏检）', () => {
    expect(hasMermaidIssues('```mermaid\ngraphx TD')).toBe(true);
  });

  it('hasMermaidIssues 便捷判定与主函数一致', () => {
    expect(hasMermaidIssues('```mermaid\ngraph TD;\nA-->B;\n```')).toBe(false);
    expect(hasMermaidIssues('```mermaid\n\ngraph TD;\nA-->B;\n```')).toBe(
      false
    );
  });

  it('formatMermaidIssues：补"第几个 / 起始行"定位，reason 原样透传', () => {
    // 第 2 块起始于第 5 行（1 起），故 line=5、blockIndex=1 ⇒ 展示为"第 2 个图表"
    const text = [
      '```mermaid',
      'graph TD;',
      'A-->B;',
      '```',
      '```mermaid',
      'graphx TD;',
      '```',
    ].join('\n');
    const issues = lintMermaidBlocks(text);
    expect(issues).toHaveLength(1);

    const rendered = formatMermaidIssues(issues);
    expect(rendered).toBe(
      `- 第 2 个图表（起始行 ${issues[0].line}）：${issues[0].reason}`
    );
    expect(rendered).toContain('无法识别');
  });

  it('formatMermaidIssues：空清单 ⇒ 空串（调用方据此不注入空指令）', () => {
    expect(formatMermaidIssues([])).toBe('');
  });
});
