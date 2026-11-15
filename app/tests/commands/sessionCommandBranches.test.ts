// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`/session` 命令**参数校验与帮助输出**的特征化锁（外移前先测）。
 *
 * 现状：`commands/builtin/session/Session.ts` 没有任何回归锁。该命令按子命令分支返回文本，
 * 其中「帮助 / 缺参数」这些分支不触碰会话数据，是外移时最容易被顺手改坏的部分。
 * 这里钉住：help 先于会话初始化返回、各子命令的缺参文案与 usage、未知子命令兜底。
 *
 * 环境隔离：`LIRI_DATA_DIR` 指向临时目录（`createChatManager().initialize()` 会走到存储层）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'session-cmd-'));
const prevDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = dataDir;

const { default: sessionCommand } =
  await import('../../src/commands/builtin/session/Session.js');

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 临时目录清理失败不影响结论（可能有句柄未释放）
  }
});

async function run(args: string): Promise<string> {
  return (await sessionCommand.call(args)).value;
}

describe('/session 命令分支（P3-2 外移前特征化）', () => {
  it('空参 ⇒ 帮助文案', async () => {
    expect(await run('')).toContain('Session Command Help');
  });

  it('help ⇒ 帮助文案（且不依赖会话初始化）', async () => {
    const help = await run('help');
    expect(help).toContain('/session list');
    expect(help).toContain('/session create <title>');
    expect(help).toContain('/session current');
  });

  it('create 缺标题 ⇒ 提示缺参并带用法', async () => {
    const out = await run('create');
    expect(out).toContain('Please specify session title');
    expect(out).toContain('Usage: /session create <title>');
  });

  it('switch 缺 ID ⇒ 提示缺参并带用法', async () => {
    const out = await run('switch');
    expect(out).toContain('Please specify session ID');
    expect(out).toContain('Usage: /session switch <session_id>');
  });

  it('delete 缺 ID ⇒ 提示缺参并带用法', async () => {
    const out = await run('delete');
    expect(out).toContain('Please specify session ID');
    expect(out).toContain('Usage: /session delete <session_id>');
  });

  it('info 缺 ID ⇒ 提示缺参并带用法', async () => {
    const out = await run('info');
    expect(out).toContain('Please specify session ID');
    expect(out).toContain('Usage: /session info <session_id>');
  });

  it('未知子命令 ⇒ 兜底提示并指向 help', async () => {
    const out = await run('nope');
    expect(out).toContain('Unknown subcommand: nope');
    expect(out).toContain('/session help');
  });
});
