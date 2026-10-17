// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 出站文件「可外发资格」单测（2026-10-17 修订，Spec `.trae/specs/qq-file-transfer.md` §3.2③）。
//
// 背景（真机实证）：旧判定只有「存在 + 非禁区」⇒ 回复正文里**回显**一个已存在路径就会被当成投递意图，
// 连续两条真机消息各误触发一次。现改为**双信号资格**：在**交付面**内（`~/.pyapp/{output,downloads,attachments}`）
// **或** 为**本轮新产出**（`mtime ≥ 本轮起点 − 2s`）；两者都不满足 ⇒ **静默忽略**（不投递、也不产生
// 用户可见的「未能发送」噪音 —— 只有「超 30MB」「超 2 个」这两类仍如实告知）。
//
// 本用例用 `LIRI_HOME` 把交付面重定向到临时目录（**不碰**真实 `~/.pyapp`），并在 afterAll 还原环境变量。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterSendableFiles } from '../../src/channels/routing/outboundFileRouter';

let root = '';
const savedLiriHome = process.env['LIRI_HOME'];

/** 一小时前（「非本轮产出」） */
const OLD = new Date(Date.now() - 3_600_000);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-ofr-'));
  for (const d of ['output', 'downloads', 'attachments', 'elsewhere']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  process.env['LIRI_HOME'] = root; // 交付面 = <tmp>/{output,downloads,attachments}
});

afterAll(() => {
  if (savedLiriHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = savedLiriHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

/** 造文件并指定 mtime */
function makeFile(rel: string, mtime: Date, bytes = 16): string {
  const p = join(root, rel);
  writeFileSync(p, 'x'.repeat(bytes));
  utimesSync(p, mtime, mtime);
  return p;
}

describe('交付面（~/.pyapp/{output,downloads,attachments}）内的旧文件 ⇒ 仍可外发', () => {
  it.each(['output/old.txt', 'downloads/old.txt', 'attachments/old.txt'])(
    '%s ⇒ sendable（保留「把已有附件/文档发给我」的能力）',
    (rel) => {
      const p = makeFile(rel, OLD);
      const { sendable, skipped } = filterSendableFiles([p]);
      expect(sendable).toEqual([p]);
      expect(skipped).toEqual([]);
    }
  );
});

describe('本轮新产出（不在交付面内也放行）', () => {
  it('面外 + mtime 新于本轮起点 ⇒ sendable（「工具刚写出来的文件」）', () => {
    const p = makeFile('elsewhere/fresh.txt', new Date());
    const { sendable } = filterSendableFiles([p], {
      runStartedAtMs: Date.now() - 1000,
    });
    expect(sendable).toEqual([p]);
  });

  it('不给本轮起点（缺省 ⇒ 只认交付面）⇒ 面外新文件也**不**放行', () => {
    const p = makeFile('elsewhere/fresh2.txt', new Date());
    const { sendable, skipped } = filterSendableFiles([p]);
    expect(sendable).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe('★ 本次修复：面外 + 非本轮产出 ⇒ **静默忽略**（既不投递、也不产生噪音）', () => {
  it('回显一个既有源码路径（事故场景）⇒ sendable 与 skipped **都为空**', () => {
    const p = makeFile('elsewhere/existing-source.ts', OLD);
    const { sendable, skipped } = filterSendableFiles([p], {
      runStartedAtMs: Date.now() - 1000,
    });
    expect(sendable).toEqual([]);
    expect(skipped).toEqual([]); // ★ 关键：不再把「误判」变成用户可见的「⚠️ 未能发送」
  });

  it('不存在的路径（叙述性）⇒ 同样静默（零回归）', () => {
    const { sendable, skipped } = filterSendableFiles([
      join(root, 'elsewhere', 'nope.txt'),
    ]);
    expect(sendable).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe('仍**如实告知**的两类（守 CS03：用户本该拿到却没发出去）', () => {
  it('面内但超 30MB ⇒ skipped（带原因）', () => {
    const p = join(root, 'output', 'big.bin');
    writeFileSync(p, '');
    truncateSync(p, 30 * 1024 * 1024 + 1); // 稀疏扩展，不真写 30MB
    const { sendable, skipped } = filterSendableFiles([p]);
    expect(sendable).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain('30MB');
  });

  it('面内超过 2 个 ⇒ 前 2 个 sendable、其余 skipped（被动配额保护）', () => {
    const paths = [1, 2, 3].map((n) => makeFile(`output/many-${n}.txt`, OLD));
    const { sendable, skipped } = filterSendableFiles(paths);
    expect(sendable).toEqual(paths.slice(0, 2));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.path).toBe(paths[2]!);
  });
});

describe('realpath 加固：交付面内的链接不可指向面外', () => {
  it('面内的符号链接指向面外 ⇒ 不因「路径前缀」而被放行', () => {
    const outside = makeFile('elsewhere/secret.txt', OLD);
    const link = join(root, 'output', 'link.txt');
    try {
      symlinkSync(outside, link, 'file');
    } catch {
      // Windows 建符号链接需开发者模式/管理员 ⇒ 环境不允许时如实跳过该断言
      console.warn('[skip] 当前环境不允许创建符号链接，跳过该断言');
      return;
    }
    const { sendable, skipped } = filterSendableFiles([link], {
      runStartedAtMs: Date.now() - 1000,
    });
    expect(sendable).toEqual([]); // realpath 落到 elsewhere ⇒ 既不在面内、也非本轮产出
    expect(skipped).toEqual([]);
  });
});
