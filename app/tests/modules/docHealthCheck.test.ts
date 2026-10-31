// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `shouldReconnectOfficeCli` —— DocModule 健康检查的触发判据（2026-10-31，P1 功能缺口）。
 *
 * 缺陷：30s 健康检查 tick 原先**只打 debug**（`TODO: 检查 OfficeCLI MCP 连接状态`），
 * OfficeCLI 崩溃后模块仍自报 `FULL`，直到下一次真实调用才暴露。
 *
 * 口径：模块自认 `FULL` + 无在途重连 + 连接状态**不在**存活集合（`connected`/`connecting`，
 * 缺条目也算失效）⇒ 走既有 `handleOfficeCLICrash()`（3 次退避重连 → FULL / DEGRADED）。
 */
import { describe, expect, it } from 'bun:test';
import { shouldReconnectOfficeCli } from '../../src/modules/doc/DocModule';
import { DocModuleStatus } from '../../src/modules/doc/types';
import { MCPServerStatus } from '../../src/services/mcp/types';

const ALIVE = [MCPServerStatus.CONNECTED, MCPServerStatus.CONNECTING];

describe('shouldReconnectOfficeCli', () => {
  it('FULL + 连接已 error ⇒ 触发重连', () => {
    expect(
      shouldReconnectOfficeCli({
        moduleStatus: DocModuleStatus.FULL,
        connStatus: MCPServerStatus.ERROR,
        aliveStatuses: ALIVE,
        inFlight: false,
      })
    ).toBe(true);
  });

  it('FULL + 连接 disconnected / 条目缺失 ⇒ 触发重连', () => {
    for (const connStatus of [MCPServerStatus.DISCONNECTED, undefined]) {
      expect(
        shouldReconnectOfficeCli({
          moduleStatus: DocModuleStatus.FULL,
          connStatus,
          aliveStatuses: ALIVE,
          inFlight: false,
        })
      ).toBe(true);
    }
  });

  it('FULL + connected / connecting ⇒ 不打扰', () => {
    for (const connStatus of [
      MCPServerStatus.CONNECTED,
      MCPServerStatus.CONNECTING,
    ]) {
      expect(
        shouldReconnectOfficeCli({
          moduleStatus: DocModuleStatus.FULL,
          connStatus,
          aliveStatuses: ALIVE,
          inFlight: false,
        })
      ).toBe(false);
    }
  });

  it('非 FULL（DEGRADED/UNINITIALIZED）交给 refreshMCPStatus ⇒ 不在此重连', () => {
    for (const moduleStatus of [
      DocModuleStatus.DEGRADED,
      DocModuleStatus.UNINITIALIZED,
    ]) {
      expect(
        shouldReconnectOfficeCli({
          moduleStatus,
          connStatus: MCPServerStatus.ERROR,
          aliveStatuses: ALIVE,
          inFlight: false,
        })
      ).toBe(false);
    }
  });

  it('单飞：重连在途 ⇒ 跳过（防重连风暴）', () => {
    expect(
      shouldReconnectOfficeCli({
        moduleStatus: DocModuleStatus.FULL,
        connStatus: MCPServerStatus.ERROR,
        aliveStatuses: ALIVE,
        inFlight: true,
      })
    ).toBe(false);
  });
});
