// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G-8（2026-10-18）：「文件写入 / 工具回传」两个新接入点的行为测试。
 *
 * 覆盖：
 * - `writeFile`（FileWriteTool）：默认（空注册）⇒ 原文落盘；注册敏感护栏 ⇒ 打码落盘
 *   （回执 size 与实写一致）；注册 block 护栏 ⇒ 抛 AppError 拒写；
 * - `MessageService.createToolResultMessage`（工具回传单一收口）：默认原样；
 *   注册敏感护栏 ⇒ content 内打码、原始凭据不进入消息体（⇒ 不落盘、不回灌模型）。
 */

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getOutputGuardRegistry,
  resetOutputGuardRegistryForTest,
} from '../../src/core/outputGuard';
import { createSensitiveContentGuard } from '../../src/chat/outputGuards/sensitiveContentGuard';
import { writeFile } from '../../src/tools/FileWriteTool/FileWriteTool';
import { MessageServiceImpl } from '../../src/chat/services/MessageService';

/** 命中 `redactSecretsFully` 规则表的假密钥形态（固定假值，非真实凭据） */
const FAKE_SECRET = `sk-proj-${'G'.repeat(40)}`;

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'liri-g8-'));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  resetOutputGuardRegistryForTest();
});

describe('G-8 文件写入接入点（writeFile）', () => {
  it('默认（空注册）⇒ 原文落盘（零行为变更）', () => {
    const target = join(dir, 'plain.txt');
    writeFile({ filePath: target, content: `key=${FAKE_SECRET}` });
    expect(readFileSync(target, 'utf8')).toBe(`key=${FAKE_SECRET}`);
  });

  it('注册敏感护栏 ⇒ 打码落盘，回执 size 与实写一致', () => {
    getOutputGuardRegistry().register(createSensitiveContentGuard());
    const target = join(dir, 'redacted.txt');
    const res = writeFile({ filePath: target, content: `key=${FAKE_SECRET}` });
    const onDisk = readFileSync(target, 'utf8');
    expect(onDisk).not.toContain(FAKE_SECRET);
    expect(res.sizeBytes).toBe(Buffer.byteLength(onDisk, 'utf-8'));
  });

  it('注册 block 护栏 ⇒ 抛 AppError 拒写，文件不产生', () => {
    getOutputGuardRegistry().register({
      name: 'test_blocker',
      priority: 1,
      check: () => ({
        action: 'block',
        text: '',
        issues: [
          { guard: 'test_blocker', severity: 'block', message: '测试阻断' },
        ],
      }),
    });
    const target = join(dir, 'blocked.txt');
    expect(() => writeFile({ filePath: target, content: 'anything' })).toThrow(
      '输出护栏'
    );
  });
});

describe('G-8 工具回传接入点（createToolResultMessage）', () => {
  const makeResult = (result: unknown) => ({
    toolCallId: 'tc-1',
    sessionId: 's-1',
    result,
  });

  it('默认（空注册）⇒ result 原文进入消息 content（零行为变更）', () => {
    const svc = new MessageServiceImpl();
    const msg = svc.createToolResultMessage(
      makeResult({ note: `key=${FAKE_SECRET}` }) as never,
      { sessionId: 's-1' }
    );
    const value = (msg.content[0] as { value: string }).value;
    expect(value).toContain(FAKE_SECRET);
  });

  it('注册敏感护栏 ⇒ 消息 content 内打码（不落盘、不回灌模型）', () => {
    getOutputGuardRegistry().register(createSensitiveContentGuard());
    const svc = new MessageServiceImpl();
    const msg = svc.createToolResultMessage(
      makeResult({ note: `key=${FAKE_SECRET}` }) as never,
      { sessionId: 's-1' }
    );
    const value = (msg.content[0] as { value: string }).value;
    expect(value).not.toContain(FAKE_SECRET);
  });
});
