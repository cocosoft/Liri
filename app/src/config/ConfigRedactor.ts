import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /^api[_-]?key$/i,
  /^apikey$/i,
  /^token$/i,
  /^password$/i,
  /^secret$/i,
  /^passwd$/i,
  /^private[_-]?key$/i,
  /^access[_-]?key/i,
  /^secret[_-]?key/i,
  /^auth[_-]?token/i,
  /^refresh[_-]?token/i,
  /^session[_-]?secret/i,
  /^oauth[_-]?secret/i,
  /^client[_-]?secret/i,
  /^db[_-]?password/i,
  /^redis[_-]?password/i,
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /^auth\./i,
  /^secrets?\./i,
  /^security\./i,
  /^credentials?\./i,
  /^database\.password$/i,
  /^redis\.password$/i,
  /^oauth\./i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(path));
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 0) {
    return '***';
  }
  if (typeof value === 'number') {
    return 0;
  }
  return value;
}

function redactRecursive(
  obj: Record<string, unknown>,
  currentPath: string = ''
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key;

    if (isSensitiveKey(key) || isSensitivePath(fullPath)) {
      result[key] = redactValue(obj[key]);
      logger.debug(`配置字段已脱敏: ${fullPath}`);
    } else if (
      obj[key] !== null &&
      typeof obj[key] === 'object' &&
      !Array.isArray(obj[key])
    ) {
      result[key] = redactRecursive(
        obj[key] as Record<string, unknown>,
        fullPath
      );
    } else if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as unknown[]).map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? redactRecursive(item as Record<string, unknown>, `${fullPath}[]`)
          : item
      );
    } else {
      result[key] = obj[key];
    }
  }

  return result;
}

export function redactConfig<T extends Record<string, unknown>>(config: T): T {
  return redactRecursive(config as Record<string, unknown>) as T;
}
