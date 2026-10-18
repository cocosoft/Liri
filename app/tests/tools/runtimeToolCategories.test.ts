/**
 * I-2：运行期注册工具类别表 + 登记断言。
 *
 * 覆盖：
 * ① 已知运行期名字（office/calendar/mail/knowledge/workflow）均已登记且不落 `misc`；
 * ② wire 形态（冒号 → 下划线）仍能查到同一类别（`WIRE_KEYED_CATEGORIES` 派生）。
 *
 * 注：本测试是「已知运行期面」的 CI 断言；新增运行期工具若未登记，应在此追加名字并使其失败，
 * 而不是只依赖进程内 `logger.warn`。
 */
import { describe, expect, it } from 'bun:test';
import { getToolCategory } from '../../src/tools/toolCategories.js';
import { toWireToolName } from '../../src/tools/toolNameCodec.js';

const RUNTIME_NAMES = [
  'office:workflow',
  'office:doc-pipeline',
  'calendar:add',
  'calendar:list',
  'calendar:update',
  'calendar:delete',
  'mail:send',
  'knowledge_search',
  'knowledge_write',
  'knowledge_delete',
  'knowledge_import',
  'knowledge_export',
  'knowledge_restore',
  'knowledge_snapshots',
  'workflow:run-template',
] as const;

describe('I-2 运行期工具类别登记', () => {
  it('已知运行期名字均已登记且不落 misc', () => {
    for (const name of RUNTIME_NAMES) {
      expect(getToolCategory(name)).not.toBe('misc');
    }
  });

  it('wire 形态能查到同一类别', () => {
    for (const name of RUNTIME_NAMES) {
      const wire = toWireToolName(name);
      expect(getToolCategory(wire)).toBe(getToolCategory(name));
    }
  });
});
