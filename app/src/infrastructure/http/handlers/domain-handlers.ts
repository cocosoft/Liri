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
 * domain-handlers.ts — 知识域清单（D6-3）
 *
 * 端点：`GET /v1/knowledge/domains`
 *
 * 语义说明（避免误解）：
 * - 域清单来源是 `~/.pyapp/knowledge/domains/` 下**带 config 的子目录**（`DomainManager.list()` 既有语义）；
 * - **默认域 `knowledge` 始终存在于返回值**（即使 `domains/` 目录不存在）——
 *   存量图数据的 `kg_edges.domain` 全为 `knowledge`，若清单为空会让"域"这一维度看起来不存在；
 * - 只读：不创建目录、不写任何文件。
 */

import type http from 'http';
import { sendErrorMapped } from './handler-utils';
import { handleError } from '@modules/error';

/** 默认域（与 `KnowledgeGraph` / 编译管线的缺省域一致） */
const DEFAULT_DOMAIN = 'knowledge';

/** 域清单条目 */
interface DomainListItem {
  name: string;
  label: string;
  description: string;
  keywordTags: string[];
  wikiPageCount: number;
  /** 是否为默认域（缺省域，不可删除） */
  isDefault: boolean;
}

/**
 * GET /v1/knowledge/domains
 *
 * 返回 `{ defaultDomain, domains: [...] }`（默认域始终在列表首位）。
 */
export async function handleListKnowledgeDomains(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { DomainManager } =
      await import('@modules/knowledge/domain/DomainManager');
    const manager = new DomainManager();

    const existing = await manager.list();
    const domains: DomainListItem[] = [
      {
        name: DEFAULT_DOMAIN,
        label: '默认域',
        description: '默认域：存量图数据与未分域的文档都在这里',
        keywordTags: [],
        wikiPageCount: 0,
        isDefault: true,
      },
      ...existing
        .filter((item) => item.name !== DEFAULT_DOMAIN)
        .map((item) => ({
          name: item.name,
          label: item.label,
          description: item.description,
          keywordTags: item.keywordTags ?? [],
          wikiPageCount: item.wikiPageCount ?? 0,
          isDefault: false,
        })),
    ];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ defaultDomain: DEFAULT_DOMAIN, domains }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:domain',
      action: 'list_domains',
    });
    sendErrorMapped(res, err);
  }
}
