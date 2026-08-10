/**
 * 深度链接协议处理器
 *
 * 解析 pyapp-cli:// 或 pyapp:// URI 协议
 * 提取查询参数(q)、工作目录(cwd)、仓库(repo)
 * 安全校验：控制字符过滤、长度限制、repo slug 验证
 *
 * 参考: cc_code/backend/utils/deepLink/parseDeepLink.ts
 *       cc_code/backend/utils/deepLink/protocolHandler.ts
 */

import { logForDebugging } from '../debug.js';
import { launchInTerminal } from './TerminalLauncher';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('utils:deepLink:ProtocolHandler');

export const DEEP_LINK_PROTOCOL = 'pyapp';

export type DeepLinkAction = {
  query?: string;
  cwd?: string;
  repo?: string;
};

const MAX_QUERY_LENGTH = 5000;
const MAX_CWD_LENGTH = 4096;
const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;

function containsControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function shellEscape(value: string): string {
  const escaped = value.replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

export function parseDeepLink(uri: string): DeepLinkAction {
  let url: URL;

  try {
    url = new URL(uri);
  } catch {
    throw new AppError(
      `Invalid URI: ${uri.slice(0, 100)}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  if (
    url.protocol !== `${DEEP_LINK_PROTOCOL}:` &&
    url.protocol !== `${DEEP_LINK_PROTOCOL}-cli:`
  ) {
    throw new AppError(
      `Unsupported protocol: ${url.protocol}. Expected ${DEEP_LINK_PROTOCOL}: or ${DEEP_LINK_PROTOCOL}-cli:`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const action: DeepLinkAction = {};

  const q = url.searchParams.get('q');
  if (q) {
    if (q.length > MAX_QUERY_LENGTH) {
      throw new AppError(
        `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (containsControlChars(q)) {
      throw new AppError(
        'Query contains disallowed control characters',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    action.query = q;
  }

  const cwd = url.searchParams.get('cwd');
  if (cwd) {
    if (cwd.length > MAX_CWD_LENGTH) {
      throw new AppError(
        `Working directory exceeds maximum length of ${MAX_CWD_LENGTH} characters`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (containsControlChars(cwd)) {
      throw new AppError(
        'Working directory contains disallowed control characters',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (
      cwd.includes('..') ||
      (cwd.startsWith('/') === false && cwd.includes(':'))
    ) {
      throw new AppError(
        'Working directory must be an absolute path',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    action.cwd = cwd;
  }

  const repo = url.searchParams.get('repo');
  if (repo) {
    if (!REPO_SLUG_PATTERN.test(repo)) {
      throw new AppError(
        `Invalid repository format: ${repo}. Expected owner/repo`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    action.repo = repo;
  }

  return action;
}

export async function handleDeepLinkUri(uri: string): Promise<number> {
  logForDebugging(`[deepLink] Handling URI: ${uri}`);

  let action: DeepLinkAction;
  try {
    action = parseDeepLink(uri);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Deep link error: ${message}`);
    return 1;
  }

  logForDebugging(`[deepLink] Parsed action: ${JSON.stringify(action)}`);

  const cwd = action.cwd || process.cwd();
  const execPath = process.execPath;

  const launched = await launchInTerminal(execPath, {
    query: action.query,
    cwd,
    repo: action.repo,
  });

  if (!launched) {
    logger.error(
      'Failed to open a terminal. Make sure a supported terminal emulator is installed.'
    );
    return 1;
  }

  return 0;
}

export function buildDeepLinkUri(
  params: DeepLinkAction,
  protocol: string = DEEP_LINK_PROTOCOL
): string {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('q', params.query);
  if (params.cwd) searchParams.set('cwd', params.cwd);
  if (params.repo) searchParams.set('repo', params.repo);

  const queryString = searchParams.toString();
  return queryString
    ? `${protocol}://open?${queryString}`
    : `${protocol}://open`;
}

export function buildShellCommand(
  action: DeepLinkAction,
  execPath: string
): string {
  const parts: string[] = [execPath];

  if (action.query) {
    parts.push(`--prefill ${shellEscape(action.query)}`);
  }
  if (action.repo) {
    parts.push(`--repo ${shellEscape(action.repo)}`);
  }
  if (action.cwd) {
    parts.push(`--cwd ${shellEscape(action.cwd)}`);
  }

  parts.push('--deep-link-origin');

  return parts.join(' ');
}
