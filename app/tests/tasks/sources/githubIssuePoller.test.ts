/**
 * D1（2026-11-18）：GitHub issue 轮询适配器单测
 *
 * 覆盖：配置解析（默认关 / 无 token / 无合法 repo / 间隔下限）、issue → 事件翻译、
 * 一拍轮询（逐条 emit）、拉取失败**不推进位点**、start/stop 幂等。
 */
import { afterAll, describe, expect, it } from 'bun:test';

import {
  GITHUB_POLLER_DEFAULT_INTERVAL_MS,
  GITHUB_POLLER_MIN_INTERVAL_MS,
  GITHUB_TOKEN_ENV,
  createGithubIssuePoller,
  fetchIssuesFromGithub,
  issueToExternalEvent,
  parseGithubIssuePollerConfig,
  type GithubIssue,
} from '../../../src/tasks/sources/githubIssuePoller';
import type { ExternalEventInput } from '../../../src/tasks/sources/externalEventSource';

const TOKEN_BEFORE = process.env[GITHUB_TOKEN_ENV];

afterAll(() => {
  if (TOKEN_BEFORE === undefined) delete process.env[GITHUB_TOKEN_ENV];
  else process.env[GITHUB_TOKEN_ENV] = TOKEN_BEFORE;
});

describe('parseGithubIssuePollerConfig', () => {
  const raw = { enabled: true, repos: ['acme/widget'] };

  it('未启用 ⇒ null', () => {
    expect(
      parseGithubIssuePollerConfig({ ...raw, enabled: false }, 't')
    ).toBeNull();
    expect(parseGithubIssuePollerConfig(undefined, 't')).toBeNull();
  });

  it('无 token ⇒ null（不做匿名轮询）', () => {
    expect(parseGithubIssuePollerConfig(raw, undefined)).toBeNull();
    expect(parseGithubIssuePollerConfig(raw, '   ')).toBeNull();
  });

  it('无合法 repo ⇒ null；非法项被过滤、重复被去重', () => {
    expect(
      parseGithubIssuePollerConfig({ enabled: true, repos: [] }, 't')
    ).toBeNull();
    expect(
      parseGithubIssuePollerConfig(
        { enabled: true, repos: ['bad', 'a/b/c'] },
        't'
      )
    ).toBeNull();
    const ok = parseGithubIssuePollerConfig(
      { enabled: true, repos: [' acme/widget ', 'acme/widget', 'acme/api'] },
      't'
    );
    expect(ok?.repos).toEqual(['acme/widget', 'acme/api']);
  });

  it('间隔缺省 / 低于下限 ⇒ 取下限', () => {
    expect(parseGithubIssuePollerConfig(raw, 't')?.intervalMs).toBe(
      GITHUB_POLLER_DEFAULT_INTERVAL_MS
    );
    expect(
      parseGithubIssuePollerConfig({ ...raw, intervalMs: 1000 }, 't')
        ?.intervalMs
    ).toBe(GITHUB_POLLER_MIN_INTERVAL_MS);
  });
});

describe('issueToExternalEvent', () => {
  const issue: GithubIssue = {
    id: 9001,
    number: 12,
    title: 'crash on start',
    htmlUrl: 'https://github.com/acme/widget/issues/12',
    state: 'open',
    createdAt: '2026-11-18T00:00:00Z',
  };

  it('eventId 用 repo#id（稳定幂等键）；threadId 用 repo#number（同 issue 串行）', () => {
    const event = issueToExternalEvent('acme/widget', issue);
    expect(event.eventId).toBe('github-issue:acme/widget#9001');
    expect(event.threadId).toBe('github-issue:acme/widget#12');
    expect(event.payload).toEqual({
      kind: 'github-issue',
      repo: 'acme/widget',
      number: 12,
      title: 'crash on start',
      url: 'https://github.com/acme/widget/issues/12',
      state: 'open',
      createdAt: '2026-11-18T00:00:00Z',
    });
  });
});

describe('createGithubIssuePoller.pollOnce', () => {
  const config = { repos: ['acme/widget'], intervalMs: 60_000 };
  const issue: GithubIssue = {
    id: 1,
    number: 1,
    title: 't',
    htmlUrl: 'u',
    state: 'open',
    createdAt: 'c',
  };

  it('逐条 emit；全部成功 ⇒ 位点推进到本轮开始时刻', async () => {
    process.env[GITHUB_TOKEN_ENV] = 'test-token';
    const emitted: ExternalEventInput[] = [];
    const seenSince: string[] = [];
    let now = Date.parse('2026-11-18T00:00:00Z');

    const poller = createGithubIssuePoller({
      config,
      emit: async (input) => {
        emitted.push(input);
        return true;
      },
      fetchIssues: async (_repo, since) => {
        seenSince.push(since);
        return [issue, { ...issue, id: 2, number: 2 }];
      },
      now: () => now,
    });

    await poller.pollOnce();
    expect(emitted.map((e) => e.eventId)).toEqual([
      'github-issue:acme/widget#1',
      'github-issue:acme/widget#2',
    ]);

    now += 60_000;
    await poller.pollOnce();
    // 第二拍用的 since = 第一拍**开始**时刻（成功后才推进）
    expect(seenSince[1]).toBe('2026-11-18T00:00:00.000Z');

    now += 60_000;
    await poller.pollOnce();
    // 第三拍用第二拍开始时刻
    expect(seenSince[2]).toBe('2026-11-18T00:01:00.000Z');
  });

  it('拉取失败 ⇒ 回调 onError 且**不推进位点**（下一拍用旧 since 重试）', async () => {
    process.env[GITHUB_TOKEN_ENV] = 'test-token';
    const errors: unknown[] = [];
    const seenSince: string[] = [];
    let now = Date.parse('2026-11-18T00:00:00Z');

    const poller = createGithubIssuePoller({
      config,
      emit: async () => true,
      fetchIssues: async (_repo, since) => {
        seenSince.push(since);
        throw new Error('503');
      },
      onError: (error) => errors.push(error),
      now: () => now,
    });

    await poller.pollOnce();
    now += 60_000;
    await poller.pollOnce();

    expect(errors).toHaveLength(2);
    expect(seenSince).toEqual([
      '2026-11-18T00:00:00.000Z',
      '2026-11-18T00:00:00.000Z',
    ]);
  });

  it('start / stop 幂等（不抛错）', () => {
    process.env[GITHUB_TOKEN_ENV] = 'test-token';
    const poller = createGithubIssuePoller({
      config,
      emit: async () => true,
      fetchIssues: async () => [],
    });
    poller.start();
    poller.start();
    poller.stop();
    poller.stop();
    expect(true).toBe(true);
  });
});

describe('fetchIssuesFromGithub（默认拉取实现）', () => {
  function row(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 1,
      number: 1,
      title: 't',
      html_url: 'u',
      state: 'open',
      created_at: 'c',
      ...over,
    };
  }

  function fakeFetch(pages: Array<Array<Record<string, unknown>>>) {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const rows = pages[urls.length - 1] ?? [];
      return { ok: true, status: 200, json: async () => rows };
    }) as unknown as typeof fetch;
    return { impl, urls };
  }

  it('按 updated_at 语义拉取（sort=updated & direction=asc），过滤 PR 与非法行', async () => {
    const { impl, urls } = fakeFetch([
      [
        row({ id: 10, number: 10 }),
        row({ id: 11, number: 11, pull_request: { url: 'x' } }),
        { id: 'bad', number: 12 },
      ],
    ]);

    const issues = await fetchIssuesFromGithub(
      'acme/widget',
      '2026-11-18T00:00:00Z',
      't',
      impl
    );

    expect(urls[0]).toContain('sort=updated');
    expect(urls[0]).toContain('direction=asc');
    expect(urls[0]).toContain('since=2026-11-18T00%3A00%3A00Z');
    expect(urls[0]).toContain('page=1');
    expect(issues.map((i) => i.id)).toEqual([10]);
  });

  it('满页 ⇒ 继续翻页；不足一页 ⇒ 停止（最多 5 页）', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) =>
      row({ id: i + 1, number: i + 1 })
    );
    const { impl, urls } = fakeFetch([
      fullPage,
      [row({ id: 999, number: 999 })],
    ]);

    const issues = await fetchIssuesFromGithub(
      'acme/widget',
      '2026-11-18T00:00:00Z',
      't',
      impl
    );

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('page=2');
    expect(issues).toHaveLength(51);
  });

  it('非 2xx ⇒ 抛错（由调用方决定不推进位点）', async () => {
    const impl = (async () => ({
      ok: false,
      status: 503,
      json: async () => [],
    })) as unknown as typeof fetch;
    await expect(
      fetchIssuesFromGithub('acme/widget', '2026-11-18T00:00:00Z', 't', impl)
    ).rejects.toThrow('GitHub API 503');
  });
});
