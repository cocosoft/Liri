// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F10（2026-11-22）：写同一资源的工具不得标记为并发安全。
 *
 * 背景（二次复查）：`media_delete` / `media_delete_batch` / `knowledge_save` /
 * `mcp_tool` 原返回 `isConcurrencySafe=true` ⇒ 并行删同一媒体、并行 upsert 同一知识
 * 条目、并发调用未知远端操作会竞争/覆盖。
 */

import { describe, expect, it } from 'bun:test';

import {
  createMediaDeleteTool,
  createMediaDeleteBatchTool,
} from '@openliri/tool-media';
import { MCPTool } from '@openliri/service/mcp/MCPTool';

import { KnowledgeSaveTool } from '@openliri/tool-agent/KnowledgeSaveTool/KnowledgeSaveTool';

describe('F10：写同资源工具串行执行', () => {
  it('media_delete 不可并发', () => {
    expect(createMediaDeleteTool().isConcurrencySafe()).toBe(false);
  });

  it('media_delete_batch 不可并发', () => {
    expect(createMediaDeleteBatchTool().isConcurrencySafe()).toBe(false);
  });

  it('knowledge_save 不可并发', () => {
    expect(new KnowledgeSaveTool().isConcurrencySafe()).toBe(false);
  });

  it('mcp_tool 不可并发（远端语义未知）', () => {
    expect(MCPTool.isConcurrencySafe()).toBe(false);
  });
});
