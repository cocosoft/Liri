/**
 * 渐进式文件路径链接组件 — MarkdownRenderer V1/V2 共享
 * MIT License
 *
 * 对标 cline InlineCodeWithFileCheck：
 * 1. 同步：如果 codeContent 匹配 knownFilePaths → 立即渲染 FileLink
 * 2. 异步：否则先渲染 code 样式，后台验证文件存在后升级为 FileLink
 * 3. 始终非阻塞，主线程零卡顿
 */
import { useState, useEffect } from "react";
import FileLink from "../FileLink";
import { getBackendBaseUrl } from "../../../services/backendUrl";
import { matchFilePath, pathResolveCache, pathResolvePending, setPathCache } from "./pathCache";

interface InlineCodeLinkProps {
  codeContent: string;
  knownFilePaths: string[] | undefined;
  onPreviewFile: ((path: string) => void) | undefined;
}

export function InlineCodeLink({
  codeContent,
  knownFilePaths,
  onPreviewFile,
}: InlineCodeLinkProps) {
  const [confirmedPath, setConfirmedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!knownFilePaths || knownFilePaths.length === 0) return;

    // 先在已知文件列表中做多级 fallback 匹配
    const matched = matchFilePath(codeContent, knownFilePaths);
    if (matched) {
      setConfirmedPath(matched);
      return;
    }

    // 支持中文等非 ASCII 字符的文件路径匹配
    // \p{L} = 任意 Unicode 字母（含中文），\p{N} = 任意 Unicode 数字
    const pathLike =
      /^(?:[A-Za-z]:)?[\\/]?(?:[\p{L}\p{N}\w\-.]+\\)*[\p{L}\p{N}\w\-.]+\.[a-zA-Z0-9]{1,10}$/u;
    if (pathLike.test(codeContent) && !checking) {
      // 先查缓存（含别名匹配），命中则直接使用
      const cached = pathResolveCache.get(codeContent);
      if (cached) {
        setConfirmedPath(cached.canonical);
        return;
      }
      // 检查是否已有相同路径的请求在进行中
      if (pathResolvePending.has(codeContent)) return;

      setChecking(true);
      pathResolvePending.add(codeContent);
      const baseUrl = getBackendBaseUrl();
      const encodedPath = encodeURIComponent(codeContent);
      fetch(`${baseUrl}/api/file/resolve-path?path=${encodedPath}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const resolved = data?.resolvedPath || null;
          if (resolved) {
            setPathCache(codeContent, resolved);
            setConfirmedPath(resolved);
          } else {
            pathResolveCache.set(codeContent, { canonical: '', aliases: new Set() });
          }
        })
        .catch(() => {
          pathResolveCache.set(codeContent, { canonical: '', aliases: new Set() });
        })
        .finally(() => {
          pathResolvePending.delete(codeContent);
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

  return <code>{codeContent}</code>;
}