/**
 * 通用常量
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const APP_NAME = 'Liri';
export const APP_NAME_LOWER = 'liri';

/**
 * 版本号唯一事实来源：app/package.json
 * 模块加载时直接解析，不依赖启动 env 注入时序（.env 中已删除 APP_VERSION 假值）
 */
function resolveAppVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // app/src/constants
    const pkgPath = join(here, '..', '..', 'package.json'); // app/package.json
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    }
  } catch {
    // 解析失败回退 env / 默认值
  }
  return process.env.APP_VERSION || '0.0.0';
}

export const APP_VERSION = resolveAppVersion();

export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;
export const MAX_CONCURRENT_TASKS = 10;
export const MAX_RETRY_COUNT = 3;
export const DEFAULT_RETRY_DELAY = 1000;
export const HEARTBEAT_INTERVAL = 30 * 1000;
export const CONNECTION_TIMEOUT = 10 * 1000;
export const REQUEST_TIMEOUT = 60 * 1000;
export const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_CACHE_SIZE = 100 * 1024 * 1024;
export const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = 'localhost';
export const ENV_PREFIX = 'LIRI_';

export const CONFIG_FILE_NAME = 'config.json';
export const DATA_DIR_NAME = 'data';
export const CACHE_DIR_NAME = 'cache';
export const LOGS_DIR_NAME = 'logs';
export const TEMP_DIR_NAME = 'tmp';

export const DEFAULT_ENCODING = 'utf-8';
/**
 * 产品默认语言 / 时区（**唯一真源**）。
 *
 * 口径（`dev_docs/20261013/硬编码统一治理方案-20261013.md` §11 `Q-H2`，2026-10-13 裁定）：
 * 统一为 **`zh-CN` / `Asia/Shanghai`** —— 依据：① 仓内渠道以国内为主（企微/钉钉/飞书/微信/QQ/元宝）；
 * ② 前端 i18n 回退即 `zh`（`client/src/i18n/index.ts:33`）；③ 语音链路默认 `zh-CN`
 * （`services/voice/services/ttsConfigOverlay.ts`、`voice/WakeWordEngine.ts`）。
 *
 * ⚠️ **历史漂移已消除**：本常量原为 `en-US`/`UTC`，与 i18n/语音链路的 `zh-CN` **口径相反**
 * 且**零消费者**（grep 仅命中定义处）——本轮改值并**接上消费者**（真源必须被引用，否则是"假真源"）。
 * ⚠️ **`core` 层不得引用本文件**（`constants` = infra，而 `core` 仅可依赖 `core`，R00-001）⇒
 * 需要同值的 core 侧常量只能"**同值自持 + 由测试锁同值**"（不跨层引用）。
 */
export const DEFAULT_LOCALE = 'zh-CN';
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PATH_LENGTH = 4096;
export const MAX_FILENAME_LENGTH = 255;

export const TOKEN_ENCODING = 'o200k_base'; // P1-13: upgraded from cl100k_base
export const DEFAULT_MODEL = '';

/**
 * 哨兵值：表示"未选择具体模型，由 SmartRouter 自动决策"。
 * 前端传此值时，后端 resolveSmartModel() 通过 SmartRouter 动态选择模型。
 * 客户端同步定义在 client/src/services/chatService.ts，Rust 侧同步定义在 client/src-tauri/src/commands/chat.rs。
 */
export const DEFAULT_MODEL_SENTINEL = 'pyapp-default';

export const DEFAULT_MAX_TOKENS = 4096;

export const USER_AGENT = 'Liri/1.0.0';

export const PROTOCOL_VERSION = '1.0';
export const API_VERSION = 'v1';

export const CLIENT_ID = 'liri_client';
export const CLIENT_NAME = 'Liri';

export const FEATURE_FLAGS_PREFIX = 'LIRI_FEATURE_';
export const EXPERIMENT_PREFIX = 'LIRI_EXP_';
