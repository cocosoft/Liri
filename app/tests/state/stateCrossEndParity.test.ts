/**
 * R09-012（治理方案 P1-2，2026-11-24）：**跨端状态词汇一致性**。
 *
 * 缺口：前端状态词汇（工具结果态 / 任务状态表）此前完全不入任何目录，
 * 后端改了取值或前端自行改名都无人发现。
 *
 * 本测试以 `shared/stateVocabulary.ts`（前端经 `@shared/*` 引用）为准：
 * ① `machineId` 必须存在于定义目录；
 * ② `clientFile` 真实存在；
 * ③ 每个前端取值要么能映射到后端 `states`（`aliases` 或同名），
 *    要么在 `uiOnly` 中声明并带非空理由；
 * ④ 不允许"既不可映射又无理由"的裸取值。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_MACHINES } from '@openliri/infra/state/engine/stateMachineCatalog';
import { CLIENT_STATE_VOCABULARY } from '../../../shared/stateVocabulary';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const byId = new Map(STATE_MACHINES.map((m) => [m.id, m]));

describe('R09-012 前后端状态词汇一致性', () => {
  it('词汇表非空（防筛选失效空跑）', () => {
    expect(CLIENT_STATE_VOCABULARY.length).toBeGreaterThanOrEqual(2);
  });

  for (const entry of CLIENT_STATE_VOCABULARY) {
    it(`${entry.machineId}：机器存在、前端文件存在、取值可解释`, () => {
      const machine = byId.get(entry.machineId);
      expect(machine, `目录缺机器: ${entry.machineId}`).toBeDefined();
      expect(
        existsSync(join(REPO_ROOT, entry.clientFile)),
        `前端文件不存在: ${entry.clientFile}`
      ).toBe(true);

      const states = new Set(machine!.states);
      const unmapped: string[] = [];
      const blankReasons: string[] = [];

      for (const value of entry.values) {
        const uiOnlyReason = entry.uiOnly?.[value];
        if (uiOnlyReason !== undefined) {
          if (uiOnlyReason.trim().length === 0) blankReasons.push(value);
          continue;
        }
        const mapped = entry.aliases?.[value] ?? value;
        if (!states.has(mapped)) unmapped.push(`${value}→${mapped}`);
      }

      expect({ machineId: entry.machineId, unmapped }).toEqual({
        machineId: entry.machineId,
        unmapped: [],
      });
      expect({ machineId: entry.machineId, blankReasons }).toEqual({
        machineId: entry.machineId,
        blankReasons: [],
      });
    });
  }
});
