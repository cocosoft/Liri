/**
 * DocGenerateTool — 文档生成工具
 * 利用 officecli (create + add + save) 生成 Office 文件到 output 目录
 * 管线：用户数据 → Handlebars 渲染 → officecli batch → .docx/.xlsx/.pptx
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { deflateRawSync } from 'zlib';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { sanitizeFileName as sanitizeFileNameBase } from '@modules/services/file/fileNaming';
import {
  DEFAULT_CN_FONT,
  LANG_PROFILES,
  cjkFontOf,
  resolveLanguage,
  type LangKey,
} from '@modules/system/i18n/languageProfiles';
const logger = getLogger('tools:DocGenerateTool');

/** 支持的文档类型（html 为原生生成，不依赖 officecli） */
const VALID_TYPES = ['docx', 'xlsx', 'pptx', 'html'] as const;
type DocType = (typeof VALID_TYPES)[number];

/** 工具输入参数 */
interface DocGenerateInput {
  title: string;
  content: string;
  type?: DocType;
  template?: string;
  /** 文档语言（如 zh-CN / en-US），未传则按 通用设置→系统→内容 解析 */
  language?: string;
  /** 全局字体名称（原生 docx 生成时写入 styles，如 微软雅黑/宋体） */
  fontName?: string;
  /** 正文字号（pt，仅原生 docx 生成生效，默认 10.5） */
  fontSize?: number;
}

/** 工具输出 */
interface DocGenerateOutput {
  fileName: string;
  filePath: string;
  type: DocType;
  size: number;
}

/** 单个 officecli batch 命令 */
interface BatchCommand {
  command: string;
  parent?: string;
  type?: string;
  props?: Record<string, string>;
  path?: string;
}

/**
 * 清洗文件名
 *
 * 非法字符清理（含全角符号）委托给统一入口 sanitizeFileName，
 * 此处仅保留额外的格式化（空格→下划线、连续下划线合并、首尾清理、长度截断）。
 */
function sanitizeFileName(name: string): string {
  return sanitizeFileNameBase(name)
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
}

/**
 * 检测 officecli 是否可用
 */
function isOfficeCLIAvailable(): boolean {
  try {
    execSync('officecli --version', {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 调用 officecli 子命令（spawnSync，无 shell 转义问题）
 */
function runOfficeCLI(args: string[]): {
  ok: boolean;
  error?: string;
  stdout?: string;
} {
  logger.info('DocGenerateTool: 调用 officecli', { args: args.slice(0, 4) });

  const result = spawnSync('officecli', args, {
    encoding: 'utf-8',
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status === 0) {
    return { ok: true, stdout: result.stdout?.trim() };
  }

  logger.warn('DocGenerateTool: officecli 调用失败', {
    status: result.status,
    stderr: result.stderr?.slice(0, 300),
    error: result.error?.message,
  });

  return {
    ok: false,
    error:
      result.stderr?.trim() ||
      result.error?.message ||
      'officecli 返回非零状态码',
  };
}

/**
 * 将 Markdown 内容解析为 batch 命令数组
 * 支持：# → Heading1, ## → Heading2, ### → Heading3, - → 列表项, ![alt](path) → picture, 普通文本 → 段落
 */
function markdownToBatchCommands(content: string): BatchCommand[] {
  const lines = content.split('\n');
  const commands: BatchCommand[] = [];
  // 段落计数器（1-based，用于 picture parent 定位）
  let paragraphCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行跳过
    if (!trimmed) continue;

    // 图片：![alt](path) → 先添加空段落，再添加 picture 到该段落
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const [, alt, src] = imgMatch;
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: '' },
      });
      commands.push({
        command: 'add',
        parent: `/body/p[${paragraphCount}]`,
        type: 'picture',
        props: { src, width: '15cm' },
      });
      continue;
    }

    // 标题
    if (trimmed.startsWith('### ')) {
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(4), style: 'Heading3' },
      });
    } else if (trimmed.startsWith('## ')) {
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(3), style: 'Heading2' },
      });
    } else if (trimmed.startsWith('# ')) {
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(2), style: 'Heading1' },
      });
    } else if (trimmed.startsWith('---')) {
      // 分隔线：添加空段落
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: '' },
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // 列表项
      paragraphCount++;
      const itemText = trimmed.slice(2);
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: `• ${itemText}` },
      });
    } else {
      // 普通段落
      paragraphCount++;
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed },
      });
    }
  }

  return commands;
}

/**
 * 使用 officecli batch 创建 Office 文档
 */
function createWithOfficeCLI(
  title: string,
  content: string,
  type: DocType,
  outputDir: string
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.${type}`;
  const filePath = join(outputDir, fileName);

  // 确保输出目录存在
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 删除旧文件
  try {
    unlinkSync(filePath);
  } catch {
    /* 不存在 */
  }

  // 1. 创建空白文档
  logger.info('DocGenerateTool: 步骤1 - 创建空白文档', { filePath });
  const createResult = runOfficeCLI(['create', filePath, '--json']);
  if (!createResult.ok) {
    throw new Error(`创建文档失败：${createResult.error}`);
  }

  // 2. 将 Markdown 内容解析为 batch 命令
  const commands = markdownToBatchCommands(content);
  logger.info('DocGenerateTool: 步骤2 - 解析Markdown', {
    commandCount: commands.length,
    contentLines: content.split('\n').length,
  });

  if (commands.length === 0) {
    // 如果内容为空，至少添加一个标题段落
    commands.push({
      command: 'add',
      parent: '/body',
      type: 'paragraph',
      props: { text: title, style: 'Heading1' },
    });
  }

  // 3. 通过 batch 命令添加所有内容
  const batchJson = JSON.stringify(commands);
  const tmpBatchPath = join(outputDir, `${safeName}_batch.json`);
  writeFileSync(tmpBatchPath, batchJson, 'utf-8');

  logger.info('DocGenerateTool: 步骤3 - 批量添加内容', {
    batchFile: tmpBatchPath,
    commandCount: commands.length,
    jsonSize: batchJson.length,
  });

  try {
    const batchResult = runOfficeCLI([
      'batch',
      filePath,
      '--input',
      tmpBatchPath,
      '--json',
    ]);

    if (!batchResult.ok) {
      logger.warn('officecli batch 失败，尝试逐条添加', {
        error: batchResult.error,
      });

      // 回退：逐条执行 add 命令
      for (const cmd of commands) {
        if (cmd.command === 'add' && cmd.parent && cmd.type) {
          const addArgs = ['add', filePath, cmd.parent, '--type', cmd.type];
          if (cmd.props) {
            for (const [key, value] of Object.entries(cmd.props)) {
              addArgs.push('--prop', `${key}=${value}`);
            }
          }
          addArgs.push('--json');
          runOfficeCLI(addArgs);
        }
      }
    }
  } finally {
    try {
      unlinkSync(tmpBatchPath);
    } catch {
      /* 忽略 */
    }
  }

  // 4. 保存并关闭文档
  logger.info('DocGenerateTool: 步骤4 - 保存并关闭');
  runOfficeCLI(['save', filePath, '--json']);
  runOfficeCLI(['close', filePath, '--json']);

  const fileExists = existsSync(filePath);
  const fileSize = fileExists ? statSync(filePath).size : 0;
  logger.info('DocGenerateTool: 文件创建完成', {
    filePath,
    exists: fileExists,
    size: fileSize,
  });

  return { fileName, filePath };
}

/**
 * 回退方案：生成 Markdown 文件（officecli 不可用时）
 */
function createFallbackMarkdown(
  title: string,
  content: string,
  type: DocType,
  outputDir: string
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const extMap: Record<DocType, string> = {
    docx: '.doc.md',
    xlsx: '.xls.md',
    pptx: '.ppt.md',
    html: '.html.md',
  };
  const ext = extMap[type] || '.md';
  const fileName = `${safeName}${ext}`;
  const filePath = join(outputDir, fileName);

  const header = `<!-- officecli 不可用，此文件为降级 Markdown 格式。安装 officecli 后可生成 .${type} 文件。-->\n\n`;
  writeFileSync(filePath, header + content, 'utf-8');

  logger.info('文档已通过 Markdown 回退方案生成（officecli 不可用）', {
    fileName,
    type,
  });

  return { fileName, filePath };
}

// ─── 方案六 P1-3：officecli 不可用时的原生 docx 生成 fallback ───────────────
// 纯 Node 实现（zlib + 手写 ZIP 结构），零第三方依赖。
// 支持标题（#/##/###）、列表（- /*）、段落，输出标准 .docx（Word 可打开）。

/** CRC32 表（标准多项式 0xEDB88320） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** XML 文本转义 */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 生成带样式的段落 XML */
function paragraphWithStyle(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/** Markdown 行 → OOXML 段落（与 markdownToBatchCommands 语义一致） */
function markdownLineToParagraph(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '<w:p/>';

  if (trimmed.startsWith('### ')) {
    return paragraphWithStyle(trimmed.slice(4), 'Heading3');
  }
  if (trimmed.startsWith('## ')) {
    return paragraphWithStyle(trimmed.slice(3), 'Heading2');
  }
  if (trimmed.startsWith('# ')) {
    return paragraphWithStyle(trimmed.slice(2), 'Heading1');
  }
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    // 列表项：与 officecli 路径一致使用 • 前缀段落，避免依赖 numbering.xml
    return `<w:p><w:r><w:t xml:space="preserve">• ${xmlEscape(trimmed.slice(2))}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(trimmed)}</w:t></w:r></w:p>`;
}

/** 手写最小 ZIP 打包（deflate 压缩） */
function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);

    // local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 文件名
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBuf, compressed);

    // central directory header
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // method
    centralHeader.writeUInt16LE(0, 12); // time
    centralHeader.writeUInt16LE(0x21, 14); // date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset
    central.push(centralHeader, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(central);
  const centralStart = offset;

  // end of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralDir, eocd]);
}

/**
 * 原生 docx 生成（officecli 不可用时的 fallback）
 * 生成标准 OOXML 结构的 .docx 文件，Word/WPS 可直接打开。
 */
function createNativeDocx(
  title: string,
  content: string,
  outputDir: string,
  options?: { fontName?: string; fontSize?: number; language?: LangKey }
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.docx`;
  const filePath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 正文字号：入参 pt → half-points（OOXML sz 单位），默认 10.5pt=21，限制 8~72pt
  const bodySizeHalf = Math.max(
    16,
    Math.min(144, Math.round((options?.fontSize ?? 10.5) * 2))
  );
  // 多语言字体：latin 域（ascii/hAnsi/cs）用语言默认字体，eastAsia 域用 cjkFontOf(lang)，
  // 支持中英混排；用户显式 fontName 时四域统一应用户字体（覆盖语言默认）。
  const lang = options?.language;
  const latinFont =
    options?.fontName ??
    (lang ? LANG_PROFILES[lang]?.fontName : undefined) ??
    DEFAULT_CN_FONT;
  const eastFont =
    options?.fontName ?? (lang ? cjkFontOf(lang) : DEFAULT_CN_FONT);
  const fontRpr = `<w:rFonts w:ascii="${xmlEscape(latinFont)}" w:hAnsi="${xmlEscape(latinFont)}" w:eastAsia="${xmlEscape(eastFont)}" w:cs="${xmlEscape(latinFont)}"/>`;
  // 语言标记：rPr 内位于 sz/szCs 之后（ECMA-376 CT_RPr 顺序）
  const langRpr = lang ? `<w:lang w:val="${xmlEscape(lang)}"/>` : '';

  const paragraphs = content
    .split('\n')
    .map((line) => markdownLineToParagraph(line))
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const coreProps = corePropsXml(title);
  const appProps = appPropsXml();

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>${fontRpr}<w:sz w:val="${bodySizeHalf}"/><w:szCs w:val="${bodySizeHalf}"/>${langRpr}</w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr>${fontRpr}<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/>${langRpr}</w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr>${fontRpr}<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/>${langRpr}</w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr>${fontRpr}<w:b/><w:sz w:val="24"/><w:szCs w:val="24"/>${langRpr}</w:rPr>
  </w:style>
</w:styles>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const zipBuffer = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf-8') },
    { name: 'docProps/core.xml', data: Buffer.from(coreProps, 'utf-8') },
    { name: 'docProps/app.xml', data: Buffer.from(appProps, 'utf-8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf-8') },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(docRels, 'utf-8'),
    },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml, 'utf-8') },
  ]);

  writeFileSync(filePath, zipBuffer);

  logger.info('原生 docx 生成成功（officecli 不可用，fallback）', {
    fileName,
    size: zipBuffer.length,
  });

  return { fileName, filePath };
}

// ─── 原生 Office 生成共享 XML 片段（docx/xlsx/pptx 复用） ────────────────────

/** docProps/core.xml（标题可配置） */
function corePropsXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>Liri AI</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;
}

/** docProps/app.xml */
function appPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Liri AI</Application>
</Properties>`;
}

// ─── 原生 xlsx 生成（officecli 不可用时的 fallback） ─────────────────────────
// 解析规则：`# ` 前缀 → 加粗单单元格；含 `|` 的行 → 表格行（按 | 拆分）；其余 → 单单元格。

/** 0 起始列索引 → Excel 列字母（A, B, ..., Z, AA...） */
function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** Sheet 名清理（Excel 限制：≤31 字符，不含 []:*?/\ ） */
function sanitizeSheetName(title: string): string {
  return title.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1';
}

/** Markdown 内容 → 工作表行（每行：单元格数组 + 是否加粗） */
function markdownToSheetRows(
  content: string
): { cells: string[]; bold: boolean }[] {
  return content
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return null;
      let text = line;
      let bold = false;
      if (text.startsWith('# ')) {
        text = text.slice(2);
        bold = true;
      }
      const cells = text
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      return { cells: cells.length > 0 ? cells : [text], bold };
    })
    .filter((r): r is { cells: string[]; bold: boolean } => r !== null);
}

function createNativeXlsx(
  title: string,
  content: string,
  outputDir: string,
  options?: { language?: LangKey }
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.xlsx`;
  const filePath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const sheetName = sanitizeSheetName(title);
  const rows = markdownToSheetRows(content);
  // 多语言字体：语言默认字体（非 CJK 语言 fallback 宋体）
  const xlsxFont = options?.language
    ? (LANG_PROFILES[options.language]?.fontName ?? DEFAULT_CN_FONT)
    : DEFAULT_CN_FONT;

  // 工作表：inlineStr 单元格；`# ` 标题行加粗（样式 s="1"）
  const sheetRowsXml = rows
    .map((row, r) => {
      const rowIdx = r + 1;
      const cells = row.cells
        .map((cell, c) => {
          const col = columnName(c);
          const s = row.bold ? ' s="1"' : '';
          return `<c r="${col}${rowIdx}" t="inlineStr"${s}><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIdx}">${cells}</row>`;
    })
    .join('');

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // 语言默认字体 + 加粗样式（标题行）
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="${xmlEscape(xlsxFont)}"/></font>
    <font><b/><sz val="11"/><name val="${xmlEscape(xlsxFont)}"/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const zipBuffer = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf-8') },
    {
      name: 'docProps/core.xml',
      data: Buffer.from(corePropsXml(title), 'utf-8'),
    },
    { name: 'docProps/app.xml', data: Buffer.from(appPropsXml(), 'utf-8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf-8') },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(workbookRels, 'utf-8'),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1Xml, 'utf-8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml, 'utf-8') },
  ]);

  writeFileSync(filePath, zipBuffer);

  logger.info('原生 xlsx 生成成功（officecli 不可用，fallback）', {
    fileName,
    size: zipBuffer.length,
  });

  return { fileName, filePath };
}

// ─── 原生 pptx 生成（officecli 不可用时的 fallback） ─────────────────────────
// 解析规则：独立行 `---` 分页；每页首行 `# ` 为标题；其余行为正文（- /* 前缀去除）。
// 幻灯片尺寸：16:9（12192000 x 6858000 EMU）。

function markdownToSlides(
  content: string
): { title: string; lines: string[] }[] {
  const slides: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '---') {
      if (current) slides.push(current);
      current = null;
      continue;
    }
    if (!current) current = { title: '', lines: [] };
    if (line.startsWith('# ')) {
      current.title = line.slice(2).trim();
    } else if (line) {
      current.lines.push(line.replace(/^[-*]\s+/, ''));
    }
  }
  if (current) slides.push(current);

  if (slides.length === 0) {
    slides.push({ title: '演示文稿', lines: [] });
  }
  return slides;
}

/** 单个幻灯片 XML（自绘文本形状，不依赖占位符继承，PowerPoint 可直接打开） */
function slideXml(
  slide: { title: string; lines: string[] },
  index: number,
  langTag = 'zh-CN'
): string {
  const titleText = slide.title || `第 ${index} 页`;
  const bodyParagraphs = (slide.lines.length > 0 ? slide.lines : [''])
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="${xmlEscape(langTag)}" sz="1800"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10374400" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="${xmlEscape(langTag)}" sz="3200" b="1"/><a:t>${xmlEscape(titleText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="10374400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bodyParagraphs}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function createNativePptx(
  title: string,
  content: string,
  outputDir: string,
  options?: { language?: LangKey }
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.pptx`;
  const filePath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 多语言字体：latin 域用语言默认字体，ea 域用 cjkFontOf(lang)
  const lang = options?.language;
  const pptxLatin = lang
    ? (LANG_PROFILES[lang]?.fontName ?? DEFAULT_CN_FONT)
    : 'Arial';
  const pptxEast = lang ? cjkFontOf(lang) : DEFAULT_CN_FONT;
  const langTag = lang ? (LANG_PROFILES[lang]?.langTag ?? lang) : 'zh-CN';

  const slides = markdownToSlides(content);

  // 逐页 slideN.xml + rels
  const slideEntries: { name: string; data: Buffer }[] = [];
  const slideIdLst: string[] = [];
  const slideRelsLst: string[] = [];
  slides.forEach((slide, i) => {
    const n = i + 1;
    slideEntries.push({
      name: `ppt/slides/slide${n}.xml`,
      data: Buffer.from(slideXml(slide, n, langTag), 'utf-8'),
    });
    slideEntries.push({
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
        'utf-8'
      ),
    });
    slideIdLst.push(`<p:sldId id="${255 + n}" r:id="rId${1 + n}"/>`);
    slideRelsLst.push(
      `<Relationship Id="rId${1 + n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`
    );
  });

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIdLst.join('')}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRelsLst.join('')}
</Relationships>`;

  const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr/></p:bodyStyle>
    <p:otherStyle/>
  </p:txStyles>
</p:sldMaster>`;

  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

  const slideLayoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj">
  <p:cSld name="Content">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

  const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="${xmlEscape(pptxLatin)}"/><a:ea typeface="${xmlEscape(pptxEast)}"/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="${xmlEscape(pptxLatin)}"/><a:ea typeface="${xmlEscape(pptxEast)}"/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const zipBuffer = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf-8') },
    {
      name: 'docProps/core.xml',
      data: Buffer.from(corePropsXml(title), 'utf-8'),
    },
    { name: 'docProps/app.xml', data: Buffer.from(appPropsXml(), 'utf-8') },
    {
      name: 'ppt/presentation.xml',
      data: Buffer.from(presentationXml, 'utf-8'),
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: Buffer.from(presentationRels, 'utf-8'),
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: Buffer.from(slideMasterXml, 'utf-8'),
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: Buffer.from(slideMasterRels, 'utf-8'),
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: Buffer.from(slideLayoutXml, 'utf-8'),
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: Buffer.from(slideLayoutRels, 'utf-8'),
    },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(themeXml, 'utf-8') },
    ...slideEntries,
  ]);

  writeFileSync(filePath, zipBuffer);

  logger.info('原生 pptx 生成成功（officecli 不可用，fallback）', {
    fileName,
    slideCount: slides.length,
    size: zipBuffer.length,
  });

  return { fileName, filePath };
}

// ─── 原生 html 生成（不依赖 officecli，始终走此路径） ────────────────────────
// Markdown → HTML：标题（#/##/###）、列表（- /*）、表格（| 分隔）、段落、分隔线。

/** HTML 转义 */
function htmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Markdown → HTML 正文片段 */
function markdownToHtmlBody(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  const pendingTables: string[][] = [];

  const flushList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const flushTable = (): void => {
    if (pendingTables.length === 0) return;
    const rows = pendingTables;
    const [header, ...body] = rows;
    out.push('<table><thead><tr>');
    for (const cell of header) out.push(`<th>${htmlEscape(cell)}</th>`);
    out.push('</tr></thead><tbody>');
    for (const row of body) {
      out.push('<tr>');
      for (const cell of row) out.push(`<td>${htmlEscape(cell)}</td>`);
      out.push('</tr>');
    }
    out.push('</tbody></table>');
    pendingTables.length = 0;
  };
  const flushAll = (): void => {
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 表格行：连续 `|` 分隔行收集；第二行若为分隔线（|---|）则跳过
    if (line.startsWith('|') || line.includes('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length > 0) {
        const isSeparator = cells.every((c) => /^:?-{1,}:?$/.test(c));
        if (!isSeparator) pendingTables.push(cells);
        flushList();
        continue;
      }
    }
    flushTable();
    if (line.startsWith('### ')) {
      flushAll();
      out.push(`<h3>${htmlEscape(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      flushAll();
      out.push(`<h2>${htmlEscape(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      flushAll();
      out.push(`<h1>${htmlEscape(line.slice(2))}</h1>`);
    } else if (line === '---') {
      flushAll();
      out.push('<hr/>');
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      flushTable();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${htmlEscape(line.slice(2))}</li>`);
    } else {
      flushAll();
      out.push(`<p>${htmlEscape(line)}</p>`);
    }
  }
  flushAll();
  return out.join('\n');
}

/** 原生 html 生成：UTF-8 + 内联样式（按语言字体 + fallback 链） */
function createNativeHtml(
  title: string,
  content: string,
  outputDir: string,
  options?: { language?: LangKey }
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.html`;
  const filePath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 多语言：lang 属性 + font-family fallback 链（latin 主字体 → 系统衬线 → CJK 字体 → 通用族）
  const lang = options?.language;
  const langTag = lang ? (LANG_PROFILES[lang]?.langTag ?? lang) : 'zh-CN';
  const latinFont =
    (lang ? LANG_PROFILES[lang]?.fontName : undefined) ?? DEFAULT_CN_FONT;
  const eastFont = lang ? cjkFontOf(lang) : DEFAULT_CN_FONT;

  const body = markdownToHtmlBody(content);
  const html = `<!DOCTYPE html>
<html lang="${htmlEscape(langTag)}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${htmlEscape(title)}</title>
<style>
body { font-family: ${xmlEscape(latinFont)}, "Liberation Serif", ${xmlEscape(eastFont)}, "Noto Serif CJK SC", serif; font-size: 12px; line-height: 1.8; color: #333; max-width: 800px; margin: 40px auto; padding: 0 20px; }
h1 { font-size: 22px; border-bottom: 2px solid #4f81bd; padding-bottom: 8px; }
h2 { font-size: 18px; }
h3 { font-size: 15px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
th { background: #f0f4f8; }
ul { padding-left: 24px; }
hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  writeFileSync(filePath, html, 'utf-8');

  logger.info('原生 html 生成成功', {
    fileName,
    size: Buffer.byteLength(html, 'utf-8'),
  });

  return { fileName, filePath };
}

export class DocGenerateTool extends BaseTool {
  name = 'doc_generate';

  constructor() {
    super();
    logger.info('DocGenerateTool 已实例化（将在 AI 工具列表中可见）');
  }

  /** 即使 officecli 不可用也启用（有 Markdown 回退方案） */
  override isEnabled(): boolean {
    return true;
  }

  description =
    '创建并填充 Office 文档（.docx/.xlsx/.pptx）或 HTML 页面（.html）。' +
    '当用户要求"创建文档"、"生成周报"、"写一份会议纪要"、"导出为 docx"、"导出为 html"时必须调用此工具。' +
    '传入 Markdown 格式的内容（标题 # ## ###、列表 -、段落、表格 |），自动生成格式化的文档。' +
    'type 参数默认 docx；template 可选：weekly-report / meeting-minutes / tech-design / prd。';

  params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description: '文档标题，同时用作文件名',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description:
        '文档正文内容，支持 Markdown 格式（标题、列表、粗体、表格等）',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['docx', 'xlsx', 'pptx', 'html'],
      description:
        '文档类型：docx（Word文档）、xlsx（Excel表格）、pptx（演示文稿）、html（网页）。默认 docx',
      required: false,
      default: 'docx',
    },
    {
      name: 'language',
      type: 'string',
      description:
        '文档语言（BCP-47，如 zh-CN / en-US / ja-JP）。未传时依次按 通用设置语言 → 系统语言 → 内容检测 自动解析；用于选择默认字体、lang 标记与 PDF 字体',
      required: false,
    },
    {
      name: 'template',
      type: 'string',
      enum: ['weekly-report', 'meeting-minutes', 'tech-design', 'prd'],
      description:
        '预置模板名称（可选）。weekly-report=周报、meeting-minutes=会议纪要、tech-design=技术设计、prd=产品需求文档',
      required: false,
    },
    {
      name: 'fontName',
      type: 'string',
      description:
        '全局字体名称（仅 officecli 不可用时的原生 docx 生成生效），如 微软雅黑/宋体/黑体。默认内置中文字体「宋体」',
      required: false,
      default: '宋体',
    },
    {
      name: 'fontSize',
      type: 'number',
      description:
        '正文字号（pt，仅 officecli 不可用时的原生 docx 生成生效），范围 8~72，默认 10.5',
      required: false,
      default: 10.5,
    },
  ];

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    logger.info('========================================', {});
    logger.info('DocGenerateTool.execute() 被 AI 调用！', {
      inputKeys: Object.keys(input),
    });
    logger.info('========================================', {});

    try {
      const params = input as unknown as DocGenerateInput;

      // 参数校验
      if (!params.title || typeof params.title !== 'string') {
        logger.warn('DocGenerateTool: 参数 title 无效', {
          title: params.title,
        });
        return {
          success: false,
          error: '参数 title 是必需的，且必须为字符串',
        };
      }
      if (!params.content || typeof params.content !== 'string') {
        logger.warn('DocGenerateTool: 参数 content 无效');
        return {
          success: false,
          error: '参数 content 是必需的，且必须为字符串',
        };
      }

      const docType: DocType =
        params.type && VALID_TYPES.includes(params.type as DocType)
          ? (params.type as DocType)
          : 'docx';

      // 渲染模板（如果指定了模板）
      let finalContent = params.content;
      let finalTitle = params.title;

      if (params.template) {
        try {
          const { TemplateEngine } =
            await import('@modules/doc/template/TemplateEngine');
          const engine = new TemplateEngine();
          const rendered = engine.render(params.template, {
            title: params.title,
            content: params.content,
            date: new Date().toLocaleDateString('zh-CN'),
            author: 'Liri AI',
          });
          finalContent = rendered;
          // 使用模板名作为标题后缀
          const templateDisplay =
            engine.getTemplate(params.template)?.displayName || params.template;
          finalTitle = `${params.title} - ${templateDisplay}`;
        } catch (err) {
          logger.warn('模板渲染失败，使用原始内容', {
            template: params.template,
            error: String(err),
          });
        }
      }

      // 获取输出目录
      const { resolveOutputDir } = await import('@modules/core');
      const outputDir = resolveOutputDir();

      logger.info('DocGenerateTool: 输出目录', {
        outputDir,
        exists: existsSync(outputDir),
        title: finalTitle,
        type: docType,
        contentLength: finalContent.length,
        officecliAvailable: isOfficeCLIAvailable(),
      });

      let result: { fileName: string; filePath: string };

      // 多语言解析：工具参数 language → 通用设置 → 系统语言 → 内容检测（收敛到表内 key）
      const lang = resolveLanguage(
        typeof params.language === 'string' ? params.language : undefined,
        finalContent
      );
      const fontNameOpt =
        typeof params.fontName === 'string' ? params.fontName : undefined;
      const fontSizeOpt =
        typeof params.fontSize === 'number' ? params.fontSize : undefined;

      // 检测 officecli 可用性，选择生成路径
      const cliAvailable = isOfficeCLIAvailable();
      if (docType === 'html') {
        // html 不依赖 officecli，始终走原生生成
        logger.info('DocGenerateTool: 使用原生 html 生成', { lang });
        result = createNativeHtml(finalTitle, finalContent, outputDir, {
          language: lang,
        });
      } else if (cliAvailable) {
        logger.info('DocGenerateTool: 使用 officecli 路径');
        result = createWithOfficeCLI(
          finalTitle,
          finalContent,
          docType,
          outputDir
        );
      } else if (docType === 'docx') {
        // 方案六 P1-3：officecli 不可用且目标为 docx 时，使用原生 OOXML 生成 fallback
        logger.info('DocGenerateTool: officecli 不可用，使用原生 docx 生成', {
          lang,
          fontName: fontNameOpt,
          fontSize: fontSizeOpt,
        });
        result = createNativeDocx(finalTitle, finalContent, outputDir, {
          fontName: fontNameOpt,
          fontSize: fontSizeOpt,
          language: lang,
        });
      } else if (docType === 'xlsx') {
        // 原生 xlsx fallback（表格：`# ` 加粗、`|` 拆列）
        logger.info('DocGenerateTool: officecli 不可用，使用原生 xlsx 生成', {
          lang,
        });
        result = createNativeXlsx(finalTitle, finalContent, outputDir, {
          language: lang,
        });
      } else if (docType === 'pptx') {
        // 原生 pptx fallback（`---` 分页，每页标题+正文）
        logger.info('DocGenerateTool: officecli 不可用，使用原生 pptx 生成', {
          lang,
        });
        result = createNativePptx(finalTitle, finalContent, outputDir, {
          language: lang,
        });
      } else {
        // 理论不可达（type 仅 docx/xlsx/pptx/html），保留 Markdown 降级兜底
        logger.info('DocGenerateTool: officecli 不可用，使用 Markdown 回退');
        result = createFallbackMarkdown(
          finalTitle,
          finalContent,
          docType,
          outputDir
        );
      }

      // 验证文件确实已生成
      if (!existsSync(result.filePath)) {
        logger.error('DocGenerateTool: 文件未生成！', {
          expectedPath: result.filePath,
          expectedName: result.fileName,
        });
        return {
          success: false,
          error: `文件未能成功生成：${result.fileName}`,
        };
      }

      // 获取文件大小
      const size = statSync(result.filePath).size;

      logger.info('DocGenerateTool: 文档生成成功！', {
        fileName: result.fileName,
        filePath: result.filePath,
        type: docType,
        sizeKB: (size / 1024).toFixed(1),
      });

      const data: DocGenerateOutput = {
        fileName: result.fileName,
        filePath: result.filePath,
        type: docType,
        size,
      };

      // officecli 不可用时的提示信息（docx/xlsx/pptx 均走内置原生生成；html 无此提示）
      const cliNote =
        docType === 'html'
          ? ''
          : cliAvailable
            ? ''
            : '\n\n⚠️ officecli 未安装，已使用内置原生生成器生成 .docx/.xlsx/.pptx。安装 officecli 可获得更丰富的格式支持。';

      return {
        success: true,
        data,
        output: `文档已生成：${result.fileName}（${(size / 1024).toFixed(1)} KB，格式：${docType}）${cliNote}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:docGenerate',
        action: '文档生成失败',
      });
      return {
        success: false,
        error: `文档生成失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * 创建 DocGenerateTool 实例
 */
export function createDocGenerateTool(): DocGenerateTool {
  return new DocGenerateTool();
}
