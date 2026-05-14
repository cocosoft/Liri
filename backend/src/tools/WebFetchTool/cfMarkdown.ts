/**
 * Cloudflare Markdown Converter
 * 对标OpenClaw CF Markdown转换功能
 * 将HTML内容转换为Clean Markdown格式
 */

export interface CfMarkdownOptions {
  headingStyle?: 'atx' | 'setext';
  codeBlockStyle?: 'fenced' | 'indented';
  emDelimiter?: '*' | '_';
  strongDelimiter?: '**' | '__';
  bulletListMarker?: '-' | '*' | '+';
  linkStyle?: 'inlined' | 'referenced';
  wrapWidth?: number;
  preserveImageTags?: boolean;
  preserveLinks?: boolean;
}

const DEFAULT_OPTIONS: Required<CfMarkdownOptions> = {
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  bulletListMarker: '-',
  linkStyle: 'inlined',
  wrapWidth: 0,
  preserveImageTags: true,
  preserveLinks: true,
};

function convertHeadings(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');
}

function convertParagraphs(html: string): string {
  return html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
}

function convertLists(html: string, marker: string): string {
  let result = html;

  result = result.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_: string, content: string) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, `${marker} $1\n`) + '\n';
  });

  result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_: string, content: string) => {
    let index = 1;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      return `${index++}. ${item}\n`;
    }) + '\n';
  });

  return result;
}

function convertCodeBlocks(html: string, style: string): string {
  if (style === 'fenced') {
    return html
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
        const lang = (_.match(/class="[^"]*language-(\w+)[^"]*"/) || [])[1] || '';
        return '```' + lang + '\n' + decodeHtmlEntities(code) + '\n```\n\n';
      })
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  }

  return html
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
      return '    ' + decodeHtmlEntities(code).replace(/\n/g, '\n    ') + '\n\n';
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
}

function convertFormatting(html: string, emDelim: string, strongDelim: string): string {
  return html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, `${strongDelim}$1${strongDelim}`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, `${strongDelim}$1${strongDelim}`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, `${emDelim}$1${emDelim}`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, `${emDelim}$1${emDelim}`)
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, `__$1__`)
    .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, `~~$1~~`)
    .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, `~~$1~~`)
    .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, `==$1==`)
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, `~$1~`)
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, `^$1^`);
}

function convertLinks(html: string, style: string): string {
  if (style === 'inlined') {
    return html.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  }

  const links: Array<{ href: string; text: string }> = [];
  let refIndex = 1;

  const result = html.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    links.push({ href, text });
    return `[${text}][${refIndex++}]`;
  });

  const refs = links.map((l, i) => `[${i + 1}]: ${l.href}`).join('\n');
  return result + '\n' + refs;
}

function convertImages(html: string): string {
  return html.replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, (match, src) => {
    const alt = (match.match(/alt=["']([^"']*)["']/) || [])[1] || '';
    return `![${alt}](${src})`;
  });
}

function convertTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
    const rows: string[][] = [];
    let headerRow: string[] | null = null;

    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(content)) !== null) {
      const cells: string[] = [];
      const cellPattern = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      if (rowMatch[1].includes('<th')) {
        headerRow = cells;
      } else {
        rows.push(cells);
      }
    }

    if (!headerRow && rows.length === 0) return '';

    return createMarkdownTable(headerRow, rows) + '\n\n';
  });
}

function createMarkdownTable(
  header: string[] | null,
  rows: string[][],
): string {
  const lines: string[] = [];

  if (header) {
    lines.push('| ' + header.join(' | ') + ' |');
    lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
  }

  for (const row of rows) {
    lines.push('| ' + row.join(' | ') + ' |');
  }

  return lines.join('\n');
}

function convertBlockquotes(html: string): string {
  return html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const cleaned = content.replace(/<[^>]+>/g, '').trim();
    return '> ' + cleaned.split('\n').join('\n> ') + '\n\n';
  });
}

function convertHorizontalRules(html: string): string {
  return html.replace(/<hr\s*\/?>/gi, '\n---\n\n');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function trimExcessWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trim();
}

function wordWrap(text: string, width: number): string {
  if (width <= 0) return text;

  return text.split('\n').map((line) => {
    if (line.length <= width || line.startsWith('```') || line.startsWith('    ')) {
      return line;
    }

    const words = line.split(' ');
    const wrapped: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length > width) {
        if (currentLine) wrapped.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }

    if (currentLine) wrapped.push(currentLine.trim());
    return wrapped.join('\n');
  }).join('\n');
}

export function htmlToMarkdown(html: string, options?: CfMarkdownOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let result = html;

  result = convertHeadings(result);
  result = convertParagraphs(result);
  result = convertLists(result, opts.bulletListMarker);
  result = convertCodeBlocks(result, opts.codeBlockStyle);
  result = convertFormatting(result, opts.emDelimiter, opts.strongDelimiter);

  if (opts.preserveLinks) {
    result = convertLinks(result, opts.linkStyle);
  }

  if (opts.preserveImageTags) {
    result = convertImages(result);
  }

  result = convertTables(result);
  result = convertBlockquotes(result);
  result = convertHorizontalRules(result);
  result = decodeHtmlEntities(result);
  result = trimExcessWhitespace(result);

  if (opts.wrapWidth > 0) {
    result = wordWrap(result, opts.wrapWidth);
  }

  return result;
}
