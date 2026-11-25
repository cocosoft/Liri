/**
 * Memory 命令 - 记忆文件管理
 * 管理 ~/.pyapp/memory/ 目录下的 .md 记忆文件
 * 对标 CC 源码 cc_code/backend/commands/memory/memory.tsx
 */
import { mkdir, writeFile, readdir, readFile, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { CommandContext } from '@modules/commands';
import { resolvePyappHome } from '@openliri/infra/environment';
import { configManager } from '@openliri/infra/config';
import { handleError } from '@openliri/infra/error';

import { getLogger } from '@openliri/infra/monitoring';
import { DEFAULT_LOCALE } from '@openliri/infra/constants';
const logger = getLogger('commands:builtin:memory:Memory');

/**
 * 获取记忆文件目录
 */
function getMemoryDir(): string {
  return join(resolvePyappHome(), 'memory');
}

/**
 * 获取记忆文件完整路径
 */
function getMemoryFilePath(name: string): string {
  return join(getMemoryDir(), `${name}.md`);
}

/**
 * 读取记忆文件内容
 */
async function readMemoryContent(name: string): Promise<string> {
  try {
    const filePath = getMemoryFilePath(name);
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 获取文件名（不含扩展名）
 */
function stripExtension(filename: string): string {
  return filename.replace(/\.md$/, '');
}

const memoryCommand = {
  async execute(args: string, context: CommandContext) {
    const trimmed = args.trim();

    if (
      trimmed === '-h' ||
      trimmed === '--help' ||
      trimmed === 'help' ||
      !trimmed
    ) {
      return this.showHelp();
    }

    if (trimmed === 'status') {
      return this.showStatus();
    }

    // 团队记忆：审阅冲突 / 人工取舍（Phase 3-lite）
    if (trimmed === 'team' || trimmed.startsWith('team ')) {
      return await this.teamCommand(
        trimmed.slice(4).trim(),
        trimmed.includes('--json')
      );
    }

    const useJson = trimmed.includes('--json');
    const cleanArgs = trimmed.replace(/--json\s*/g, '').trim();

    if (useJson && !cleanArgs) {
      const status = await this.getStatus();
      return { success: true, message: JSON.stringify(status, null, 2) };
    }

    const parts = cleanArgs.split(/\s+/);
    const subcommand = parts[0];
    const name = parts.slice(1).join(' ');

    try {
      switch (subcommand) {
        case '--list':
        case '-l':
          return await this.listFiles(useJson);
        case '--create':
        case '-c':
          return await this.createFile(name, useJson);
        case '--show':
        case '-s':
          return await this.showFile(name, useJson);
        case '--edit':
        case '-e':
          return await this.editFile(name, useJson);
        case '--delete':
        case '-d':
          return await this.deleteFile(name, useJson);
        default:
          return await this.showFile(subcommand, useJson);
      }
    } catch (error) {
      return {
        success: false,
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  showHelp() {
    return {
      success: true,
      message: [
        '记忆文件管理帮助',
        '==================',
        '',
        '管理 ~/.pyapp/memory/ 目录下的 .md 记忆文件，用于存储持久化上下文信息。',
        '',
        '用法:',
        '  /memory                    - 显示记忆文件概览',
        '  /memory --list (-l)        - 列出所有记忆文件',
        '  /memory --create <name>    - 创建新的记忆文件',
        '  /memory --show <name>      - 显示记忆文件内容',
        '  /memory --edit <name>      - 编辑记忆文件',
        '  /memory --delete <name>    - 删除记忆文件',
        '  /memory <name>             - 显示指定记忆文件',
        '  /memory status             - 显示记忆系统状态',
        '  /memory team               - 列出团队记忆同步冲突候选',
        '  /memory team keep-local <id>  - 采纳本地版本（覆盖共享侧）',
        '  /memory team keep-shared <id> - 采纳共享版本（覆盖本地）',
        '  /memory --json             - 以 JSON 格式输出概览',
        '  /memory help               - 显示本帮助',
        '',
        '选项:',
        '  --json    以 JSON 格式输出结果',
        '',
        '别名: /mem, /记忆',
      ].join('\n'),
    };
  },

  async showStatus() {
    const status = await this.getStatus();
    return {
      success: true,
      message: [
        '记忆系统状态',
        '============',
        '',
        `记忆目录: ${status.memoryDir}`,
        `记忆文件数: ${status.fileCount}`,
        `总大小: ${status.totalSize}`,
        `目录存在: ${status.dirExists ? '是' : '否'}`,
      ].join('\n'),
    };
  },

  /**
   * 团队记忆审阅入口（Phase 3-lite）：列出 `conflicts.json` 候选，或人工取舍。
   * `dirs` 仅用于单测注入（缺省走真实目录/配置）。
   *
   * Phase 2N-10：候选有**两个写入源**（共享目录版 → `teamDir`；网络版 → 同步器
   * `config.localDir`，见 2N-5）。原实现只读 `teamDir` ⇒ CLI 看不到网络候选、
   * 也采纳不了（文件取舍要求两侧文件都存在）。现与 HTTP 入口同源：合并读取，
   * 网络候选走同步器的 `resolveConflictCandidate`（与设置页同一判定）。
   */
  async teamCommand(
    args: string,
    useJson: boolean,
    dirs?: { teamDir: string; sharedDir: string; networkDir?: string }
  ) {
    const { resolveTeamMemoryDir } =
      await import('@openliri/infra/environment');
    const { resolveTeamConflict, readMergedTeamConflicts } =
      await import('@openliri/infra/memory/services/TeamMemorySharedDirSync');
    const { defaultTeamMemorySyncService } =
      await import('@openliri/infra/memory/services/TeamMemorySyncService');
    const teamDir = dirs?.teamDir ?? resolveTeamMemoryDir();
    const sharedDir =
      dirs?.sharedDir ??
      (
        configManager.getValue<string>('memory.teamSync.sharedDir', '') ?? ''
      ).trim();
    // 单测注入时网络目录默认同注入目录，避免读写真实用户数据目录
    const networkDir =
      dirs?.networkDir ??
      (dirs ? teamDir : defaultTeamMemorySyncService.getConfig().localDir);

    const [action, id] = args.split(/\s+/);
    if (action === 'keep-local' || action === 'keep-shared') {
      if (!id) {
        return {
          success: false,
          message:
            '用法: /memory team keep-local|keep-shared <id>（需先配置 memory.teamSync.sharedDir）',
        };
      }
      const resolution = action === 'keep-local' ? 'keep_local' : 'keep_shared';

      // 网络候选优先（与 HTTP resolve 入口同一判定；文件候选返回 not_applicable）
      const outcome =
        await defaultTeamMemorySyncService.resolveConflictCandidate(
          id,
          resolution,
          networkDir
        );
      if (outcome === 'not_configured') {
        return {
          success: false,
          message:
            '未配置 memory.teamSync.serverUrl，无法采纳网络候选（共享目录版请配置 memory.teamSync.sharedDir）',
        };
      }
      if (outcome === 'not_resolved') {
        return {
          success: false,
          message: `采纳失败: ${id}（id 不安全、远端已变或下载失败）`,
        };
      }
      if (outcome === 'resolved') {
        return { success: true, message: `已采纳 ${action}: ${id}` };
      }

      if (!sharedDir) {
        return {
          success: false,
          message:
            '用法: /memory team keep-local|keep-shared <id>（需先配置 memory.teamSync.sharedDir）',
        };
      }
      const ok = await resolveTeamConflict({
        id,
        teamDir,
        sharedDir,
        resolution,
      });
      return {
        success: ok,
        message: ok
          ? `已采纳 ${action}: ${id}`
          : `采纳失败（${id} 不存在于两侧，或源内容命中密钥）`,
      };
    }

    const payload = await readMergedTeamConflicts([networkDir, teamDir]);
    if (useJson) {
      return { success: true, message: JSON.stringify(payload, null, 2) };
    }
    const candidates = payload.candidates ?? [];
    if (candidates.length === 0) {
      return {
        success: true,
        message: `团队记忆无待处理冲突（${teamDir}）`,
      };
    }
    return {
      success: true,
      message: [
        '团队记忆冲突候选:',
        ...candidates.map(
          (c) =>
            `  - ${c.id} [${(c.directions ?? []).join('/')}]${
              c.source === 'network' ? ' (network)' : ''
            }`
        ),
        '',
        '采纳: /memory team keep-local|keep-shared <id>',
      ].join('\n'),
    };
  },

  async getStatus(): Promise<Record<string, unknown>> {
    const memoryDir = getMemoryDir();
    const dirExists = existsSync(memoryDir);
    let files: string[] = [];
    let totalBytes = 0;

    if (dirExists) {
      try {
        const allFiles = await readdir(memoryDir);
        files = allFiles.filter((f) => f.endsWith('.md')).map(stripExtension);

        for (const f of allFiles) {
          if (f.endsWith('.md')) {
            try {
              const s = await stat(join(memoryDir, f));
              totalBytes += s.size;
            } catch (err) {
              void handleError(err, {
                module: 'commands:builtin',
                action: 'catch_error',
              });
            }
          }
        }
      } catch (err) {
        void handleError(err, {
          module: 'commands:builtin',
          action: 'catch_error',
        });
      }
    }

    return {
      memoryDir,
      dirExists,
      fileCount: files.length,
      files,
      totalSize: formatSize(totalBytes),
      totalBytes,
    };
  },

  async listFiles(useJson: boolean) {
    const memoryDir = getMemoryDir();

    if (!existsSync(memoryDir)) {
      if (useJson) {
        return {
          success: true,
          message: JSON.stringify({ files: [] }, null, 2),
        };
      }
      return { success: true, message: '没有找到记忆文件。' };
    }

    const allFiles = await readdir(memoryDir);
    const memoryFiles = allFiles
      .filter((f) => f.endsWith('.md'))
      .map(stripExtension);

    if (useJson) {
      const fileDetails = await Promise.all(
        memoryFiles.map(async (name) => {
          try {
            const s = await stat(getMemoryFilePath(name));
            return { name, size: s.size, modifiedAt: s.mtime.toISOString() };
          } catch {
            return { name, size: 0, modifiedAt: null };
          }
        })
      );
      return {
        success: true,
        message: JSON.stringify({ files: fileDetails }, null, 2),
      };
    }

    if (memoryFiles.length === 0) {
      return {
        success: true,
        message: '没有找到记忆文件。使用 /memory --create <name> 创建。',
      };
    }

    let content = `📋 记忆文件列表 (${memoryFiles.length} 个):\n\n`;
    for (let i = 0; i < memoryFiles.length; i++) {
      try {
        const s = await stat(getMemoryFilePath(memoryFiles[i]));
        const size = formatSize(s.size);
        const date = s.mtime.toLocaleDateString(DEFAULT_LOCALE);
        content += `  ${i + 1}. ${memoryFiles[i]} (${size}, ${date})\n`;
      } catch {
        content += `  ${i + 1}. ${memoryFiles[i]}\n`;
      }
    }

    return { success: true, message: content };
  },

  async createFile(name: string, useJson: boolean) {
    if (!name) {
      return {
        success: false,
        message: '请提供记忆文件名称。用法: /memory --create <name>',
      };
    }

    const filePath = getMemoryFilePath(name);

    if (existsSync(filePath)) {
      return { success: false, message: `记忆文件 "${name}" 已存在。` };
    }

    await mkdir(getMemoryDir(), { recursive: true });
    const content = `# ${name}\n\n创建时间: ${new Date().toISOString()}\n\n`;
    await writeFile(filePath, content, 'utf8');

    (await import('@openliri/service/services/analytics/index')).logEvent(
      'tengu_memory_created',
      {
        name,
      }
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { created: true, name, path: filePath },
          null,
          2
        ),
      };
    }

    return { success: true, message: `✅ 已创建记忆文件: ${name}` };
  },

  async showFile(name: string, useJson: boolean) {
    if (!name) {
      return {
        success: false,
        message: '请提供记忆文件名称。用法: /memory --show <name>',
      };
    }

    const content = await readMemoryContent(name);

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { name, content, exists: content !== '' },
          null,
          2
        ),
      };
    }

    if (!content) {
      return { success: false, message: `记忆文件 "${name}" 不存在。` };
    }

    return { success: true, message: `📄 ${name}:\n\n${content}` };
  },

  async editFile(name: string, useJson: boolean) {
    if (!name) {
      return {
        success: false,
        message: '请提供记忆文件名称。用法: /memory --edit <name>',
      };
    }

    const filePath = getMemoryFilePath(name);

    if (!existsSync(filePath)) {
      await mkdir(getMemoryDir(), { recursive: true });
      const defaultContent = `# ${name}\n\n创建时间: ${new Date().toISOString()}\n\n`;
      await writeFile(filePath, defaultContent, 'utf8');
    }

    const editor =
      configManager.env('VISUAL') || configManager.env('EDITOR') || 'notepad';

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { edited: true, name, path: filePath, editor },
          null,
          2
        ),
      };
    }

    return {
      success: true,
      message: `📝 正在用 ${editor} 打开 "${name}"\n\n如需更换编辑器，请设置 $EDITOR 或 $VISUAL 环境变量。`,
    };
  },

  async deleteFile(name: string, useJson: boolean) {
    if (!name) {
      return {
        success: false,
        message: '请提供记忆文件名称。用法: /memory --delete <name>',
      };
    }

    const filePath = getMemoryFilePath(name);

    if (!existsSync(filePath)) {
      return { success: false, message: `记忆文件 "${name}" 不存在。` };
    }

    await unlink(filePath);

    (await import('@openliri/service/services/analytics/index')).logEvent(
      'tengu_memory_deleted',
      {
        name,
      }
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify({ deleted: true, name }, null, 2),
      };
    }

    return { success: true, message: `🗑️ 已删除记忆文件: ${name}` };
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default memoryCommand;
