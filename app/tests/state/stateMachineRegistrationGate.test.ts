/**
 * R09-006 状态机登记豁免清单**自洽守卫**（状态机规范管理方案 阶段 1.4，2026-10-12）。
 *
 * `lint:arch` 的 R09-006 保证「候选 ⊆ 目录 ∪ 豁免」；本测试补另一半：**豁免条目本身必须真实、带理由、不陈旧**
 * （否则清单会退化为"随手加一行"的垃圾桶，门禁形同虚设）。
 *
 * 断言：
 * ① 每条豁免的 `file` 真实存在，且 `exportName` **确实**由该文件导出（陈旧豁免 ⇒ 红，须删除）；
 * ② 每条豁免必须带 `reason`（"显式且附理由" = 阶段 1.4 验收口径）；
 * ③ 豁免键唯一（无重复登记）；
 * ④ 豁免**不得**与定义目录的 `verifyRef` 锚点重复（同一 `file#exportName` 只能有一处登记）。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_MACHINES } from '../../src/state/engine/stateMachineCatalog.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const ALLOWLIST = join(REPO_ROOT, 'scripts', 'state-machine-allowlist.json');

interface Exemption {
  file: string;
  exportName: string;
  reason?: string;
}

const exemptions = (
  JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as { exemptions: Exemption[] }
).exemptions;

/** 该文件是否**导出**了 `exportName`（enum 或 const 声明） */
function isExported(file: string, exportName: string): boolean {
  const src = readFileSync(join(REPO_ROOT, file), 'utf8');
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^export\\s+(?:enum|const)\\s+${escaped}\\b`, 'm').test(
    src
  );
}

describe('R09-006 状态机豁免清单守卫（阶段 1.4）', () => {
  it('清单非空且每条豁免带 reason（"显式且附理由"）', () => {
    expect(exemptions.length).toBeGreaterThan(0);
    for (const e of exemptions) {
      expect(e.file.length).toBeGreaterThan(0);
      expect(e.exportName.length).toBeGreaterThan(0);
      expect((e.reason ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('豁免条目真实有效：文件存在且确实导出该符号（不陈旧）', () => {
    const stale: string[] = [];
    for (const e of exemptions) {
      if (!existsSync(join(REPO_ROOT, e.file))) {
        stale.push(`${e.file} —— 文件不存在`);
        continue;
      }
      if (!isExported(e.file, e.exportName)) {
        stale.push(`${e.file}#${e.exportName} —— 该文件未导出此符号`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('豁免键唯一（无重复登记）', () => {
    const keys = exemptions.map((e) => `${e.file}#${e.exportName}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('豁免与定义目录**不重叠**（同一 file#exportName 只登记一处）', () => {
    const anchors = new Set(
      STATE_MACHINES.filter((m) => m.verifyRef).map((m) =>
        `${m.verifyRef!.module}#${m.verifyRef!.exportName}`.toLowerCase()
      )
    );
    const overlapped = exemptions
      .map((e) => `${e.file}#${e.exportName}`)
      .filter((k) => anchors.has(k.toLowerCase()));
    expect(overlapped).toEqual([]);
  });
});
