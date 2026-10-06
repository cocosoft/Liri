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
 * 启动前检查与首次引导（preflight）
 *
 * 由 `main.ts` 外迁（大文件拆分 batch；见 `.trae/specs/file-size-debt-partition-plan.md`）：
 * 收拢四簇 —— ① `.env` 自举 ② 关键依赖完整性校验 ③ SOUL/USER → ConfigManager 迁移
 * ④ 首次运行引导（首次标记 + 重试计数）。
 *
 * ⚠️ **只搬不改**：代码逐字搬迁，logger module 名保持 `main`（与宿主一致）⇒ 日志输出不变。
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  resolveProjectRoot,
  resolveDataDir,
  resolveOnboardedFlagPath,
} from '@modules/core';
import { configManager } from '../config/index.js';
import { setOfflineMode } from '../entrypoints/shared-state.js';
import { probeExternalModule } from '../utils/externalDeps.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('main');

/** 最大首次引导重试次数 */
const MAX_ONBOARD_RETRIES = 3;

/** 已知的占位 API 密钥值（用户未替换的真实密钥） */
const PLACEHOLDER_API_KEYS = new Set([
  'your_deepseek_api_key_here',
  'sk-your-api-key',
  'your-api-key',
  'your_api_key_here',
  '',
]);

/**
 * 获取首次运行标记文件路径
 * 委托给 paths.ts 的集中管理函数
 */
function getOnboardedFlagPath(): string {
  return resolveOnboardedFlagPath();
}

/**
 * 获取 .env 文件路径
 * 与 pyapp.ts 启动加载路径保持一致：app/.env
 */
function getEnvFilePath(): string {
  return join(resolveProjectRoot(), 'app', '.env');
}

/**
 * 获取 .env.example 文件路径
 * 位于 app/.env.example
 */
function getEnvExamplePath(): string {
  return join(resolveProjectRoot(), 'app', '.env.example');
}

/**
 * 获取引导重试计数文件路径
 */
function getOnboardRetryFlagPath(): string {
  return join(resolveDataDir(), '.onboard_retry');
}

/**
 * 获取数据目录路径
 */
function getDataDir(): string {
  return resolveDataDir();
}

/**
 * 校验 API 密钥是否有效（非占位符、非空）
 */
export function isValidApiKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 8) return false; // 最短密钥长度
  if (PLACEHOLDER_API_KEYS.has(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * 检查 AI 是否已配置
 */
async function isAIConfigured(): Promise<boolean> {
  try {
    // 数出同源：DB 是 API Key 的唯一事实来源，无数据时前端引导用户配置
    const { providerManager } =
      await import('../ai/providers/ProviderManager.js');
    const dbProviders = await providerManager.listProviders({ isActive: true });
    return dbProviders.some((p) => isValidApiKey(p.apiKey));
  } catch {
    return false;
  }
}

/**
 * 确保 .env 文件存在
 *
 * 在 HTTP 服务启动前调用，避免服务因缺少环境变量而失败。
 * 从 .env.example 模板自动创建，如果模板也不存在则静默跳过。
 */
export function ensureEnvFileExists(): void {
  const envFile = getEnvFilePath();
  const envExample = getEnvExamplePath();

  if (existsSync(envFile)) {
    return; // 已存在，无需创建
  }

  if (!existsSync(envExample)) {
    logger.warn('.env.example 模板文件不存在，无法自动创建 .env', {
      expectedPath: envExample,
    });
    return;
  }

  try {
    const exampleContent = readFileSync(envExample, 'utf-8');
    // 替换占位密钥为空，引导用户填写真实密钥
    const envContent = exampleContent.replace(
      /DEEPSEEK_API_KEY=.*/,
      '# 请将下方密钥替换为你的真实 DeepSeek API 密钥\n# 获取地址: https://platform.deepseek.com/api_keys\nDEEPSEEK_API_KEY='
    );
    writeFileSync(envFile, envContent, 'utf-8');
    logger.info('.env 文件已自动创建（来自 .env.example）', {
      envFile,
    });

    // 重新加载环境变量，使新创建的 .env 文件生效
    // 注意：这是增量加载，不覆盖已存在的环境变量（与 pyapp.ts 行为一致）
    try {
      const reloadedCount = reloadEnvFromFile(envFile);
      logger.info(`已从 .env 重新加载 ${reloadedCount} 个环境变量`);
    } catch (reloadErr) {
      logger.warn('重新加载 .env 失败（非致命）', {
        error: String(reloadErr),
      });
    }
  } catch (e) {
    logger.warn('自动创建 .env 文件失败', { error: String(e) });
  }
}

/**
 * 从指定 .env 文件重新加载环境变量
 * 仅设置尚未存在的变量（与 pyapp.ts 行为一致，不覆盖已有值）
 * @returns 成功加载的变量数量
 */
function reloadEnvFromFile(envPath: string): number {
  const content = readFileSync(envPath, 'utf-8');
  let count = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
      count++;
    }
  }
  return count;
}

/**
 * 启动时关键依赖完整性校验
 *
 * 扫描关键依赖（sharp, pdfjs-dist, sqlite3），缺失时给出明确指引。
 * 非阻塞：校验失败不阻止启动，但会输出清晰的修复指引到 stderr。
 *
 * @returns 校验结果，包含是否全部通过和问题列表
 */
export async function checkCriticalDependencies(): Promise<{
  ok: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // 1. 检查 .env 配置文件
  const envFile = getEnvFilePath();
  if (!existsSync(envFile)) {
    issues.push(
      `缺少 .env 配置文件: ${envFile}\n` +
        '  修复: 复制 app/.env.example 为 app/.env，并填写必填的 API 密钥。'
    );
  }

  // 2. 检查 bun:sqlite（数据库核心依赖）
  try {
    require.resolve('bun:sqlite');
  } catch {
    issues.push(
      '缺少 bun:sqlite 模块（数据库核心依赖）。请确保使用 Bun 运行时启动应用。'
    );
  }

  // 3. 检查 sharp（图片处理，原生 C++ 模块，ABI 敏感）
  // 使用文件级探测（exe 同级 node_modules）：compile 模式下 Bun 的
  // require.resolve/createRequire.resolve 基于打包模块图解析，external 包必然失败
  if (!probeExternalModule('sharp')) {
    issues.push(
      '缺少 sharp 模块（图片处理依赖）。请确保 node_modules/sharp 已正确安装。\n' +
        '  修复: 在应用目录执行 bun install，确保 sharp 的原生二进制与当前系统兼容。'
    );
  }

  // 4. 检查 pdfjs-dist（PDF 解析依赖）
  if (
    !probeExternalModule('pdfjs-dist/legacy/build/pdf') &&
    !probeExternalModule('pdfjs-dist')
  ) {
    issues.push(
      '缺少 pdfjs-dist 模块（PDF 解析依赖）。请确保 node_modules/pdfjs-dist 已正确安装。\n' +
        '  修复: 在应用目录执行 bun install。'
    );
  }

  if (issues.length > 0) {
    const header = '\n' + '='.repeat(60) + '\n';
    const footer = '='.repeat(60) + '\n';
    console.error(
      header +
        '  [启动检查] 发现以下关键依赖问题:\n' +
        issues.map((i, idx) => `  ${idx + 1}. ${i}`).join('\n') +
        '\n' +
        footer
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Phase 2.2: 将 SOUL.md / USER.md 从文件系统迁移到 ConfigManager
 *
 * 仅在 ConfigManager 中无数据且文件系统有旧文件时执行迁移。
 * 迁移后将内容写入 ConfigManager，旧文件保留不删除（向后兼容）。
 */
export async function migrateSoulAndUserToConfigManager(
  configMgr: typeof configManager
): Promise<void> {
  try {
    const { resolveSoulPath, resolveUserProfilePath } =
      await import('@modules/core');

    // 迁移 SOUL.md
    const soulConfig = configMgr.getConfigValue('settings.soul') as
      | { content?: string }
      | undefined;
    if (!soulConfig?.content) {
      const soulPath = resolveSoulPath();
      if (existsSync(soulPath)) {
        try {
          const content = readFileSync(soulPath, 'utf-8');
          if (content.trim()) {
            configMgr.setConfigValue('settings.soul', { content });
            logger.info('SOUL.md 已迁移到 ConfigManager');
          }
        } catch (err) {
          logger.warn('SOUL.md 迁移失败', { error: String(err) });
        }
      }
    }

    // 迁移 USER.md
    const userConfig = configMgr.getConfigValue('settings.user') as
      | { content?: string }
      | undefined;
    if (!userConfig?.content) {
      const userPath = resolveUserProfilePath();
      if (existsSync(userPath)) {
        try {
          const content = readFileSync(userPath, 'utf-8');
          if (content.trim()) {
            configMgr.setConfigValue('settings.user', { content });
            logger.info('USER.md 已迁移到 ConfigManager');
          }
        } catch (err) {
          logger.warn('USER.md 迁移失败', { error: String(err) });
        }
      }
    }
  } catch (err) {
    // 迁移非关键，失败不影响启动
    logger.warn('SOUL/USER 迁移到 ConfigManager 失败', {
      error: String(err),
    });
  }
}

/**
 * 检查是否为首次运行（无配置的初始化）
 *
 * 通过检查 app/data/.onboarded 标记文件来判断。
 * 若文件不存在，自动触发引导流程。
 */
export async function checkFirstRunAndOnboard(): Promise<void> {
  const onboardedFlag = getOnboardedFlagPath();
  const onboardRetryFlag = getOnboardRetryFlagPath();
  const dataDir = getDataDir();

  if (existsSync(onboardedFlag)) {
    // 已有标记文件，检查 AI 状态
    if (await isAIConfigured()) {
      setOfflineMode(false);
    }
    return;
  }

  // 首次运行：.env 文件已在 ensureEnvFileExists() 中提前创建
  // 此处仅执行用户引导流程

  // 检查重试次数
  let retryCount = 0;
  if (existsSync(onboardRetryFlag)) {
    try {
      retryCount = parseInt(readFileSync(onboardRetryFlag, 'utf-8').trim(), 10);
    } catch {
      retryCount = 0;
    }
  }

  console.log('');
  console.log('🎉 欢迎使用 Liri，准备配置向导...');
  console.log('');

  // 若 HTTP 服务已在运行，提示用户可通过浏览器完成初始化
  if (configManager.env('LIRI_HTTP_STARTED') === '1') {
    console.log('  💻 也可打开浏览器访问前端页面完成初始化配置。');
    console.log('');
  }

  if (retryCount >= MAX_ONBOARD_RETRIES) {
    console.log('  ⚠️ 引导已重试多次，跳过自动引导。');
    console.log('  您可以随时输入 /onboard 手动启动配置。');
    console.log('');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');
    if (existsSync(onboardRetryFlag)) {
      try {
        rmSync(onboardRetryFlag, { force: true });
      } catch (err) {
        handleError(err, { module: 'core:onboard', action: 'cleanRetryFlag' });
      } // @ignore-catch: 清理重试标志文件，失败不影响流程
    }
    return;
  }

  logger.info('检测到首次运行，启动初始化引导...');

  try {
    const { runOnboard } =
      await import('../commands/builtin/onboard/Onboard.js');

    const result = await runOnboard();

    if (result.length > 0) {
      logger.info(result.join('\n'));
    }

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');

    // 清除重试计数
    if (existsSync(onboardRetryFlag)) {
      try {
        rmSync(onboardRetryFlag, { force: true });
      } catch (err) {
        handleError(err, { module: 'core:onboard', action: 'cleanRetryFlag' });
      } // @ignore-catch: 清理重试标志文件，失败不影响流程
    }

    if (await isAIConfigured()) {
      setOfflineMode(false);
      console.log('  ✅ AI 已配置，准备就绪！');
    } else {
      console.log('  💡 提示: AI 密钥未配置，将进入离线模式。');
      console.log('  您可以稍后通过 /onboard 或 /config 命令配置。');
    }

    logger.info('初始化引导完成');
  } catch (error) {
    // 增加重试计数
    retryCount++;
    try {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(onboardRetryFlag, String(retryCount), 'utf-8');
    } catch (err) {
      handleError(err, { module: 'core:onboard', action: 'writeRetryFlag' });
    } // @ignore-catch: 重试计数写入失败不影响主流程

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warning('初始化引导失败，可使用 /onboard 命令手动启动', {
      error: errorMsg,
    });

    // 向控制台输出友好错误（用户能看到）
    console.log('  ⚠️ 自动引导遇到问题，跳过配置。');
    console.log('  您可以随时输入 /onboard 手动启动配置向导。');
    console.log('');
    console.log('  📖 快速开始:');
    console.log('  1. 获取 API 密钥: https://platform.deepseek.com/api_keys');
    console.log('  2. 输入 /onboard 启动配置向导');
    console.log('  3. 或输入 /help 查看可用命令');
    console.log('');

    // 创建标记文件防止每次启动都失败
    if (retryCount >= MAX_ONBOARD_RETRIES) {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');
    }
  }
}
