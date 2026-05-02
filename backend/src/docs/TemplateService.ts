/**
 * 文档模板服务
 * 提供文档模板管理和生成功能
 */

/**
 * 模板变量类型
 */
export type TemplateVariableType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';

/**
 * 模板变量
 */
export interface TemplateVariable {
  name: string;
  type: TemplateVariableType;
  defaultValue?: any;
  description?: string;
  required?: boolean;
}

/**
 * 模板定义
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  variables: TemplateVariable[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

/**
 * 模板渲染结果
 */
export interface TemplateRenderResult {
  success: boolean;
  content: string;
  errors: string[];
  warnings: string[];
  usedVariables: string[];
  missingVariables: string[];
}

/**
 * 模板搜索过滤器
 */
export interface TemplateSearchFilter {
  category?: string;
  tags?: string[];
  keyword?: string;
}

/**
 * 内置模板
 */
const BUILT_IN_TEMPLATES: Omit<TemplateDefinition, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'api-doc',
    name: 'API 文档',
    description: '标准 API 文档模板',
    category: 'documentation',
    content: `# API 文档

## {{apiName}}

### 描述
{{description}}

### 基本信息
- **版本**: {{version}}
- **作者**: {{author}}
- **创建日期**: {{createdDate}}

### 接口列表

{{#each endpoints}}
#### {{method}} {{path}}

**描述**: {{description}}

**参数**:
{{#each parameters}}
- {{name}} ({{type}}): {{description}}
{{/each}}

**返回值**:
\`\`\`{{returnType}}
{{returnExample}}
\`\`\`

{{/each}}

### 使用示例

\`\`\`{{exampleLanguage}}
{{exampleCode}}
\`\`\`
`,
    variables: [
      { name: 'apiName', type: 'string', required: true, description: 'API 名称' },
      { name: 'description', type: 'string', description: 'API 描述' },
      { name: 'version', type: 'string', defaultValue: '1.0.0', description: '版本号' },
      { name: 'author', type: 'string', description: '作者' },
      { name: 'createdDate', type: 'date', description: '创建日期' },
      { name: 'endpoints', type: 'array', description: '端点列表' },
      { name: 'exampleLanguage', type: 'string', defaultValue: 'javascript', description: '示例语言' },
      { name: 'exampleCode', type: 'string', description: '示例代码' },
    ],
    tags: ['api', 'documentation', 'standard'],
    version: 1,
  },
  {
    id: 'readme',
    name: 'README 文档',
    description: '项目 README 文档模板',
    category: 'documentation',
    content: `# {{projectName}}

{{badges}}

## 简介

{{description}}

## 特性

{{#each features}}
- {{this}}
{{/each}}

## 安装

\`\`\`bash
npm install {{packageName}}
\`\`\`

## 快速开始

\`\`\`{{codeLanguage}}
{{quickStartCode}}
\`\`\`

## 使用文档

详细的 API 文档请参阅 [文档]({{docsUrl}})。

## 贡献

贡献者列表请参阅 [贡献者]({{contributorsUrl}})。

## 许可证

本项目采用 [{{license}}]({{licenseUrl}}) 许可证。
`,
    variables: [
      { name: 'projectName', type: 'string', required: true, description: '项目名称' },
      { name: 'badges', type: 'string', description: '徽章' },
      { name: 'description', type: 'string', description: '项目描述' },
      { name: 'features', type: 'array', description: '项目特性' },
      { name: 'packageName', type: 'string', description: '包名称' },
      { name: 'codeLanguage', type: 'string', defaultValue: 'javascript', description: '代码语言' },
      { name: 'quickStartCode', type: 'string', description: '快速开始代码' },
      { name: 'docsUrl', type: 'string', description: '文档链接' },
      { name: 'contributorsUrl', type: 'string', description: '贡献者链接' },
      { name: 'license', type: 'string', defaultValue: 'MIT', description: '许可证' },
      { name: 'licenseUrl', type: 'string', description: '许可证链接' },
    ],
    tags: ['readme', 'documentation', 'project'],
    version: 1,
  },
  {
    id: 'changelog',
    name: '更新日志',
    description: '变更日志模板',
    category: 'changelog',
    content: `# 更新日志

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [{{version}}] - {{releaseDate}}

### {{changeType}}

{{#each changes}}
- {{this}}
{{/each}}

### {{additionalType}}

{{#each additional}}
- {{this}}
{{/each}}
`,
    variables: [
      { name: 'version', type: 'string', required: true, description: '版本号' },
      { name: 'releaseDate', type: 'date', description: '发布日期' },
      { name: 'changeType', type: 'string', defaultValue: 'Added', description: '变更类型' },
      { name: 'changes', type: 'array', description: '变更列表' },
      { name: 'additionalType', type: 'string', description: '附加类型' },
      { name: 'additional', type: 'array', description: '附加列表' },
    ],
    tags: ['changelog', 'version', 'release'],
    version: 1,
  },
  {
    id: 'release-note',
    name: '发布说明',
    description: '版本发布说明模板',
    category: 'release',
    content: `# {{releaseVersion}} 发布说明

**发布类型**: {{releaseType}}
**发布日期**: {{releaseDate}}
**下载链接**: {{downloadUrl}}

## 重要更新

{{#each importantChanges}}
### {{title}}
{{content}}
{{/each}}

## 新功能

{{#each newFeatures}}
- {{title}}: {{description}}
{{/each}}

## 功能优化

{{#each improvements}}
- {{title}}: {{description}}
{{/each}}

## 问题修复

{{#each bugFixes}}
- [{{issueId}}] {{description}}
{{/each}}

## 破坏性变更

{{breakingChanges}}

## 迁移指南

{{migrationGuide}}

## 已知问题

{{#each knownIssues}}
- {{this}}
{{/each}}

## 致谢

{{acknowledgements}}
`,
    variables: [
      { name: 'releaseVersion', type: 'string', required: true, description: '发布版本' },
      { name: 'releaseType', type: 'string', description: '发布类型' },
      { name: 'releaseDate', type: 'date', description: '发布日期' },
      { name: 'downloadUrl', type: 'string', description: '下载链接' },
      { name: 'importantChanges', type: 'array', description: '重要更新' },
      { name: 'newFeatures', type: 'array', description: '新功能' },
      { name: 'improvements', type: 'array', description: '功能优化' },
      { name: 'bugFixes', type: 'array', description: '问题修复' },
      { name: 'breakingChanges', type: 'string', description: '破坏性变更' },
      { name: 'migrationGuide', type: 'string', description: '迁移指南' },
      { name: 'knownIssues', type: 'array', description: '已知问题' },
      { name: 'acknowledgements', type: 'string', description: '致谢' },
    ],
    tags: ['release', 'version', 'announcement'],
    version: 1,
  },
];

/**
 * 模板服务
 */
export class TemplateService {
  private templates: Map<string, TemplateDefinition> = new Map();
  private variablePatterns: {
    simple: RegExp;
    block: RegExp;
    conditional: RegExp;
  };

  /**
   * 构造函数
   */
  constructor() {
    this.variablePatterns = {
      simple: /\{\{(\w+)\}\}/g,
      block: /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      conditional: /\{\{(\w+)\?\}\}([\s\S]*?)(?:\{\{:\}\}([\s\S]*?))?\{\{\/\1\}\}/g,
    };

    this.loadBuiltInTemplates();
  }

  /**
   * 加载内置模板
   */
  private loadBuiltInTemplates(): void {
    const now = Date.now();

    for (const template of BUILT_IN_TEMPLATES) {
      const definition: TemplateDefinition = {
        ...template,
        createdAt: now,
        updatedAt: now,
      };

      this.templates.set(template.id, definition);
    }
  }

  /**
   * 注册模板
   */
  public registerTemplate(template: Omit<TemplateDefinition, 'createdAt' | 'updatedAt'>): void {
    const now = Date.now();
    const definition: TemplateDefinition = {
      ...template,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(template.id, definition);
  }

  /**
   * 获取模板
   */
  public getTemplate(id: string): TemplateDefinition | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取所有模板
   */
  public getAllTemplates(): TemplateDefinition[] {
    return Array.from(this.templates.values());
  }

  /**
   * 删除模板
   */
  public deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  /**
   * 搜索模板
   */
  public searchTemplates(filter: TemplateSearchFilter): TemplateDefinition[] {
    let results = Array.from(this.templates.values());

    if (filter.category) {
      results = results.filter(t => t.category === filter.category);
    }

    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(t =>
        filter.tags!.some(tag => t.tags.includes(tag))
      );
    }

    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase();
      results = results.filter(t =>
        t.name.toLowerCase().includes(keyword) ||
        t.description.toLowerCase().includes(keyword) ||
        t.tags.some(tag => tag.toLowerCase().includes(keyword))
      );
    }

    return results;
  }

  /**
   * 获取模板分类
   */
  public getCategories(): string[] {
    const categories = new Set<string>();

    for (const template of this.templates.values()) {
      categories.add(template.category);
    }

    return Array.from(categories);
  }

  /**
   * 渲染模板
   */
  public render(templateId: string, variables: Record<string, any>): TemplateRenderResult {
    const template = this.templates.get(templateId);

    if (!template) {
      return {
        success: false,
        content: '',
        errors: [`Template '${templateId}' not found`],
        warnings: [],
        usedVariables: [],
        missingVariables: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const usedVariables: string[] = [];
    const missingVariables: string[] = [];

    const requiredVars = template.variables.filter(v => v.required);

    for (const varDef of requiredVars) {
      if (variables[varDef.name] === undefined) {
        if (varDef.defaultValue !== undefined) {
          variables[varDef.name] = varDef.defaultValue;
          warnings.push(`Using default value for required variable: ${varDef.name}`);
        } else {
          errors.push(`Missing required variable: ${varDef.name}`);
          missingVariables.push(varDef.name);
        }
      }
    }

    let content = template.content;

    content = this.renderSimpleVariables(content, variables, usedVariables);

    content = this.renderBlockHelpers(content, variables, usedVariables);

    return {
      success: errors.length === 0,
      content,
      errors,
      warnings,
      usedVariables,
      missingVariables,
    };
  }

  /**
   * 渲染简单变量
   */
  private renderSimpleVariables(
    content: string,
    variables: Record<string, any>,
    usedVariables: string[]
  ): string {
    return content.replace(this.variablePatterns.simple, (match, varName) => {
      if (varName in variables) {
        usedVariables.push(varName);
        const value = variables[varName];

        if (value instanceof Date) {
          return this.formatDate(value);
        }

        return String(value);
      }

      return match;
    });
  }

  /**
   * 渲染块助手（循环、条件）
   */
  private renderBlockHelpers(
    content: string,
    variables: Record<string, any>,
    usedVariables: string[]
  ): string {
    content = content.replace(this.variablePatterns.block, (match, helperName, blockContent) => {
      usedVariables.push(helperName);

      const arrayValue = variables[helperName];

      if (!Array.isArray(arrayValue)) {
        return '';
      }

      let result = '';

      for (const item of arrayValue) {
        let itemContent = blockContent;

        if (typeof item === 'object' && item !== null) {
          itemContent = this.renderSimpleVariables(itemContent, { ...variables, ...item }, usedVariables);
        } else {
          itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
        }

        result += itemContent;
      }

      return result;
    });

    return content;
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * 获取模板变量列表
   */
  public getTemplateVariables(templateId: string): TemplateVariable[] {
    const template = this.templates.get(templateId);
    return template ? template.variables : [];
  }

  /**
   * 验证模板变量
   */
  public validateVariables(
    templateId: string,
    variables: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const template = this.templates.get(templateId);

    if (!template) {
      return { valid: false, errors: [`Template '${templateId}' not found`] };
    }

    const errors: string[] = [];

    for (const varDef of template.variables) {
      const value = variables[varDef.name];

      if (varDef.required && value === undefined) {
        if (varDef.defaultValue === undefined) {
          errors.push(`Missing required variable: ${varDef.name}`);
        }
        continue;
      }

      if (value !== undefined) {
        const actualType = this.getVariableType(value);

        if (actualType !== varDef.type && varDef.type !== 'object') {
          errors.push(
            `Variable '${varDef.name}' type mismatch: expected ${varDef.type}, got ${actualType}`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 获取变量类型
   */
  private getVariableType(value: any): TemplateVariableType {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object' && value !== null) return 'object';

    return 'string';
  }

  /**
   * 更新模板
   */
  public updateTemplate(
    id: string,
    updates: Partial<Omit<TemplateDefinition, 'id' | 'createdAt' | 'updatedAt'>>
  ): boolean {
    const template = this.templates.get(id);

    if (!template) {
      return false;
    }

    const updated: TemplateDefinition = {
      ...template,
      ...updates,
      updatedAt: Date.now(),
      version: template.version + 1,
    };

    this.templates.set(id, updated);

    return true;
  }

  /**
   * 导出模板
   */
  public exportTemplate(id: string): string | null {
    const template = this.templates.get(id);

    if (!template) {
      return null;
    }

    return JSON.stringify(template, null, 2);
  }

  /**
   * 导入模板
   */
  public importTemplate(jsonString: string): boolean {
    try {
      const template = JSON.parse(jsonString) as TemplateDefinition;

      if (!template.id || !template.name || !template.content) {
        return false;
      }

      template.updatedAt = Date.now();

      if (!template.createdAt) {
        template.createdAt = Date.now();
      }

      this.templates.set(template.id, template);

      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * 创建模板服务实例
 */
export function createTemplateService(): TemplateService {
  return new TemplateService();
}

/**
 * 默认模板服务实例
 */
let defaultService: TemplateService | null = null;

/**
 * 获取默认模板服务
 */
export function getDefaultTemplateService(): TemplateService {
  if (!defaultService) {
    defaultService = new TemplateService();
  }
  return defaultService;
}
