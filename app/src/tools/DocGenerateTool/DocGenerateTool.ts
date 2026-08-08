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

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'tools:DocGenerateTool',
  level: LogLevel.INFO,
});

/** 支持的文档类型 */
const VALID_TYPES = ['docx', 'xlsx', 'pptx'] as const;
type DocType = (typeof VALID_TYPES)[number];

/** 工具输入参数 */
interface DocGenerateInput {
  title: string;
  content: string;
  type?: DocType;
  template?: string;
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
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
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
 * 支持：# → Heading1, ## → Heading2, ### → Heading3, - → 列表项, 普通文本 → 段落
 */
function markdownToBatchCommands(content: string): BatchCommand[] {
  const lines = content.split('\n');
  const commands: BatchCommand[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行跳过
    if (!trimmed) continue;

    // 标题
    if (trimmed.startsWith('### ')) {
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(4), style: 'Heading3' },
      });
    } else if (trimmed.startsWith('## ')) {
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(3), style: 'Heading2' },
      });
    } else if (trimmed.startsWith('# ')) {
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: trimmed.slice(2), style: 'Heading1' },
      });
    } else if (trimmed.startsWith('---')) {
      // 分隔线：添加空段落
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: '' },
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // 列表项
      const itemText = trimmed.slice(2);
      commands.push({
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: `• ${itemText}` },
      });
    } else {
      // 普通段落
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
        if (
          cmd.command === 'add' &&
          cmd.parent &&
          cmd.type &&
          cmd.props?.text !== undefined
        ) {
          const addArgs = ['add', filePath, cmd.parent, '--type', cmd.type];
          for (const [key, value] of Object.entries(cmd.props)) {
            addArgs.push('--prop', `${key}=${value}`);
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
  outputDir: string
): { fileName: string; filePath: string } {
  const safeName = sanitizeFileName(title);
  const fileName = `${safeName}.docx`;
  const filePath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

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

  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>Liri AI</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;

  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Liri AI</Application>
</Properties>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
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
    '创建并填充 Office 文档（.docx/.xlsx/.pptx）。' +
    '当用户要求"创建文档"、"生成周报"、"写一份会议纪要"、"导出为 docx"时必须调用此工具。' +
    '传入 Markdown 格式的内容（标题 # ## ###、列表 -、段落），自动生成格式化的 Office 文档。' +
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
      enum: ['docx', 'xlsx', 'pptx'],
      description:
        '文档类型：docx（Word文档）、xlsx（Excel表格）、pptx（演示文稿）。默认 docx',
      required: false,
      default: 'docx',
    },
    {
      name: 'template',
      type: 'string',
      enum: ['weekly-report', 'meeting-minutes', 'tech-design', 'prd'],
      description:
        '预置模板名称（可选）。weekly-report=周报、meeting-minutes=会议纪要、tech-design=技术设计、prd=产品需求文档',
      required: false,
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

      // 检测 officecli 可用性，选择生成路径
      const cliAvailable = isOfficeCLIAvailable();
      if (cliAvailable) {
        logger.info('DocGenerateTool: 使用 officecli 路径');
        result = createWithOfficeCLI(
          finalTitle,
          finalContent,
          docType,
          outputDir
        );
      } else if (docType === 'docx') {
        // 方案六 P1-3：officecli 不可用且目标为 docx 时，使用原生 OOXML 生成 fallback
        logger.info('DocGenerateTool: officecli 不可用，使用原生 docx 生成');
        result = createNativeDocx(finalTitle, finalContent, outputDir);
      } else {
        logger.info('DocGenerateTool: officecli 不可用，使用 Markdown 回退');
        // 回退：生成 Markdown 文件（xlsx/pptx 暂不提供原生生成）
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

      // officecli 不可用时的提示信息（docx 已走原生生成，非降级）
      const cliNote = cliAvailable
        ? ''
        : docType === 'docx'
          ? '\n\n⚠️ officecli 未安装，已使用内置原生 docx 生成器（非 Markdown 降级）。安装 officecli 可获得更丰富的格式支持。'
          : '\n\n⚠️ officecli 未安装，已生成 Markdown 降级文件。安装 officecli 后可生成真正的 .xlsx/.pptx 文件。';

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
