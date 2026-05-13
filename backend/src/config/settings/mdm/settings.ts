/**
 * MDM设置解析和管理
 * 基于CC源码 cc_code/backend/utils/settings/mdm/settings.ts
 * 读取企业级MDM配置并解析为设置对象
 */

import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { logger } from '@modules/utils/log.js';
import {
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js';
import {
  fireRawRead,
  getMdmRawReadPromise,
  type RawReadResult,
} from './rawRead.js';

/**
 * MDM读取结果
 */
export type MdmResult = {
  settings: Record<string, unknown>;
  errors: Array<{ source: string; message: string }>;
};

const EMPTY_RESULT: MdmResult = Object.freeze({ settings: {}, errors: [] });

let mdmCache: MdmResult | null = null;
let hkcuCache: MdmResult | null = null;
let mdmLoadPromise: Promise<void> | null = null;

/**
 * 启动MDM设置加载
 * 尽早调用以便子进程与模块加载并行运行
 */
export function startMdmSettingsLoad(): void {
  if (mdmLoadPromise) return;
  mdmLoadPromise = (async () => {
    const startTime = Date.now();

    const rawPromise = getMdmRawReadPromise() ?? fireRawRead();
    const { mdm, hkcu } = consumeRawReadResult(await rawPromise);
    mdmCache = mdm;
    hkcuCache = hkcu;

    const duration = Date.now() - startTime;
    logger.info(`MDM settings load completed in ${duration}ms`);

    if (Object.keys(mdm.settings).length > 0) {
      logger.info(
        `MDM settings found: ${Object.keys(mdm.settings).join(', ')}`
      );
    }
  })();
}

/**
 * 确保MDM设置已加载
 */
export async function ensureMdmSettingsLoaded(): Promise<void> {
  if (!mdmLoadPromise) {
    startMdmSettingsLoad();
  }
  await mdmLoadPromise;
}

/**
 * 获取管理员控制的MDM设置
 * macOS: /Library/Managed Preferences/ (需要root)
 * Windows: HKLM注册表 (需要管理员)
 */
export function getMdmSettings(): MdmResult {
  return mdmCache ?? EMPTY_RESULT;
}

/**
 * 获取HKCU注册表设置（用户可写，最低策略优先级）
 * 仅在Windows上有效
 */
export function getHkcuSettings(): MdmResult {
  return hkcuCache ?? EMPTY_RESULT;
}

/**
 * 清除MDM设置缓存
 */
export function clearMdmSettingsCache(): void {
  mdmCache = null;
  hkcuCache = null;
  mdmLoadPromise = null;
}

/**
 * 更新MDM设置缓存
 */
export function setMdmSettingsCache(mdm: MdmResult, hkcu: MdmResult): void {
  mdmCache = mdm;
  hkcuCache = hkcu;
}

/**
 * 刷新MDM设置
 */
export async function refreshMdmSettings(): Promise<{
  mdm: MdmResult;
  hkcu: MdmResult;
}> {
  const raw = await fireRawRead();
  return consumeRawReadResult(raw);
}

/**
 * 解析命令输出为设置对象
 */
export function parseCommandOutputAsSettings(
  stdout: string,
  sourcePath: string
): MdmResult {
  try {
    const data = JSON.parse(stdout);
    if (!data || typeof data !== 'object') {
      return { settings: {}, errors: [] };
    }
    return { settings: data, errors: [] };
  } catch (error) {
    return {
      settings: {},
      errors: [{ source: sourcePath, message: `JSON parse error: ${error}` }],
    };
  }
}

/**
 * 解析reg query输出提取注册表字符串值
 */
export function parseRegQueryStdout(
  stdout: string,
  valueName = 'Settings'
): string | null {
  const lines = stdout.split(/\r?\n/);
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s+${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'i');
  for (const line of lines) {
    const match = line.match(re);
    if (match && match[1]) {
      return match[1].trimEnd();
    }
  }
  return null;
}

/**
 * 将原始子进程输出转换为解析后的MDM和HKCU结果
 * 应用"第一源优先"策略
 */
function consumeRawReadResult(raw: RawReadResult): {
  mdm: MdmResult;
  hkcu: MdmResult;
} {
  if (raw.plistStdouts && raw.plistStdouts.length > 0) {
    const { stdout, label } = raw.plistStdouts[0]!;
    const result = parseCommandOutputAsSettings(stdout, label);
    if (Object.keys(result.settings).length > 0) {
      return { mdm: result, hkcu: EMPTY_RESULT };
    }
  }

  if (raw.hklmStdout) {
    const jsonString = parseRegQueryStdout(raw.hklmStdout);
    if (jsonString) {
      const result = parseCommandOutputAsSettings(
        jsonString,
        `Registry: ${WINDOWS_REGISTRY_KEY_PATH_HKLM}\\${WINDOWS_REGISTRY_VALUE_NAME}`
      );
      if (Object.keys(result.settings).length > 0) {
        return { mdm: result, hkcu: EMPTY_RESULT };
      }
    }
  }

  if (hasManagedSettingsFile()) {
    return { mdm: EMPTY_RESULT, hkcu: EMPTY_RESULT };
  }

  if (raw.hkcuStdout) {
    const jsonString = parseRegQueryStdout(raw.hkcuStdout);
    if (jsonString) {
      const result = parseCommandOutputAsSettings(
        jsonString,
        `Registry: ${WINDOWS_REGISTRY_KEY_PATH_HKCU}\\${WINDOWS_REGISTRY_VALUE_NAME}`
      );
      return { mdm: EMPTY_RESULT, hkcu: result };
    }
  }

  return { mdm: EMPTY_RESULT, hkcu: EMPTY_RESULT };
}

/**
 * 检查是否存在文件型托管设置
 */
function hasManagedSettingsFile(): boolean {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const managedDir = join(homeDir, '.py_app');

  try {
    const filePath = join(managedDir, 'managed-settings.json');
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return true;
      }
    }
  } catch {
    // fall through
  }

  try {
    const dropInDir = join(managedDir, 'managed-settings.d');
    if (!existsSync(dropInDir)) return false;

    const entries = readdirSync(dropInDir);
    for (const name of entries) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      try {
        const content = readFileSync(join(dropInDir, name), 'utf-8');
        const data = JSON.parse(content);
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          return true;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // drop-in dir doesn't exist
  }

  return false;
}
