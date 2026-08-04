//
/**
 * HTTP类型Hook执行器
 * 负责执行HTTP类型的Hook
 */

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';
import { request } from 'https';
import { URL } from 'url';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = new Logger({
  module: 'hooks:executors:HttpHookExecutor',
  level: LogLevel.INFO,
});

/**
 * HTTP Hook执行器
 */
export class HttpHookExecutor {
  /**
   * 执行HTTP类型Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns 执行结果
   */
  public async execute(
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): Promise<HookExecutionResult> {
    const config = hook.config as Record<string, unknown>;
    const httpConfig = config.http as
      | {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: unknown;
        }
      | undefined;

    if (!httpConfig?.url) {
      return {
        success: false,
        error: 'HTTP url is required for HTTP type hook',
      };
    }

    try {
      const { url, method = 'POST', headers = {}, body } = httpConfig;

      // 构建请求选项
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      // 准备请求体
      const requestBody = body || context.data;
      const bodyString = JSON.stringify(requestBody);
      (options.headers as Record<string, string>)['Content-Length'] =
        Buffer.byteLength(bodyString).toString();

      // 发送请求
      const response = await this.sendRequest(options, bodyString);

      return {
        success: true,
        output: response,
        hookSpecificOutput: {
          response,
        },
      };
    } catch (error) {
      void handleError(error, { module: 'hooks:http', action: 'execute' });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 发送HTTP请求
   * @param options 请求选项
   * @param body 请求体
   * @returns 响应内容
   */
  private sendRequest(
    options: Record<string, unknown>,
    body: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request(
        options as unknown as Parameters<typeof request>[0],
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve(data);
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });
  }
}
