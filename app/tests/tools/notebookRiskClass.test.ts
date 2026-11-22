/**
 * P1-4（2026-11-22，G4）：`notebook` 的「执行单元格」按 `shell` 分档。
 *
 * 修复前整工具固定 `riskClass='write'`（WRITE_LOCAL）⇒ 在会话 `auto-local` /
 * 沙箱豁免下可能被**自动放行**，而 `executeCell` 实际执行任意代码。
 */
import { describe, expect, it } from 'bun:test';

import { NotebookToolAdapter } from '@modules/tools/adapters/NotebookToolAdapter';
import { deriveToolRiskClass } from '@modules/tools/toolRiskClass';

describe('notebook：执行单元格按 shell 分档（G4）', () => {
  const tool = new NotebookToolAdapter();

  it('能力位声明为 execution（与回环中的"执行任意代码"一致）', () => {
    expect(tool.sandboxLevel).toBe('execution');
  });

  it('executeCell / executeAllCells ⇒ shell（不得被判 write 自动放行）', () => {
    expect(tool.riskClassFor({ action: 'executeCell' })).toBe('shell');
    expect(tool.riskClassFor({ action: 'executeAllCells' })).toBe('shell');
    expect(deriveToolRiskClass(tool, { action: 'executeCell' })).toBe('shell');
    expect(deriveToolRiskClass(tool, { action: 'executeAllCells' })).toBe(
      'shell'
    );
  });

  it('本地写/读类 action ⇒ write（保持原有保守档）', () => {
    for (const action of [
      'create',
      'open',
      'save',
      'addCodeCell',
      'addMarkdownCell',
      'export',
      'list',
      'delete',
    ]) {
      expect(deriveToolRiskClass(tool, { action })).toBe('write');
    }
    // 缺省/未知 action ⇒ 回退静态声明（write），不因动态分档而静默放宽
    expect(deriveToolRiskClass(tool, {})).toBe('write');
  });
});
