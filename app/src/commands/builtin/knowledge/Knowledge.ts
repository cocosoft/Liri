/**
 * Knowledge 命令实现
 * 用户知识库管理
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { knowledgeDocsProvider } from '@modules/docs/FileDocsProvider.js';
import { getDefaultDocumentVersionService } from '@modules/docs/DocumentVersionService.js';
import { getDefaultTemplateService } from '@modules/docs/TemplateService.js';
import { writeFile, unlink, mkdir, readFile } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { existsSync } from 'node:fs';

const knowledgeCommand = {
  /**
   * 执行 knowledge 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const cleanArgs = args.trim();
      const parts = cleanArgs.split(' ');
      const command = parts[0].toLowerCase();
      const rest = parts.slice(1).join(' ').trim();

      if (
        !cleanArgs ||
        command === 'help' ||
        command === '--help' ||
        command === '-h'
      ) {
        return this.showHelp();
      }

      if (command === 'list') {
        return this.listDocs();
      }

      if (command === 'create') {
        if (!rest) {
          return {
            success: false,
            type: 'text',
            message:
              '请提供文档标题：/knowledge create <标题> [--template <模板ID>]',
          };
        }
        return this.createDoc(rest);
      }

      if (command === 'edit') {
        if (!rest) {
          return {
            success: false,
            type: 'text',
            message: '请提供文档标题：/knowledge edit <标题>',
          };
        }
        return this.editDoc(rest);
      }

      if (command === 'delete') {
        if (!rest) {
          return {
            success: false,
            type: 'text',
            message: '请提供文档标题：/knowledge delete <标题>',
          };
        }
        return this.deleteDoc(rest);
      }

      if (command === 'search' || command === 'find') {
        if (!rest) {
          return {
            success: false,
            type: 'text',
            message:
              '请提供搜索关键词：/knowledge search <关键词> [--page <页码>]',
          };
        }

        // 解析 --page 参数
        const pageMatch = rest.match(/(.*) --page (\d+)$/);
        if (pageMatch) {
          const query = pageMatch[1].trim();
          const page = parseInt(pageMatch[2], 10);
          return this.searchDocs(query, { page });
        }

        return this.searchDocs(rest);
      }

      if (command === 'history' || command === 'versions') {
        if (!rest) {
          return {
            success: false,
            type: 'text',
            message: '请提供文档标题：/knowledge history <标题>',
          };
        }
        return this.showHistory(rest);
      }

      if (command === 'rollback') {
        const rollbackParts = rest.split(' ');
        if (rollbackParts.length < 2) {
          return {
            success: false,
            type: 'text',
            message:
              '请提供文档标题和版本号：/knowledge rollback <标题> <版本号>',
          };
        }
        const title = rollbackParts.slice(0, -1).join(' ');
        const version = parseInt(rollbackParts[rollbackParts.length - 1], 10);
        return this.rollbackDoc(title, version);
      }

      if (command === 'templates' || command === 'template') {
        return this.listTemplates(rest);
      }

      if (command === 'lint') {
        return this.lintDocs();
      }

      return this.viewDoc(cleanArgs);
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `操作失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      '📚 用户知识库命令帮助',
      '',
      '用法：',
      '  /knowledge                    - 显示知识库概览',
      '  /knowledge list               - 列出所有知识文档',
      '  /knowledge <标题>             - 查看指定文档',
      '  /knowledge create <标题> [--template <模板ID>]  - 创建新文档',
      '  /knowledge edit <标题>        - 编辑文档',
      '  /knowledge delete <标题>      - 删除文档',
      '  /knowledge search <关键词> [--page <页码>]  - 搜索知识文档（支持模糊搜索、高亮、分页）',
      '  /knowledge history <标题>     - 查看文档版本历史',
      '  /knowledge versions <标题>    - 同上',
      '  /knowledge rollback <标题> <版本号>  - 回滚到指定版本',
      '  /knowledge templates          - 列出可用模板',
      '  /knowledge lint               - 检查知识库健康状态（结构/断链/新鲜度等）',
      '  /knowledge help               - 显示此帮助信息',
      '',
      '别名：',
      '  /kb, /wiki, /note',
      '',
      '示例：',
      '  /knowledge create 我的学习笔记',
      '  /knowledge create API文档 --template api-doc',
      '  /knowledge history 我的学习笔记',
      '  /knowledge rollback 我的学习笔记 2',
      '  /knowledge search TypeScript',
      '  /knowledge search TypeScript --page 2',
      '  /knowledge list',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 列出所有知识文档
   */
  async listDocs(): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();

    if (docs.length === 0) {
      const lines = [
        '📚 用户知识库',
        '',
        '你的知识库目前是空的。',
        '',
        '开始使用：',
        '  /knowledge create <标题>  - 创建你的第一个文档',
        '  /knowledge help           - 查看完整帮助',
      ];
      return { success: true, type: 'text', message: lines.join('\n') };
    }

    const lines = [
      `📚 用户知识库（${docs.length} 个文档）`,
      '',
      ...docs.map((doc, i) => {
        const category = doc.category !== '根目录' ? `[${doc.category}] ` : '';
        return `${i + 1}. ${category}${doc.title}`;
      }),
      '',
      '使用 /knowledge <标题> 查看文档内容。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 查看文档
   */
  async viewDoc(title: string): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const lowerTitle = title.toLowerCase();

    const doc = docs.find(
      (d) =>
        d.title.toLowerCase() === lowerTitle ||
        d.relativePath.toLowerCase() === lowerTitle ||
        d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
    );

    if (!doc) {
      return this.searchDocs(title);
    }

    const lines = [`📄 ${doc.title}`, '', doc.content];
    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 创建文档
   */
  async createDoc(title: string): Promise<CommandResult> {
    let actualTitle = title;
    let templateId: string | undefined;

    const templateMatch = title.match(/(.*) --template (\S+)$/);
    if (templateMatch) {
      actualTitle = templateMatch[1].trim();
      templateId = templateMatch[2];
    }

    const roots = knowledgeDocsProvider.getDocsRoots();
    const root = roots[0];
    const safeTitle = actualTitle.replace(/[<>:"/\\|?*]/g, '_');
    const fileName = `${safeTitle}.md`;
    const filePath = join(root, fileName);

    if (existsSync(filePath)) {
      return {
        success: false,
        type: 'text',
        message: `文档"${actualTitle}"已存在，请使用 /knowledge edit 编辑。`,
      };
    }

    let content: string;
    if (templateId) {
      const templateService = getDefaultTemplateService();
      const variables: Record<string, unknown> = {
        projectName: actualTitle,
        description: '文档描述',
        createdDate: new Date(),
        features: [],
        version: '1.0.0',
        apiName: actualTitle,
        author: 'User',
      };
      const result = templateService.render(templateId, variables);
      if (result.success) {
        content = result.content;
      } else {
        return {
          success: false,
          type: 'text',
          message: `模板渲染失败：${result.errors.join(', ')}\n使用 /knowledge templates 查看可用模板。`,
        };
      }
    } else {
      content = `# ${actualTitle}

> 创建于 ${new Date().toLocaleString()}

在此处编写你的内容...

## 提示

- 使用 Markdown 格式编写
- 可以使用多级标题
- 支持代码块、列表等 Markdown 特性
`;
    }

    await writeFile(filePath, content, 'utf-8');
    knowledgeDocsProvider.clearCache();

    const versionService = getDefaultDocumentVersionService();
    versionService.createVersion(actualTitle, content, {
      description: 'Initial version',
    });

    const lines = [
      `✅ 文档"${actualTitle}"创建成功！`,
      templateId ? `（使用模板：${templateId}）` : '',
      '',
      '接下来你可以：',
      `  /knowledge edit "${actualTitle}"  - 编辑文档内容`,
      '  /knowledge list             - 查看所有文档',
    ].filter(Boolean);

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 编辑文档
   */
  async editDoc(title: string): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const lowerTitle = title.toLowerCase();

    const doc = docs.find(
      (d) =>
        d.title.toLowerCase() === lowerTitle ||
        d.relativePath.toLowerCase() === lowerTitle ||
        d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
    );

    if (!doc) {
      return {
        success: false,
        type: 'text',
        message: `未找到文档"${title}"。请使用 /knowledge list 查看所有文档。`,
      };
    }

    const filePath = join(
      doc.source || knowledgeDocsProvider.getDocsRoots()[0],
      doc.relativePath
    );

    const lines = [
      `✏️ 编辑文档"${doc.title}"`,
      '',
      `文件路径：${filePath}`,
      '',
      '当前内容：',
      '────────────────────────────────────────',
      doc.content,
      '────────────────────────────────────────',
      '',
      '提示：你可以使用 /file-edit 命令或手动编辑此文件。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 删除文档
   */
  async deleteDoc(title: string): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const lowerTitle = title.toLowerCase();

    const doc = docs.find(
      (d) =>
        d.title.toLowerCase() === lowerTitle ||
        d.relativePath.toLowerCase() === lowerTitle ||
        d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
    );

    if (!doc) {
      return {
        success: false,
        type: 'text',
        message: `未找到文档"${title}"。请使用 /knowledge list 查看所有文档。`,
      };
    }

    const filePath = join(
      doc.source || knowledgeDocsProvider.getDocsRoots()[0],
      doc.relativePath
    );
    await unlink(filePath);
    knowledgeDocsProvider.clearCache();

    const lines = [
      `🗑️ 文档"${doc.title}"已删除。`,
      '',
      '提示：使用 /knowledge list 查看剩余文档。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 搜索文档（增强版：混合搜索 + 语义搜索 + 分页）
   */
  async searchDocs(
    query: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<CommandResult> {
    const { page = 1, pageSize = 5 } = options || {};
    const offset = (page - 1) * pageSize;

    const { getKnowledgeRouter } =
      await import('@modules/knowledge/KnowledgeRouter.js');
    const router = await getKnowledgeRouter();
    const allResults = await router.search(query, {
      maxResults: offset + pageSize,
    });

    if (allResults.length === 0) {
      return {
        success: true,
        type: 'text',
        message: `未找到与"${query}"相关的文档。`,
      };
    }

    const totalPages = Math.ceil(allResults.length / pageSize);
    const pageResults = allResults.slice(offset, offset + pageSize);

    const lines = [
      `🔍 找到 ${allResults.length} 个与"${query}"相关的文档（第 ${page}/${totalPages} 页）`,
      '',
      ...pageResults.map((result, i) => {
        const category =
          result.category !== '根目录' ? `[${result.category}] ` : '';
        const scoreLabel =
          result.score >= 0.7 ? '🔥' : result.score >= 0.4 ? '⭐' : '📄';
        return `${(page - 1) * pageSize + i + 1}. ${category}${result.title} (${(result.score * 100).toFixed(0)}分 ${scoreLabel})\n   ${result.snippet.slice(0, 120)}...`;
      }),
    ];

    if (page < totalPages) {
      lines.push(
        '',
        `📄 更多结果请使用：/knowledge search "${query}" --page ${page + 1}`
      );
    }

    lines.push('', '使用 /knowledge <标题> 查看完整内容。');

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 查看文档版本历史
   */
  async showHistory(title: string): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const lowerTitle = title.toLowerCase();

    const doc = docs.find(
      (d) =>
        d.title.toLowerCase() === lowerTitle ||
        d.relativePath.toLowerCase() === lowerTitle ||
        d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
    );

    if (!doc) {
      return {
        success: false,
        type: 'text',
        message: `未找到文档"${title}"。请使用 /knowledge list 查看所有文档。`,
      };
    }

    const versionService = getDefaultDocumentVersionService();
    const documentId = versionService['generateDocumentId'](doc.title);
    const history = versionService.getVersionHistory(documentId);

    if (history.totalVersions === 0) {
      return {
        success: true,
        type: 'text',
        message: `文档"${doc.title}"暂无版本历史记录。`,
      };
    }

    const lines = [
      `📜 文档"${doc.title}"的版本历史（${history.totalVersions} 个版本）`,
      '',
      ...history.versions.map((version) => {
        const date = new Date(version.createdAt).toLocaleString();
        return `${version.version}. ${date}${version.description ? ` - ${version.description}` : ''}`;
      }),
      '',
      '使用 /knowledge rollback <标题> <版本号> 回滚到指定版本。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 回滚文档到指定版本
   */
  async rollbackDoc(title: string, version: number): Promise<CommandResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const lowerTitle = title.toLowerCase();

    const doc = docs.find(
      (d) =>
        d.title.toLowerCase() === lowerTitle ||
        d.relativePath.toLowerCase() === lowerTitle ||
        d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
    );

    if (!doc) {
      return {
        success: false,
        type: 'text',
        message: `未找到文档"${title}"。请使用 /knowledge list 查看所有文档。`,
      };
    }

    const versionService = getDefaultDocumentVersionService();
    const documentId = versionService['generateDocumentId'](doc.title);
    const versionContent = versionService.getVersion(documentId, version);

    if (!versionContent) {
      return {
        success: false,
        type: 'text',
        message: `未找到版本 ${version} 的内容。请使用 /knowledge history "${title}" 查看可用版本。`,
      };
    }

    const filePath = join(
      doc.source || knowledgeDocsProvider.getDocsRoots()[0],
      doc.relativePath
    );
    await writeFile(filePath, versionContent.content, 'utf-8');
    knowledgeDocsProvider.clearCache();

    versionService.createVersion(doc.title, versionContent.content, {
      description: `Rollback to version ${version}`,
    });

    const lines = [
      `✅ 文档"${doc.title}"已回滚到版本 ${version}！`,
      '',
      '接下来你可以：',
      `  /knowledge view "${doc.title}"  - 查看当前内容`,
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 知识库健康检查
   */
  async lintDocs(): Promise<CommandResult> {
    const { runKnowledgeLint, formatLintResult } =
      await import('@modules/knowledge/KnowledgeLinter.js');

    const result = await runKnowledgeLint();
    const report = formatLintResult(result);

    return { success: true, type: 'text', message: report };
  },

  /**
   * 列出可用模板
   */
  listTemplates(filter: string): CommandResult {
    const templateService = getDefaultTemplateService();
    let templates = templateService.getAllTemplates();

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(lowerFilter) ||
          t.id.toLowerCase().includes(lowerFilter) ||
          t.description.toLowerCase().includes(lowerFilter) ||
          t.tags.some((tag) => tag.toLowerCase().includes(lowerFilter))
      );
    }

    const lines = [
      `📝 可用模板（${templates.length} 个）`,
      '',
      ...templates.map((template) => {
        return [
          `${template.id} - ${template.name}`,
          `  ${template.description}`,
          `  标签：${template.tags.join(', ')}`,
          '',
        ].join('\n');
      }),
      '使用 /knowledge create <标题> --template <模板ID> 创建文档。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },
};

export default knowledgeCommand;
