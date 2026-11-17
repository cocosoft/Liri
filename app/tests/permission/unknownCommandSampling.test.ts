/**
 * 未知命令结构化采样（P2-A，2026-11-17）—— 审批缺口的闭环回归。
 *
 * 结论口径：`auto` 档对未收录命令仍是 ask（安全不变），但**每次**都会把
 * `{ head, at, surface }` 追加到本地 JSONL，供评审补白名单/规则（不再只停在日志里）。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AutoModeClassifier } from '../../../packages/infra/src/permission/classifiers/AutoModeClassifier';

interface SampleLine {
  head: string;
  at: number;
  surface: string;
}

async function waitForFile(path: string, minLines: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
      if (lines.length >= minLines) return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('未知命令采样（JSONL）', () => {
  it('未收录命令 ⇒ 落一行 {head,at,surface}；同 head 每进程只记一次', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unknown-cmd-'));
    const logPath = join(dir, 'unknown-commands.jsonl');
    const prev = process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
    process.env.PERMISSION_UNKNOWN_COMMAND_LOG = logPath;
    try {
      const c = new AutoModeClassifier();
      // 首条：未收录命令 ⇒ 落样
      const first = await c.classify(
        'bash',
        { command: 'liri-probe-cli --list --depth 2' },
        []
      );
      expect(first.requiresApproval).toBe(true);
      await waitForFile(logPath, 1);
      const line = JSON.parse(
        readFileSync(logPath, 'utf8').trim().split('\n')[0]!
      ) as SampleLine;
      expect(line.head).toBe('liri-probe-cli');
      expect(typeof line.at).toBe('number');
      expect(line.surface).toContain('liri-probe-cli --list');

      // 同一 head 再判一次 ⇒ 不重复写（每进程去重）
      await c.classify('bash', { command: 'liri-probe-cli --other' }, []);
      const lines = readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
      expect(lines).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
      else process.env.PERMISSION_UNKNOWN_COMMAND_LOG = prev;
    }
  });
});
