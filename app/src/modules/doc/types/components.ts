/**
 * 文档预览卡片组件
 * 前端渲染用 —— 工具执行结果返回 MessageContent 后由本组件展示
 * 对应 messageType: 'document-preview'
 */

export interface DocumentPreviewProps {
  path: string;
  filename: string;
  preview: string;
  format: 'docx' | 'xlsx' | 'pptx';
  size: string;
  createdAt: string;
  actions: ('open' | 'download' | 'send-email' | 'share')[];
}

/**
 * 文档预览卡片 HTML 模板
 * 前端直接渲染此 HTML 到对话消息中
 */
export function renderDocumentPreview(data: DocumentPreviewProps): string {
  const formatIcon: Record<string, string> = {
    docx: '📄',
    xlsx: '📊',
    pptx: '📽️',
  };

  const actionButtons = data.actions
    .map((action) => {
      const labels: Record<string, string> = {
        open: '打开',
        download: '下载',
        'send-email': '发送邮件',
        share: '分享',
      };
      return `<button class="office-action" data-action="${action}" data-path="${data.path}">${labels[action] || action}</button>`;
    })
    .join('');

  return `
<div class="document-preview-card">
  <div class="doc-icon">${formatIcon[data.format] || '📁'}</div>
  <div class="doc-info">
    <div class="doc-filename">${data.filename}</div>
    <div class="doc-meta">${data.format.toUpperCase()} · ${data.size} · ${data.createdAt}</div>
    <div class="doc-preview">${data.preview}</div>
    <div class="doc-actions">${actionButtons}</div>
  </div>
</div>`;
}
