/**
 * Readability Extraction
 * 对标OpenClaw 可读性提取功能
 * 从HTML中提取可读性内容，去除导航/广告/页脚等干扰元素
 */

export interface ReadabilityResult {
  title: string | null;
  content: string;
  textContent: string;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  length: number;
  contentLength: number;
}

export interface ReadabilityOptions {
  maxContentLength?: number;
  includeImages?: boolean;
  includeLinks?: boolean;
  minContentLength?: number;
  removeSelectors?: string[];
}

const REMOVE_SELECTORS = [
  'script',
  'style',
  'nav',
  'footer',
  'header',
  '.sidebar',
  '#sidebar',
  '.advertisement',
  '.ad',
  '.social-share',
  '.comments',
  '#comments',
  '.related-posts',
  '.recommended',
  '.cookie-consent',
  '.popup',
  '.modal',
  '.newsletter',
  '.subscribe',
  'iframe',
  'noscript',
];

function extractTitle(doc: string): string | null {
  const ogMatch = doc.match(
    /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i
  );
  if (ogMatch) return ogMatch[1].trim();

  const titleMatch = doc.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();

  const h1Match = doc.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();

  return null;
}

function extractByline(doc: string): string | null {
  const authorMeta = doc.match(
    /<meta\s+name=["']author["']\s+content=["']([^"']*)["']/i
  );
  if (authorMeta) return authorMeta[1].trim();

  const ogAuthor = doc.match(
    /<meta\s+property=["']article:author["']\s+content=["']([^"']*)["']/i
  );
  if (ogAuthor) return ogAuthor[1].trim();

  return null;
}

function extractSiteName(doc: string): string | null {
  const ogSite = doc.match(
    /<meta\s+property=["']og:site_name["']\s+content=["']([^"']*)["']/i
  );
  if (ogSite) return ogSite[1].trim();

  const domain = doc.match(/https?:\/\/(?:www\.)?([^\/]+)/i);
  if (domain) return domain[1];

  return null;
}

function extractExcerpt(doc: string): string | null {
  const ogDesc = doc.match(
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i
  );
  if (ogDesc) return ogDesc[1].trim();

  const metaDesc = doc.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i
  );
  if (metaDesc) return metaDesc[1].trim();

  return null;
}

function getMainContent(doc: string, options: ReadabilityOptions): string {
  let cleaned = doc;

  const selectors = [...REMOVE_SELECTORS, ...(options.removeSelectors ?? [])];
  for (const sel of selectors) {
    const tagName = sel.replace(/^[.#]/, '');
    const patterns = [
      new RegExp(`<${sel}[^>]*>[\\s\\S]*?<\\/${sel}>`, 'gi'),
      new RegExp(
        `<${tagName}[^>]*class="[^"]*${sel.replace(/^\./, '')}[^"]*"[^>]*>[\\s\\S]*?<\\/${tagName}>`,
        'gi'
      ),
      new RegExp(
        `<${tagName}[^>]*id="${sel.replace(/^#/, '')}"[^>]*>[\\s\\S]*?<\\/${tagName}>`,
        'gi'
      ),
    ];
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
  }

  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return cleaned;
}

function htmlToText(html: string, options: ReadabilityOptions): string {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, alt) =>
      alt ? `[Image: ${alt}]` : ''
    )
    .replace(
      /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi,
      (_, href, text) => {
        if (!options.includeLinks) return text;
        return `${text} (${href})`;
      }
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (options.maxContentLength && text.length > options.maxContentLength) {
    text =
      text.substring(0, options.maxContentLength) + '\n\n[Content truncated]';
  }

  if (options.minContentLength && text.length < options.minContentLength) {
    return '';
  }

  return text;
}

export function extractReadableContent(
  html: string,
  options?: ReadabilityOptions
): ReadabilityResult | null {
  const opts: ReadabilityOptions = {
    maxContentLength: options?.maxContentLength ?? 100000,
    includeImages: options?.includeImages ?? false,
    includeLinks: options?.includeLinks ?? true,
    minContentLength: options?.minContentLength ?? 50,
    removeSelectors: options?.removeSelectors ?? [],
  };

  const mainHtml = getMainContent(html, opts);
  const textContent = htmlToText(mainHtml, opts);

  if (!textContent && opts.minContentLength && opts.minContentLength > 0) {
    const fallback = htmlToText(html, opts);
    if (!fallback) return null;
  }

  const contentHtml = opts.maxContentLength
    ? mainHtml.substring(0, opts.maxContentLength)
    : mainHtml;

  return {
    title: extractTitle(html),
    content: contentHtml,
    textContent: textContent || htmlToText(html, opts),
    excerpt: extractExcerpt(html),
    byline: extractByline(html),
    siteName: extractSiteName(html),
    length: mainHtml.length,
    contentLength: (textContent || '').length,
  };
}

export function generateMarkdown(
  result: ReadabilityResult,
  sourceUrl?: string
): string {
  const lines: string[] = [];

  if (result.title) {
    lines.push(`# ${result.title}`, '');
  }

  if (sourceUrl) {
    lines.push(`> Source: ${sourceUrl}`, '');
  }

  if (result.byline || result.siteName) {
    const meta: string[] = [];
    if (result.byline) meta.push(`By: ${result.byline}`);
    if (result.siteName) meta.push(`From: ${result.siteName}`);
    lines.push(`> ${meta.join(' · ')}`, '');
  }

  lines.push(result.textContent);

  return lines.join('\n');
}
