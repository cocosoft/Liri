/**
 * 通用常量
 */

export const APP_NAME = 'Liri';
export const APP_NAME_LOWER = 'liri';
export const APP_VERSION = '1.0.0';

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
export const CONFIG_DIR_NAME = '.liri';
export const DATA_DIR_NAME = 'data';
export const CACHE_DIR_NAME = 'cache';
export const LOGS_DIR_NAME = 'logs';
export const TEMP_DIR_NAME = 'tmp';

export const DEFAULT_ENCODING = 'utf-8';
export const DEFAULT_LOCALE = 'en-US';
export const DEFAULT_TIMEZONE = 'UTC';

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
