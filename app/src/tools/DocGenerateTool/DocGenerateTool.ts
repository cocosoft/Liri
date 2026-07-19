/**
 * DocGenerateTool — 文档生成工具
 * 利用 officecli (create + add + save) 生成 Office 文件到 output 目录
 * 管线：用户数据 → Handlebars 渲染 → officecli batch → .docx/.xlsx/.pptx
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
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
      if (isOfficeCLIAvailable()) {
        logger.info('DocGenerateTool: 使用 officecli 路径');
        result = createWithOfficeCLI(
          finalTitle,
          finalContent,
          docType,
          outputDir
        );
      } else {
        logger.info('DocGenerateTool: officecli 不可用，使用 Markdown 回退');
        // 回退：生成 Markdown 文件
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

      return {
        success: true,
        data,
        output: `文档已生成：${result.fileName}（${(size / 1024).toFixed(1)} KB，格式：${docType}）`,
      };
    } catch (error) {
      logger.error('DocGenerateTool: 执行异常！', {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
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
