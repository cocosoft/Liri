// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * KnowledgeSearchTool — AI 会话中搜索知识库文档
 *
 * 使用 KnowledgeRouter 双通道（关键词+语义）检索，支持自动写入新知识。
 * 迁移自 memory/tools/KnowledgeSearchTool.ts。
 */

import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import {
  type IKnowledgeSearch,
  type KnowledgeRoute,
} from '../../docs/knowledge-types';
import type { AIService } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { resolveKnowledgeDir } from '@modules/core';
import { KnowledgeBaseWriter } from '../KnowledgeBaseWriter';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('knowledge:tools:knowledgeSearchTool');

export class KnowledgeSearchTool implements Tool {
  public name: string = 'knowledge_search';
  public description: string =
    'Search and retrieve documents from the knowledge base. Use this to find documentation, guides, API references, and wiki articles.';
  public params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description: 'Search query for knowledge base documents',
      required: true,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
      default: 5,
    },
    {
      name: 'minScore',
      type: 'number',
      description:
        'Minimum relevance score (0-1), lower values return more results',
      required: false,
      default: 0.1,
    },
    {
      name: 'offset',
      type: 'number',
      description:
        'Pagination offset — skip the first N results. Use with limit for paginated browsing of search results.',
      required: false,
      default: 0,
    },
    {
      name: 'domain',
      type: 'string',
      description:
        'Limit search to a specific knowledge domain. Leave empty to search all domains.',
      required: false,
    },
    {
      name: 'autoWrite',
      type: 'boolean',
      description:
        'Auto-write new knowledge when search results are insufficient',
      required: false,
      default: false,
    },
    {
      name: 'recordType',
      type: 'string',
      description:
        'K2 记录检索：填写 records.yaml 中声明的记录类型（如 contract）时，' +
        '改为按主键/字段检索 knowledge_records 结构化记录（支持合同编号精确定位）。',
      required: false,
    },
    {
      name: 'ruleKind',
      type: 'string',
      description:
        'K3 规则检索：填写规则类别（policy/guideline/tip）时，' +
        '改为按规则陈述/触发场景检索 kg_rules 规则（结果携带强度 mandatory/should/may）。',
      required: false,
    },
  ];
  public aliases: string[] = ['knowledge', 'docs_search', 'find_doc'];
  public searchTips: string[] = [
    'knowledge',
    'docs',
    'documentation',
    'guide',
    'api',
    'reference',
    'wiki',
  ];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => true;

  private router: IKnowledgeSearch;
  private aiService?: AIService;
  private writer?: KnowledgeBaseWriter;
  /** K4 证据回链：编译页 → raw 源映射缓存（会话内避免重复全目录扫描） */
  private evidenceIndex = new Map<string, string>();

  constructor(router: IKnowledgeSearch, aiService?: AIService) {
    this.router = router;
    this.aiService = aiService;
    if (aiService) {
      this.writer = new KnowledgeBaseWriter();
    }
  }

  /**
   * K4 证据回链：把 record/rule 的原文摘句装饰为 "doc.pdf#p.12" 引用
   * （页面 → raw 反查 + sidecar quote→page 定位，纯后端、无 LLM 调用）
   */
  private async decorateCitation(
    sourceFile: string,
    quote: string | undefined
  ): Promise<{ cite: string; page?: number } | null> {
    if (!quote || !sourceFile) return null;
    const { findRawForPage, loadSidecar, locateQuote, buildDocCitation } =
      await import('../evidence/EvidenceLocator');
    try {
      const rawDir = `${resolveKnowledgeDir()}/raw`;
      const raw = await findRawForPage(sourceFile, rawDir, this.evidenceIndex);
      if (!raw) return null;
      const sidecar = await loadSidecar(raw);
      const loc = locateQuote(sidecar, quote);
      if (!loc) return null;
      return { cite: buildDocCitation(raw, loc), page: loc.page };
    } catch {
      // @ignore-catch 定位装饰失败仅去掉引用，不影响检索结果
      return null;
    }
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult<KnowledgeRoute[]>> {
    const startTime = Date.now();
    const query = input.query as string;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'query is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const limit = (input.limit as number) ?? 5;
      const minScore = (input.minScore as number) ?? 0.1;
      const offset = (input.offset as number) ?? 0;
      const domain = (input.domain as string) || undefined;
      const autoWrite = (input.autoWrite as boolean) ?? false;
      const recordType = (input.recordType as string) || undefined;

      // K2 记录检索模式：按记录类型查 knowledge_records（主键/字段精确匹配）
      if (recordType) {
        return this.searchRecords(query.trim(), recordType, limit, domain);
      }

      // K3 规则检索模式：按规则类别查 kg_rules（陈述/触发场景 + 强度标签）
      const ruleKind = (input.ruleKind as string) || undefined;
      if (ruleKind) {
        return this.searchRules(query.trim(), ruleKind, limit, domain);
      }

      const results = await this.router.search(query.trim(), {
        maxResults: limit,
        minScore,
        offset,
        domain,
      });

      const metadata: Record<string, unknown> = {
        count: results.length,
        query: query.trim(),
      };

      // Auto-write: 搜索结果不足时自动生成新知识
      if (autoWrite && results.length < 3 && this.aiService && this.writer) {
        try {
          const writeResult = await this.autoWriteKnowledge(query.trim());
          metadata.autoWritten = writeResult.success;
          metadata.autoWriteAction = writeResult.action;
          metadata.autoWritePath = writeResult.filePath;
        } catch (writeError) {
          logger.warning('自动写入知识失败', {
            query,
            error:
              writeError instanceof Error
                ? writeError.message
                : String(writeError),
          });
          metadata.autoWriteError = String(writeError);
        }
      }

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata,
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * K2 记录检索：查 knowledge_records 结构化记录（主键/字段级）
   */
  private async searchRecords(
    query: string,
    recordType: string,
    limit: number,
    domain?: string
  ): Promise<ToolResult<KnowledgeRoute[]>> {
    const startTime = Date.now();
    const executionId = `knowledge_search_${Date.now()}`;
    const { RecordStore } = await import('../record/RecordStore');
    const store = new RecordStore();
    try {
      const rows = await store.search(query, {
        type: recordType,
        domain,
        limit,
      });
      const results: KnowledgeRoute[] = [];
      for (const r of rows) {
        const quote = Object.values(r.evidence).find(
          (v): v is string => typeof v === 'string' && v.length > 0
        );
        const deco = await this.decorateCitation(r.sourceFile, quote);
        results.push({
          docPath: r.sourceFile,
          title: `${r.type}:${r.key}`,
          score: 1,
          category: 'record',
          snippet:
            (deco ? `(${deco.cite}) ` : '') +
            JSON.stringify({ fields: r.data, evidence: r.evidence }),
          matchType: 'keyword',
          isKnowledgeDoc: false,
        });
      }
      logger.info('记录检索完成', {
        query,
        recordType,
        count: results.length,
      });
      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata: {
          count: results.length,
          query,
          recordType,
          mode: 'record',
        },
        executionId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } finally {
      await store.close().catch(() => undefined);
    }
  }

  /**
   * K3 规则检索：查 kg_rules（陈述/触发场景 + 强度标签）
   */
  private async searchRules(
    query: string,
    ruleKind: string,
    limit: number,
    domain?: string
  ): Promise<ToolResult<KnowledgeRoute[]>> {
    const startTime = Date.now();
    const executionId = `knowledge_search_${Date.now()}`;
    const { RuleStore } = await import('../rule/RuleStore');
    const store = new RuleStore();
    try {
      const rows = await store.search(query, {
        kind: ruleKind as 'policy' | 'guideline' | 'tip',
        domain,
        limit,
      });
      const results: KnowledgeRoute[] = [];
      for (const r of rows) {
        const quote = r.evidence.statement ?? '';
        const deco = await this.decorateCitation(
          r.sourceFile,
          quote || undefined
        );
        results.push({
          docPath: r.sourceFile,
          title: `${r.kind}:${r.statement.slice(0, 40)}`,
          score: 1,
          category: 'rule',
          snippet: `[${r.constraintStrength}]${deco ? ` (${deco.cite})` : ''} ${r.statement}${quote ? `（原文：${quote.slice(0, 80)}）` : ''}`,
          matchType: 'keyword',
          isKnowledgeDoc: false,
        });
      }
      logger.info('规则检索完成', {
        query,
        ruleKind,
        count: results.length,
      });
      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata: {
          count: results.length,
          query,
          ruleKind,
          mode: 'rule',
        },
        executionId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } finally {
      await store.close().catch(() => undefined);
    }
  }

  /**
   * 当搜索结果不足时，使用 LLM 生成新知识并写入知识库
   */
  private async autoWriteKnowledge(query: string) {
    if (!this.aiService || !this.writer) {
      return { success: false, action: 'skipped' as const, filePath: '' };
    }

    const response = await this.aiService.generate([
      {
        role: AIMessageRole.SYSTEM,
        content:
          '你是一个知识库自动编写助手。根据用户查询，生成一篇结构化的知识文档。' +
          '请以 Markdown 格式输出，包含概述和详细内容。不要包含 frontmatter。',
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: `请为 "${query}" 撰写知识库文档`,
        timestamp: Date.now(),
      },
    ]);

    const content = response.content.trim();

    const writeResult = await this.writer.writeEntry({
      title: query,
      content,
      category: '知识库',
      tags: [query],
      source: 'auto-write',
    });

    logger.info('自动写入知识完成', {
      query,
      action: writeResult.action,
      path: writeResult.filePath,
    });

    return writeResult;
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive(),
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
    };
  }
}

export function createKnowledgeSearchTool(router: IKnowledgeSearch): Tool {
  return new KnowledgeSearchTool(router);
}
