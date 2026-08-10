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
 * 查询反哺管道 — QueryFeedbackPipeline
 *
 * 从查询日志中提取高频话题，自动反哺知识库：
 *   1. 读取 query_logs 表中最近的查询记录
 *   2. 分析高频主题 / 知识点
 *   3. 调用 LLM 生成 wiki 页面
 *   4. 写入 knowledge/ 目录并更新索引
 *
 * 依赖：QueryLogStore + LLM + IndexManager
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { getQueryLogStore } from '@modules/query/QueryLogStore';
import { resolveKnowledgeDir, resolveDomainDir } from '@modules/core';
import { IndexManager } from './IndexManager';
import { KnowledgeGraph } from './graph/KnowledgeGraph';

const logger = getLogger('knowledge:queryFeedbackPipeline');

/** 反哺配置 */
export interface FeedbackConfig {
  /** 分析窗口（毫秒），默认 7 天 */
  windowMs: number;
  /** 最小查询次数才算热点，默认 3 */
  minQueryCount: number;
  /** 一次最多生成的页面数 */
  maxPages: number;
}

/** 反哺结果 */
export interface FeedbackResult {
  /** 发现的主题数 */
  topicsFound: number;
  /** 新建的页面数 */
  pagesCreated: number;
  /** 更新的页面数 */
  pagesUpdated: number;
  /** 错误数 */
  errors: number;
  /** 详情 */
  detail: string[];
}

const DEFAULT_CONFIG: FeedbackConfig = {
  windowMs: 7 * 24 * 60 * 60 * 1000,
  minQueryCount: 3,
  maxPages: 5,
};

/**
 * 查询反哺管道
 *
 * Domain-First 模式下，通过 domainName 指定域：
 *   生成的新页面写入 domains/{domain}/，索引管理器对应域
 */
export class QueryFeedbackPipeline {
  private aiService: AIService;
  private config: FeedbackConfig;
  private knowledgeRoot: string;
  private indexManager: IndexManager;
  private domainName?: string;

  /**
   * @param aiService LLM 服务
   * @param config 配置
   * @param knowledgeRoot 知识库根目录
   * @param domainName 域名称（可选）。指定后反哺写入域目录
   */
  constructor(
    aiService: AIService,
    config?: Partial<FeedbackConfig>,
    knowledgeRoot?: string,
    domainName?: string
  ) {
    this.aiService = aiService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.domainName = domainName;

    if (knowledgeRoot) {
      this.knowledgeRoot = knowledgeRoot;
    } else if (domainName) {
      this.knowledgeRoot = resolveDomainDir(domainName);
    } else {
      this.knowledgeRoot = resolveKnowledgeDir();
    }

    this.indexManager = new IndexManager(this.knowledgeRoot);
  }

  /**
   * 实时反哺：将单个好问答对保存为 wiki 页面
   * 在用户获得满意回答后立即调用，而非等待批处理
   *
   * @param query 用户问题
   * @param answer AI 回答内容
   * @param kind 可选实体类型，默认"知识条目"
   * @returns 创建的页面 ID，失败返回 undefined
   */
  async onGoodAnswer(
    query: string,
    answer: string,
    kind: string = '知识条目'
  ): Promise<string | undefined> {
    const pageId = this.toPageId(query.slice(0, 40));
    const filename = pageId + '.md';
    const targetPath = join(this.knowledgeRoot, filename);
    const exists = existsSync(targetPath);

    try {
      // 用 LLM 将问答编译为结构化 wiki 页面
      const content = await this.generateAnswerWikiContent(
        query,
        answer,
        pageId,
        kind,
        exists
      );

      await writeFile(targetPath, content, 'utf-8');

      // 更新索引和日志
      await this.indexManager.updateIndexMd();
      await this.indexManager.appendLog({
        timestamp: Date.now(),
        action: exists ? 'update' : 'compile',
        source: 'query-feedback-real-time',
        pages: [filename],
        detail: `实时反哺: "${query.slice(0, 30)}..."`,
      });

      // 在知识图谱中注册实体
      try {
        const graph = new KnowledgeGraph();
        await graph.init();
        await graph.addEdge({
          from: `knowledge:entity:${pageId}`,
          to: `knowledge:topic:${this.toPageId(query.slice(0, 20))}`,
          type: 'relates_to',
          direction: 'directed',
          domain: this.domainName || '',
        });
      } catch (_err) {
        // 图谱注册失败是非致命的
      }

      logger.info('实时反哺完成', {
        filename,
        isNew: !exists,
        query: query.slice(0, 30),
      });
      return pageId;
    } catch (e) {
      await handleError(e, {
        module: 'knowledge:feedback',
        action: 'on_good_answer',
        context: { query: query.slice(0, 30) },
      });
      return undefined;
    }
  }

  /**
   * 用 LLM 将问答对编译为 wiki 页面内容
   */
  private async generateAnswerWikiContent(
    query: string,
    answer: string,
    pageId: string,
    kind: string,
    isUpdate: boolean
  ): Promise<string> {
    const systemPrompt = `你是一个知识库编辑助手。将以下问答对编译为结构化的 Markdown wiki 页面。

${isUpdate ? '这是对已有页面的补充更新，请保留原有框架并叠加新信息。' : '创建新页面。'}

输出格式要求：
1. 以 YAML frontmatter 开头，包含: id, title, kind, tags, summary
2. 正文用 Markdown 格式
3. 提取问答中的关键知识点组织为结构化内容
4. 对相关概念添加 [[]] Wiki 链接
5. 末尾添加 "## 相关概念" 小节

示例 frontmatter:
---
id: ${pageId}
title: ${query.slice(0, 30)}
kind: ${kind}
tags: []
summary: 简要摘要，不超过 100 字
---`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: `问题: ${query}\n\n回答: ${answer}`,
        timestamp: Date.now(),
      },
    ];

    const response = await this.aiService.generate(messages);
    return response.content.trim();
  }

  /**
   * 执行反哺：分析日志 → 生成知识页面 → 更新索引
   */
  async run(): Promise<FeedbackResult> {
    const result: FeedbackResult = {
      topicsFound: 0,
      pagesCreated: 0,
      pagesUpdated: 0,
      errors: 0,
      detail: [],
    };

    try {
      // 1. 获取热点话题
      const topics = await this.extractHotTopics();
      result.topicsFound = topics.length;
      result.detail.push(`发现 ${topics.length} 个热点话题`);

      if (topics.length === 0) return result;

      // 2. 检查哪些话题已有的 wiki 页面
      const existingPages = await this.indexManager.listPages();
      const existingIds = new Set(
        existingPages.map((p) => p.replace(/\.md$/, ''))
      );

      // 3. 对每个热点话题调用 LLM 生成知识页面
      let pageCount = 0;
      for (const topic of topics) {
        if (pageCount >= this.config.maxPages) {
          result.detail.push(
            `达到最大页面数限制 (${this.config.maxPages})，停止`
          );
          break;
        }

        const pageId = this.toPageId(topic.name);
        const action = existingIds.has(pageId) ? 'update' : 'create';

        try {
          const content = await this.generateWikiContent(topic, action);
          const filename = pageId + '.md';
          const targetPath = join(this.knowledgeRoot, filename);

          await writeFile(targetPath, content, 'utf-8');

          if (action === 'create') {
            result.pagesCreated++;
          } else {
            result.pagesUpdated++;
          }

          pageCount++;
          result.detail.push(
            `${action === 'create' ? '创建' : '更新'} 页面: ${filename}`
          );
        } catch (e) {
          result.errors++;
          result.detail.push(
            `处理话题 "${topic.name}" 失败: ${(e as Error).message}`
          );
          logger.warn('话题处理失败', { topic: topic.name, error: e });
        }
      }

      // 4. 在知识图谱中注册实体
      if (result.pagesCreated + result.pagesUpdated > 0) {
        try {
          const graph = new KnowledgeGraph();
          await graph.init();
          for (const topic of topics) {
            const pageId = this.toPageId(topic.name);
            await graph.addEdge({
              from: `knowledge:topic:${pageId}`,
              to: `knowledge:batch:${Date.now()}`,
              type: 'relates_to',
              direction: 'directed',
              domain: this.domainName || '',
            });
          }
        } catch (_err) {
          // 图谱注册失败是非致命的
        }
      }

      // 5. 更新索引和日志
      await this.indexManager.updateIndexMd();
      await this.indexManager.appendLog({
        timestamp: Date.now(),
        action: 'compile',
        source: 'query-feedback-pipeline',
        pages: [],
        detail: `反哺 ${result.pagesCreated} 个新页面, 更新 ${result.pagesUpdated} 个页面`,
      });
    } catch (e) {
      result.errors++;
      result.detail.push(`管道执行失败: ${(e as Error).message}`);
      await handleError(e, {
        module: 'knowledge:feedback',
        action: 'execute_pipeline',
      });
    }

    return result;
  }

  /**
   * 分析查询日志提取热点话题
   */
  private async extractHotTopics(): Promise<
    Array<{ name: string; count: number }>
  > {
    const store = getQueryLogStore();
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    // 获取最近的查询记录
    const logs = await store.query({
      startTime: cutoff,
      endTime: now,
      limit: 500,
    });

    // 按 sessionId 聚合查询，提取 query 类型记录
    const queryTexts: string[] = [];

    for (const log of logs) {
      // 从 metadata 中提取查询文本
      if (log.type === 'query' && log.metadata) {
        const meta = log.metadata as Record<string, unknown>;
        if (typeof meta.query === 'string' && meta.query.trim()) {
          queryTexts.push(meta.query.trim());
        }
      }
    }

    if (queryTexts.length < this.config.minQueryCount) {
      return [];
    }

    // 使用 LLM 从查询日志中提取热点话题
    return await this.analyzeQueriesWithLLM(queryTexts);
  }

  /**
   * 用 LLM 分析查询文本提取话题
   */
  private async analyzeQueriesWithLLM(
    queries: string[]
  ): Promise<Array<{ name: string; count: number }>> {
    const sample = queries.slice(0, 100).join('\n');

    const systemPrompt = `你是一个知识库分析助手。分析以下用户查询列表，提取出现频率最高的 3-5 个知识点/话题。

要求：
1. 只提取可以成为独立知识条目的概念（排除临时性问题、问候、闲聊）
2. 每个话题输出一行: 话题名|出现次数
3. 按出现次数降序排列
4. 话题名用中文，不超过 20 字
5. 只输出纯文本列表，不要多余文字`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: sample,
        timestamp: Date.now(),
      },
    ];

    const response = await this.aiService.generate(messages);
    const topics: Array<{ name: string; count: number }> = [];

    for (const line of response.content.trim().split('\n')) {
      const match = line.match(/^(.+?)\|(\d+)$/);
      if (match) {
        const name = match[1].trim();
        const count = parseInt(match[2], 10);
        if (name && count >= this.config.minQueryCount) {
          topics.push({ name, count });
        }
      }
    }

    // 按出现次数降序
    topics.sort((a, b) => b.count - a.count);

    return topics.slice(0, this.config.maxPages);
  }

  /**
   * 用 LLM 生成话题对应的 wiki 页面内容
   */
  private async generateWikiContent(
    topic: { name: string; count: number },
    action: 'create' | 'update'
  ): Promise<string> {
    const systemPrompt = `你是一个知识库编辑助手。${action === 'create' ? '创建' : '更新'}一个知识条目。

话题: ${topic.name}
相关查询次数: ${topic.count}

输出格式要求：
1. 以 YAML frontmatter 开头，包含: id, title, kind, tags
2. 正文用 Markdown 格式
3. 对相关概念添加 [[]] Wiki 链接
4. 末尾添加 "## 相关概念" 小节

示例 frontmatter:
---
id: ${this.toPageId(topic.name)}
title: ${topic.name}
kind: 知识条目
tags: []
---`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: `请${action === 'create' ? '创建' : '更新'} "${topic.name}" 的知识条目。`,
        timestamp: Date.now(),
      },
    ];

    const response = await this.aiService.generate(messages);
    return response.content.trim();
  }

  /**
   * 话题名转页面 ID
   */
  private toPageId(name: string): string {
    return (
      name
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || `topic-${Date.now()}`
    );
  }
}
