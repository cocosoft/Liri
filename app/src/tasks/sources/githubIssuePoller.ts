/**
 * githubIssuePoller —— GitHub issue **轮询**适配器（D1，2026-11-18）
 *
 * Spec：`.trae/specs/external-event-adapters.md` §5-1。
 * 复用既有受理/来源链路（**不新建调度器/队列**）：
 * ```
 * poller（本文件，默认关）→ externalEventSource.emit
 *   → withPolicyGate → SourceRegistry（幂等/串行）→ ticketSink → ticketRunConsumer
 * ```
 *
 * 口径（如实）：
 * - **默认关**：`autonomy.externalPollers.github.enabled === true` 才启动；
 * - **无 token ⇒ 不启动**（`GITHUB_TOKEN`；不做匿名轮询，避免低配额与来源不明）；
 * - `since` 位点为**进程内**（重启从启动时刻重新开始，不补发历史；重复事件由
 *   `eventId` + `triggerId` 双层幂等兜住）；
 * - **不拉正文/评论**：只带 `kind/repo/number/title/url/state/createdAt`，控制载荷与敏感面；
 * - 拉取失败只记日志、**不推进 `since`**（下一拍重试），不影响其他来源。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { configManager } from '@openliri/infra/config';
// CS01：GitHub API 基址 / 轮询节奏复用 infra 常量（不重复写字面量；lint:consts 棘轮）
import {
  GITHUB_API_BASE,
  GITHUB_POLLER_DEFAULT_INTERVAL_MS,
  GITHUB_POLLER_MIN_INTERVAL_MS,
} from '@openliri/infra/constants';

import type { ExternalEventInput } from './externalEventSource';

const logger = getLogger('tasks:github-issue-poller');

/** 配置键路径（`autonomy.externalPollers.github`） */
export const GITHUB_POLLER_CONFIG_PATH = 'autonomy';

export { GITHUB_POLLER_DEFAULT_INTERVAL_MS, GITHUB_POLLER_MIN_INTERVAL_MS };

/** 令牌环境变量名（唯一读取点） */
export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';

export interface GithubIssuePollerConfig {
  /** `owner/repo` 列表（已校验、去重、保序） */
  repos: string[];
  intervalMs: number;
}

/** 一次 issue 的最小事实（GitHub API 的子集） */
export interface GithubIssue {
  /** issue 的全局 id（幂等键来源） */
  id: number;
  number: number;
  title: string;
  htmlUrl: string;
  state: string;
  createdAt: string;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * 纯函数：解析配置。
 *
 * @param raw `autonomy.externalPollers.github` 的原始值
 * @param token `GITHUB_TOKEN`（缺失 ⇒ `null`：不启动）
 * @returns 合法且启用 ⇒ 配置；未启用/无 repo/无 token ⇒ `null`
 */
export function parseGithubIssuePollerConfig(
  raw: unknown,
  token: string | undefined
): GithubIssuePollerConfig | null {
  if (!token?.trim()) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj['enabled'] !== true) return null;

  const reposRaw = obj['repos'];
  if (!Array.isArray(reposRaw)) return null;
  const repos = [
    ...new Set(
      reposRaw
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => REPO_PATTERN.test(v))
    ),
  ];
  if (repos.length === 0) return null;

  const rawInterval = Number(obj['intervalMs']);
  const intervalMs =
    Number.isFinite(rawInterval) && rawInterval > 0
      ? Math.max(Math.trunc(rawInterval), GITHUB_POLLER_MIN_INTERVAL_MS)
      : GITHUB_POLLER_DEFAULT_INTERVAL_MS;

  return { repos, intervalMs };
}

/** 读取配置（`autonomy.externalPollers.github` + `GITHUB_TOKEN`） */
export function readGithubIssuePollerConfig(): GithubIssuePollerConfig | null {
  const autonomy = configManager.getConfigValue<Record<string, unknown>>(
    GITHUB_POLLER_CONFIG_PATH
  );
  const pollers = autonomy?.['externalPollers'];
  const github =
    pollers && typeof pollers === 'object' && !Array.isArray(pollers)
      ? (pollers as Record<string, unknown>)['github']
      : undefined;
  const config = parseGithubIssuePollerConfig(
    github,
    configManager.env(GITHUB_TOKEN_ENV)
  );
  if (!config && github) {
    // 配了但未生效 ⇒ 如实说明原因（便于排障，不静默）
    logger.info('GitHub issue 轮询未启动', {
      reason: configManager.env(GITHUB_TOKEN_ENV)
        ? '未启用 / 无合法 repos'
        : `缺少 ${GITHUB_TOKEN_ENV}`,
    });
  }
  return config;
}

/**
 * 纯函数：issue → 外部事件（唯一翻译点）。
 *
 * `eventId` 用 `repo#id`（GitHub 的 issue id 全局唯一且稳定，重投不重复建工作项）；
 * `threadId` 用 `repo#number`（同一 issue 的事件串行）。
 */
export function issueToExternalEvent(
  repo: string,
  issue: GithubIssue
): ExternalEventInput {
  return {
    eventId: `github-issue:${repo}#${issue.id}`,
    threadId: `github-issue:${repo}#${issue.number}`,
    payload: {
      kind: 'github-issue',
      repo,
      number: issue.number,
      title: issue.title,
      url: issue.htmlUrl,
      state: issue.state,
      createdAt: issue.createdAt,
    },
  };
}

export interface GithubIssuePollerDeps {
  config: GithubIssuePollerConfig;
  emit: (input: ExternalEventInput) => Promise<boolean>;
  /** 拉取（测试可注入；缺省走 GitHub REST） */
  fetchIssues?: (
    repo: string,
    sinceIso: string,
    token: string
  ) => Promise<GithubIssue[]>;
  now?: () => number;
  onError?: (error: unknown, repo?: string) => void;
}

export interface GithubIssuePoller {
  /** 启动周期轮询（立即先跑一拍） */
  start(): void;
  /** 停止（幂等） */
  stop(): void;
  /** 跑一拍（测试/运维手动触发） */
  pollOnce(): Promise<void>;
}

/**
 * 创建轮询器（**不自动启动**；由流水线按开关调用 `start()`）。
 *
 * 失败语义：单个 repo 拉取失败只回调 `onError`，**不推进 `since`**、不影响其他 repo。
 */
export function createGithubIssuePoller(
  deps: GithubIssuePollerDeps
): GithubIssuePoller {
  const now = deps.now ?? Date.now;
  const fetchIssues = deps.fetchIssues ?? fetchIssuesFromGithub;
  const token = configManager.env(GITHUB_TOKEN_ENV) ?? '';
  let sinceIso = new Date(now()).toISOString();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const onError =
    deps.onError ??
    ((error: unknown, repo?: string) => {
      logger.warn('GitHub issue 拉取失败（不推进位点）', {
        repo: repo ?? null,
        error: String(error),
      });
    });

  async function pollOnce(): Promise<void> {
    if (running) return;
    running = true;
    const runStartedIso = new Date(now()).toISOString();
    let failed = false;
    try {
      for (const repo of deps.config.repos) {
        try {
          const issues = await fetchIssues(repo, sinceIso, token);
          for (const issue of issues) {
            await deps.emit(issueToExternalEvent(repo, issue));
          }
        } catch (error) {
          failed = true;
          onError(error, repo);
        }
      }
    } finally {
      running = false;
    }
    // 只在全部 repo 成功时推进位点（有失败 ⇒ 下一拍用旧位点重试）
    if (!failed) sinceIso = runStartedIso;
  }

  return {
    start() {
      if (timer) return;
      void pollOnce();
      timer = setInterval(() => {
        void pollOnce();
      }, deps.config.intervalMs);
      logger.info('GitHub issue 轮询已启动', {
        repos: deps.config.repos,
        intervalMs: deps.config.intervalMs,
      });
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger.info('GitHub issue 轮询已停止');
    },
    pollOnce,
  };
}

/**
 * 默认拉取实现：`GET /repos/{repo}/issues?state=all&since=…&sort=created&direction=asc`。
 *
 * - 过滤掉 `pull_request` 条目（GitHub 的 issues 接口会混入 PR）；
 * - 只取最小字段；`state` 原样透出（`open` / `closed`）；
 * - 非 2xx ⇒ 抛错（由调用方记日志，不推进位点）。
 */
export async function fetchIssuesFromGithub(
  repo: string,
  sinceIso: string,
  token: string
): Promise<GithubIssue[]> {
  const url =
    `${GITHUB_API_BASE}/repos/${repo}/issues?state=all` +
    `&since=${encodeURIComponent(sinceIso)}&sort=created&direction=asc&per_page=50`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}（${repo}）`);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => !row['pull_request'])
    .map((row) => ({
      id: Number(row['id']),
      number: Number(row['number']),
      title: String(row['title'] ?? ''),
      htmlUrl: String(row['html_url'] ?? ''),
      state: String(row['state'] ?? ''),
      createdAt: String(row['created_at'] ?? ''),
    }))
    .filter(
      (issue) => Number.isFinite(issue.id) && Number.isFinite(issue.number)
    );
}
