/**
 * LLM+Wiki KnowledgeRouter
 * 基于倒排索引 + 分层权重的智能文件路由系统
 *
 * 路由算法: 用户名匹配(+0.4) > 标题匹配(+0.3) > 内容关键词匹配(+0.2) > 目录名匹配(+0.1)
 *
 * 利用现有的 FileDocsProvider + 结构化 Markdown 文档，零新增依赖。
 */

import { FileDocsProvider, fileDocsProvider } from './FileDocsProvider';

const COMMON_STOP_WORDS = new Set([
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
  'also',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'whom',
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
]);

export interface KnowledgeRoute {
  docPath: string;
  title: string;
  score: number;
  category: string;
  snippet: string;
  matchType: 'username' | 'title' | 'keyword' | 'directory';
}

export interface KnowledgeRouterOptions {
  maxResults?: number;
  minScore?: number;
}

interface WeightedDoc {
  docPath: string;
  title: string;
  category: string;
  content: string;
}

export class KnowledgeRouter {
  private provider: FileDocsProvider;
  private knownUsernames: string[];
  private docs: WeightedDoc[] = [];
  private initialized: boolean = false;

  constructor(provider: FileDocsProvider, knownUsernames: string[] = []) {
    this.provider = provider;
    this.knownUsernames = knownUsernames;
  }

  setKnownUsernames(usernames: string[]): void {
    this.knownUsernames = usernames;
  }

  async buildIndex(): Promise<void> {
    const entries = await this.provider.buildIndex();
    this.docs = entries.map((e) => ({
      docPath: e.relativePath,
      title: e.title,
      category: e.category,
      content: e.content,
    }));
    this.initialized = true;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,，。、；：（）()\[\]【】{}""''「」『』《》\/\\\-]+/)
      .filter((t) => t.length > 1)
      .filter((t) => !COMMON_STOP_WORDS.has(t));
  }

  private extractSnippet(
    content: string,
    queryTokens: string[],
    maxLen: number = 120
  ): string {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (queryTokens.some((t) => lower.includes(t))) {
        let snippet = lines[i].trim();
        if (snippet.length > maxLen) {
          snippet = snippet.slice(0, maxLen) + '...';
        }
        return snippet;
      }
    }
    const firstLine = lines.find((l) => l.trim().length > 0);
    return firstLine ? firstLine.trim().slice(0, maxLen) : '';
  }

  async search(
    query: string,
    options?: KnowledgeRouterOptions
  ): Promise<KnowledgeRoute[]> {
    if (!this.initialized) {
      await this.buildIndex();
    }

    const maxResults = options?.maxResults ?? 10;
    const minScore = options?.minScore ?? 0;
    const queryTokens = this.tokenize(query);
    const lowerQuery = query.toLowerCase();

    if (queryTokens.length === 0) {
      return [];
    }

    const results: KnowledgeRoute[] = [];

    for (const doc of this.docs) {
      const lowerTitle = doc.title.toLowerCase();
      const lowerCategory = doc.category.toLowerCase();
      const lowerContent = doc.content.toLowerCase();

      let bestScore = 0;
      let bestMatchType: KnowledgeRoute['matchType'] = 'keyword';

      // 用户名匹配 (+0.4): 查询中是否包含已知用户名
      if (this.knownUsernames.length > 0) {
        const matchedUser = this.knownUsernames.some((u) =>
          lowerQuery.includes(u.toLowerCase())
        );
        if (
          matchedUser &&
          lowerContent.includes('@') &&
          queryTokens.some((t) => lowerContent.includes(t))
        ) {
          if (0.4 > bestScore) {
            bestScore = 0.4;
            bestMatchType = 'username';
          }
        }
      }

      // 标题匹配 (+0.3): 查询词与文档标题匹配
      const titleMatchCount = queryTokens.filter((t) =>
        lowerTitle.includes(t)
      ).length;
      if (titleMatchCount > 0) {
        const titleScore = 0.3 * (titleMatchCount / queryTokens.length);
        if (titleScore > bestScore) {
          bestScore = titleScore;
          bestMatchType = 'title';
        }
      }

      // 内容关键词匹配 (+0.2): 查询词在文档内容中出现
      const contentMatchCount = queryTokens.filter((t) =>
        lowerContent.includes(t)
      ).length;
      if (contentMatchCount > 0) {
        const contentScore = 0.2 * (contentMatchCount / queryTokens.length);
        if (contentScore > bestScore) {
          bestScore = contentScore;
          bestMatchType = 'keyword';
        }
      }

      // 目录名匹配 (+0.1): 查询词与目录名匹配
      const dirMatchCount = queryTokens.filter((t) =>
        lowerCategory.includes(t)
      ).length;
      if (dirMatchCount > 0) {
        const dirScore = 0.1 * (dirMatchCount / queryTokens.length);
        if (dirScore > bestScore) {
          bestScore = dirScore;
          bestMatchType = 'directory';
        }
      }

      if (bestScore > 0 && bestScore >= minScore) {
        results.push({
          docPath: doc.docPath,
          title: doc.title,
          score: Math.round(bestScore * 100) / 100,
          category: doc.category,
          snippet: this.extractSnippet(doc.content, queryTokens),
          matchType: bestMatchType,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  async getDocContent(docPath: string): Promise<string | null> {
    const entry = await this.provider.loadDoc(docPath);
    return entry?.content ?? null;
  }

  async getCategories(): Promise<string[]> {
    return this.provider.getCategories();
  }
}

export const knowledgeRouter = new KnowledgeRouter(fileDocsProvider);

export async function getKnowledgeRouter(): Promise<KnowledgeRouter> {
  if (!knowledgeRouter['initialized']) {
    await knowledgeRouter.buildIndex();
  }
  return knowledgeRouter;
}
