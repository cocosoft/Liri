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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';

// ========== Commands Handlers ==========

export async function handleListCommands(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCommandManager } =
        await import('@modules/commands/manager/CommandManager.js');
      const commandManager = getCommandManager();
      const commands = await commandManager.getAllCommands();
      const result = commands.map((cmd: any) => ({
        name: cmd.name,
        description: cmd.description,
        aliases: cmd.aliases || [],
        argumentHint: cmd.argumentHint || '',
        userInvocable: cmd.userInvocable !== false,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
    }
  }

  /**
   * 处理执行命令请求 POST /v1/commands/execute
   */
export async function handleExecuteCommand(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await ctx.readRequestBody(req);

      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'invalid JSON in request body' } })
        );
        return;
      }

      const { command } = parsedBody;

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'command is required' } }));
        return;
      }

      const { commandExecutor } =
        await import('@modules/commands/executor/CommandExecutor.js');
      const result = await commandExecutor.execute(command);

      const output =
        result.value?.toString() || result.message?.toString() || '';
      const error = result.type === 'error' ? output : '';

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: result.success !== false,
          output,
          error,
        })
      );
    } catch (err) {
    }
  }

  /**
   * 递归复制目录（带回滚令牌）
   * @param src 源目录
   * @param dest 目标目录
   * @param fs fs 模块
   * @param path path 模块
   * @returns 复制结果统计
   */
function copyDirectory(
    src: string,
    dest: string,
    fs: any,
    path: any
  ): { copied: number; skipped: number; errors: string[] } {
    let copied = 0;
    let skipped = 0;
    const errors: string[] = [];

    if (!fs.existsSync(src)) {
      return { copied, skipped, errors };
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过迁移标记文件本身，避免误复制
      if (
        entry.name === '.migrating' ||
        entry.name === '.migration_committed'
      ) {
        continue;
      }
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          const result = copyDirectory(srcPath, destPath, fs, path);
          copied += result.copied;
          skipped += result.skipped;
          errors.push(...result.errors);
        } else {
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            copied++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        errors.push(`复制 ${srcPath} 失败: ${(err as Error).message}`);
      }
    }

    return { copied, skipped, errors };
  }

  /**
   * 设置用户数据目录 PUT /v1/settings/data-directory
   * 使用两阶段迁移：全部复制成功后才切换目录，复制失败则回滚清理
   * @param req
   * @param res
   * @param options.migrate 是否迁移现有数据（默认 true）
   */
export async function handleSetDataDirectory(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const payload = JSON.parse(body);
      const { directory, migrate = true } = payload;

      if (!directory || typeof directory !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: '目录路径不能为空',
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const resolvedDir = path.resolve(directory);

      // 验证目录可写
      try {
        if (!fs.existsSync(resolvedDir)) {
          fs.mkdirSync(resolvedDir, { recursive: true });
        }
        const testFile = path.join(resolvedDir, '.write_test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: `无法创建或写入目录: ${(err as Error).message}`,
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      // 获取当前数据目录
      const { resolvePyappHome, setUserDataDirOverride } =
        await import('@modules/core/paths');
      const currentDir = resolvePyappHome();

      // 执行数据迁移（两阶段：先复制，成功后再切换）
      let migrationResult: {
        copied: number;
        skipped: number;
        errors: string[];
      } | null = null;
      if (migrate && currentDir !== resolvedDir && fs.existsSync(currentDir)) {
        // 阶段一：写迁移令牌，标记迁移进行中
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migrating'),
            Date.now().toString(),
            'utf-8'
          );
        } catch {
          // 非致命：令牌写入失败不影响迁移
        }

        migrationResult = copyDirectory(currentDir, resolvedDir, fs, path);

        // 检查迁移是否出错，出错则执行回滚
        if (migrationResult.errors.length > 0) {
          rollbackMigration(resolvedDir, fs, path, currentDir);

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: `数据迁移失败，已回滚，保留了 ${migrationResult.copied} 个已复制的文件作为备份参考`,
              directory: resolvedDir,
              migration: migrationResult,
              rolledBack: true,
              error: {
                message: `迁移过程中出现 ${migrationResult.errors.length} 个错误，目录已回滚`,
                type: 'migration_error',
              },
            })
          );
          return;
        }

        // 阶段二：写迁移完成标记
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migration_committed'),
            Date.now().toString(),
            'utf-8'
          );
        } catch {
          // 非致命：标记写入失败不影响目录切换
        }
      }

      // 设置全局覆盖
      setUserDataDirOverride(resolvedDir);

      // 持久化到用户设置
      const { updateUserSettings } =
        await import('@modules/config/settings/userSettings');
      await updateUserSettings({ dataDirectory: resolvedDir });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: migrationResult
            ? `数据目录已更新，已迁移 ${migrationResult.copied} 个文件，跳过 ${migrationResult.skipped} 个文件`
            : '数据目录已更新',
          directory: resolvedDir,
          migration: migrationResult,
        })
      );
    } catch (error) {
    }
  }

  /**
   * 回滚数据迁移：删除目标目录中的已复制内容
   * @param destDir 目标目录（将被清理）
   * @param fs fs 模块
   * @param path path 模块
   * @param oldDir 原数据目录（保留不动）
   */
function rollbackMigration(
    destDir: string,
    fs: any,
    path: any,
    oldDir: string
  ): void {
    try {
      // 清理目标目录中除 .migrating 令牌外的所有文件和子目录
      if (fs.existsSync(destDir)) {
        const entries = fs.readdirSync(destDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.migrating') continue;
          const entryPath = path.join(destDir, entry.name);
          try {
            if (entry.isDirectory()) {
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(entryPath);
            }
          } catch {
            // 静默忽略清理中的个别错误
          }
        }
      }
    } catch {
      // 回滚清理失败不影响主流程，数据保留在原目录
    }
  }

  // ──────────────────────────────────────────────
  // Skills（ClawHub 生态对接）处理器
  // ──────────────────────────────────────────────

  /**
   * 获取 ClawHubAdapter 实例
   * 优先从 ThirdPartyAdapterRegistry 获取，fallback 到直接 import
   */
async function getClawHubAdapter(): Promise<any> {
    // 优先从注册表获取
    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered) {
        return registered;
      }
    } catch {
      // 注册表不可用时 fallback
    }

    // Fallback: 直接 import
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    const adapter = ClawHubAdapter.getInstance();

    if (!adapter['initialized']) {
      await adapter.initialize();
    }

    return adapter;
  }

  /**
   * 处理列出已安装技能请求 GET /v1/skills
   */
export async function handleListSkills(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const skills = await adapter.getInstalledSkills();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills }));
    } catch (err) {
    }
  }

  /**
   * 处理列出系统内置技能请求 GET /v1/skills/system
   * 扫描 builtin/skills 和用户技能目录中的 SKILL.md 文件，
   * 返回与前端 SkillPage 兼容的技能列表
   */
export async function handleListSystemSkills(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const { parseSkillFrontmatter } =
        await import('@modules/skills/utils/skillParser');
      const { readdir, readFile, stat } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { join } = await import('node:path');

      const skills: Record<string, any>[] = [];
      const seen = new Set<string>();

      const scanDir = async (dir: string, source: string) => {
        if (!existsSync(dir)) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = join(dir, entry.name);
          try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = parseSkillFrontmatter(content);
            const name = entry.name.replace(/\.md$/, '');
            const description = (parsed.frontmatter as any)?.description || '';
            const fm = parsed.frontmatter as Record<string, any>;
            const version = fm?.version || '1.0.0';
            const author = fm?.author || '';
            const category = fm?.category || 'general';

            if (seen.has(name)) continue;
            seen.add(name);

            let createdAt = 0;
            let updatedAt = 0;
            try {
              const st = await stat(filePath);
              createdAt = st.birthtimeMs;
              updatedAt = st.mtimeMs;
            } catch {
              /* use defaults */
            }

            skills.push({
              id: name,
              name,
              description,
              status: 'enabled',
              category,
              parameters: [],
              createdAt,
              updatedAt,
              usageCount: 0,
              lastUsedAt: null,
              source,
              version,
              filePath,
              frontmatter: { author, version, category },
            });
          } catch {
            /* skip malformed files */
          }
        }
      };

      // 扫描内置技能
      const projectRoot = resolveProjectRoot();
      const builtinDir = join(projectRoot, 'app', 'src', 'builtin', 'skills');
      await scanDir(builtinDir, 'builtin');

      // 扫描用户技能
      const userSkillsDir = join(resolvePyappHome(), 'skills');
      await scanDir(userSkillsDir, 'user');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills, total: skills.length }));
    } catch (err) {
    }
  }

  /**
   * 处理获取系统技能内容 GET /v1/skills/system/:id/content
   * 读取 SKILL.md 文件返回原始内容及 frontmatter
   */
export async function handleSystemSkillContent(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const { readFile, stat } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const pathMod = await import('node:path');

      const candidateDirs = [
        pathMod.join(
          resolveProjectRoot(),
          'app',
          'src',
          'builtin',
          'skills',
          decodeURIComponent(skillId)
        ),
        pathMod.join(resolvePyappHome(), 'skills', decodeURIComponent(skillId)),
      ];

      let skillFile = '';
      for (const dir of candidateDirs) {
        const candidate = pathMod.join(dir, 'SKILL.md');
        if (existsSync(candidate)) {
          skillFile = candidate;
          break;
        }
      }

      if (!skillFile) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: '技能未找到' } }));
        return;
      }

      const rawContent = await readFile(skillFile, 'utf-8');
      let content = rawContent;
      const frontmatter: Record<string, unknown> = {};
      const linkedFiles: string[] = [];

      const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n/);
      if (fmMatch) {
        content = rawContent.slice(fmMatch[0].length);
        const lines = fmMatch[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
          if (m) frontmatter[m[1]] = m[2].trim();
        }
      }

      // 收集关联文件
      const skillDir = pathMod.dirname(skillFile);
      try {
        const entries = await (
          await import('fs/promises')
        ).readdir(skillDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name !== 'SKILL.md') {
            linkedFiles.push(entry.name);
          }
        }
      } catch {
        /* ignore */
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          content,
          rawContent,
          frontmatter,
          linkedFiles,
        })
      );
    } catch (err) {
    }
  }

  /**
   * 处理搜索技能请求 GET /v1/skills/search?q=...&category=...&tags=...&source=...
   * source: 限定搜索源（clawhub / github），不传则搜索全部
   */
export async function handleSearchSkills(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q') || '';
      const category = urlObj.searchParams.get('category') || undefined;
      const tagsStr = urlObj.searchParams.get('tags') || undefined;
      const tags = tagsStr
        ? tagsStr.split(',').map((t) => t.trim())
        : undefined;
      const source = urlObj.searchParams.get('source') || undefined;

      const adapter = await getClawHubAdapter();
      const results = await adapter.searchSkills(query, {
        category,
        tags,
        source,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ results }));
    } catch (err) {
    }
  }

  /**
   * 处理推荐技能列表请求 GET /v1/skills/recommended
   * 返回 ClawHub 市场推荐的技能列表
   */
export async function handleRecommendedSkills(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);

      const adapter = await getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();
      const installedIds = new Set(installed.map((s: any) => s.meta.id));

      const searchEngine = adapter.getSearchEngine();
      const allResults = await searchEngine.searchRemote('', {});

      const recommended = allResults
        .filter((r: any) => !installedIds.has(r.skill.id))
        .slice(0, limit)
        .map((r: any) => ({ ...r, installed: false }));

      const categories = getSkillCategoryMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ recommended, categories }));
    } catch (err) {
    }
  }

  /**
   * 处理技能分类列表请求 GET /v1/skills/categories
   * 按能力分类统计已安装插件数量，技能统一归入 skill 分类
   */
export async function handleSkillCategories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { PLUGIN_CATEGORIES } =
        await import('@modules/plugins/categories/PluginCategories');

      const adapter = await getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();

      const categoryMap = getSkillCategoryMap(installed);

      const categories = Object.entries(PLUGIN_CATEGORIES).map(
        ([key, cat]) => ({
          id: key,
          capability: cat.capability,
          description: cat.description,
          count: categoryMap[key] || 0,
        })
      );

      const sourceMap = getSkillSourceMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ categories, sourceDistribution: sourceMap }));
    } catch (err) {
    }
  }

  /**
   * 处理技能来源列表请求 GET /v1/skills/sources
   * 返回 SearchEngine 中注册的所有搜索源名称
   */
export async function handleSkillSources(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      const sources = searchEngine.getSourceNames() as string[];

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sources }));
    } catch (err) {
    }
  }

  /**
   * 添加自定义技能搜索源 POST /v1/skills/sources
   * Body: { name: string, apiBaseUrl: string }
   */
export async function handleAddSkillSource(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await ctx.readRequestBody(req);
      const { name, apiBaseUrl } = JSON.parse(body || '{}');

      if (
        !name ||
        !apiBaseUrl ||
        typeof name !== 'string' ||
        typeof apiBaseUrl !== 'string'
      ) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({ error: { message: '需要 name 和 apiBaseUrl 字段' } })
        );
        return;
      }

      const adapter = await getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.addCustomSource(name.trim(), apiBaseUrl.trim());

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
    }
  }

  /**
   * 移除自定义技能搜索源 DELETE /v1/skills/sources/:name
   */
export async function handleRemoveSkillSource(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.removeCustomSource(decodeURIComponent(name));

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
    }
  }

  /**
   * 构建插件分类统计映射
   * 所有技能统一归入 skill 分类，不再按来源分裂
   */
function getSkillCategoryMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'third_party';

      if (source === 'builtin') {
        map['builtin'] = (map['builtin'] || 0) + 1;
      } else {
        map['skill'] = (map['skill'] || 0) + 1;
      }
    }

    return map;
  }

  /**
   * 构建技能来源分布统计
   * 按 source 字段统计各来源的技能数量
   */
function getSkillSourceMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'unknown';
      map[source] = (map[source] || 0) + 1;
    }

    return map;
  }

  /**
   * 处理获取技能详情请求 GET /v1/skills/:id
   */
export async function handleGetSkillDetail(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const skill = await adapter.getSkillDetail(skillId);

      if (!skill) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `技能未找到: ${skillId}` } })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skill }));
    } catch (err) {
    }
  }

  /**
   * 处理安装技能请求 POST /v1/skills/install
   */
export async function handleInstallSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await ctx.readRequestBody(req);

      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      const parsedBody = JSON.parse(body);
      const { skillId, sourceUrl } = parsedBody;

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await getClawHubAdapter();
      const installed = await adapter.installSkill(skillId, sourceUrl);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: installed }));
    } catch (err) {
    }
  }

  /**
   * 处理卸载技能请求 POST /v1/skills/:id/uninstall
   */
export async function handleUninstallSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      await adapter.uninstallSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
    }
  }

  /**
   * 处理更新技能请求 POST /v1/skills/:id/update
   */
export async function handleUpdateSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const updated = await adapter.updateSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: updated }));
    } catch (err) {
    }
  }

  /**
   * 处理切换技能启用状态请求 POST /v1/skills/:id/toggle
   */
export async function handleToggleSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      const adapter = await getClawHubAdapter();

      if (enabled === true) {
        await adapter.enableSkill(skillId);
      } else if (enabled === false) {
        await adapter.disableSkill(skillId);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, enabled }));
    } catch (err) {
    }
  }
