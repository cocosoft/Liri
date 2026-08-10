/**
 * OfficeCLI 错误解析器
 * 将 OfficeCLI stdout/stderr + exitCode 映射到结构化错误码
 */

import { AppError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:detection');

/** 错误解析规则 */
interface ErrorParseRule {
  pattern: RegExp;
  code: string;
  message: string;
}

/** 按优先级排序的规则列表（第一个匹配生效） */
const ERROR_RULES: ErrorParseRule[] = [
  {
    pattern: /not found|no such file|ENOENT/i,
    code: 'DOC_FILE_NOT_FOUND',
    message: '目标文件不存在',
  },
  {
    pattern: /unsupported|invalid format/i,
    code: 'DOC_UNSUPPORTED_FORMAT',
    message: '不支持的文件格式',
  },
  {
    pattern: /permission denied|access denied/i,
    code: 'DOC_FILE_PERMISSION_DENIED',
    message: '文件权限不足',
  },
  {
    pattern: /file already exists/i,
    code: 'DOC_FILE_EXISTS',
    message: '文件已存在',
  },
  {
    pattern: /out of memory|memory/i,
    code: 'DOC_RESOURCE_EXCEEDED',
    message: 'OfficeCLI 资源超限',
  },
];

/**
 * 将 OfficeCLI 的原生 stdout/stderr + exitCode 映射到结构化错误
 */
export function parseOfficeCLIError(
  stdout: string,
  stderr: string,
  exitCode: number
): AppError | null {
  if (exitCode === 0) return null;

  const combinedOutput = `${stderr}\n${stdout}`;

  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(combinedOutput)) {
      logger.debug('OfficeCLI 错误已映射', { code: rule.code, stderr });
      return new AppError(
        rule.message,
        'EXECUTION' as any,
        'MEDIUM' as any,
        rule.code,
        { rawStderr: stderr.substring(0, 500) }
      );
    }
  }

  // 兜底：无法映射的命令失败
  logger.debug('OfficeCLI 无法映射的错误', {
    stderr: stderr.substring(0, 200),
  });
  return new AppError(
    'OfficeCLI 命令执行失败',
    'EXECUTION' as any,
    'MEDIUM' as any,
    'DOC_COMMAND_FAILED',
    { rawStderr: stderr.substring(0, 500) }
  );
}
