/**
 * HTML 查看器服务
 *
 * 生成自包含的 HTML 查看器页面，嵌入 Trace 数据。
 * 支持超过 50 条记录时懒加载。
 *
 * 参考：claude-tap 的 viewer.py (Python 实现)
 */

import fs from 'fs';
import path from 'path';
import type { TraceRecord } from '../types';

/** 查看器元数据 */
interface ViewerMeta {
  model: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
  toolNames: string[];
  systemPrompt: string;
  durationMs: number;
}

/**
 * 查看器服务
 */
export class ViewerService {
  /**
   * 生成 HTML 查看器文件
   * @param records 录制记录列表
   * @param outputPath 输出路径
   * @returns 输出文件路径
   */
  generateHtml(records: TraceRecord[], outputPath: string): string {
    const recordsJson = JSON.stringify(records);
    const metadataList = records.map((r) => this.extractMetadata(r));
    const metadataJson = JSON.stringify(metadataList);

    // 懒加载阈值
    const lazyLoadThreshold = 50;
    const needsLazyLoad = records.length > lazyLoadThreshold;

    const html = this.buildHtml({
      recordsJson,
      metadataJson,
      totalCount: records.length,
      needsLazyLoad,
      generatedAt: new Date().toISOString(),
    });

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, html, 'utf-8');
    return outputPath;
  }

  /**
   * 生成 HTML 字符串（不写文件）
   * @param records 录制记录列表
   * @returns HTML 字符串
   */
  renderHtml(records: TraceRecord[]): string {
    const recordsJson = JSON.stringify(records);
    const metadataList = records.map((r) => this.extractMetadata(r));
    const metadataJson = JSON.stringify(metadataList);

    return this.buildHtml({
      recordsJson,
      metadataJson,
      totalCount: records.length,
      needsLazyLoad: records.length > 50,
      generatedAt: new Date().toISOString(),
    });
  }

  /**
   * 提取查看器元数据
   */
  private extractMetadata(
    record: TraceRecord
  ): ViewerMeta & { id: string; timestamp: string; status: number } {
    const reqBody = record.request.body;
    let model = 'unknown';
    let systemPrompt = '';

    if (reqBody && typeof reqBody === 'object' && !Array.isArray(reqBody)) {
      const b = reqBody as Record<string, unknown>;
      if (typeof b.model === 'string') {
        model = b.model;
      }
      // 提取 system prompt
      if (b.system && typeof b.system === 'string') {
        systemPrompt = b.system.slice(0, 200);
      } else if (Array.isArray(b.messages)) {
        const sysMsg = b.messages.find(
          (m: Record<string, unknown>) => m.role === 'system'
        );
        if (sysMsg && typeof sysMsg.content === 'string') {
          systemPrompt = sysMsg.content.slice(0, 200);
        }
      }
    }

    // 提取 token 用量
    let tokens: ViewerMeta['tokens'] = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreate: 0,
    };
    const respBody = record.response.body;
    if (respBody && typeof respBody === 'object') {
      const body = respBody as Record<string, unknown>;
      const usage = body.usage as Record<string, unknown> | undefined;
      if (usage) {
        tokens = {
          input:
            (usage.input_tokens as number) ||
            (usage.prompt_tokens as number) ||
            0,
          output:
            (usage.output_tokens as number) ||
            (usage.completion_tokens as number) ||
            0,
          cacheRead: (usage.cache_read_input_tokens as number) || 0,
          cacheCreate: (usage.cache_creation_input_tokens as number) || 0,
        };
      }
    }

    // 提取工具名称
    const toolNames = this.extractToolNames(record);

    return {
      id: record.id,
      timestamp: record.timestamp,
      model,
      tokens,
      toolNames,
      systemPrompt,
      durationMs: record.durationMs,
      status: record.response.status,
    };
  }

  /**
   * 提取工具名称列表
   */
  private extractToolNames(record: TraceRecord): string[] {
    const names = new Set<string>();

    // 从请求体中提取 tools
    const reqBody = record.request.body;
    if (reqBody && typeof reqBody === 'object') {
      const tools = (reqBody as Record<string, unknown>).tools;
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          if (tool && typeof tool === 'object') {
            const fn = (tool as Record<string, unknown>).function as
              | Record<string, unknown>
              | undefined;
            if (fn && typeof fn.name === 'string') {
              names.add(fn.name);
            } else if (
              typeof (tool as Record<string, unknown>).name === 'string'
            ) {
              names.add((tool as Record<string, unknown>).name as string);
            }
          }
        }
      }
    }

    // 从 SSE events 中提取 tool_use
    const sseEvents = record.response.sseEvents;
    if (sseEvents) {
      for (const ev of sseEvents) {
        if (ev.data && typeof ev.data === 'object') {
          const d = ev.data as Record<string, unknown>;
          if (ev.event === 'content_block_start' && d.content_block) {
            const block = d.content_block as Record<string, unknown>;
            if (block.type === 'tool_use' && typeof block.name === 'string') {
              names.add(block.name);
            }
          }
        }
      }
    }

    return Array.from(names);
  }

  /**
   * 构建 HTML
   */
  private buildHtml(params: {
    recordsJson: string;
    metadataJson: string;
    totalCount: number;
    needsLazyLoad: boolean;
    generatedAt: string;
  }): string {
    const {
      recordsJson,
      metadataJson,
      totalCount,
      needsLazyLoad,
      generatedAt,
    } = params;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Trace Viewer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
.header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 20px; font-weight: 600; }
.header .meta { font-size: 12px; color: #8b949e; }
.container { display: flex; height: calc(100vh - 60px); }
.sidebar { width: 360px; min-width: 360px; background: #161b22; border-right: 1px solid #30363d; overflow-y: auto; }
.sidebar .item { padding: 12px 16px; border-bottom: 1px solid #21262d; cursor: pointer; transition: background 0.15s; }
.sidebar .item:hover { background: #1c2128; }
.sidebar .item.active { background: #1f2937; border-left: 3px solid #58a6ff; }
.sidebar .item .model { font-weight: 600; font-size: 13px; color: #58a6ff; }
.sidebar .item .ts { font-size: 11px; color: #8b949e; margin-top: 2px; }
.sidebar .item .stat { font-size: 11px; color: #8b949e; margin-top: 4px; display: flex; gap: 12px; }
.sidebar .item .stat .badge { padding: 1px 8px; border-radius: 8px; font-size: 10px; }
.badge-ok { background: #1b3a2d; color: #3fb950; }
.badge-err { background: #3d1f1f; color: #f85149; }
.badge-slow { background: #3d2e00; color: #d29922; }
.main { flex: 1; overflow-y: auto; padding: 24px; }
.main h2 { font-size: 16px; margin-bottom: 16px; }
.detail-section { margin-bottom: 24px; }
.detail-section h3 { font-size: 13px; color: #8b949e; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.detail-section pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #8b949e; font-size: 14px; }
.filter-bar { padding: 12px 16px; border-bottom: 1px solid #30363d; }
.filter-bar input { width: 100%; padding: 6px 12px; border: 1px solid #30363d; border-radius: 6px; background: #0d1117; color: #c9d1d9; font-size: 13px; outline: none; }
.filter-bar input:focus { border-color: #58a6ff; }
.loading { text-align: center; padding: 24px; color: #8b949e; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>AI Trace Viewer</h1>
    <div class="meta">${totalCount} records | Generated ${generatedAt}</div>
  </div>
</div>
<div class="container">
  <div class="sidebar" id="sidebar">
    <div class="filter-bar">
      <input type="text" id="filter" placeholder="Filter by model, id..." oninput="applyFilter()">
    </div>
    <div id="sidebar-list">
      <div class="loading">Loading...</div>
    </div>
  </div>
  <div class="main" id="main">
    <div class="empty-state">Select a record to view details</div>
  </div>
</div>

<script>
const ALL_RECORDS = ${recordsJson};
const METADATA = ${metadataJson};
const LAZY_LIMIT = 50;
const needsLazy = ${needsLazyLoad};
let renderedCount = 0;
let selectedId = null;

function applyFilter() {
  const q = document.getElementById('filter').value.toLowerCase();
  const items = document.querySelectorAll('.sidebar .item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(q) ? '' : 'none';
  });
}

function renderSidebar() {
  const list = document.getElementById('sidebar-list');
  const limit = needsLazy ? Math.min(LAZY_LIMIT, ALL_RECORDS.length) : ALL_RECORDS.length;
  list.innerHTML = METADATA.slice(0, limit).map((m, i) => itemHtml(m, i)).join('');
  renderedCount = limit;

  if (needsLazy && renderedCount < ALL_RECORDS.length) {
    const loadMore = document.createElement('div');
    loadMore.className = 'loading';
    loadMore.id = 'load-more';
    loadMore.textContent = 'Load more...';
    loadMore.style.cursor = 'pointer';
    loadMore.onclick = () => loadMoreRecords();
    list.appendChild(loadMore);
  }
}

function loadMoreRecords() {
  const list = document.getElementById('sidebar-list');
  const next = Math.min(renderedCount + 50, ALL_RECORDS.length);
  for (let i = renderedCount; i < next; i++) {
    const div = document.createElement('div');
    div.innerHTML = itemHtml(METADATA[i], i);
    div.firstChild.addEventListener('click', () => selectRecord(i));
    list.insertBefore(div.firstChild, document.getElementById('load-more'));
  }
  renderedCount = next;
  if (renderedCount >= ALL_RECORDS.length) {
    const lm = document.getElementById('load-more');
    if (lm) lm.remove();
  }
}

function itemHtml(m, i) {
  const statusClass = m.status >= 400 ? 'badge-err' : m.durationMs > 30000 ? 'badge-slow' : 'badge-ok';
  const statusLabel = m.status >= 400 ? 'ERR' : m.durationMs > 30000 ? 'SLOW' : 'OK';
  return '<div class="item" onclick="selectRecord(' + i + ')">' +
    '<div class="model">' + esc(m.model) + '</div>' +
    '<div class="ts">' + m.timestamp + ' | ' + m.id + '</div>' +
    '<div class="stat">' +
      '<span class="badge ' + statusClass + '">' + statusLabel + '</span>' +
      '<span>' + m.durationMs + 'ms</span>' +
      '<span>in:' + m.tokens.input + '</span>' +
      '<span>out:' + m.tokens.output + '</span>' +
      (m.toolNames.length ? '<span>tools:' + m.toolNames.join(',') + '</span>' : '') +
    '</div>' +
  '</div>';
}

function selectRecord(idx) {
  selectedId = idx;
  document.querySelectorAll('.sidebar .item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.sidebar .item');
  if (items[idx]) items[idx].classList.add('active');
  showDetail(idx);
}

function showDetail(idx) {
  const r = ALL_RECORDS[idx];
  const m = METADATA[idx];
  const main = document.getElementById('main');

  let sseHtml = '';
  if (r.response.sseEvents && r.response.sseEvents.length) {
    sseHtml = '<div class="detail-section"><h3>SSE Events (' + r.response.sseEvents.length + ')</h3><pre>' +
      esc(JSON.stringify(r.response.sseEvents.slice(0, 20), null, 2)) +
      (r.response.sseEvents.length > 20 ? '\\n... and ' + (r.response.sseEvents.length - 20) + ' more' : '') +
    '</pre></div>';
  }

  main.innerHTML =
    '<h2>[#' + (idx + 1) + '] ' + esc(m.model) + ' - ' + m.durationMs + 'ms</h2>' +
    '<div class="detail-section"><h3>Request</h3><pre>' + esc(JSON.stringify(r.request, null, 2)) + '</pre></div>' +
    '<div class="detail-section"><h3>Response</h3><pre>' + esc(JSON.stringify(r.response.body || r.response, null, 2)) + '</pre></div>' +
    sseHtml +
    (r.error ? '<div class="detail-section"><h3>Error</h3><pre style="color:#f85149">' + esc(r.error) + '</pre></div>' : '');
}

function esc(s) {
  if (typeof s !== 'string') s = String(s || '');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

renderSidebar();
if (ALL_RECORDS.length > 0) selectRecord(0);
</script>
</body>
</html>`;
  }
}
