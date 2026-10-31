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

describe('FileIOLoopDetector：查询签名参与判定键（2026-10-31）', () => {
  // 真机证据：单窗口 `文件IO循环已被阻止` 346–434 次，全部是 glob 指向**同一工作区根**
  // 但 pattern 各不相同的合法探索；旧判定键只有「路径 + 分页区域」⇒ 第 4 次直接终止整轮。

  it('同一目录、不同 pattern 连续 6 次 ⇒ 不警告也不阻断', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const dir = 'C:/ws/proj';

    const patterns = [
      '**/*',
      'package.json',
      'src/**',
      '*.md',
      'output/**',
      '**/*.ts',
    ];
    for (const pattern of patterns) {
      const r = d.checkBeforeAccess('glob', dir, undefined, undefined, pattern);
      expect(r.blocked).toBe(false);
      expect(r.warning).toBe(false);
    }
  });

  it('同一目录、同一 pattern 连续 4 次 ⇒ 仍阻断（真循环不被放过）', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const dir = 'C:/ws/proj';

    for (let i = 0; i < 3; i++) {
      expect(
        d.checkBeforeAccess('glob', dir, undefined, undefined, '**/*').blocked
      ).toBe(false);
    }

    const blocked = d.checkBeforeAccess(
      'glob',
      dir,
      undefined,
      undefined,
      '**/*'
    );
    expect(blocked.blocked).toBe(true);
    expect(String(blocked.message)).toContain('连续读');
  });

  it('两个目录交替、pattern 各不同 ⇒ 不判为交替循环', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });

    for (let i = 0; i < 6; i++) {
      expect(
        d.checkBeforeAccess('glob', 'C:/ws/a', undefined, undefined, `a-${i}`)
          .blocked
      ).toBe(false);
      expect(
        d.checkBeforeAccess('glob', 'C:/ws/b', undefined, undefined, `b-${i}`)
          .blocked
      ).toBe(false);
    }
  });
});

describe('FileIOLoopDetector：同一文件的绝对/相对写法不判交替循环（2026-10-31）', () => {
  // 真机 app.log 实证：`[IO_CYCLE] 检测到 2 个文件交替读取循环:
  // C:/Users/…/output/PRD.md, output/PRD.md` —— 两个键指向**同一个物理文件**，
  // 却被当成两个文件交替 ⇒ 整轮终止。

  it('同一文件 abs/rel 交替 ⇒ 按「同一目标重复」拦，且不再出现"2 个文件交替"判定', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const abs = 'C:/Users/u/.pyapp/workspaces/pdca_x/output/PRD.md';
    const rel = 'output/PRD.md';

    // 4 次访问同一文件（两种写法交替）⇒ 归一到同一目标，达到 blockThreshold 即拦
    const results = [0, 1, 2, 3].map((i) =>
      d.checkBeforeAccess('file_read', i % 2 === 0 ? abs : rel)
    );
    expect(results.slice(0, 3).every((r) => !r.blocked)).toBe(true);

    const last = results[3];
    expect(last.blocked).toBe(true);
    expect(String(last.message)).toContain('[IO_REPEAT]');
    // 关键：不得再判成「两个文件交替」（那是 abs/rel 写法差异导致的误判）
    expect(String(last.message)).not.toContain('交替');
  });

  it('真正不同的两个文件交替（各 3 次）⇒ **不再**判循环（2026-10-31 口径）', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });

    // 口径：交叉文件判定只认「同一目标重复」；两个不同目标各 3 次属正常探索
    //（交替/乒乓判据由 query:loopConfig.pingPongThreshold 负责，默认 10）。
    for (let i = 0; i < 3; i++) {
      expect(d.checkBeforeAccess('file_read', 'C:/ws/a.md').blocked).toBe(
        false
      );
      expect(d.checkBeforeAccess('file_read', 'C:/ws/b.md').blocked).toBe(
        false
      );
    }
  });

  it('同一目标在窗口内重复 4 次（非连续）⇒ 仍拦', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    // A、B、A、C、A、D、A ⇒ 第 4 次 A 时窗口内同一目标重复 ×4
    for (const p of [
      'C:/ws/a.md',
      'C:/ws/b.md',
      'C:/ws/a.md',
      'C:/ws/c.md',
      'C:/ws/a.md',
      'C:/ws/d.md',
    ]) {
      expect(d.checkBeforeAccess('file_read', p).blocked).toBe(false);
    }
    const blocked = d.checkBeforeAccess('file_read', 'C:/ws/a.md');
    expect(blocked.blocked).toBe(true);
    expect(String(blocked.message)).toContain('[IO_REPEAT]');
  });

  it('同路径不同 pattern 交替（各 3 次）⇒ 不拦（查询语义不同 + 非同一目标重复）', () => {
    const d = createFileIOLoopDetector({
      warningThreshold: 3,
      blockThreshold: 4,
    });
    const p = 'C:/ws/docs';

    for (let i = 0; i < 3; i++) {
      expect(
        d.checkBeforeAccess('grep', p, undefined, undefined, 'A').blocked
      ).toBe(false);
      expect(
        d.checkBeforeAccess('grep', p, undefined, undefined, 'B').blocked
      ).toBe(false);
    }
  });
});
