/**
 * FileIOLoopDetector 单元守卫（2026-09-26 新增）。
 *
 * 背景：本检测器此前**零测试覆盖**。因 `query/tool-constants.ts` 的清单抄的是 Claude Code
 * 工具名（`read_file` / `write_file` / …）且调用方入参键不符 ⇒ `isRead` / `isWrite` 恒 false，
 * 检测器**实质失效**（fail-open：漏检不误检）。②修复后它真正生效（默认 `enabled: true`，
 * 阈值来自 `LOOP_FILE_IO_WARNING`=3 / `LOOP_FILE_IO_BLOCK`=4），故补本守卫：断言
 * 「真实注册名 → 被追踪 → 阈值行为」这条链路成立；名字被改回漂移名时本用例即转红。
 *
 * ⚠️ 未覆盖的一半（如实）：调用方 `TAORLoop.act()` 按 `file_path` / `notebook_path` / `searchPath`
 * 提取路径，该处**无自动化守卫**，改动需手工核对（已记台账）。
 */
import { describe, expect, it } from 'bun:test';
import { createFileIOLoopDetector } from '../../src/query/FileIOLoopDetector';

describe('FileIOLoopDetector：清单与真实注册名对齐后真正生效', () => {
  it('真实读工具 file_read 连续读同一文件+同区域：第 3 次警告、第 4 次阻断', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const p = 'src/a.ts';

    expect(d.checkBeforeAccess('file_read', p, 0, 10).warning).toBe(false);
    expect(d.checkBeforeAccess('file_read', p, 0, 10).warning).toBe(false);

    const warned = d.checkBeforeAccess('file_read', p, 0, 10);
    expect(warned.blocked).toBe(false);
    expect(warned.warning).toBe(true);

    const blocked = d.checkBeforeAccess('file_read', p, 0, 10);
    expect(blocked.blocked).toBe(true);
    expect(String(blocked.message)).toContain('连续读');
  });

  it('真实写工具 file_write 连续写同一文件：第 4 次阻断', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const p = 'src/b.ts';

    for (let i = 0; i < 3; i++) {
      expect(d.checkBeforeAccess('file_write', p).blocked).toBe(false);
    }

    const blocked = d.checkBeforeAccess('file_write', p);
    expect(blocked.blocked).toBe(true);
    expect(String(blocked.message)).toContain('连续写');
  });

  it('命令类 bash 不在清单 ⇒ 不被追踪（成员口径：无按文件读写语义）', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });

    for (let i = 0; i < 6; i++) {
      const r = d.checkBeforeAccess('bash', 'src/a.ts');
      expect(r.blocked).toBe(false);
      expect(r.warning).toBe(false);
    }
  });
});
