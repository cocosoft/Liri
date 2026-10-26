/**
 * F7（2026-10-27）：路径不存在时给出**同级目录候选**。
 *
 * 实测来源（Liri 报告 P2-1）：模型沿用重构前的路径 `app/src/modules/...`，
 * 而真实目录是 `app/src/runtime/`、`app/src/permission/`；旧提示只说"请确认拼写正确"，
 * 模型改不动，只能反复重试同一路径。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildMissingSegmentCandidateHint,
  checkPathAccessibility,
} from '../../src/tools/utils/ToolUtils.js';

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-f7-'));
  for (const name of ['runtime', 'permission', 'chat']) {
    mkdirSync(join(root, name), { recursive: true });
  }
  return root;
}

describe('F7：路径不存在时给出同级候选', () => {
  it('缺失层级存在兄弟目录 ⇒ 提示列出候选（不再只说"请确认拼写"）', () => {
    const root = makeTree();
    const hint = buildMissingSegmentCandidateHint(
      join(root, 'modules', 'config')
    );
    expect(hint).not.toBeNull();
    expect(hint!).toContain('"modules"');
    expect(hint!).toContain('runtime');
    expect(hint!).toContain('permission');
  });

  it('checkPathAccessibility 的 suggestions 含候选提示', () => {
    const root = makeTree();
    const result = checkPathAccessibility(
      join(root, 'modules', 'config'),
      '搜索目录'
    );
    expect(result.accessible).toBe(false);
    expect(result.suggestions?.some((s) => s.includes('同级现有目录'))).toBe(
      true
    );
  });

  it('负向对照：路径存在 ⇒ 可访问，且不产生候选提示', () => {
    const root = makeTree();
    const result = checkPathAccessibility(join(root, 'runtime'), '搜索目录');
    expect(result.accessible).toBe(true);
    expect(result.suggestions).toBeUndefined();
  });
});
