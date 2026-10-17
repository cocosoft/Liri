// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 余额查询「持续性告警只记一次」闸门单测（2026-10-17；台账 `BALANCE-WARN-DEDUPE` + `BALANCE-WARN-PERSIST`）。
//
// 背景：余额查询按周期轮询，而「接口已下线 / 固定错误码」这类**持续性**失败每轮都会命中 ⇒ 旧实现每轮刷同一条
// warning，日志无限增长且无新信息；且本仓 dev 模式每次保存源码都重启 ⇒ 仅靠进程内记忆只解决一半噪音。
//
// 本组钉住两件事：① 闸门语义（首次记 / 重复不记 / **恢复即清记忆** / 前缀不误伤）；
// ② **落盘往返**（跨进程重启不重复告警；恢复后清除 ⇒ 状态变化仍能上报）。
//
// 落盘重定向：用 `LIRI_HOME` 指向临时目录（**不碰**真实 `~/.pyapp`），并在 `afterAll` 还原环境变量
// （守台账 `L-23-test-global-pollution` 的教训：污染未还原 ⇒ 隔离绿 / 全量红）。

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  shouldWarnRecurring,
  clearRecurringWarn,
  resetRecurringWarnForTest,
} from '../../../src/ai/providers/BalanceChecker';
import { balanceWarnStatePath } from '../../../src/ai/providers/balanceWarnPersistence';

let root = '';
const savedLiriHome = process.env['LIRI_HOME'];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-balance-warn-'));
  process.env['LIRI_HOME'] = root; // 落盘重定向到临时目录
});

afterAll(() => {
  if (savedLiriHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = savedLiriHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(balanceWarnStatePath(), { force: true });
  await resetRecurringWarnForTest(); // 清内存 + 让下次判定重新读盘（= 模拟「新进程」）
});

describe('持续性告警闸门：首次记、重复不记', () => {
  it('同一 key ⇒ 首次 true、此后 false（同状态不再刷屏）', async () => {
    const key = 'siliconflow|retired';
    expect(await shouldWarnRecurring(key)).toBe(true);
    expect(await shouldWarnRecurring(key)).toBe(false);
    expect(await shouldWarnRecurring(key)).toBe(false);
  });

  it('不同 provider / 不同 kind ⇒ 各自首次都会记一次（互不吞掉）', async () => {
    expect(await shouldWarnRecurring('siliconflow|retired')).toBe(true);
    expect(await shouldWarnRecurring('siliconflow-en|retired')).toBe(true);
    expect(await shouldWarnRecurring('siliconflow|api-error:20092')).toBe(true);
  });
});

describe('恢复即清记忆（不把「曾经坏过」永久静音）', () => {
  it('clear 之后同 key ⇒ **再次** true（状态变化仍可上报）', async () => {
    const key = 'siliconflow|retired';
    expect(await shouldWarnRecurring(key)).toBe(true);
    expect(await shouldWarnRecurring(key)).toBe(false);
    await clearRecurringWarn('siliconflow');
    expect(await shouldWarnRecurring(key)).toBe(true); // ★
  });

  it('clear 一整个 provider ⇒ 它的**多个** kind 都被清掉', async () => {
    await shouldWarnRecurring('siliconflow|retired');
    await shouldWarnRecurring('siliconflow|api-error:101');
    await clearRecurringWarn('siliconflow');
    expect(await shouldWarnRecurring('siliconflow|retired')).toBe(true);
    expect(await shouldWarnRecurring('siliconflow|api-error:101')).toBe(true);
  });

  it('按 `provider|` 前缀清 ⇒ **不误伤**同名前缀的另一个 provider（`siliconflow` vs `siliconflow-en`）', async () => {
    expect(await shouldWarnRecurring('siliconflow-en|retired')).toBe(true);
    await clearRecurringWarn('siliconflow');
    expect(await shouldWarnRecurring('siliconflow-en|retired')).toBe(false); // 仍是「已记过」
  });
});

describe('落盘（跨进程重启不重复告警）', () => {
  it('落盘路径被 `LIRI_HOME` 重定向（**负向自证**：绝不写到真实 ~/.pyapp）', () => {
    expect(balanceWarnStatePath().startsWith(root)).toBe(true);
  });

  it('首次告警 ⇒ 文件落盘且含该 key（带 `apiCode`）', async () => {
    expect(await shouldWarnRecurring('siliconflow|retired', 20092)).toBe(true);
    const file = balanceWarnStatePath();
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      version: number;
      entries: Record<string, { warnedAt: number; apiCode?: number }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.entries['siliconflow|retired']?.apiCode).toBe(20092);
    expect(typeof parsed.entries['siliconflow|retired']?.warnedAt).toBe(
      'number'
    );
  });

  it('★ 模拟进程重启（清内存 + 重读落盘）⇒ 仍为 false（不再重复告警）', async () => {
    expect(await shouldWarnRecurring('siliconflow|retired', 20092)).toBe(true);
    await resetRecurringWarnForTest(); // 内存清空、下次判定重新读盘（落盘文件保留）
    expect(await shouldWarnRecurring('siliconflow|retired', 20092)).toBe(false);
  });

  it('恢复后清除会**一并落盘** ⇒ 重启后仍能上报（不把状态变化静音）', async () => {
    expect(await shouldWarnRecurring('siliconflow|retired', 20092)).toBe(true);
    await clearRecurringWarn('siliconflow');
    const after = JSON.parse(readFileSync(balanceWarnStatePath(), 'utf-8')) as {
      entries: Record<string, unknown>;
    };
    expect(after.entries['siliconflow|retired']).toBeUndefined();
    await resetRecurringWarnForTest(); // 模拟重启
    expect(await shouldWarnRecurring('siliconflow|retired', 20092)).toBe(true);
  });

  it('落盘文件损坏 ⇒ 按空表读取（不抛），闸门仍可用', async () => {
    const file = balanceWarnStatePath();
    writeFileSync(file, '{ this is not json');
    await resetRecurringWarnForTest();
    expect(await shouldWarnRecurring('siliconflow|retired')).toBe(true);
  });
});
