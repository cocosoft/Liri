/**
 * 模板市场 —— 将模板作为 MCP Resource 注册
 * 复用现有 MCPMarketplace 基础设施
 */

import { getLogger } from '@modules/monitoring';
import {
  TemplateEngine,
  BUILTIN_TEMPLATES,
  type TemplateMeta,
} from './TemplateEngine';

const logger = getLogger('doc:template');

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
   * G-12：registerAsResource 未真正接入 MCPMarketplace，改为告警而非"已注册"假象
   */
  registerBuiltinTemplates(): void {
    for (const tmpl of BUILTIN_TEMPLATES) {
      this.registerAsResource(tmpl);
    }
    logger.warn('内置模板未真正注册到市场：MCPMarketplace 尚未接入（G-12）', {
      count: BUILTIN_TEMPLATES.length,
    });
  }

  /**
   * 将单个模板注册为 MCP Resource
   * G-12：未实现——明确告警
   */
  private registerAsResource(meta: TemplateMeta): void {
    logger.warn('模板资源未注册到 MCPMarketplace（G-12）', {
      resource: `office:template:${meta.name}`,
    });
  }

  /**
   * 搜索模板
   */
  static async search(query: string): Promise<TemplateMeta[]> {
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
   * G-12：未实现——明确告警而非静默成功
   */
  static async install(templateName: string): Promise<void> {
    logger.warn('模板安装未实现：MCPMarketplace 尚未接入（G-12）', {
      template: templateName,
    });
  }

  /**
   * 获取已安装模板数
   */
  get installedCount(): number {
    return this.templateEngine.templateCount;
  }
}
