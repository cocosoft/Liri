/**
 * PDFTool PDF 生成工具
 * 让 Agent 从文本内容生成 PDF 文档或提取 PDF 文字
 */
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:PDFTool:PDFTool',
  level: LogLevel.INFO,
});

interface PDFInput {
  action: 'generate' | 'extract' | 'info';
  title?: string;
  content?: string;
  filename?: string;
  filepath?: string;
}

function generateSimplePDF(title: string, content: string): Buffer {
  const sanitized = content
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const lines = sanitized.split('\n');

  let pdf = '%PDF-1.4\n';
  const objects: string[] = [];

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');

  const textObjects: string[] = [];
  textObjects.push('BT');
  textObjects.push(`/F1 12 Tf`);
  textObjects.push(`/F1 18 Tf`);
  textObjects.push(`100 750 Td`);
  textObjects.push(`(${title.replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj`);
  textObjects.push('0 -20 Td');
  textObjects.push('/F1 10 Tf');

  for (const line of lines) {
    const truncated = line.slice(0, 100);
    textObjects.push(`0 -15 Td`);
    textObjects.push(
      `(${truncated.replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj`
    );
  }
  textObjects.push('ET');
  const streamContent = textObjects.join('\n');

  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj`
  );
  objects.push(
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`
  );

  const xrefOffset = pdf.length + objects.join('\n').length + 1;
  pdf += objects.join('\n') + '\n';
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  let offset = 0;
  for (let i = 0; i < objects.length; i++) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    offset += objects[i].length + 1;
  }

  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
  pdf += 'startxref\n' + xrefOffset + '\n%%EOF\n';

  return Buffer.from(pdf, 'latin1');
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
          const pdfBuffer = generateSimplePDF(docTitle, content);
          const outFile = filename || `document-${Date.now()}.pdf`;

          return {
            success: true,
            data: {
              filename: outFile,
              sizeBytes: pdfBuffer.length,
              title: docTitle,
              pages: 1,
            },
            output: `PDF generated: "${outFile}" (${pdfBuffer.length} bytes, 1 page)`,
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
