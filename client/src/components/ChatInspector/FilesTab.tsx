/**
 * 文件 Tab — 会话文件列表 + 文件预览
 *
 * 内部引用 FileListViewer 纯内容组件，不包含 FilePreviewPanel 的 Tab 栏。
 */

import React from "react";
import FileListViewer from "./FileListViewer";

function FilesTab() {
  return <FileListViewer />;
}

export default React.memo(FilesTab);
