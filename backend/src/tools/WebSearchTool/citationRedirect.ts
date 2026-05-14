/**
 * Citation Redirect
 * 对标OpenClaw 引用重定向功能
 * 解析搜索结果中的重定向链接，提取真实目标URL
 */

export interface CitationRedirectResult {
  originalUrl: string;
  resolvedUrl: string;
  resolved: boolean;
  redirectType: CitationRedirectType;
  domain: string;
  originalDomain: string;
}

export type CitationRedirectType =
  | 'none'
  | 'search_redirect'
  | 'tracking_link'
  | 'url_shortener'
  | 'academic_redirect'
  | 'link_wrapper';

const SEARCH_REDIRECT_PATTERNS: Array<{
  pattern: RegExp;
  extractIndex: number;
  source: string;
}> = [
  { pattern: /\/url\?q=([^&]+)/i, extractIndex: 1, source: 'Google' },
  { pattern: /\/l.php\?u=([^&]+)/i, extractIndex: 1, source: 'Facebook' },
  { pattern: /\/redirect\?url=([^&]+)/i, extractIndex: 1, source: 'Generic' },
  { pattern: /\/redirect\/?[?]url=([^&]+)/i, extractIndex: 1, source: 'LinkedIn' },
  { pattern: /\/gateway\?url=([^&]+)/i, extractIndex: 1, source: 'Yahoo' },
  { pattern: /\/link\?url=([^&]+)/i, extractIndex: 1, source: 'Twitter/X' },
  { pattern: /\/away\?to=([^&]+)/i, extractIndex: 1, source: 'Reddit' },
];

const URL_SHORTENER_PATTERNS = [
  /^https?:\/\/bit\.ly\//i,
  /^https?:\/\/t\.co\//i,
  /^https?:\/\/tinyurl\.com\//i,
  /^https?:\/\/goo\.gl\//i,
  /^https?:\/\/ow\.ly\//i,
  /^https?:\/\/is\.gd\//i,
  /^https?:\/\/buff\.ly\//i,
  /^https?:\/\/shorturl\.at\//i,
  /^https?:\/\/0B/,
  /^https?:\/\/2ty\.cx\//i,
  /^https?:\/\/dlvr\.it\//i,
  /^https?:\/\/rb\.gy\//i,
];

const ACADEMIC_REDIRECT_PATTERNS = [
  /^https?:\/\/doi\.org\//i,
  /^https?:\/\/scholar\.google\.[a-z]+\/url\?/i,
  /^https?:\/\/link\.springer\.com\/.*\/url\?/i,
  /^https?:\/\/www\.nature\.com\/articles\/.*\/url\?/i,
  /^https?:\/\/dx\.doi\.org\//i,
];

const LINK_WRAPPER_DOMAINS = [
  'l.facebook.com', 'l.messenger.com', 'out.reddit.com',
  'redirect.viglink.com', 'click.linksynergy.com',
  'www.awin1.com', 'shareasale.com', 'anrdoezrs.net',
  'dpbolvw.net', 'tkqlhce.com', 'jdoqocy.com',
];

export function resolveCitationUrl(url: string): CitationRedirectResult {
  const originalDomain = extractDomain(url);
  const resolvedUrl = tryExtractRedirectUrl(url);
  const resolvedDomain = extractDomain(resolvedUrl);

  let redirectType: CitationRedirectType = 'none';

  if (resolvedUrl !== url) {
    if (isSearchRedirect(url)) {
      redirectType = 'search_redirect';
    } else if (isUrlShortener(url)) {
      redirectType = 'url_shortener';
    } else if (isAcademicRedirect(url)) {
      redirectType = 'academic_redirect';
    } else if (isLinkWrapper(url)) {
      redirectType = 'link_wrapper';
    } else {
      redirectType = 'tracking_link';
    }
  }

  return {
    originalUrl: url,
    resolvedUrl,
    resolved: resolvedUrl !== url,
    redirectType,
    domain: resolvedDomain,
    originalDomain,
  };
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function tryExtractRedirectUrl(url: string): string {
  for (const { pattern, extractIndex } of SEARCH_REDIRECT_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[extractIndex]) {
      try {
        const decoded = decodeURIComponent(match[extractIndex]);
        new URL(decoded);
        return decoded;
      } catch {
        continue;
      }
    }
  }

  if (isUrlShortener(url) || isLinkWrapper(url)) {
    return url;
  }

  if (url.includes('?') || url.includes('&')) {
    const redirectParams = ['redirect_uri=', 'redirect_url=', 'return_url=', 'return_to=', 'next=', 'destination='];
    for (const param of redirectParams) {
      const paramMatch = url.match(new RegExp(`${param}([^&]+)`));
      if (paramMatch) {
        try {
          const decoded = decodeURIComponent(paramMatch[1]);
          new URL(decoded);
          return decoded;
        } catch {
          continue;
        }
      }
    }
  }

  return url;
}

function isSearchRedirect(url: string): boolean {
  return SEARCH_REDIRECT_PATTERNS.some(({ pattern }) => pattern.test(url));
}

function isUrlShortener(url: string): boolean {
  return URL_SHORTENER_PATTERNS.some((pattern) => pattern.test(url));
}

function isAcademicRedirect(url: string): boolean {
  return ACADEMIC_REDIRECT_PATTERNS.some((pattern) => pattern.test(url));
}

function isLinkWrapper(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LINK_WRAPPER_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function extractCitationInfo(results: Array<{ title: string; url: string; snippet: string }>): Array<{
  title: string;
  originalUrl: string;
  resolvedUrl: string;
  domain: string;
  isRedirected: boolean;
  snippet: string;
}> {
  return results.map((r) => {
    const resolved = resolveCitationUrl(r.url);
    return {
      title: r.title,
      originalUrl: r.url,
      resolvedUrl: resolved.resolvedUrl,
      domain: resolved.domain,
      isRedirected: resolved.resolved,
      snippet: r.snippet,
    };
  });
}

export function formatCitations(
  citations: Array<{ title: string; resolvedUrl: string; domain: string }>,
  format?: 'numbered' | 'bulleted' | 'inline',
): string {
  switch (format ?? 'numbered') {
    case 'numbered':
      return citations
        .map((c, i) => `${i + 1}. [${c.title}](${c.resolvedUrl}) (${c.domain})`)
        .join('\n');

    case 'bulleted':
      return citations
        .map((c) => `- [${c.title}](${c.resolvedUrl}) (${c.domain})`)
        .join('\n');

    case 'inline': {
      const formatter = new Intl.ListFormat('en', { style: 'long', type: 'unit' });
      const links = citations.map((c) => `[${c.title}](${c.resolvedUrl})`);
      return formatter.format(links);
    }
  }
}
