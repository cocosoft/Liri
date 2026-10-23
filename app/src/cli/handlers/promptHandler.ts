/**
 * C-5（2026-10-18）`liri prompt` —— 提示词维护面（list / export / diff / validate / reset）。
 *
 * 全部逻辑复用**单一实现**：
 * - 资源清单：`readPromptManifest`（与解析链同一事实源）
 * - 生效覆盖：`listPromptOverrides`（与解析链同序：locale 子目录 → 旧扁平 → 项目）
 * - 校验：`validatePromptResources`（与四个 lint 门禁同一实现）
 *
 * 危险操作：`reset` 会删除用户级覆盖文件，必须显式 `--confirm`。
 */
import chalk from 'chalk';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { resolvePyappHome } from '@openliri/kernel';
import { DEFAULT_LOCALE } from '@modules/constants';
import {
  clearPromptCache,
  getPromptResourceRoot,
  listPromptOverrides,
  listToolResourceOverrides,
  readPromptManifest,
  TOOL_RESOURCE_FILES,
} from '@modules/services/prompt/PromptVersionManager';
import {
  validatePromptResources,
  formatPromptIssues,
} from '@modules/services/prompt/PromptValidator';

interface ParsedArgs {
  locale: string;
  json: boolean;
  to?: string;
  confirm: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    locale: DEFAULT_LOCALE,
    json: false,
    confirm: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--confirm') parsed.confirm = true;
    else if (arg.startsWith('--locale=')) parsed.locale = arg.slice(9);
    else if (arg === '--locale') parsed.locale = args[++i] ?? DEFAULT_LOCALE;
    else if (arg.startsWith('--to=')) parsed.to = arg.slice(5);
    else if (arg === '--to') parsed.to = args[++i];
  }
  return parsed;
}

export class PromptHandler {
  async handle(subcommand: string, args: string[]): Promise<boolean> {
    switch (subcommand) {
      case 'list':
        await this.handleList(args);
        return true;
      case 'export':
        await this.handleExport(args);
        return true;
      case 'diff':
        await this.handleDiff(args);
        return true;
      case 'validate':
        await this.handleValidate(args);
        return true;
      case 'reset':
        await this.handleReset(args);
        return true;
      default:
        return false;
    }
  }

  /** 列出 manifest 条目（id / kind / file） */
  private async handleList(args: string[]): Promise<void> {
    const opts = parseArgs(args);
    const entries = readPromptManifest(DEFAULT_LOCALE);
    if (!entries) {
      console.error(chalk.red('✗'), 'manifest.json 缺失或不可解析');
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    console.log(
      chalk.bold(
        `提示词清单（源语言 ${DEFAULT_LOCALE}，共 ${entries.length} 条）`
      )
    );
    for (const entry of entries) {
      const file = entry.file ?? `(${entry.kind}: ${entry.reason ?? '动态段'})`;
      console.log(`  ${entry.id.padEnd(48)} ${file}`);
    }
  }

  /**
   * 导出当前 locale 的包内资源到用户覆盖目录（缺省 `~/.pyapp/prompts/<locale>/`）。
   * 系统段写 `<locale>/<id>.md`（与解析链的覆盖路径一致），工具层保留 `tools/...`。
   */
  private async handleExport(args: string[]): Promise<void> {
    const opts = parseArgs(args);
    const entries = readPromptManifest(DEFAULT_LOCALE);
    if (!entries) {
      console.error(chalk.red('✗'), 'manifest.json 缺失或不可解析');
      return;
    }

    const targetDir =
      opts.to ?? join(resolvePyappHome(), 'prompts', opts.locale);
    const resourceRoot = getPromptResourceRoot();
    let written = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!entry.file) continue;
      const source = join(resourceRoot, opts.locale, entry.file);
      if (!existsSync(source)) {
        skipped++;
        continue;
      }
      // 系统段：覆盖路径去掉 `sections/` 前缀；工具层：保持 `tools/...`
      const rel = entry.layer === 'system' ? basename(entry.file) : entry.file;
      const dest = join(targetDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
      written++;
    }

    // C-3b / T2：工具级资源（参数描述 / 工具级描述）也能被用户覆盖 ⇒ 一并导出，
    // 否则「解析链支持覆盖」但 CLI 拿不到基线（双轨缺口）。
    let toolResources = 0;
    for (const resource of TOOL_RESOURCE_FILES) {
      const source = join(resourceRoot, opts.locale, resource.file);
      if (!existsSync(source)) continue;
      const dest = join(targetDir, resource.file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
      toolResources++;
    }

    clearPromptCache();
    console.log(
      chalk.green('✓'),
      `已导出 ${written} 个文件到 ${targetDir}` +
        (toolResources > 0
          ? chalk.gray(`（另含 ${toolResources} 份工具级资源 JSON）`)
          : '') +
        (skipped > 0
          ? chalk.yellow(`（${skipped} 个在 ${opts.locale} 无资源，已跳过）`)
          : '')
    );
    console.log(
      chalk.gray(
        '  修改后 30s 内生效（TTL 到期即重读）；`liri prompt reset --confirm` 可撤销。'
      )
    );
  }

  /** 比较用户/项目覆盖与包内资源（只列被覆盖的键） */
  private async handleDiff(args: string[]): Promise<void> {
    const opts = parseArgs(args);
    const hits = listPromptOverrides(opts.locale);
    // C-3b / T2：工具级资源（JSON）的覆盖同样上报（解析链 ①② 支持，但不在 manifest 里）
    const toolHits = listToolResourceOverrides(opts.locale);
    const entries = readPromptManifest(DEFAULT_LOCALE) ?? [];
    const byId = new Map(entries.map((e) => [e.id, e]));

    if (opts.json) {
      console.log(
        JSON.stringify(
          [
            ...hits.map((h) => ({ id: h.id, scope: h.scope, path: h.path })),
            ...toolHits.map((h) => ({
              id: `tool-resource:${h.file}`,
              scope: h.scope,
              path: h.path,
              count: h.count,
            })),
          ],
          null,
          2
        )
      );
      return;
    }

    if (hits.length === 0 && toolHits.length === 0) {
      console.log(
        chalk.green('✓'),
        `无外置覆盖（${opts.locale} 使用包内资源 + 内置兜底）`
      );
      return;
    }

    if (hits.length > 0) {
      console.log(chalk.bold(`外置覆盖 ${hits.length} 条（${opts.locale}）`));
    }
    for (const hit of hits) {
      const entry = byId.get(hit.id);
      const bundledPath = entry?.file
        ? join(getPromptResourceRoot(), opts.locale, entry.file)
        : null;
      const bundled =
        bundledPath && existsSync(bundledPath)
          ? readFileSync(bundledPath, 'utf-8').trim()
          : '';
      const state = bundled === hit.content.trim() ? '相同' : '不同';
      console.log(
        `  ${chalk.cyan(hit.id.padEnd(44))} ${hit.scope === 'user' ? '用户' : '项目'}  ${chalk.gray(state)}`
      );
      console.log(`    ${hit.path}`);
    }

    if (toolHits.length > 0) {
      console.log(
        chalk.bold(`工具级资源外置覆盖 ${toolHits.length} 份（${opts.locale}）`)
      );
      for (const hit of toolHits) {
        console.log(
          `  ${chalk.cyan(hit.file.padEnd(44))} ${hit.scope === 'user' ? '用户' : '项目'}  ${chalk.gray(`${hit.count} 条`)}  ${chalk.gray(hit.label)}`
        );
        console.log(`    ${hit.path}`);
      }
    }
  }

  /** 资源校验（与四个 lint 门禁同一实现） */
  private async handleValidate(args: string[]): Promise<void> {
    const opts = parseArgs(args);
    const result = validatePromptResources({ locales: [opts.locale] });

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            locales: result.locales,
            errors: result.issues.filter((i) => i.severity === 'error').length,
            warnings: result.issues.filter((i) => i.severity === 'warning')
              .length,
            issues: result.issues,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(formatPromptIssues(result.issues));
  }

  /** 删除用户级覆盖（危险操作，必须 --confirm） */
  private async handleReset(args: string[]): Promise<void> {
    const opts = parseArgs(args);
    const dir = join(resolvePyappHome(), 'prompts', opts.locale);

    if (!opts.confirm) {
      console.log(chalk.yellow('⚠'), `将删除 ${dir}（用户级覆盖）`);
      console.log(
        chalk.gray(
          '  确认请执行：liri prompt reset --locale=' +
            opts.locale +
            ' --confirm'
        )
      );
      return;
    }

    if (!existsSync(dir)) {
      console.log(chalk.gray('  目录不存在，无需重置：'), dir);
      return;
    }

    rmSync(dir, { recursive: true, force: true });
    clearPromptCache();
    console.log(
      chalk.green('✓'),
      `已删除 ${dir}，${opts.locale} 回退到包内资源 + 内置兜底`
    );
  }

  showHelp(): void {
    console.log(chalk.bold('  prompt —— 提示词维护'));
    console.log(
      '    prompt list [--json]                     列出 manifest 条目'
    );
    console.log(
      '    prompt export [--locale=] [--to=]        导出包内资源到用户覆盖目录'
    );
    console.log(
      '    prompt diff [--locale=] [--json]         查看外置覆盖（用户/项目）'
    );
    console.log(
      '    prompt validate [--locale=] [--json]     校验占位符 / T1 / 长度预算'
    );
    console.log(
      '    prompt reset [--locale=] --confirm       删除用户级覆盖（危险）'
    );
  }
}

export function createPromptHandler(): PromptHandler {
  return new PromptHandler();
}
