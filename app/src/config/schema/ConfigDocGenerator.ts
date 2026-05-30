/**
 * ConfigDocGenerator 配置文档生成器
 * 从 ConfigSchema 注册的配置项自动生成 Markdown 格式配置文档
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  ConfigSchema,
  configSchema,
  type ConfigItemDefinition,
} from './ConfigSchema.js';

/**
 * 文档生成选项
 */
export interface DocGenOptions {
  /** 文档标题，默认 "配置参考" */
  title?: string;
  /** 是否包含示例值 */
  showExamples?: boolean;
  /** 是否包含校验规则 */
  showValidation?: boolean;
  /** 是否包含类型枚举值 */
  showEnum?: boolean;
}

const defaultOptions: DocGenOptions = {
  title: 'Liri 配置参考',
  showExamples: true,
  showValidation: true,
  showEnum: true,
};

/**
 * 配置文档生成器
 */
export class ConfigDocGenerator {
  private schema: ConfigSchema;

  constructor(schema: ConfigSchema) {
    this.schema = schema;
  }

  /**
   * 生成 Markdown 文档字符串
   */
  generateMarkdown(options?: DocGenOptions): string {
    const opts = { ...defaultOptions, ...options };
    const categories = this.schema.getAllCategories();

    if (categories.length === 0) {
      return this.noContentMessage(opts);
    }

    const lines: string[] = [];

    lines.push(`# ${opts.title}`);
    lines.push('');
    lines.push('> 自动生成于 ' + new Date().toISOString().slice(0, 10));
    lines.push('');
    lines.push('## 目录');
    lines.push('');

    for (const cat of categories) {
      const anchor = this.toAnchor(cat.name);
      lines.push(`- [${cat.name}](#${anchor}) — ${cat.description}`);
    }

    lines.push('');

    for (const cat of categories) {
      lines.push(`---`);
      lines.push('');
      lines.push(`## ${cat.name}`);
      lines.push('');
      lines.push(cat.description);
      lines.push('');

      for (const item of cat.items) {
        this.renderItem(lines, item, opts);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(
      `*共 ${categories.length} 个分类，${this.schema.getAllCategories().reduce((s, c) => s + c.items.length, 0)} 个配置项*`
    );

    return lines.join('\n');
  }

  /**
   * 生成文档并写入文件
   */
  generateToFile(outputPath: string, options?: DocGenOptions): string {
    const content = this.generateMarkdown(options);
    const dir = dirname(outputPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(outputPath, content, 'utf-8');
    return outputPath;
  }

  /**
   * 生成简短的配置概览表格（适合 CLI 命令输出）
   */
  generateSummary(): string {
    const categories = this.schema.getAllCategories();

    if (categories.length === 0) {
      return '暂无注册的配置项。';
    }

    const lines: string[] = ['## 配置概览', ''];

    for (const cat of categories) {
      lines.push(`### ${cat.name}`);
      lines.push('');
      lines.push(`| 配置键 | 类型 | 默认值 | 描述 |`);
      lines.push(`|--------|------|--------|------|`);

      for (const item of cat.items) {
        const defaultValue = this.formatValue(item.defaultValue);
        lines.push(
          `| \`${item.key}\` | ${item.type} | ${defaultValue} | ${item.description} |`
        );
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成单个配置项的详细说明
   */
  generateItemDetail(key: string): string | null {
    const item = this.schema.getItem(key);

    if (!item) {
      return null;
    }

    const lines: string[] = [];
    this.renderItem(lines, item, {
      showExamples: true,
      showValidation: true,
      showEnum: true,
    });

    return lines.join('\n');
  }

  private renderItem(
    lines: string[],
    item: ConfigItemDefinition,
    opts: DocGenOptions
  ): void {
    const required = item.required ? ' **（必填）**' : '';
    lines.push(`### \`${item.key}\``);
    lines.push('');
    lines.push(`${item.description}${required}`);
    lines.push('');
    lines.push(`- **类型**: \`${item.type}\``);

    const defaultValue = this.formatValue(item.defaultValue);
    lines.push(`- **默认值**: \`${defaultValue}\``);

    if (opts.showEnum && item.enum && item.enum.length > 0) {
      lines.push(
        `- **枚举值**: ${item.enum.map((e) => `\`${e}\``).join(', ')}`
      );
    }

    if (opts.showValidation) {
      if (item.min !== undefined) {
        lines.push(`- **最小值**: ${item.min}`);
      }
      if (item.max !== undefined) {
        lines.push(`- **最大值**: ${item.max}`);
      }
      if (item.pattern) {
        lines.push(`- **格式**: \`${item.pattern}\``);
      }
    }

    if (opts.showExamples && item.example !== undefined) {
      lines.push(`- **示例**: \`${this.formatValue(item.example)}\``);
    }

    lines.push('');
  }

  private formatValue(value: unknown): string {
    if (value === undefined || value === null) {
      return '-';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).slice(0, 60);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private toAnchor(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]/g, '');
  }

  private noContentMessage(opts: DocGenOptions): string {
    return [
      `# ${opts.title}`,
      '',
      '> 自动生成于 ' + new Date().toISOString().slice(0, 10),
      '',
      '暂无注册的配置项。请通过 `configSchema.registerItem()` 或 `configSchema.registerCategory()` 注册配置项后重新生成。',
      '',
      '示例：',
      '',
      '```typescript',
      `import { configSchema } from '@modules/config/schema';`,
      '',
      'configSchema.registerItem("通用设置", {',
      '  key: "theme",',
      '  description: "应用主题",',
      '  type: "string",',
      '  defaultValue: "dark",',
      '  enum: ["dark", "light", "system"],',
      '});',
      '```',
    ].join('\n');
  }
}

/**
 * 快捷函数：从 configSchema 生成 Markdown 文档
 */
export function generateConfigDocs(options?: DocGenOptions): string {
  const generator = new ConfigDocGenerator(configSchema);
  return generator.generateMarkdown(options);
}

/**
 * 快捷函数：生成文档并写入文件
 */
export function generateConfigDocsToFile(
  outputPath: string,
  options?: DocGenOptions
): void {
  const generator = new ConfigDocGenerator(configSchema);
  generator.generateToFile(outputPath, options);
}
