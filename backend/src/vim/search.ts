/**
 * Vim搜索模块
 * 支持正向/反向搜索、替换等功能
 */

export interface SearchResult {
  matches: number[];
  currentIndex: number;
  pattern: string;
  flags: string;
}

export interface ReplaceResult {
  replacedCount: number;
  newText: string;
}

export class SearchManager {
  private text: string = '';
  private lastPattern: string = '';
  private lastFlags: string = 'g';
  private searchResults: SearchResult | null = null;

  /**
   * 设置当前文本
   */
  setText(text: string): void {
    this.text = text;
  }

  /**
   * 正向搜索
   */
  searchForward(pattern: string, flags: string = 'g'): SearchResult {
    const regex = new RegExp(pattern, flags);
    const matches: number[] = [];
    let match;

    while ((match = regex.exec(this.text)) !== null) {
      matches.push(match.index);
    }

    this.lastPattern = pattern;
    this.lastFlags = flags;
    this.searchResults = { matches, currentIndex: 0, pattern, flags };

    return this.searchResults;
  }

  /**
   * 反向搜索
   */
  searchBackward(pattern: string, flags: string = 'g'): SearchResult {
    const result = this.searchForward(pattern, flags);
    result.matches.reverse();
    this.searchResults = result;
    return result;
  }

  /**
   * 查找下一个匹配
   */
  findNext(): number | null {
    if (!this.searchResults || this.searchResults.matches.length === 0) {
      return null;
    }

    this.searchResults.currentIndex = (this.searchResults.currentIndex + 1) % this.searchResults.matches.length;
    return this.searchResults.matches[this.searchResults.currentIndex];
  }

  /**
   * 查找上一个匹配
   */
  findPrevious(): number | null {
    if (!this.searchResults || this.searchResults.matches.length === 0) {
      return null;
    }

    this.searchResults.currentIndex = 
      (this.searchResults.currentIndex - 1 + this.searchResults.matches.length) % this.searchResults.matches.length;
    return this.searchResults.matches[this.searchResults.currentIndex];
  }

  /**
   * 获取当前匹配位置
   */
  getCurrentMatch(): number | null {
    if (!this.searchResults || this.searchResults.matches.length === 0) {
      return null;
    }

    return this.searchResults.matches[this.searchResults.currentIndex];
  }

  /**
   * 简单替换
   */
  replace(pattern: string, replacement: string, flags: string = 'g'): ReplaceResult {
    const regex = new RegExp(pattern, flags);
    const newText = this.text.replace(regex, replacement);
    const replacedCount = (this.text.match(regex) || []).length;

    return { replacedCount, newText };
  }

  /**
   * 替换第一个匹配
   */
  replaceFirst(pattern: string, replacement: string): ReplaceResult {
    return this.replace(pattern, replacement, '');
  }

  /**
   * 替换所有匹配
   */
  replaceAll(pattern: string, replacement: string): ReplaceResult {
    return this.replace(pattern, replacement, 'g');
  }

  /**
   * 使用最后一次的模式搜索
   */
  repeatSearch(forward: boolean = true): SearchResult | null {
    if (!this.lastPattern) return null;
    return forward ? this.searchForward(this.lastPattern, this.lastFlags) : this.searchBackward(this.lastPattern, this.lastFlags);
  }

  /**
   * 获取搜索结果
   */
  getSearchResults(): SearchResult | null {
    return this.searchResults;
  }

  /**
   * 清除搜索状态
   */
  clear(): void {
    this.searchResults = null;
  }

  /**
   * 获取最后使用的模式
   */
  getLastPattern(): string {
    return this.lastPattern;
  }
}

/**
 * 创建搜索管理器实例
 */
export function createSearchManager(): SearchManager {
  return new SearchManager();
}

/**
 * 全局搜索管理器实例
 */
export const searchManager = createSearchManager();
