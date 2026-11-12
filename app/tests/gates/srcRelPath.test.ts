/**
 * 门禁路径归一的**跨平台**契约锁（2026-11-12）
 *
 * 背景：`lint-architecture.ts` 的 barrel / 薄桶豁免原实现写死 `indexOf('src\\')` 与
 * `startsWith('src\\…')` ⇒ POSIX 上 `relative()` 返回 `/`，归一恒失败、豁免全部失配
 * （R05-005 是 warning ⇒ CI 一直绿，属静默失焦）。本测试把两侧口径钉死，避免回潮。
 */

import { describe, expect, it } from 'bun:test';

import {
  matchesModuleEntryDir,
  toSrcRelativePosix,
} from '../../../scripts/lib/srcRelPath';

describe('门禁路径归一：toSrcRelativePosix', () => {
  it('Windows 反斜杠 ⇒ POSIX，且从首个 src/ 起', () => {
    expect(toSrcRelativePosix('app\\src\\ai\\index.ts')).toBe(
      'src/ai/index.ts'
    );
  });

  it('POSIX 路径同样归一（Linux 分支不再依赖反斜杠）', () => {
    expect(toSrcRelativePosix('app/src/ai/index.ts')).toBe('src/ai/index.ts');
  });

  it('拆包后的包内路径：取首个 src/ 之后（模块名仍是 sandbox）', () => {
    expect(toSrcRelativePosix('packages/sandbox/src/sandbox/index.ts')).toBe(
      'src/sandbox/index.ts'
    );
  });

  it('不含 src/ ⇒ POSIX 化后原样返回（不臆造前缀）', () => {
    expect(toSrcRelativePosix('client\\src2\\x.ts')).toBe('client/src2/x.ts');
  });
});

describe('模块入口豁免匹配：matchesModuleEntryDir', () => {
  it('清单沿用 `src\\…` 写法也能匹配 POSIX 路径', () => {
    expect(
      matchesModuleEntryDir('src/sandbox/index.ts', ['src\\sandbox\\'])
    ).toBe(true);
    expect(matchesModuleEntryDir('src/ai/index.ts', ['src\\ai\\'])).toBe(true);
  });

  it('不在清单内 ⇒ 不豁免（barrel / 薄桶仍会被报出）', () => {
    expect(
      matchesModuleEntryDir('src/tools/index.ts', ['src\\sandbox\\'])
    ).toBe(false);
  });
});
