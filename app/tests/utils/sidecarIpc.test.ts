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
 * ① P1 —— sidecar IPC **单一契约**单测（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P1）——
 * 契约（类型 + 版本 + 就绪握手 + 心跳）+ 分帧单一来源。
 */
import { describe, expect, it } from 'bun:test';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  SIDECAR_HEARTBEAT_TYPE,
  encodeFrame,
  decodeFrame,
  isCompatibleVersion,
  isStartupFrame,
  isHeartbeatFrame,
  buildHeartbeat,
} from '../../src/utils/sidecarIpc';
import { BRIDGE_PROTOCOL_VERSION } from '../../src/ai/python/JsonRpcBridge';

describe('P1 分帧（换行分隔 JSON）', () => {
  it('encodeFrame ⇒ 单行 JSON + 换行', () => {
    const line = encodeFrame({ id: 'r1', method: 'm' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n').length).toBe(1);
  });

  it('encode → decode 往返恒等（对象）', () => {
    const frame = { id: 'req_1', method: 'ping', params: { a: 1 } };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('decodeFrame：非 JSON / 数组 / 空串 ⇒ null（调试输出被忽略）', () => {
    expect(decodeFrame('not json')).toBeNull();
    expect(decodeFrame('[1,2]')).toBeNull();
    expect(decodeFrame('')).toBeNull();
    expect(decodeFrame('   ')).toBeNull();
    expect(decodeFrame('"str"')).toBeNull();
  });
});

describe('P1 版本协商（major 相等即兼容；未声明=legacy 兼容）', () => {
  it('未声明 / 非数字 ⇒ 兼容（不破坏既有 legacy worker）', () => {
    expect(isCompatibleVersion(undefined)).toBe(true);
    expect(isCompatibleVersion(null)).toBe(true);
    expect(isCompatibleVersion('1')).toBe(true);
    expect(isCompatibleVersion(Number.NaN)).toBe(true);
  });

  it('major 相等 ⇒ 兼容；major 不同 ⇒ 不兼容（fail-closed）', () => {
    expect(isCompatibleVersion(SIDECAR_IPC_PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleVersion(SIDECAR_IPC_PROTOCOL_VERSION + 0.9)).toBe(true);
    expect(isCompatibleVersion(SIDECAR_IPC_PROTOCOL_VERSION + 1)).toBe(false);
  });
});

describe('P1 帧判定与心跳', () => {
  it('isStartupFrame / isHeartbeatFrame', () => {
    expect(isStartupFrame({ type: SIDECAR_STARTUP_TYPE })).toBe(true);
    expect(isStartupFrame({ type: 'notify' })).toBe(false);
    expect(isHeartbeatFrame({ type: SIDECAR_HEARTBEAT_TYPE })).toBe(true);
    expect(isHeartbeatFrame({ type: 'startup' })).toBe(false);
  });

  it('buildHeartbeat ⇒ 带 type 与 at（可注入时钟）', () => {
    expect(buildHeartbeat(1234)).toEqual({ type: 'heartbeat', at: 1234 });
    const hb = buildHeartbeat();
    expect(hb.type).toBe('heartbeat');
    expect(typeof hb.at).toBe('number');
  });
});

describe('P1 单一事实源（契约 ↔ JsonRpcBridge 收敛）', () => {
  it('BRIDGE_PROTOCOL_VERSION 恒等于契约版本（同一来源）', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(SIDECAR_IPC_PROTOCOL_VERSION);
  });
});
