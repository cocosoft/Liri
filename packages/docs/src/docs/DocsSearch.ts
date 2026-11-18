/**
 * 文档搜索管理器
 * 提供文档内容的搜索和索引功能
 */

import { SearchResult } from './types.js';
import { ExampleCommands } from './ExampleCommands.js';
import { ReleaseNotes } from './ReleaseNotes.js';
import { ErrorMessages } from './ErrorMessages.js';
import { ContextHelp } from './ContextHelp.js';

const COMMON_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'and',
  'but',
  'or',
  'nor',
  'not',
  'so',
  'yet',
  'both',
  'either',
  'neither',
  'each',
  'every',
  'all',
  'any',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'only',
  'own',
  'same',
  'than',
  'too',
  'very',
  'just',
  'because',
  'about',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !COMMON_WORDS.has(t));
}

function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return tokens;
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(' '));
  }
  return result;
}

export interface SearchQueryRecord {
  query: string;
  count: number;
  lastSearchedAt: number;
  resultCount: number;
}

export interface SearchAnalyticsData {
  totalSearches: number;
  uniqueQueries: number;
  topQueries: SearchQueryRecord[];
  recentQueries: SearchQueryRecord[];
}

/**
 * 文档搜索管理器类
 */
export class DocsSearch {
  private exampleCommands: ExampleCommands;
  private releaseNotes: ReleaseNotes;
  private errorMessages: ErrorMessages;
  private contextHelp: ContextHelp;
  private searchCount: number = 0;
  private queryRecords: Map<string, SearchQueryRecord> = new Map();

  constructor(
    exampleCommands?: ExampleCommands,
    releaseNotes?: ReleaseNotes,
    errorMessages?: ErrorMessages,
    contextHelp?: ContextHelp
  ) {
    this.exampleCommands = exampleCommands || new ExampleCommands();
    this.releaseNotes = releaseNotes || new ReleaseNotes();
    this.errorMessages = errorMessages || new ErrorMessages();
    this.contextHelp = contextHelp || new ContextHelp();
  }

  search(query: string): SearchResult[] {
    this.searchCount++;
    this.recordQuery(query);
    const results: SearchResult[] = [];

    results.push(...this.searchExamples(query));
    results.push(...this.searchReleaseNotes(query));
    results.push(...this.searchErrorMessages(query));
    results.push(...this.searchContextHelp(query));

    const sorted = results.sort((a, b) => b.relevance - a.relevance);
    this.updateQueryResultCount(query, sorted.length);
    return sorted;
  }

  private recordQuery(query: string): void {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;
    const existing = this.queryRecords.get(trimmed);
    if (existing) {
      existing.count++;
      existing.lastSearchedAt = Date.now();
    } else {
      this.queryRecords.set(trimmed, {
        query: trimmed,
        count: 1,
        lastSearchedAt: Date.now(),
        resultCount: 0,
      });
    }
  }

  private updateQueryResultCount(query: string, count: number): void {
    const trimmed = query.trim().toLowerCase();
    const record = this.queryRecords.get(trimmed);
    if (record) {
      record.resultCount = count;
    }
  }

  getSearchAnalytics(): SearchAnalyticsData {
    const records = Array.from(this.queryRecords.values());
    const topQueries = [...records]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const recentQueries = [...records]
      .sort((a, b) => b.lastSearchedAt - a.lastSearchedAt)
      .slice(0, 10);
    return {
      totalSearches: this.searchCount,
      uniqueQueries: this.queryRecords.size,
      topQueries,
      recentQueries,
    };
  }

  resetAnalytics(): void {
    this.queryRecords.clear();
    this.searchCount = 0;
  }

  /**
   * 搜索示例命令
   * @param query 搜索关键词
   * @returns 搜索结果数组
   */
  private searchExamples(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const examples = this.exampleCommands.searchExamples(query);

    for (const example of examples) {
      const relevance = this.calculateRelevance(query, [
        example.command,
        example.description,
        ...example.tags,
      ]);

      results.push({
        id: `example-${example.id}`,
        type: 'example',
        title: example.description,
        content: example.command,
        relevance,
        matchedKeywords: this.extractMatchedKeywords(query, [
          example.command,
          example.description,
          ...example.tags,
        ]),
      });
    }

    return results;
  }

  /**
   * 搜索释放说明
   * @param query 搜索关键词
   * @returns 搜索结果数组
   */
  private searchReleaseNotes(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const notes = this.releaseNotes.getAllReleaseNotes();

    for (const note of notes) {
      const content = note.notes.join(' ');
      const relevance = this.calculateRelevance(query, [note.version, content]);

      if (relevance > 0) {
        results.push({
          id: `release-${note.version}`,
          type: 'release_note',
          title: `版本 ${note.version}`,
          content: content,
          relevance,
          matchedKeywords: this.extractMatchedKeywords(query, [
            note.version,
            content,
          ]),
        });
      }
    }

    return results;
  }

  /**
   * 搜索错误消息
   * @param query 搜索关键词
   * @returns 搜索结果数组
   */
  private searchErrorMessages(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const errors = this.errorMessages.searchErrors(query);

    for (const error of errors) {
      const relevance = this.calculateRelevance(query, [
        error.code,
        error.message,
        error.description,
      ]);

      results.push({
        id: `error-${error.code}`,
        type: 'error_message',
        title: `${error.code}: ${error.message}`,
        content: error.description,
        relevance,
        matchedKeywords: this.extractMatchedKeywords(query, [
          error.code,
          error.message,
          error.description,
        ]),
      });
    }

    return results;
  }

  /**
   * 搜索上下文帮助
   * @param query 搜索关键词
   * @returns 搜索结果数组
   */
  private searchContextHelp(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const helpEntries = this.contextHelp.getAllContextHelp();

    for (const entry of helpEntries) {
      const relevance = this.calculateRelevance(query, [
        entry.description,
        entry.helpContent,
        ...entry.relatedCommands,
        ...entry.relatedTools,
      ]);

      if (relevance > 0) {
        results.push({
          id: `help-${entry.contextId}`,
          type: 'help',
          title: entry.description,
          content: entry.helpContent,
          relevance,
          matchedKeywords: this.extractMatchedKeywords(query, [
            entry.description,
            entry.helpContent,
          ]),
        });
      }
    }

    return results;
  }

  private calculateRelevance(query: string, texts: string[]): number {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return 0;

    const textTokensList = texts.map((t) => tokenize(t));
    const allTextTokens = textTokensList.flat();

    const totalDocs = textTokensList.filter((t) => t.length > 0).length;
    if (totalDocs === 0) return 0;

    const idfScores = new Map<string, number>();
    for (const qt of queryTokens) {
      const docFreq = textTokensList.filter((tokens) =>
        tokens.includes(qt)
      ).length;
      idfScores.set(
        qt,
        Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5))
      );
    }

    let maxScore = 0;
    let bestScore = 0;

    for (const tokens of textTokensList) {
      if (tokens.length === 0) continue;

      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      const queryBigrams = ngrams(queryTokens, 2);
      const textBigrams = ngrams(tokens, 2);
      let bigramMatches = 0;
      for (const qb of queryBigrams) {
        for (const tb of textBigrams) {
          if (qb === tb || tb.includes(qb) || qb.includes(tb)) {
            bigramMatches++;
          }
        }
      }
      const bigramBonus =
        tokens.length > 0 ? Math.min(bigramMatches / tokens.length, 0.3) : 0;

      let textScore = 0;
      let possibleScore = 0;
      for (const qt of queryTokens) {
        const idf = idfScores.get(qt) || 1;
        const maxTf = Math.max(...Array.from(tfMap.values()), 1);
        const tf = tfMap.get(qt) || 0;
        const tfNorm = 0.5 + 0.5 * (tf / maxTf);
        possibleScore += idf;

        if (tf > 0) {
          textScore += idf * tfNorm;
        } else {
          for (const [token] of tfMap) {
            if (token.startsWith(qt) || qt.startsWith(token)) {
              textScore += idf * 0.3;
              break;
            }
          }
        }
      }

      textScore = textScore / Math.max(possibleScore, 1) + bigramBonus;

      if (textScore > bestScore) {
        bestScore = textScore;
      }
      maxScore = Math.max(maxScore, possibleScore);
    }

    return Math.min(bestScore, 1);
  }

  private extractMatchedKeywords(query: string, texts: string[]): string[] {
    const queryTokens = tokenize(query);
    const allText = texts.join(' ').toLowerCase();
    const matched: string[] = [];

    for (const qt of queryTokens) {
      if (allText.includes(qt)) {
        matched.push(qt);
      }
    }

    return [...new Set(matched)];
  }

  /**
   * 获取搜索建议
   * @param query 部分输入
   * @param limit 数量限制
   * @returns 建议数组
   */
  getSuggestions(query: string, limit: number = 5): string[] {
    if (!query || query.length < 2) {
      return [];
    }

    const suggestions: string[] = [];

    // 从示例命令中获取建议
    const examples = this.exampleCommands.getAllExamples();
    for (const example of examples) {
      if (example.command.toLowerCase().includes(query.toLowerCase())) {
        suggestions.push(example.command);
      }
      if (suggestions.length >= limit) break;
    }

    // 从命令中获取建议
    const helpEntries = this.contextHelp.getAllContextHelp();
    for (const entry of helpEntries) {
      for (const cmd of entry.relatedCommands) {
        if (cmd.toLowerCase().includes(query.toLowerCase())) {
          suggestions.push(cmd);
        }
        if (suggestions.length >= limit) break;
      }
      if (suggestions.length >= limit) break;
    }

    return [...new Set(suggestions)].slice(0, limit);
  }

  /**
   * 获取热门搜索
   * @param limit 数量限制
   * @returns 热门搜索关键词数组
   */
  getPopularSearches(limit: number = 5): string[] {
    // 基于示例命令和上下文帮助生成热门搜索
    const popular: string[] = [
      'fix',
      'explain',
      'refactor',
      'test',
      'git',
      'debug',
      'optimize',
    ];

    return popular.slice(0, limit);
  }

  /**
   * 获取搜索统计
   * @returns 搜索次数
   */
  getSearchCount(): number {
    return this.searchCount;
  }

  /**
   * 重置搜索统计
   */
  resetSearchCount(): void {
    this.searchCount = 0;
  }

  /**
   * 高级搜索（支持过滤）
   * @param query 搜索关键词
   * @param filters 过滤器
   * @returns 搜索结果数组
   */
  advancedSearch(
    query: string,
    filters?: {
      types?: Array<'example' | 'release_note' | 'error_message' | 'help'>;
      minRelevance?: number;
    }
  ): SearchResult[] {
    let results = this.search(query);

    if (filters?.types) {
      results = results.filter((result) =>
        filters.types!.includes(result.type)
      );
    }

    if (filters?.minRelevance !== undefined) {
      results = results.filter(
        (result) => result.relevance >= filters.minRelevance!
      );
    }

    return results;
  }
}

// 导出单例实例
export const docsSearch = new DocsSearch();
