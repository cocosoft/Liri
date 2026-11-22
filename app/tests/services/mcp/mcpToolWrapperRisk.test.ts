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
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.UNDECLARED);
  });

  it('readOnlyHint=false ⇒ 仍按未声明处理', () => {
    const tool = wrapper({ readOnlyHint: false });
    expect(tool.isReadOnly()).toBe(false);
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.UNDECLARED);
  });

  it('readOnlyHint=true ⇒ read（可自动放行）', () => {
    const tool = wrapper({ readOnlyHint: true });
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
    expect(deriveToolRiskClass(tool, {})).toBe('read');
    expect(resolveRiskClass(tool, {})).toBe(RiskClass.READ);
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
