/**
 * 未知命令结构化采样（P2-A，2026-11-17；R4 改造）—— 审批缺口的闭环回归。
 *
 * 结论口径：`auto` 档对未收录命令仍是 ask（安全不变），但**每次**都会把
 * 结构化样本追加到本地 JSONL（R4：去敏 + 补字段 + 每 head 计数 + 轮转）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { AutoModeClassifier } from '../../../packages/infra/src/permission/classifiers/AutoModeClassifier';
import {
  MAX_UNKNOWN_COMMAND_SAMPLES_PER_PROCESS,
  UNKNOWN_COMMAND_SURFACE_MAX_CHARS,
  buildUnknownCommandSample,
  decideUnknownCommandLogRotation,
  monthKeyOf,
  resetUnknownCommandSampleStateForTest,
  shouldRecordUnknownCommandSample,
} from '@openliri/infra/permission/classifiers/unknownCommandSamples';

interface SampleLine {
  head: string;
  at: number;
  surface: string;
  surfaceLength: number;
  headSeq: number;
  shell: string;
  os: string;
  permissionMode?: string;
  autonomy?: string;
  decision: string;
  segmentIndex: number;
  blockedBy: string;
}

let dir: string;
let logPath: string;
const savedEnv = {
  log: process.env.PERMISSION_UNKNOWN_COMMAND_LOG,
  maxBytes: process.env.PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'unknown-cmd-'));
  logPath = join(dir, 'unknown-commands.jsonl');
  process.env.PERMISSION_UNKNOWN_COMMAND_LOG = logPath;
  delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES;
  resetUnknownCommandSampleStateForTest();
});

afterEach(() => {
  if (savedEnv.log === undefined)
    delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
  else process.env.PERMISSION_UNKNOWN_COMMAND_LOG = savedEnv.log;
  if (savedEnv.maxBytes === undefined) {
    delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES;
  } else {
    process.env.PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES = savedEnv.maxBytes;
  }
  rmSync(dir, { recursive: true, force: true });
});

function readLines(path: string): SampleLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SampleLine);
}

async function waitForLines(path: string, min: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (readLines(path).length >= min) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function waitForExists(path: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('R4：采样记录字段与去敏（纯函数）', () => {
  it('字段补全：head / shell / os / decision / segmentIndex / blockedBy', () => {
    const sample = buildUnknownCommandSample({
      surface: 'Liri-Probe --flag',
      toolName: 'powershell',
      permissionMode: 'auto',
      autonomy: 'demand',
      segmentIndex: 3,
    });
    expect(sample).not.toBeNull();
    if (!sample) return;
    expect(sample.head).toBe('liri-probe');
    expect(sample.shell).toBe('pwsh');
    expect(sample.os).toBe(process.platform);
    expect(sample.decision).toBe('ask');
    expect(sample.blockedBy).toBe('classifier');
    expect(sample.segmentIndex).toBe(3);
    expect(sample.permissionMode).toBe('auto');
    expect(sample.autonomy).toBe('demand');
    expect(sample.headSeq).toBe(1);
  });

  it('落盘前去敏：密钥形态不出现在 surface，长度字段记录原文', () => {
    const command =
      'liri-probe --token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 --password=hunter2';
    const sample = buildUnknownCommandSample({
      surface: command,
      toolName: 'bash',
    });
    expect(sample).not.toBeNull();
    if (!sample) return;
    expect(sample.surface).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    );
    expect(sample.surface).not.toContain('hunter2');
    expect(sample.surface).toContain('[REDACTED]');
    expect(sample.surfaceLength).toBe(command.length);
  });

  it('surface 超长截断到 120 字符（去敏后截断）', () => {
    const sample = buildUnknownCommandSample({
      surface: `liri-long ${'x'.repeat(300)}`,
      toolName: 'bash',
    });
    expect(sample).not.toBeNull();
    if (!sample) return;
    expect(sample.surface.length).toBeLessThanOrEqual(
      UNKNOWN_COMMAND_SURFACE_MAX_CHARS
    );
    expect(sample.surfaceLength).toBeGreaterThan(
      UNKNOWN_COMMAND_SURFACE_MAX_CHARS
    );
  });

  it('每 head 计数：headSeq 递增；进程内写盘上限 50 条', () => {
    const head = 'liri-cap';
    for (let i = 1; i <= MAX_UNKNOWN_COMMAND_SAMPLES_PER_PROCESS; i += 1) {
      const sample = buildUnknownCommandSample({
        surface: `${head} --n ${i}`,
        toolName: 'bash',
      });
      expect(sample?.headSeq).toBe(i);
    }
    // 第 51 次：不写盘，但计数继续
    expect(
      buildUnknownCommandSample({ surface: `${head} --n 51`, toolName: 'bash' })
    ).toBeNull();
    expect(shouldRecordUnknownCommandSample(head).headSeq).toBe(52);
  });
});

describe('R4：采样轮转（单文件上限 + 按月切分）', () => {
  it('decideUnknownCommandLogRotation：达标 → size；跨月 → month；同月且未超限 → null', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    expect(decideUnknownCommandLogRotation(5 * 1024 * 1024, now, now)).toBe(
      'size'
    );
    expect(decideUnknownCommandLogRotation(10, now, now)).toBeNull();
    const lastMonth = Date.parse('2026-10-31T00:00:00Z');
    expect(decideUnknownCommandLogRotation(10, lastMonth, now)).toBe('month');
  });

  it('超过阈值 ⇒ 改名为 <base>.<YYYY-MM>.jsonl 并重新开始', async () => {
    process.env.PERMISSION_UNKNOWN_COMMAND_LOG_MAX_BYTES = '10';
    writeFileSync(logPath, '{"head":"old"}\n');
    const rotated = join(
      dir,
      `${basename(logPath, '.jsonl')}.${monthKeyOf(Date.now())}.jsonl`
    );

    const c = new AutoModeClassifier();
    await c.classify('bash', { command: 'liri-probe-alpha --x' }, []);
    // 采样是 fire-and-forget ⇒ 等"轮转产物出现"（活跃文件里本就有旧行，不能只等行数）
    await waitForExists(rotated);

    expect(readLines(rotated)[0]?.head).toBe('old');
    await waitForLines(logPath, 1);
    expect(readLines(logPath).map((l) => l.head)).toEqual(['liri-probe-alpha']);
    expect(readdirSync(dir).length).toBe(2);
  });
});

describe('R4：分类器集成（判定不变、采样变富）', () => {
  it('未收录命令仍 ask；采样带上下文字段；同一 head 第二次也落盘（频次口径）', async () => {
    const c = new AutoModeClassifier();
    const first = await c.classify(
      'bash',
      { command: 'liri-probe-cli --list --depth 2' },
      [],
      { permissionMode: 'auto', autonomy: 'interactive' }
    );
    expect(first.requiresApproval).toBe(true);
    await waitForLines(logPath, 1);

    const line = readLines(logPath)[0]!;
    expect(line.head).toBe('liri-probe-cli');
    expect(line.surface).toContain('liri-probe-cli --list');
    expect(line.shell).toBe('bash');
    expect(line.decision).toBe('ask');
    expect(line.blockedBy).toBe('classifier');
    expect(line.segmentIndex).toBe(1);
    expect(line.permissionMode).toBe('auto');
    expect(line.autonomy).toBe('interactive');
    expect(line.headSeq).toBe(1);

    // R4：从"每进程每 head 一次"改为"每 head 计数" ⇒ 第二次也要落盘
    await c.classify('bash', { command: 'liri-probe-cli --other' }, []);
    await waitForLines(logPath, 2);
    expect(readLines(logPath).map((l) => l.headSeq)).toEqual([1, 2]);
  });

  it('危险命令不进采样（仍由硬拦层 deny，不产生样例）', async () => {
    const c = new AutoModeClassifier();
    const decision = await c.classify('bash', { command: 'rm -rf /' }, []);
    expect(decision.shouldBlock).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(readLines(logPath)).toHaveLength(0);
  });
});
