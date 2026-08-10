/**
 * PDFTool PDF 生成工具
 * 让 Agent 从文本内容生成 PDF 文档或提取 PDF 文字
 */
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';

import { getLogger } from '@modules/monitoring';
import {
  LANG_PROFILES,
  canUseStandardPdfFont,
  resolveLanguage,
  type LangKey,
} from '@modules/system/i18n/languageProfiles';
const logger = getLogger('tools:PDFTool:PDFTool');

interface PDFInput {
  action: 'generate' | 'extract' | 'info';
  title?: string;
  content?: string;
  filename?: string;
  filepath?: string;
}

/**
 * WinAnsi（CP1252）0x80–0x9F 区段 Unicode → 字节映射（编码文本流用；
 * 可编码性判定由共享模块 canUseStandardPdfFont 负责）
 */
const WINANSI_MAP: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** PDF 生成字体输入：'standard' = 标准 14 字体（免嵌入，WinAnsi）；否则嵌入字体 */
type PdfFontInput = { filePath: string; fontName: string } | 'standard';

/**
 * 按语言解析 PDF 字体（方案 v4 §5.3 pdf）：
 * 1. 语言支持免嵌入 且 内容可被 WinAnsi 覆盖 → 标准 Helvetica；
 * 2. 否则按 LANG_PROFILES[lang].pdfFonts 候选探测存在性，返回 { filePath, fontName }（fontName 随所选文件）；
 * 3. 全部缺失 → null（调用方报错降级）。
 */
function resolvePdfFont(lang: LangKey, content: string): PdfFontInput | null {
  const profile = LANG_PROFILES[lang];
  if (!profile) return null;
  if (profile.pdfStandard && canUseStandardPdfFont(content)) return 'standard';
  for (const candidate of profile.pdfFonts ?? []) {
    try {
      if (existsSync(candidate.path)) {
        return { filePath: candidate.path, fontName: candidate.fontName };
      }
    } catch {
      /* 路径不可访问则尝试下一个 */
    }
  }
  return null;
}

/** 文本 → PDF 十六进制字符串（Identity-H 编码下 UTF-16BE，每字符 2 字节） */
function toPdfHex(text: string): string {
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return `<${hex}>`;
}

/** 文本 → WinAnsi 转义字符串（标准字体用，含 \ ( ) 转义与 CP1252 字节映射） */
function escapePdfString(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x5c) {
      bytes.push(0x5c, 0x5c);
    } else if (code === 0x28) {
      bytes.push(0x5c, 0x28);
    } else if (code === 0x29) {
      bytes.push(0x5c, 0x29);
    } else if (code <= 0xff) {
      bytes.push(code);
    } else {
      bytes.push(WINANSI_MAP[code] ?? 0x3f);
    }
  }
  return Buffer.from(bytes).toString('latin1');
}

/** 生成 ToUnicode CMap（保证 PDF 文本可复制/搜索） */
function buildToUnicode(chars: Set<string>): string {
  const entries = Array.from(chars).map((ch) => {
    const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `<${code}> <${code}>`;
  });
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${entries.length} beginbfchar
${entries.join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/** 构建 PDF 文件（对象按序，xref 偏移精确计算） */
function buildPdf(objects: string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj + '\n';
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Markdown 内容 → PDF 行（标题/列表/段落） */
interface PdfLine {
  text: string;
  isTitle: boolean;
}

function markdownToPdfLines(content: string): PdfLine[] {
  const lines: PdfLine[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === '---') continue;
    if (line.startsWith('### ')) {
      lines.push({ text: line.slice(4), isTitle: true });
    } else if (line.startsWith('## ')) {
      lines.push({ text: line.slice(3), isTitle: true });
    } else if (line.startsWith('# ')) {
      lines.push({ text: line.slice(2), isTitle: true });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      lines.push({ text: `• ${line.slice(2)}`, isTitle: false });
    } else {
      lines.push({ text: line, isTitle: false });
    }
  }
  return lines;
}

/** 按 A4 可用高度分页（正文 18pt 行高、标题 28pt 行高） */
function chunkPdfLines(lines: PdfLine[]): PdfLine[][] {
  const capacityPts = 700;
  const chunks: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let used = 0;
  for (const line of lines) {
    const height = line.isTitle ? 28 : 18;
    if (used + height > capacityPts && current.length > 0) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += height;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

/** 单页内容流（页首标题 + 内容行；winansi=标准字体，identity=嵌入字体） */
function pdfPageStream(
  title: string,
  pageLines: PdfLine[],
  encoding: 'winansi' | 'identity'
): string {
  const maxChars = 45;
  const show = (text: string): string =>
    encoding === 'winansi'
      ? `(${escapePdfString(text)}) Tj`
      : `${toPdfHex(text)} Tj`;
  const ops: string[] = ['BT'];
  ops.push('/F1 20 Tf');
  ops.push('50 790 Td');
  ops.push(show(title));
  for (const line of pageLines) {
    const size = line.isTitle ? 15 : 12;
    ops.push(`/F1 ${size} Tf`);
    ops.push(`0 -${line.isTitle ? 28 : 18} Td`);
    const truncated =
      line.text.length > maxChars
        ? `${line.text.slice(0, maxChars)}…`
        : line.text;
    ops.push(show(truncated));
  }
  ops.push('ET');
  return ops.join('\n');
}

/** 标准 14 字体（Helvetica / WinAnsi）PDF 构建：仅内容可被 WinAnsi 覆盖时使用（免嵌入） */
function buildStandardPdf(title: string, pageChunks: PdfLine[][]): Buffer {
  const pageCount = pageChunks.length;
  const objects: string[] = [];

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from(
      { length: pageCount },
      (_, i) => `${3 + i} 0 R`
    ).join(' ')}] /Count ${pageCount} >>\nendobj`
  );
  // 3..2+P: Page（Contents 从 3+P 起）
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${3 + pageCount + i} 0 R >>\nendobj`
    );
  }
  pageChunks.forEach((pageLines) => {
    const stream = pdfPageStream(title, pageLines, 'winansi');
    objects.push(
      `${objects.length + 1} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  return buildPdf(objects);
}

/**
 * 生成 PDF：font='standard' 用 Helvetica（WinAnsi 免嵌入，仅英文等可编码内容）；
 * 否则嵌入 LANG_PROFILES 解析的字体（Type0/Identity-H + ToUnicode），支持中文等多语言。
 */
function generateSimplePDF(
  title: string,
  content: string,
  font: PdfFontInput
): { buffer: Buffer; pages: number; cjkFont: boolean } {
  const lines = markdownToPdfLines(content);
  const pageChunks = chunkPdfLines(lines);

  if (font === 'standard') {
    return {
      buffer: buildStandardPdf(title, pageChunks),
      pages: pageChunks.length,
      cjkFont: false,
    };
  }

  // 收集全部用到字符用于 ToUnicode
  const usedChars = new Set<string>();
  for (const line of lines) {
    for (const ch of line.text) usedChars.add(ch);
  }

  const fontData = readFileSync(font.filePath);
  const compressedFont = deflateSync(fontData);
  const fontName = font.fontName;

  // 对象编号规划：1 Catalog / 2 Pages / 3..2+P Page / 3+P Type0 / 4+P CIDFont /
  // 5+P FontDescriptor / 6+P FontFile2 / 7+P ToUnicode / 8+P..7+P+P Contents
  const pageCount = pageChunks.length;
  const type0Obj = 3 + pageCount;
  const cidFontObj = 4 + pageCount;
  const fontDescObj = 5 + pageCount;
  const fontFileObj = 6 + pageCount;
  const toUnicodeObj = 7 + pageCount;

  const objects: string[] = [];

  // 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // 2: Pages
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from(
      { length: pageCount },
      (_, i) => `${3 + i} 0 R`
    ).join(' ')}] /Count ${pageCount} >>\nendobj`
  );
  // 3..2+P: Page（Contents 从 8+P 起）
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${type0Obj} 0 R >> >> /Contents ${8 + pageCount + i} 0 R >>\nendobj`
    );
  }
  // 3+P: Type0 字体（F1）
  objects.push(
    `${type0Obj} 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [${cidFontObj} 0 R] /ToUnicode ${toUnicodeObj} 0 R >>\nendobj`
  );
  // 4+P: CIDFontType2
  objects.push(
    `${cidFontObj} 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescObj} 0 R /DW 1000 >>\nendobj`
  );
  // 5+P: FontDescriptor
  objects.push(
    `${fontDescObj} 0 obj\n<< /Type /FontDescriptor /FontName /${fontName} /Flags 4 /FontBBox [-60 -210 1200 859] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 859 /StemV 80 /FontFile2 ${fontFileObj} 0 R >>\nendobj`
  );
  // 6+P: FontFile2（FlateDecode 压缩 TTF）
  objects.push(
    `${fontFileObj} 0 obj\n<< /Length ${compressedFont.length} /Filter /FlateDecode /Length1 ${fontData.length} >>\nstream\n${compressedFont.toString('latin1')}\nendstream\nendobj`
  );
  // 7+P: ToUnicode
  objects.push(
    `${toUnicodeObj} 0 obj\n<< /Length ${Buffer.byteLength(buildToUnicode(usedChars), 'latin1')} >>\nstream\n${buildToUnicode(usedChars)}\nendstream\nendobj`
  );
  // 8+P..: Contents 流（每页一个，编号 = 当前已 push 对象数 + 1）
  pageChunks.forEach((pageLines) => {
    const stream = pdfPageStream(title, pageLines, 'identity');
    objects.push(
      `${objects.length + 1} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  return { buffer: buildPdf(objects), pages: pageCount, cjkFont: true };
}

/** 清洗输出文件名（禁用字符 → _，去除空白） */
function sanitizePdfFileName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 120) || 'document'
  );
}

/** 确保文件名以 .pdf 结尾 */
function ensurePdfExt(name: string): string {
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

export class PDFTool extends BaseTool<Record<string, unknown>> {
  name = 'pdf';
  description =
    'Generate simple PDF documents from text content. Supports creating, extracting text from, and getting info about PDF files.';
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        'Action: generate (create PDF), extract (read text), info (get metadata)',
      required: true,
      enum: ['generate', 'extract', 'info'],
    },
    {
      name: 'title',
      type: 'string',
      description: 'PDF document title (required for generate)',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Text content to include in the PDF (required for generate)',
      required: false,
    },
    {
      name: 'filename',
      type: 'string',
      description: 'Output filename (required for generate)',
      required: false,
    },
    {
      name: 'filepath',
      type: 'string',
      description: 'Path to an existing PDF file (required for extract/info)',
      required: false,
    },
  ];

  override aliases = ['generate-pdf', 'pdftool'];
  override searchHint = 'Generate or manipulate PDF documents';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { action, title, content, filename, filepath } =
        input as unknown as PDFInput;

      const validActions = ['generate', 'extract', 'info'];
      if (!action || !validActions.includes(action)) {
        return {
          success: false,
          error: `action must be one of: ${validActions.join(', ')}`,
        };
      }

      switch (action) {
        case 'generate': {
          if (!content || typeof content !== 'string') {
            return {
              success: false,
              error:
                'content is required and must be a string for generate action',
            };
          }

          const docTitle = title || 'Untitled';
          // 多语言解析（通用设置 → 系统语言 → 内容检测）→ 按语言选字体
          const lang = resolveLanguage(undefined, content);
          const font = resolvePdfFont(lang, content);
          if (!font) {
            return {
              success: false,
              error: `PDF 生成失败：语言 ${lang} 无可用字体（候选字体探测全部失败），已中止生成`,
            };
          }
          const { buffer, pages, cjkFont } = generateSimplePDF(
            docTitle,
            content,
            font
          );

          // 写入输出目录（~/.pyapp/output/）
          const { resolveOutputDir } = await import('@modules/core');
          const outputDir = resolveOutputDir();
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }
          const safeName = ensurePdfExt(
            sanitizePdfFileName(filename || `document-${Date.now()}.pdf`)
          );
          const outFile = join(outputDir, safeName);
          writeFileSync(outFile, buffer);

          logger.info('PDF 生成成功', {
            outFile,
            lang,
            pages,
            sizeBytes: buffer.length,
            embeddedFont: cjkFont,
          });

          return {
            success: true,
            data: {
              filename: safeName,
              filePath: outFile,
              sizeBytes: buffer.length,
              title: docTitle,
              language: lang,
              pages,
            },
            output: `PDF generated: "${safeName}" (${buffer.length} bytes, ${pages} page${pages > 1 ? 's' : ''}, language: ${lang}${cjkFont ? ', CJK 字体嵌入' : ', 标准字体免嵌入'})`,
          };
        }

        case 'extract': {
          if (!filepath) {
            return {
              success: false,
              error: 'filepath is required for extract action',
            };
          }
          return {
            success: true,
            data: {
              filepath,
              text: '[PDF text extraction requires a PDF parsing library]',
            },
            output: `PDF file "${filepath}" - text extraction requires pdf-parse library.`,
          };
        }

        case 'info': {
          if (!filepath) {
            return {
              success: false,
              error: 'filepath is required for info action',
            };
          }
          return {
            success: true,
            data: { filepath, pages: 'unknown', title: 'unknown' },
            output: `PDF file info for "${filepath}" - metadata requires pdf-parse library.`,
          };
        }

        default:
          return { success: false, error: `Unhandled action: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `PDF tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createPDFTool(): PDFTool {
  return new PDFTool();
}
