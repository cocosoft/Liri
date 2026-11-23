/**
 * P1-3（2026-11-22，G3）：`web_fetch` 的 `saveToFile` 形态不是只读。
 *
 * 背景：`TOOL_EFFECTS.web_fetch = none`，`deriveToolRiskClass` 在"声明 none 但 `isReadOnly()` 为 false"
 * 时会落 `undeclared`（ask）。旧实现 `isReadOnly()` 只看 HTTP method ⇒ GET + `saveToFile:true`
 * 仍被派生为 `read`（自动放行），而该形态会写 downloads 目录并注册 FileRegistry。
 */
import { describe, expect, it } from 'bun:test';

import { WebFetchTool } from '@openliri/tool-web';
import { deriveToolRiskClass } from '@modules/tools/toolRiskClass';

describe('web_fetch：saveToFile 纳入只读判定（G3）', () => {
  const tool = new WebFetchTool();

  it('GET（不落盘）⇒ 只读', () => {
    expect(tool.isReadOnly({ method: 'GET' })).toBe(true);
    expect(tool.isReadOnly({})).toBe(true);
  });

  it('GET + saveToFile ⇒ 非只读（会写盘 + 注册 FileRegistry）', () => {
    expect(tool.isReadOnly({ method: 'GET', saveToFile: true })).toBe(false);
    expect(tool.isConcurrencySafe({ method: 'GET', saveToFile: true })).toBe(
      false
    );
  });

  it('非 GET ⇒ 非只读', () => {
    expect(tool.isReadOnly({ method: 'POST' })).toBe(false);
  });

  it('风险派生：saveToFile 形态不得被判 read（应落 undeclared ⇒ ask）', () => {
    expect(deriveToolRiskClass(tool, { method: 'GET' })).toBe('read');
    expect(
      deriveToolRiskClass(tool, { method: 'GET', saveToFile: true })
    ).not.toBe('read');
  });
});
