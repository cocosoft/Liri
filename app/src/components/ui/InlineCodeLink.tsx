/**
 * InlineCodeLink 组件 — 渐进式文件路径链接
 *
 * 1. 同步：如果 codeContent 匹配 knownFilePaths → 立即渲染 FileLink
 * 2. 异步：否则检查是否像文件路径，后台验证文件存在后升级为 FileLink
 * 3. 始终非阻塞
 */
import { useEffect, useState } from 'react';
import React from 'react';
import { Text } from '../ink.js';
import FileLink from './FileLink.js';

interface InlineCodeLinkProps {
  codeContent: string;
  knownFilePaths?: string[];
  onPreviewFile?: (path: string) => void;
}

function InlineCodeLink({
  codeContent,
  knownFilePaths,
  onPreviewFile,
}: InlineCodeLinkProps): React.ReactNode {
  const [confirmedPath, setConfirmedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (knownFilePaths && knownFilePaths.length > 0) {
      for (const fp of knownFilePaths) {
        if (
          fp === codeContent ||
          fp.endsWith('/' + codeContent) ||
          fp.endsWith('\\' + codeContent)
        ) {
          setConfirmedPath(fp);
          return;
        }
      }
    }

    // 检查是否像文件路径（允许 Windows 和 Unix 风格）
    const pathLike =
      /^(?:[A-Za-z]:)?[\\/]?(?:[\w\-.]+[\\/])*[\w\-.]+\.[a-zA-Z0-9]{1,10}$/;
    if (pathLike.test(codeContent) && !checking) {
      setChecking(true);
      const encodedPath = encodeURIComponent(codeContent);
      fetch(`/api/file/resolve-path?path=${encodedPath}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.resolvedPath) {
            setConfirmedPath(data.resolvedPath);
          }
        })
        .catch(() => {
          // 静默失败，保持普通 code 样式
        });
    }
  }, [codeContent, knownFilePaths, checking]);

  if (confirmedPath) {
    return (
      <FileLink
        filePath={confirmedPath}
        onPreview={onPreviewFile || (() => {})}
      />
    );
  }

  return React.createElement(Text, { color: 'yellow' }, codeContent);
}

export default InlineCodeLink;
