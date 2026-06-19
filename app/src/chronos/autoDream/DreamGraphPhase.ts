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
 * 梦境图编译阶段 — DreamGraphPhase
 *
 * 在梦境完成、知识雨（raw→wiki）编译完成后，作为可选后处理阶段，
 * 扫描 wiki 目录中的结构化 .md 文件，提取 [[link]] 双链关系，
 * 写入 KnowledgeGraph（kg_edges 表）。
 *
 * Domain-First 模式下，可通过 domainName 限缩扫描范围。
 *
 * 该阶段默认关闭，需通过配置启用。
 * 不依赖任何领域 SKILL，纯通用基础设施。
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  resolveDomainDir,
  resolveKnowledgeDir,
  resolveDbPath,
  resolveDomainsRoot,
} from '@modules/core';
import { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';
import { SchemaLoader } from '@modules/knowledge/schema/SchemaLoader';
import { DomainManager } from '@modules/knowledge/domain/DomainManager';

const logger = new Logger({ level: LogLevel.INFO });

/** [[link]] 双链正则 */
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * 图编译结果摘要
 */
export interface GraphPhaseResult {
  /** 是否成功执行 */
  success: boolean;
  /** 扫描的 wiki 文件数 */
  filesScanned: number;
  /** 已添加的边数 */
  edgesAdded: number;
  /** 错误信息（可选） */
  error?: string;
}

/**
 * 执行梦境图编译阶段
 *
 * 扫描 wiki 目录，从 [[link]] 中提取关系并写入图数据库。
 * 这是 runKnowledgeRain() 完成后的可选后处理步骤。
 *
 * @param enabled 是否启用图编译，默认 false
 * @param domainName 域名称（可选）。指定后仅扫描该域的 wiki
 * @returns 编译结果摘要
 */
export async function runDreamGraphPhase(
  enabled: boolean = false,
  domainName?: string
): Promise<GraphPhaseResult> {
  if (!enabled) {
    logger.info('DreamGraphPhase 已禁用，跳过');
    return { success: true, filesScanned: 0, edgesAdded: 0 };
  }

  // 收集要扫描的域列表
  let domainsToScan: string[];

  if (domainName) {
    // 明确指定了域，仅扫描该域
    domainsToScan = [domainName];
  } else {
    // 未指定域，扫描所有已注册的域
    const domainManager = new DomainManager();
    const domainList = await domainManager.list();
    domainsToScan = domainList.map((d) => d.name);

    if (domainsToScan.length === 0) {
      // 回退：如果没有任何已注册的域，扫描默认域
      domainsToScan = ['default'];
    }
  }

  logger.info('DreamGraphPhase 开始扫描', {
    domainCount: domainsToScan.length,
    domains: domainsToScan,
  });

  const graph = new KnowledgeGraph(resolveDbPath());
  let totalFilesScanned = 0;
  let totalEdgesAdded = 0;

  try {
    await graph.init();

    for (const domain of domainsToScan) {
      const domainDir = resolveDomainDir(domain);
      const wikiDir = join(domainDir, 'wiki');

      if (!existsSync(wikiDir)) {
        logger.info('wiki 目录不存在，跳过', { domain, wikiDir });
        continue;
      }

      let mdFiles: string[];
      try {
        mdFiles = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
      } catch (err) {
        const msg = `读取 wiki 目录失败 (${domain}): ${err instanceof Error ? err.message : String(err)}`;
        logger.error(msg);
        return {
          success: false,
          filesScanned: totalFilesScanned,
          edgesAdded: totalEdgesAdded,
          error: msg,
        };
      }

      if (mdFiles.length === 0) {
        continue;
      }

      // 加载域 schema，注册 edge 类型（使 addEdge 校验通过）
      const schemaLoader = new SchemaLoader(undefined, domain);
      const { edges: edgeSchemas } = await schemaLoader.loadAll();
      graph.setEdgeSchemas(edgeSchemas);

      for (const file of mdFiles) {
        const filePath = join(wikiDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const sourceSlug = basename(file, '.md');
        const sourceId = KnowledgeGraph.generateEntityId(
          domain,
          'wiki',
          sourceSlug
        );

        if (sourceSlug === 'index') continue;

        totalFilesScanned++;

        // 查找当前页面中的所有 [[link]]
        const targets = new Set<string>();
        let match: RegExpExecArray | null;
        WIKI_LINK_RE.lastIndex = 0;

        while ((match = WIKI_LINK_RE.exec(content)) !== null) {
          const target = match[1].trim();
          if (target !== 'index' && target !== sourceSlug) {
            const targetId = target.includes(':')
              ? target
              : KnowledgeGraph.generateEntityId(domain, 'wiki', target);
            targets.add(targetId);
          }
        }

        // 为每个 [[link]] 目标建立一条 wiki_link 边
        for (const target of targets) {
          const existing = await graph.queryEdges({
            from: sourceId,
            to: target,
            type: 'wiki_link',
            domain,
          });

          if (existing.length === 0) {
            await graph.addEdge({
              from: sourceId,
              to: target,
              type: 'wiki_link',
              direction: 'symmetric',
              domain,
              attributes: { source: 'dream_graph_phase' },
            });
            totalEdgesAdded++;
          }
        }
      }
    }

    logger.info(
      `DreamGraphPhase 完成: 扫描 ${domainsToScan.length} 个域, ${totalFilesScanned} 个文件, 添加 ${totalEdgesAdded} 条边`
    );

    return {
      success: true,
      filesScanned: totalFilesScanned,
      edgesAdded: totalEdgesAdded,
    };
  } catch (err) {
    const msg = `DreamGraphPhase 执行失败: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    return {
      success: false,
      filesScanned: totalFilesScanned,
      edgesAdded: totalEdgesAdded,
      error: msg,
    };
  } finally {
    await graph.close();
  }
}
