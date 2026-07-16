/**
 * 模板市场 —— 将模板作为 MCP Resource 注册
 * 复用现有 MCPMarketplace 基础设施
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  TemplateEngine,
  BUILTIN_TEMPLATES,
  type TemplateMeta,
} from './TemplateEngine';

const logger = new Logger({
  module: 'doc:template',
  level: LogLevel.INFO,
});

/**
 * 模板市场
 * 将模板注册为 MCP Resource 到 MCPMarketplace
 * 支持：可发现、可安装、可更新、可预览、多格式
 */
export class TemplateMarketplace {
  private templateEngine: TemplateEngine;

  constructor(templateEngine: TemplateEngine) {
    this.templateEngine = templateEngine;
  }

  /**
   * 将所有内置模板注册到 MCPMarketplace
   */
  registerBuiltinTemplates(): void {
    for (const tmpl of BUILTIN_TEMPLATES) {
      this.registerAsResource(tmpl);
    }
    logger.info('内置模板已注册到市场', { count: BUILTIN_TEMPLATES.length });
  }

  /**
   * 将单个模板注册为 MCP Resource
   */
  private registerAsResource(meta: TemplateMeta): void {
    const resourceName = `office:template:${meta.name}`;

    // TODO: 调用 MCPMarketplace.registerResource()
    // MCPMarketplace.registerResource(resourceName, {
    //   displayName: meta.displayName,
    //   description: meta.description,
    //   version: meta.version,
    //   tags: meta.tags,
    //   previewImage: meta.previewImage,
    //   outputFormats: [meta.outputFormat],
    //   author: meta.author,
    //   license: 'MIT',
    // });

    logger.debug('模板资源已就绪', { resource: resourceName });
  }

  /**
   * 搜索模板
   */
  static async search(query: string): Promise<TemplateMeta[]> {
    // TODO: 调用 MCPMarketplace.listResources({ type: 'office:template', query })
    logger.info('模板搜索', { query });
    return BUILTIN_TEMPLATES.filter(
      (t) =>
        t.name.includes(query) ||
        t.displayName.includes(query) ||
        t.tags.some((tag) => tag.includes(query))
    );
  }

  /**
   * 安装模板
   */
  static async install(templateName: string): Promise<void> {
    // TODO: 调用 MCPMarketplace.install(`office:template:${templateName}`)
    logger.info('模板安装', { template: templateName });
  }

  /**
   * 获取已安装模板数
   */
  get installedCount(): number {
    return this.templateEngine.templateCount;
  }
}
