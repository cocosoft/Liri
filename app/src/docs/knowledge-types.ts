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
 * 知识搜索通用类型定义
 *
 * 原名 KnowledgeRouter.ts（Step 2 重构拆分），
 * 保留 IKnowledgeSearch 接口作为所有搜索路由的统一契约。
 */

/** 知识路由搜索结果条目 */
export interface KnowledgeRoute {
  docPath: string;
  title: string;
  score: number;
  category: string;
  snippet: string;
  matchType:
    | 'knowledge'
    | 'username'
    | 'title'
    | 'keyword'
    | 'directory'
    | 'semantic';
  isKnowledgeDoc: boolean;
  /** 分块起始行（用于上下文富化时定位关联块） */
  startLine?: number;
  /** 分块结束行（用于上下文富化时定位关联块） */
  endLine?: number;
  /** 匹配得分（语义搜索时设置） */
  semanticScore?: number;
}

/** 知识路由搜索选项 */
export interface KnowledgeRouterOptions {
  maxResults?: number;
  minScore?: number;
  /** 分页偏移量，默认 0 */
  offset?: number;
  /** 限定域搜索（按域名称过滤） */
  domain?: string;
  /** 跨多域搜索 */
  domains?: string[];
}

/** 知识搜索通用接口 — 所有搜索路由均实现此接口 */
export interface IKnowledgeSearch {
  search(
    query: string,
    options?: KnowledgeRouterOptions
  ): Promise<KnowledgeRoute[]>;
}
