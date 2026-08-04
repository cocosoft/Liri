import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export interface MarkdownifyOptions {
  headingStyle?: 'atx' | 'setext';
  bulletListMarker?: string;
  codeBlockStyle?: 'fenced' | 'indented';
  emDelimiter?: string;
  strongDelimiter?: string;
  linkStyle?: 'inlined' | 'referenced';
}

const DEFAULT_OPTIONS: MarkdownifyOptions = {
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
};

export function htmlToMarkdown(
  html: string,
  options?: MarkdownifyOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const $ = cheerio.load(html);

  $(
    'script, style, nav, footer, header, aside, .sidebar, .nav, .menu, noscript'
  ).remove();
  $('img[src^="data:"]').remove();

  const result = convertNode($, $.root(), opts, 0);
  return cleanupResult(result);
}

function convertNode(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<AnyNode>,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const results: string[] = [];

  node.contents().each((_i, el) => {
    if (el.type === 'text') {
      const text = el.data?.replace(/\s+/g, ' ') || '';
      if (text.trim()) {
        results.push(escapeText(text));
      }
      return;
    }

    if (el.type !== 'tag') return;

    const tag = el as Element;
    const tagName = tag.tagName.toLowerCase();
    const $el = $(tag);

    switch (tagName) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        results.push(convertHeading($, $el, tagName, opts, depth));
        break;
      case 'p':
        results.push(convertParagraph($, $el, opts, depth));
        break;
      case 'a':
        results.push(convertAnchor($, $el, opts));
        break;
      case 'img':
        results.push(convertImage($, $el));
        break;
      case 'br':
        results.push('\n');
        break;
      case 'hr':
        results.push('\n---\n');
        break;
      case 'ul':
      case 'ol':
        results.push(convertList($, $el, tagName, opts, depth));
        break;
      case 'li':
        results.push(convertListItem($, $el, opts, depth));
        break;
      case 'pre':
        results.push(convertPre($, $el, opts));
        break;
      case 'code':
        results.push(convertCode($, $el));
        break;
      case 'blockquote':
        results.push(convertBlockquote($, $el, opts, depth));
        break;
      case 'table':
        results.push(convertTable($, $el, opts));
        break;
      case 'div':
      case 'section':
      case 'article':
      case 'main':
        results.push(convertNode($, $el, opts, depth));
        break;
      case 'strong':
      case 'b':
        results.push(
          `${opts.strongDelimiter}${convertInline($, $el, opts)}${opts.strongDelimiter}`
        );
        break;
      case 'em':
      case 'i':
        results.push(
          `${opts.emDelimiter}${convertInline($, $el, opts)}${opts.emDelimiter}`
        );
        break;
      case 'input':
        results.push(convertInput($, $el));
        break;
      case 'dl':
        results.push(convertDefinitionList($, $el, opts, depth));
        break;
      case 'figure':
        results.push(convertNode($, $el, opts, depth) + '\n');
        break;
      case 'figcaption':
        results.push(`*${convertInline($, $el, opts)}*\n`);
        break;
      default:
        results.push(convertInline($, $el, opts));
    }
  });

  return results.join('');
}

function convertHeading(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  tagName: string,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const level = parseInt(tagName[1]);
  const prefix = '#'.repeat(level);
  const content = convertInline($, $el, opts).trim();
  const newlines = depth === 0 ? '\n\n' : '\n';
  return `${newlines}${prefix} ${content}\n${newlines}`;
}

function convertParagraph(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const content = convertInline($, $el, opts).trim();
  if (!content) return '';
  return `\n\n${content}\n\n`;
}

function convertAnchor(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions
): string {
  const href = ($el.attr('href') || '').trim();
  const text = convertInline($, $el, opts).trim() || href;

  if (!href || href.startsWith('javascript:')) return text;

  if (href === text) return href;

  return `[${text}](${escapeUri(href)})`;
}

function convertImage(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>
): string {
  const src = ($el.attr('src') || '').trim();
  const alt = ($el.attr('alt') || '').trim();

  if (!src || src.startsWith('data:')) return '';

  return `![${alt}](${escapeUri(src)})`;
}

function convertInput(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>
): string {
  const type = ($el.attr('type') || '').toLowerCase();
  const checked = $el.attr('checked') !== undefined;
  const isCheckbox = type === 'checkbox' || type === 'radio';

  if (isCheckbox) {
    return checked ? '[x]' : '[ ]';
  }

  return '';
}

function convertList(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  tagName: string,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const isOrdered = tagName === 'ol';
  const items: string[] = [];

  $el.children('li').each((_i, li) => {
    const $li = $(li);
    const prefix = isOrdered ? `${_i + 1}.` : opts.bulletListMarker || '-';
    const indent = '  '.repeat(depth);
    const content = convertInline($, $li, opts).trim();
    items.push(`${indent}${prefix} ${content}`);
  });

  return `\n${items.join('\n')}\n`;
}

function convertListItem(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions,
  depth: number
): string {
  return convertInline($, $el, opts).trim();
}

function convertPre(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions
): string {
  const $code = $el.children('code').first();
  const codeText = $code.length > 0 ? $code.text() : $el.text();
  const lang = $code.attr('class')?.replace(/^language-/, '') || '';

  const langTag = lang ? lang : '';
  return `\n\`\`\`${langTag}\n${codeText.replace(/\n$/, '')}\n\`\`\`\n`;
}

function convertCode(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>
): string {
  const text = $el.text();
  if (!text.trim()) return '';
  return `\`${text}\``;
}

function convertBlockquote(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const content = convertNode($, $el, opts, depth).trim();
  const lines = content.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'));
  return `\n${lines.join('\n')}\n`;
}

function convertTable(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions
): string {
  const allRows: string[][] = [];
  let headerIndex = -1;

  $el.find('tr').each((_i, tr) => {
    const $tr = $(tr);
    const cells: string[] = [];
    $tr.find('th, td').each((_j, cell) => {
      cells.push(convertInline($, $(cell), opts).trim());
    });
    if (cells.length === 0) return;
    allRows.push(cells);
    // 记录首个含 <th> 的行作为表头（mammoth 等转换器输出的表格可能全用 <td>，无 <th>）
    if (headerIndex === -1 && $tr.find('th').length > 0) {
      headerIndex = allRows.length - 1;
    }
  });

  if (allRows.length === 0) return '';

  // 无 <th> 时把第一行作为表头，避免整个表格被丢弃（原逻辑直接 return ''）
  const hasHeader = headerIndex !== -1;
  const header = hasHeader ? allRows[headerIndex] : allRows[0];
  const body = hasHeader
    ? allRows.filter((_, i) => i !== headerIndex)
    : allRows.slice(1);

  const colCount = Math.max(header.length, ...body.map((row) => row.length));
  const padRow = (row: string[]): string => {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };

  const headerMd = padRow(header);
  const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
  const bodyMd = body.map(padRow).join('\n');

  return `\n\n${headerMd}\n${separator}\n${bodyMd}\n\n`;
}

function convertDefinitionList(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions,
  depth: number
): string {
  const result: string[] = [];
  $el.children().each((_i, child) => {
    const $child = $(child);
    const tag = child.tagName?.toLowerCase();
    if (tag === 'dt') {
      result.push(`\n**${convertInline($, $child, opts).trim()}**`);
    } else if (tag === 'dd') {
      result.push(`: ${convertInline($, $child, opts).trim()}`);
    }
  });
  return result.join('\n') + '\n';
}

function convertInline(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<Element>,
  opts: MarkdownifyOptions
): string {
  return convertNode($, $el, opts, 999)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

function escapeUri(uri: string): string {
  return uri.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
}

function cleanupResult(md: string): string {
  return md
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trim();
}

export function convertString(
  html: string,
  options?: MarkdownifyOptions
): string {
  return htmlToMarkdown(html, options);
}
