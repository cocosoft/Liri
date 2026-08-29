/**
 * http-server.ts — 独立 HTTP 服务启动器
 *
 * 与 repl.ts 完全解耦，零项目模块静态依赖，避免循环依赖导致 TDZ。
 * 仅在需要时通过动态 import() 加载 LocalHTTPService。
 */

import type { LocalHTTPService } from '@modules/infrastructure';

/**
 * 启动 LocalHTTPService
 *
 * 通过纯动态 import 加载，不依赖任何项目模块的静态导入，
 * 避免与 CoreAPIImpl / ChatManager / configManager 等模块的循环依赖。
 */
export async function startHTTPServer(
  port: number,
  host: string = '127.0.0.1'
): Promise<LocalHTTPService> {
  // 使用相对路径动态导入，避免 @modules 别名在 Bun 动态 import 下的潜在问题
  const { LocalHTTPService: LocalHTTPServiceImpl } =
    await import('@modules/infrastructure');

  const service = new LocalHTTPServiceImpl({ host, port });
  await service.start();

  return service;
}

/**
 * 获取 LocalHTTPService 类型（用于类型推断，不触发模块加载）
 */
export type { LocalHTTPService };
