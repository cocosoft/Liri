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

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { broadcastEvent } from './handler-utils';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import { refreshCheckpointLogConfig } from '@openliri/infra/config';
// 2026-11-03：配置写入后通知**进程内**订阅方（此前只有 SSE 的 `config:updated`，
// 后端自己的运行时（如 AlwaysOn）收不到 ⇒ `features.alwaysOn` 是死开关）。
import { globalEventBus } from '@openliri/kernel';

const logger = getLogger('http:config');

// ========== Config Handlers ==========

export async function handleListConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { configManager } = await import('@openliri/infra/config');
    const globalConfig = configManager.getGlobalConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(globalConfig || {}));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  }
}

/**
 * 处理获取指定配置项请求
 */
export async function handleGetConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const { configManager } = await import('@openliri/infra/config');
    const value = configManager.getConfigValue(key);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key, value }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key, value: null }));
  }
}

/**
 * 处理设置配置项请求
 */
export async function handleSetConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { value } = JSON.parse(body);
    const { configManager } = await import('@openliri/infra/config');
    configManager.setConfigValue(key, value);
    // P2（08-09）：检查点日志开关变更时刷新缓存
    if (key === 'checkpointLog') {
      refreshCheckpointLogConfig();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key, value }));
    broadcastEvent('config:updated', { key, value });
    // 进程内广播（后端运行时按用户设置即时生效；与上面 SSE 广播互不替代）
    globalEventBus.publish('config:changed', { key, value });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:config-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleDeleteConfig(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  key: string
): Promise<void> {
  try {
    const { configManager } = await import('@openliri/infra/config');
    // ConfigManager 没有 deleteConfigValue，通过 saveGlobalConfig 移除 key
    const { getConfig } = await import('@openliri/infra/config');
    const current = { ...(getConfig() as Record<string, unknown>) };
    delete current[key];
    configManager.setConfigValue(key, undefined as unknown);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key }));
    broadcastEvent('config:deleted', { key });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:config-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

// ========== Router（智能路由）==========

/**
 * 获取 SmartRouter 当前配置与最近一次路由决策
 */
export async function handleRouterGetConfig(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    const core = getCoreAPI();
    const router = core.getSmartRouter();

    const config = router?.getConfig() || null;
    const lastDecision = core.getLastRouteDecision();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          enabled: config?.enabled ?? false,
          config,
          lastDecision,
          active: router !== null,
        },
      })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:config-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 更新 SmartRouter 配置（运行时动态切换 + 持久化到 GlobalConfig）
 */
export async function handleRouterUpdateConfig(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { config } = JSON.parse(body);
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
    const core = getCoreAPI();
    const router = core.getSmartRouter();

    if (!router) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: false, error: 'SmartRouter 未初始化' })
      );
      return;
    }

    // 更新运行时
    router.updateConfig(config);

    // 持久化到 GlobalConfig.models.router，使重启后配置不丢失
    const { configManager } = await import('@openliri/infra/config');
    configManager.saveGlobalConfig((globalCfg) => ({
      ...globalCfg,
      models: {
        ...globalCfg.models,
        router: { ...globalCfg.models?.router, ...config },
      },
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    broadcastEvent('router:updated', { config });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:config-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

// ========== 统一设置端点（从 LocalHTTPService.ts 迁移）==========

/**
 * 获取命名空间设置
 * GET /v1/settings/{namespace}
 */
export async function handleGetSettings(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  namespace: string
): Promise<void> {
  try {
    const { configManager } = await import('@openliri/infra/config');
    const settingsKey = `settings.${namespace}`;
    const value = configManager.getConfigValue(settingsKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ namespace, value: value ?? {} }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ namespace, value: {} }));
  }
}

/**
 * 设置命名空间配置
 * PUT /v1/settings/{namespace}
 */
export async function handleSetSettings(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  namespace: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const values = JSON.parse(body || '{}');
    const { configManager } = await import('@openliri/infra/config');
    const settingsKey = `settings.${namespace}`;
    configManager.setConfigValue(settingsKey, values);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, namespace, value: values }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

// ========== favicon / 数据目录设置（从 LocalHTTPService.ts 迁移）==========

/**
 * 处理 favicon 请求 — 返回 204 避免 404 控制台噪声
 */
export function handleFavicon(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  res.writeHead(204);
  res.end();
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
  fs: {
    existsSync(p: string): boolean;
    mkdirSync(p: string, opts?: { recursive?: boolean }): void;
    readdirSync(
      p: string,
      opts?: { withFileTypes?: boolean }
    ): Array<{ name: string; isDirectory(): boolean }>;
    copyFileSync(src: string, dest: string): void;
  },
  path: { join(...segments: string[]): string }
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
    if (entry.name === '.migrating' || entry.name === '.migration_committed') {
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
 * 回滚数据迁移：删除目标目录中的已复制内容
 * @param destDir 目标目录（将被清理）
 * @param fs fs 模块
 * @param path path 模块
 * @param oldDir 原数据目录（保留不动）
 */
function rollbackMigration(
  destDir: string,
  fs: {
    existsSync(p: string): boolean;
    readdirSync(
      p: string,
      opts?: { withFileTypes?: boolean }
    ): Array<{ name: string; isDirectory(): boolean }>;
    rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
    unlinkSync(p: string): void;
  },
  path: { join(...segments: string[]): string },
  _oldDir: string
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
        } catch (cleanErr) {
          // KB-CONFIG-CLEAN（2026-08-29）：清理个别条目失败静默 → 磁盘残留不可知
          logger.warn('配置迁移清理单个条目失败', {
            entryPath,
            error:
              cleanErr instanceof Error ? cleanErr.message : String(cleanErr),
          });
        }
      }
    }
  } catch (rollbackErr) {
    // KB-CONFIG-ROLLBACK（2026-08-29）：回滚清理失败静默 → 数据残留原目录不可知
    logger.warn('配置迁移回滚清理失败（数据保留在原目录）', {
      error:
        rollbackErr instanceof Error
          ? rollbackErr.message
          : String(rollbackErr),
    });
  }
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
      await import('@openliri/infra/environment');
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
      } catch (tokenErr) {
        // KB-CONFIG-TOKEN（2026-08-29）：迁移令牌写入失败静默 → 迁移中断后无法识别残留
        logger.warn('迁移令牌写入失败', {
          resolvedDir,
          error:
            tokenErr instanceof Error ? tokenErr.message : String(tokenErr),
        });
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
      } catch (commitErr) {
        // KB-CONFIG-COMMIT（2026-08-29）：完成标记写入失败静默 → 下次迁移可能重复执行
        logger.warn('迁移完成标记写入失败', {
          resolvedDir,
          error:
            commitErr instanceof Error ? commitErr.message : String(commitErr),
        });
      }
    }

    // 设置全局覆盖
    setUserDataDirOverride(resolvedDir);

    // 持久化：ConfigManager（新） + settings.json（向后兼容）
    const { configManager } = await import('@openliri/infra/config');
    configManager.setConfigValue('system.dataDirectory', resolvedDir);
    const { updateUserSettings } = await import('@openliri/infra/config');
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
    ctx.sendError(res, error);
  }
}

// ========== 项目存放位置（P2，2026-11-03）==========
//
// 与"数据目录"刻意分开：数据目录是配置/会话库/附件；项目存放位置是用户可见的
// 代码/产物目录（`<root>/<projectId>`）。语义与优先级见
// `packages/infra/src/environment/paths.ts#resolveDefaultProjectWorkspaceRoot`。

/** GET /v1/settings/projects-directory — 项目存放位置信息（生效值 / 已配置 / 默认 / env 覆盖） */
export async function handleGetProjectsDirectory(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const {
      resolveDefaultProjectWorkspaceRoot,
      getProjectWorkspaceEnvOverride,
    } = await import('@openliri/infra/environment');
    const { loadUserSettings, PROJECTS_DIRECTORY_SETTING_KEY } =
      await import('@openliri/infra/config');

    const configured = loadUserSettings()[PROJECTS_DIRECTORY_SETTING_KEY];
    const configuredDirectory =
      typeof configured === 'string' && configured.trim()
        ? configured.trim()
        : null;
    // 空 env ⇒ 纯默认值（忽略 LIRI_PROJECTS_DIR 覆盖），供页面显示"默认目录"
    const defaultDirectory = resolveDefaultProjectWorkspaceRoot({}, {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        currentDirectory:
          getProjectWorkspaceEnvOverride() ??
          configuredDirectory ??
          defaultDirectory,
        configuredDirectory,
        defaultDirectory,
        envProjectsDir: getProjectWorkspaceEnvOverride(),
      })
    );
  } catch (error) {
    await handleError(error, {
      module: 'http:config',
      action: 'get_projects_directory',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
}

/**
 * PUT /v1/settings/projects-directory — 保存项目存放位置。
 *
 * - `directory` 为空 / 缺省 ⇒ **恢复默认**（删除设置键，不删文件）；
 * - 否则必须可解析为绝对路径；已存在必须是目录；不存在则创建（并做一次写探针）；
 * - **只影响此后新建的项目**：存量 `project.json#sandboxPath` 是绝对路径，不会被改写
 *  （迁移用户已有项目是另一个动作，未在本接口里做）。
 */
export async function handleSetProjectsDirectory(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const payload = JSON.parse(body || '{}') as { directory?: unknown };
    const raw = payload?.directory;

    const {
      updateUserSettings,
      deleteUserSetting,
      PROJECTS_DIRECTORY_SETTING_KEY,
    } = await import('@openliri/infra/config');
    const { resolveDefaultProjectWorkspaceRoot } =
      await import('@openliri/infra/environment');
    const fs = await import('fs');
    const path = await import('path');

    const reset =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim().length === 0);
    if (reset) {
      deleteUserSetting(PROJECTS_DIRECTORY_SETTING_KEY);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          configuredDirectory: null,
          currentDirectory: resolveDefaultProjectWorkspaceRoot({}, {}),
          message: '已恢复默认项目存放位置',
        })
      );
      return;
    }

    if (typeof raw !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: '目录路径必须为字符串',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    const resolvedDir = path.resolve(raw.trim());
    if (fs.existsSync(resolvedDir) && !fs.statSync(resolvedDir).isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `路径已存在但不是目录: ${resolvedDir}（请换一个路径或先移走该文件）`,
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    try {
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true });
      }
      const probe = path.join(resolvedDir, '.liri_write_test');
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
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

    updateUserSettings({ [PROJECTS_DIRECTORY_SETTING_KEY]: resolvedDir });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        configuredDirectory: resolvedDir,
        currentDirectory: resolvedDir,
        message: '项目存放位置已更新（仅影响此后新建的项目）',
      })
    );
  } catch (error) {
    ctx.sendError(res, error);
  }
}
