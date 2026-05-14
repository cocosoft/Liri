/**
 * Pre-approved URL List
 * 对标CC源码 WebFetchTool/preapproved.ts
 * 预批准URL列表，允许特定域名免审批直接访问
 */

export type PreapprovedMatchType = 'exact' | 'domain' | 'prefix' | 'pattern';

export interface PreapprovedEntry {
  domain: string;
  matchType: PreapprovedMatchType;
  allowed: boolean;
  reason: string;
  maxContentLength?: number;
  allowedMethods?: string[];
  rateLimit?: number;
  priority?: number;
}

const DEFAULT_PREAPPROVED_LIST: PreapprovedEntry[] = [
  // 主流开源代码托管平台
  { domain: 'github.com', matchType: 'domain', allowed: true, reason: 'Code hosting', priority: 10 },
  { domain: 'raw.githubusercontent.com', matchType: 'domain', allowed: true, reason: 'Raw content', priority: 10 },
  { domain: 'api.github.com', matchType: 'domain', allowed: true, reason: 'GitHub API', priority: 10 },
  { domain: 'gitlab.com', matchType: 'domain', allowed: true, reason: 'Code hosting', priority: 10 },
  { domain: 'bitbucket.org', matchType: 'domain', allowed: true, reason: 'Code hosting', priority: 10 },

  // 包管理注册表
  { domain: 'registry.npmjs.org', matchType: 'domain', allowed: true, reason: 'NPM registry', priority: 10 },
  { domain: 'www.npmjs.com', matchType: 'domain', allowed: true, reason: 'NPM packages', priority: 10 },
  { domain: 'pypi.org', matchType: 'domain', allowed: true, reason: 'PyPI', priority: 10 },
  { domain: 'files.pythonhosted.org', matchType: 'domain', allowed: true, reason: 'PyPI files', priority: 10 },
  { domain: 'crates.io', matchType: 'domain', allowed: true, reason: 'Cargo registry', priority: 10 },
  { domain: 'rubygems.org', matchType: 'domain', allowed: true, reason: 'RubyGems', priority: 10 },

  // 文档与知识库
  { domain: 'developer.mozilla.org', matchType: 'domain', allowed: true, reason: 'MDN docs', priority: 9 },
  { domain: 'docs.microsoft.com', matchType: 'domain', allowed: true, reason: 'MS docs', priority: 9 },
  { domain: 'learn.microsoft.com', matchType: 'domain', allowed: true, reason: 'MS Learn', priority: 9 },
  { domain: 'stackoverflow.com', matchType: 'domain', allowed: true, reason: 'Q&A', priority: 9 },
  { domain: 'stackexchange.com', matchType: 'domain', allowed: true, reason: 'Q&A', priority: 9 },
  { domain: 'en.wikipedia.org', matchType: 'domain', allowed: true, reason: 'Wikipedia', priority: 9 },
  { domain: 'docs.docker.com', matchType: 'domain', allowed: true, reason: 'Docker docs', priority: 9 },
  { domain: 'kubernetes.io', matchType: 'domain', allowed: true, reason: 'K8s docs', priority: 9 },
  { domain: 'nodejs.org', matchType: 'domain', allowed: true, reason: 'Node.js docs', priority: 9 },
  { domain: 'dev.to', matchType: 'domain', allowed: true, reason: 'Dev community', priority: 7 },

  // 编程语言官方
  { domain: 'www.typescriptlang.org', matchType: 'domain', allowed: true, reason: 'TypeScript', priority: 8 },
  { domain: 'www.python.org', matchType: 'domain', allowed: true, reason: 'Python', priority: 8 },
  { domain: 'go.dev', matchType: 'domain', allowed: true, reason: 'Go language', priority: 8 },
  { domain: 'rust-lang.org', matchType: 'domain', allowed: true, reason: 'Rust language', priority: 8 },
  { domain: 'www.java.com', matchType: 'domain', allowed: true, reason: 'Java', priority: 8 },
  { domain: 'dotnet.microsoft.com', matchType: 'domain', allowed: true, reason: '.NET', priority: 8 },

  // 技术新闻
  { domain: 'news.ycombinator.com', matchType: 'domain', allowed: true, reason: 'Hacker News', priority: 6 },
  { domain: 'medium.com', matchType: 'domain', allowed: true, reason: 'Blog platform', priority: 5 },
  { domain: 'www.reddit.com', matchType: 'domain', allowed: true, reason: 'Reddit', priority: 5 },

  // 禁止的高风险域名
  { domain: 'localhost', matchType: 'domain', allowed: false, reason: 'SSRF protection - localhost', priority: 20 },
  { domain: '127.0.0.1', matchType: 'exact', allowed: false, reason: 'SSRF protection - loopback', priority: 20 },
  { domain: '0.0.0.0', matchType: 'exact', allowed: false, reason: 'SSRF protection', priority: 20 },
  { domain: '169.254.169.254', matchType: 'exact', allowed: false, reason: 'SSRF protection - metadata', priority: 20 },
];

let preapprovedList: PreapprovedEntry[] = [...DEFAULT_PREAPPROVED_LIST];

export function resetPreapprovedList(): void {
  preapprovedList = [...DEFAULT_PREAPPROVED_LIST];
}

export function getPreapprovedList(): PreapprovedEntry[] {
  return [...preapprovedList];
}

export function addPreapprovedEntry(entry: PreapprovedEntry): void {
  const existing = preapprovedList.findIndex(
    (e) => e.domain === entry.domain && e.matchType === entry.matchType,
  );
  if (existing >= 0) {
    preapprovedList[existing] = entry;
  } else {
    preapprovedList.push(entry);
  }
}

export function removePreapprovedEntry(domain: string): boolean {
  const before = preapprovedList.length;
  preapprovedList = preapprovedList.filter((e) => e.domain !== domain);
  return preapprovedList.length < before;
}

export function isUrlPreapproved(url: string): PreapprovedEntry | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    const sorted = [...preapprovedList].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    for (const entry of sorted) {
      switch (entry.matchType) {
        case 'exact':
          if (hostname === entry.domain) {
            return entry;
          }
          break;
        case 'domain':
          if (hostname === entry.domain || hostname.endsWith(`.${entry.domain}`)) {
            return entry;
          }
          break;
        case 'prefix':
          if (hostname.startsWith(entry.domain)) {
            return entry;
          }
          break;
        case 'pattern': {
          const pattern = entry.domain
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
          if (new RegExp(`^${pattern}$`, 'i').test(hostname)) {
            return entry;
          }
          break;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isUrlAllowed(url: string): boolean {
  const entry = isUrlPreapproved(url);
  return entry !== null && entry.allowed;
}

export function isUrlBlocked(url: string): boolean {
  const entry = isUrlPreapproved(url);
  return entry !== null && !entry.allowed;
}

export function getEffectiveMaxContentLength(url: string): number | undefined {
  const entry = isUrlPreapproved(url);
  return entry?.maxContentLength;
}
