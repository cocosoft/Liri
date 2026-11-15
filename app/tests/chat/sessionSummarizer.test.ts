/**
 * 特征化测试：`SessionSummarizer.summarize` 的既有行为（P3-2 拆分前置）。
 *
 * 目的：在把 `summarize` 的若干分支原样外移为私有辅助方法之前，先用测试锁住
 * 「提取式摘要 / 决策识别 / 5 分钟合并 / 阶段性小结 / LLM 覆盖与回退」这些外部可观测结果，
 * 保证外移是**纯搬家**而非行为变更。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionSummarizer } from '../../src/chat/services/SessionSummarizer';

type SessionArg = Parameters<SessionSummarizer['summarize']>[0];
type MessageArg = Parameters<SessionSummarizer['summarize']>[1];
type ClientArg = ConstructorParameters<typeof SessionSummarizer>[0];

const PROJ = 'proj-summarizer';

let dataDir: string;
const prevDataDir = process.env.LIRI_DATA_DIR;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pyapp-summarizer-'));
  process.env.LIRI_DATA_DIR = dataDir;
});

afterEach(() => {
  if (prevDataDir === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = prevDataDir;
  }
  // trackUsage 会打开该目录下的 usage 库（单例持有句柄）⇒ Windows 上可能 EBUSY；
  // 临时目录清理失败不影响测试结论（与 tests/budget/sideChannelGuard.test.ts 同口径）。
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 清理失败忽略 */
  }
});

function projDir(): string {
  return join(dataDir, 'projects', PROJ);
}

function summariesPath(): string {
  return join(projDir(), 'summaries.json');
}

/** 预置 summaries.json（存在即走 JSON 读写分支，不会落 items.db） */
function seedSummaries(entries: unknown[]): void {
  mkdirSync(projDir(), { recursive: true });
  writeFileSync(summariesPath(), JSON.stringify(entries, null, 2), 'utf-8');
}

function readSummaries(): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(summariesPath(), 'utf-8'));
}

function makeSession(
  id: string,
  lastUser: string,
  count = 3,
  projectId: string | undefined = PROJ
): SessionArg {
  const messages = Array.from({ length: count }, (_, i) => ({
    role: i === count - 1 ? 'user' : 'assistant',
    content: i === count - 1 ? lastUser : `历史消息 ${i}`,
  }));
  return {
    id,
    metadata: projectId ? { projectId } : {},
    messages,
  } as unknown as SessionArg;
}

const assistantMessage = {
  role: 'assistant',
  content: 'AI 回复正文',
} as unknown as MessageArg;

/** 近 10 分钟前的时间戳（避开 5 分钟合并分支） */
function tenMinutesAgo(): string {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

describe('SessionSummarizer.summarize 既有行为', () => {
  it('消息不足 3 条 ⇒ 直接返回，不创建目录/文件', async () => {
    const summarizer = new SessionSummarizer(undefined);
    await summarizer.summarize(makeSession('s1', '你好', 2), assistantMessage);
    expect(existsSync(projDir())).toBe(false);
  });

  it('会话无 projectId ⇒ 直接返回，不落盘', async () => {
    const summarizer = new SessionSummarizer(undefined);
    await summarizer.summarize(
      makeSession('s1', '你好', 3, undefined),
      assistantMessage
    );
    expect(existsSync(summariesPath())).toBe(false);
  });

  it('无 LLM 客户端 ⇒ 落提取式摘要，并识别用户决策', async () => {
    seedSummaries([]);
    const summarizer = new SessionSummarizer(undefined);
    await summarizer.summarize(
      makeSession('s1', '我们决定采用方案 A'),
      assistantMessage
    );

    const list = readSummaries();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('s1');
    expect(list[0].messageCount).toBe(3);
    expect(String(list[0].summary)).toContain('用户问"我们决定采用方案 A"');
    expect(String(list[0].summary)).toContain('AI 回应：AI 回复正文');
    expect(list[0].decision).toBe('用户决定：决定采用方案 A');
  });

  it('同一会话已有摘要 ⇒ 不重复追加', async () => {
    seedSummaries([
      {
        sessionId: 's1',
        summary: '旧摘要',
        messageCount: 3,
        createdAt: new Date().toISOString(),
      },
    ]);
    const summarizer = new SessionSummarizer(undefined);
    await summarizer.summarize(makeSession('s1', '第二轮'), assistantMessage);

    const list = readSummaries();
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe('旧摘要');
  });

  it('5 分钟内相邻会话 ⇒ 合并到上一条（不调模型、不新增条目）', async () => {
    seedSummaries([
      {
        sessionId: 's-old',
        summary: '旧摘要',
        messageCount: 2,
        createdAt: new Date().toISOString(),
      },
    ]);
    let calls = 0;
    const client = {
      providerId: 'prov-x',
      chat: async () => {
        calls += 1;
        return { content: '不应被调用' };
      },
    } as unknown as ClientArg;

    const summarizer = new SessionSummarizer(client);
    await summarizer.summarize(makeSession('s2', '继续'), assistantMessage);

    const list = readSummaries();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('s-old');
    expect(list[0].messageCount).toBe(5);
    expect(calls).toBe(0);
  });

  it('第 3 次会话摘要 ⇒ 追加阶段性小结条目', async () => {
    seedSummaries([
      {
        sessionId: 's-a',
        summary: '摘要 A',
        messageCount: 3,
        createdAt: tenMinutesAgo(),
      },
      {
        sessionId: 's-b',
        summary: '摘要 B',
        messageCount: 3,
        createdAt: tenMinutesAgo(),
      },
    ]);
    const summarizer = new SessionSummarizer(undefined);
    await summarizer.summarize(makeSession('s-c', '继续'), assistantMessage);

    const list = readSummaries();
    expect(list).toHaveLength(4);
    const phase = list[3];
    expect(phase.phaseSummary).toBe(true);
    expect(String(phase.sessionId).startsWith('phase_')).toBe(true);
    expect(String(phase.summary)).toContain('项目阶段性小结（最近 3 次会话）');
    expect(phase.messageCount).toBe(9);
  });

  it('LLM 摘要成功 ⇒ 覆盖提取式摘要', async () => {
    seedSummaries([]);
    const client = {
      providerId: 'prov-x',
      chat: async () => ({ content: '这是模型生成的摘要文本' }),
    } as unknown as ClientArg;

    const summarizer = new SessionSummarizer(client);
    await summarizer.summarize(makeSession('s1', '随便问问'), assistantMessage);

    expect(readSummaries()[0].summary).toBe('这是模型生成的摘要文本');
  });

  it('LLM 摘要抛错 ⇒ 回退提取式摘要，主流程不中断', async () => {
    seedSummaries([]);
    const client = {
      providerId: 'prov-x',
      chat: async () => {
        throw new Error('模型不可用');
      },
    } as unknown as ClientArg;

    const summarizer = new SessionSummarizer(client);
    await summarizer.summarize(makeSession('s1', '随便问问'), assistantMessage);

    const list = readSummaries();
    expect(list).toHaveLength(1);
    expect(String(list[0].summary)).toContain('用户问"随便问问"');
  });
});
