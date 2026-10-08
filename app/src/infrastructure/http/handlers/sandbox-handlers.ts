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
 * sandbox-handlers.ts — 沙箱配置与状态 HTTP handler（S1）
 *
 * 暴露：
 * - GET /v1/sandbox/config    沙箱配置（enabled + permissionLevel）
 * - PUT /v1/sandbox/config    更新沙箱配置（持久化 + 运行时同步）
 * - GET /v1/sandbox/status    沙箱运行时状态（约束/进程/资源/违规）
 *
 * 配置持久化于 config.json（sandbox.enabled / sandbox.permissionLevel）。
 * 权限级别运行时消费点：WorkspaceManager.getDefaultPermissions()（新沙箱工作空间授权）。
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { configManager } from '@modules/config';
// 2026-10-01 D-200（子批 C）：原**静态**导入 `@modules/sandbox`（app 层）4 个值符号
// （`SandboxManager` · `processRegistry` · `resourceLimitManager` · `globalWorkspaceManager`）
// ⇒ `infrastructure -> app` 倒挂。改经 **core SPI 端口** `ISandboxPort.getRuntimeStatus()`
// （服务层 → core 为下行，合法）；端口按 CS01 复用既有端口，不另立。
import { resolveSandbox } from '@modules/core/spi';
import { securityIntegrationService } from '@modules/security';

/** 沙箱权限级别（与 PERMISSION_SANDBOX_DEFAULT 取值一致） */
export type SandboxPermissionLevel = 'full' | 'standard' | 'readonly';

const VALID_PERMISSION_LEVELS: SandboxPermissionLevel[] = [
  'full',
  'standard',
  'readonly',
];

/** 读取当前生效的权限级别：配置优先，环境变量回退，默认 full */
function readPermissionLevel(): SandboxPermissionLevel {
  const configured = configManager.getValue<string>('sandbox.permissionLevel');
  const policy = (
    configured ?? configManager.env('PERMISSION_SANDBOX_DEFAULT', 'full')
  )?.toLowerCase();
  return (VALID_PERMISSION_LEVELS as string[]).includes(policy ?? '')
    ? (policy as SandboxPermissionLevel)
    : 'full';
}

/** 读取当前沙箱启用配置（默认启用，与 SANDBOX feature 默认一致） */
function readEnabled(): boolean {
  const configured = configManager.getValue<boolean>('sandbox.enabled');
  return configured ?? true;
}

/** 获取沙箱配置 GET /v1/sandbox/config */
export async function handleGetSandboxConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        enabled: readEnabled(),
        permissionLevel: readPermissionLevel(),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/** 更新沙箱配置 PUT /v1/sandbox/config */
export async function handleUpdateSandboxConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = JSON.parse((await readRequestBody(req)) || '{}') as {
      enabled?: boolean;
      permissionLevel?: string;
    };

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'enabled 必须是布尔值' } }));
      return;
    }
    if (
      body.permissionLevel !== undefined &&
      !(VALID_PERMISSION_LEVELS as string[]).includes(body.permissionLevel)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `permissionLevel 必须是 ${VALID_PERMISSION_LEVELS.join('/')}`,
          },
        })
      );
      return;
    }

    if (body.enabled !== undefined) {
      configManager.setValue('sandbox.enabled', body.enabled);
      // 同步运行时状态（SecurityIntegration 单例）
      securityIntegrationService.setSandboxEnabled(body.enabled);
    }
    if (body.permissionLevel !== undefined) {
      configManager.setValue('sandbox.permissionLevel', body.permissionLevel);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        enabled: readEnabled(),
        permissionLevel: readPermissionLevel(),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/** 获取沙箱运行时状态 GET /v1/sandbox/status */
export async function handleGetSandboxStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // D-200：原分别直连 SandboxManager / processRegistry / resourceLimitManager /
    // globalWorkspaceManager ⇒ 改经 core SPI 端口的**最小投影**快照（子字段原样进 JSON）。
    // 2026-10-08（P1-续 S1/S7）：后三者（恒空）已删，现只余 `SandboxManager` 投影。
    const status = resolveSandbox().getRuntimeStatus();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        enabled: readEnabled(),
        permissionLevel: readPermissionLevel(),
        runtimeEnabled: status.runtimeEnabled,
        settings: status.settings,
        constraints: status.constraints,
        violationCount: status.violationCount,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}
