/**
 * 通用常量
 * 基于CC源码 cc_code/backend/constants/common.ts 实现
 */

export const APP_NAME = 'PY_APP';
export const APP_NAME_LOWER = 'py_app';
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
export const ENV_PREFIX = 'PY_APP_';

export const CONFIG_FILE_NAME = 'config.json';
export const CONFIG_DIR_NAME = '.py_app';
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

export const TOKEN_ENCODING = 'cl100k_base';
export const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
export const DEFAULT_MAX_TOKENS = 4096;

export const USER_AGENT = 'PY_APP/1.0.0';

export const PROTOCOL_VERSION = '1.0';
export const API_VERSION = 'v1';

export const CLIENT_ID = 'py_app_client';
export const CLIENT_NAME = 'PY_APP';

export const FEATURE_FLAGS_PREFIX = 'PY_APP_FEATURE_';
export const EXPERIMENT_PREFIX = 'PY_APP_EXP_';
