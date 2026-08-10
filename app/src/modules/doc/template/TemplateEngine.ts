/**
 * Handlebars 模板引擎
 * 作为 OfficeCLI 文档创建的预处理层
 * 管线：用户数据 → Handlebars 渲染 → Markdown → OfficeCLI → DOCX
 */

import { getLogger } from '@modules/monitoring';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import Handlebars from 'handlebars';

const logger = getLogger('doc:template');

/** 模板元数据 */
export interface TemplateMeta {
  /** 模板名（唯一标识） */
  name: string;
  /** 显示名称 */
  displayName: string;
  /** 模板文件相对路径 */
  path: string;
  /** 输出格式 */
  outputFormat: 'docx' | 'xlsx' | 'pptx' | 'md';
  /** 功能描述 */
  description: string;
  /** 标签（用于搜索） */
  tags: string[];
  /** 语义版本 */
  version: string;
  /** 作者 */
  author: string;
  /** 渲染预览图 URL */
  previewImage?: string;
}

/** 内置模板注册表 */
export const BUILTIN_TEMPLATES: TemplateMeta[] = [
  {
    name: 'weekly-report',
    displayName: '周报模板',
    path: './builtin/weekly-report.hbs',
    outputFormat: 'docx',
    description: '适用于团队周报的场景，包含本周工作总结、下周计划和风险项',
    tags: ['周报', '中文', '团队'],
    version: '1.0.0',
    author: 'Liri',
  },
  {
    name: 'meeting-minutes',
    displayName: '会议纪要模板',
    path: './builtin/meeting-minutes.hbs',
    outputFormat: 'docx',
    description: '适用于技术团队会议纪要，包含议题、决策和行动项',
    tags: ['会议', '中文', '团队'],
    version: '1.0.0',
    author: 'Liri',
  },
  {
    name: 'tech-design',
    displayName: '技术设计文档模板',
    path: './builtin/tech-design.hbs',
    outputFormat: 'docx',
    description: '适用于软件技术设计文档，包含架构、接口和数据模型',
    tags: ['技术', '中文', '设计'],
    version: '1.0.0',
    author: 'Liri',
  },
  {
    name: 'prd',
    displayName: 'PRD 产品需求文档模板',
    path: './builtin/prd.hbs',
    outputFormat: 'docx',
    description: '适用于产品需求文档，包含用户故事、验收标准和里程碑',
    tags: ['产品', '中文', 'PRD'],
    version: '1.0.0',
    author: 'Liri',
  },
];

/**
 * 模板引擎
 * 基于 Handlebars 渲染 .hbs 模板文件
 * 内置模板从 builtin/ 目录加载，支持部分模板（partials）
 */
export class TemplateEngine {
  private templates: Map<string, TemplateMeta> = new Map();

  /** Handlebars partials 是否已注册 */
  private partialsRegistered = false;

  constructor() {
    for (const tmpl of BUILTIN_TEMPLATES) {
      this.registerTemplate(tmpl);
    }
  }

  /**
   * 注册模板元数据
   */
  registerTemplate(meta: TemplateMeta): void {
    this.templates.set(meta.name, meta);
    logger.debug('模板已注册', { name: meta.name, format: meta.outputFormat });
  }

  /**
   * 获取已注册模板列表
   */
  getTemplates(): TemplateMeta[] {
    return [...this.templates.values()];
  }

  /**
   * 按名称获取模板元数据
   */
  getTemplate(name: string): TemplateMeta | undefined {
    return this.templates.get(name);
  }

  /**
   * 获取模板数量
   */
  get templateCount(): number {
    return this.templates.size;
  }

  /**
   * 注册 Handlebars partials（_zh-fonts 等）
   */
  private registerPartials(templateDir: string): void {
    if (this.partialsRegistered) return;
    this.partialsRegistered = true;

    try {
      const zhFontsPath = resolve(
        templateDir,
        'builtin',
        '_common',
        '_zh-fonts.hbs'
      );
      if (existsSync(zhFontsPath)) {
        const content = readFileSync(zhFontsPath, 'utf-8');
        Handlebars.registerPartial('_common/_zh-fonts', content);
        logger.debug('中文排版 partial 已注册');
      }
    } catch (err) {
      logger.warn('中文排版 partial 注册失败', { error: String(err) });
    }
  }

  /**
   * 渲染模板
   *
   * 优先使用 Handlebars 编译 .hbs 文件；
   * 文件不存在时回退到简单的变量替换生成 Markdown。
   */
  render(templateName: string, variables: Record<string, unknown>): string {
    const meta = this.templates.get(templateName);
    if (!meta) {
      throw new Error(`模板 "${templateName}" 未找到`);
    }

    logger.info('模板渲染', {
      template: templateName,
      variables: Object.keys(variables),
    });

    // 尝试 Handlebars 渲染
    const templateDir = this.resolveTemplateDir();
    const templatePath = resolve(templateDir, meta.path);

    if (existsSync(templatePath)) {
      try {
        this.registerPartials(templateDir);
        const raw = readFileSync(templatePath, 'utf-8');
        const compiled = Handlebars.compile(raw);
        return compiled(variables);
      } catch (err) {
        logger.warn('Handlebars 渲染失败，回退到占位输出', {
          template: templateName,
          error: String(err),
        });
      }
    } else {
      logger.warn('.hbs 文件未找到，回退到占位输出', { path: templatePath });
    }

    // 回退：简单 Markdown 生成
    return this.renderFallback(meta, variables, templateName);
  }

  /**
   * 解析模板文件所在目录的绝对路径
   * 优先 import.meta.dir（Bun ESM），回退到 __dirname（CJS 兼容）
   */
  private resolveTemplateDir(): string {
    // Bun ESM 环境
    if (typeof (import.meta as any).dir === 'string') {
      return (import.meta as any).dir as string;
    }
    // Node.js CJS 回退
    if (typeof __dirname === 'string') {
      return __dirname;
    }
    // 最后的回退
    return process.cwd();
  }

  /**
   * 回退渲染：不使用 .hbs 文件，直接根据变量生成 Markdown
   */
  private renderFallback(
    meta: TemplateMeta,
    variables: Record<string, unknown>,
    templateName: string
  ): string {
    const lines: string[] = [];

    lines.push(`# ${meta.displayName}`);
    lines.push('');

    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'string') {
        lines.push(`**${key}**: ${value}`);
      } else if (Array.isArray(value)) {
        lines.push(`**${key}**:`);
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            const entries = Object.entries(item as Record<string, unknown>);
            lines.push(`- ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')}`);
          } else {
            lines.push(`- ${String(item)}`);
          }
        }
      }
    }

    lines.push('');
    lines.push(`---`);
    lines.push(
      `*由 Liri doc 模块自动生成，模板: ${templateName} v${meta.version}*`
    );

    return lines.join('\n');
  }

  /**
   * 获取模板输出格式
   */
  getOutputFormat(templateName: string): string {
    const meta = this.templates.get(templateName);
    return meta?.outputFormat || 'docx';
  }
}
