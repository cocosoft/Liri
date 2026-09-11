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
 * 知识图谱 CLI 命令（kg_edges 备份 / 回滚）
 *
 * 与 HTTP 端点同源——两者都只是调用 `KnowledgeGraph.exportJsonl / importJsonl`：
 *   knowledge export-graph [--out <file>]   导出全量边为 JSONL 备份
 *   knowledge import-graph <file>           从 JSONL 备份恢复（幂等）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { KnowledgeGraph } from '../graph/KnowledgeGraph';
import { resolveOutputDir } from '@modules/core/paths';
import { handleError } from '@modules/error';
import { flush } from '@modules/monitoring/logs/Logger';

/** 默认备份路径：~/.pyapp/output/kg-edges-<yyyyMMdd-HHmmss>.jsonl */
function defaultBackupPath(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .slice(0, 15)
    .replace('T', '-');
  return join(resolveOutputDir(), `kg-edges-${ts}.jsonl`);
}

/**
 * 一次性命令收尾：flush 日志后显式退出。
 * 不显式退出时，其他模块的残留句柄会让 CLI 进程在输出结果后一直挂住。
 */
async function exitCli(code: number): Promise<void> {
  await flush();
  process.exit(code);
}

/**
 * 注册知识图谱 CLI 命令
 * @param program Commander 程序实例
 */
export function registerKnowledgeGraphCommands(program: Command): void {
  const knowledge = program
    .command('knowledge')
    .description('Manage knowledge graph data (kg_edges)');

  knowledge
    .command('export-graph')
    .description('Export all graph edges to a JSONL backup file')
    .option(
      '--out <file>',
      'output file (默认 ~/.pyapp/output/kg-edges-<时间戳>.jsonl)'
    )
    .action(async (options: { out?: string }) => {
      const graph = new KnowledgeGraph();
      let failed = false;
      try {
        await graph.init();
        const outPath = options.out
          ? resolve(options.out)
          : defaultBackupPath();
        mkdirSync(dirname(outPath), { recursive: true });

        const jsonl = await graph.exportJsonl();
        writeFileSync(outPath, jsonl, 'utf-8');

        const { totalEdges } = await graph.getStats();
        console.log(chalk.green(`已导出 ${totalEdges} 条边 → ${outPath}`));
      } catch (err) {
        failed = true;
        await handleError(err, {
          module: 'cli:knowledge:graph',
          action: 'export',
        });
        console.error(
          chalk.red(
            `导出失败：${err instanceof Error ? err.message : String(err)}`
          )
        );
      } finally {
        // 必须 await close：SQLite 关闭时做 WAL checkpoint，避免残留未落盘写入
        await graph.close();
      }
      await exitCli(failed ? 1 : 0);
    });

  knowledge
    .command('import-graph <file>')
    .description('Restore graph edges from a JSONL backup (idempotent)')
    .action(async (file: string) => {
      const graph = new KnowledgeGraph();
      let failed = false;
      try {
        await graph.init();
        const jsonl = readFileSync(resolve(file), 'utf-8');
        const { imported, skipped } = await graph.importJsonl(jsonl);
        console.log(
          chalk.green(
            `已导入：新增 ${imported} 条，跳过 ${skipped} 条（已存在或无法解析）`
          )
        );
      } catch (err) {
        failed = true;
        await handleError(err, {
          module: 'cli:knowledge:graph',
          action: 'import',
        });
        console.error(
          chalk.red(
            `导入失败：${err instanceof Error ? err.message : String(err)}`
          )
        );
      } finally {
        await graph.close();
      }
      await exitCli(failed ? 1 : 0);
    });

  knowledge
    .command('dedupe-edges')
    .description(
      'Remove duplicate edges (keep the earliest) and build the unique index'
    )
    .option('--yes', '确认执行（非交互场景必需）')
    .action(async (options: { yes?: boolean }) => {
      const graph = new KnowledgeGraph();
      let failed = false;
      try {
        await graph.init();
        if (!options.yes) {
          // 数据删除操作：先要求备份 + 显式确认，避免误触
          console.log(
            chalk.yellow(
              '该操作会删除重复边：同一 (from,to,type,domain) 仅保留最早一条。'
            )
          );
          console.log(chalk.yellow('请先备份：pyapp knowledge export-graph'));
          console.log(chalk.yellow('确认无误后加 --yes 重新执行。'));
        } else {
          const result = await graph.dedupeEdges();
          console.log(
            chalk.green(
              `去重完成：重复组 ${result.groups}，删除 ${result.removed} 条；唯一索引 ${
                result.indexReady ? '已就绪' : '未就绪（仍有重复或建索引失败）'
              }`
            )
          );
        }
      } catch (err) {
        failed = true;
        await handleError(err, {
          module: 'cli:knowledge:graph',
          action: 'dedupe',
        });
        console.error(
          chalk.red(
            `去重失败：${err instanceof Error ? err.message : String(err)}`
          )
        );
      } finally {
        await graph.close();
      }
      await exitCli(failed ? 1 : 0);
    });
}
