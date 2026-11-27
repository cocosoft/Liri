// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F1（2026-11-22）：MCP 工具的只读声明必须来自服务端 `annotations.readOnlyHint`。
 *
 * 背景（二次复查）：`McpToolWrapper.isReadOnly()` 原实现**恒 true** ⇒
 * `deriveToolRiskClass` 第 5 步把每个 MCP 工具判为 `read` ⇒ 默认档
 * `READ ⇒ allow`，远端删文件 / 发消息等调用**静默执行、无审批**。
 * 现口径：只有 `annotations.readOnlyHint === true` 才认只读；缺省按未声明
 * 处理（`undeclared` ⇒ 人工审批）。
 *
 * §13.4 ①（2026-11-27）：`isReadOnly` 自报**不再**是风险声明 —— MCP 的 `read` 来自
 * `getRiskClass()` 里对显式 `readOnlyHint` 的**声明**；`deriveToolRiskClass`（无
 * `TOOL_EFFECTS` 条目）对 MCP 一律 `undeclared`。只有自报、没有任何声明的工具也一律
 * `undeclared`（见末尾用例）。
 */

import { describe, expect, it } from 'bun:test';

import { McpToolWrapper } from '@openliri/service/services/mcp/McpToolWrapper';
import { fetchToolsForClient } from '@openliri/service/services/mcp/client';
import {
  RiskClass,
  resolveRiskClass,
} from '@openliri/infra/permission/types/RiskClass';

import { deriveToolRiskClass } from '../../../src/tools/toolRiskClass.js';

const noClient = () => undefined;

function wrapper(annotations?: {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}): McpToolWrapper {
  return new McpToolWrapper(
    'srv',
    {
      name: 'delete_file',
      description: '',
      ...(annotations ? { annotations } : {}),
    },
    noClient
  );
}

describe('F1：MCP 只读声明', () => {
  it('未声明 annotations ⇒ 未声明风险，不再自动放行', () => {
    const tool = wrapper();
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(false);
    expect(deriveToolRiskClass(tool, {})).toBe('undeclared');
    expect(tool.getRiskClass()).toBe('undeclared');
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.UNDECLARED);
  });

  it('readOnlyHint=false ⇒ 仍按未声明处理', () => {
    const tool = wrapper({ readOnlyHint: false });
    expect(tool.isReadOnly()).toBe(false);
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.UNDECLARED);
  });

  it('readOnlyHint=true ⇒ getRiskClass 显式声明 read（可自动放行）', () => {
    const tool = wrapper({ readOnlyHint: true });
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
    // §13.4 ①：结构化派生（无 TOOL_EFFECTS 条目）不再因自报判 read；
    // 免问只能来自包装器的**显式声明**
    expect(deriveToolRiskClass(tool, {})).toBe('undeclared');
    expect(tool.getRiskClass()).toBe('read');
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.READ);
  });

  it('§13.4 ①：只有 isReadOnly 自报、没有任何风险声明的工具 ⇒ undeclared', () => {
    const selfReportedOnly = {
      name: 'third_party_tool',
      isReadOnly: () => true,
    };
    expect(deriveToolRiskClass(selfReportedOnly, {})).toBe('undeclared');
    expect(resolveRiskClass(selfReportedOnly, {})).toBe(RiskClass.UNDECLARED);
  });

  it('destructiveHint 缺省视为破坏性，仅显式 false 才否', () => {
    expect(wrapper().isDestructive()).toBe(true);
    expect(wrapper({ destructiveHint: false }).isDestructive()).toBe(false);
    expect(wrapper({ readOnlyHint: true }).isDestructive()).toBe(false);
  });

  it('序列化链路透传 annotations', async () => {
    const client = {
      listTools: async () => ({
        tools: [
          {
            name: 'query',
            description: 'read only tool',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          },
        ],
      }),
    };
    const tools = await fetchToolsForClient(client as never);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
  });
});
