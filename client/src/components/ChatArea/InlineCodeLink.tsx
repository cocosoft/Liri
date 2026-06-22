/**
 * 渐进式文件路径链接组件
 *
 * 对标 cline InlineCodeWithFileCheck：
 * 1. 同步：如果 codeContent 匹配 knownFilePaths → 立即渲染 FileLink
 * 2. 异步：否则先渲染 code 样式，后台验证文件存在后升级为 FileLink
 * 3. 始终非阻塞，主线程零卡顿
 */
import { useEffect, useState } from "react";
import FileLink from "./FileLink";
import { getBackendBaseUrl } from "../../services/backendUrl";

function InlineCodeLink({
  codeContent,
  knownFilePaths,
  onPreviewFile,
}: {
  codeContent: string;
  knownFilePaths: string[] | undefined;
  onPreviewFile: ((path: string) => void) | undefined;
}) {
  const [confirmedPath, setConfirmedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!knownFilePaths || knownFilePaths.length === 0) return;

    for (const fp of knownFilePaths) {
      if (fp === codeContent || fp.endsWith('/' + codeContent) || fp.endsWith('\\' + codeContent)) {
        setConfirmedPath(fp);
        return;
      }
    }

    const pathLike = /^(?:[A-Za-z]:)?[\\/]?(?:[\w\-.]+\\)*[\w\-.]+\.[a-zA-Z0-9]{1,10}$/;
    if (pathLike.test(codeContent) && !checking) {
      setChecking(true);
      const baseUrl = getBackendBaseUrl();
      const encodedPath = encodeURIComponent(codeContent);
      fetch(`${baseUrl}/api/file/resolve-path?path=${encodedPath}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.resolvedPath) {
            setConfirmedPath(data.resolvedPath);
          }
        })
        .catch(() => {});
    }
  }, [codeContent, knownFilePaths, checking]);

  if (confirmedPath) {
    return <FileLink filePath={confirmedPath} onPreview={onPreviewFile || (() => {})} />;
  }

  return <code>{codeContent}</code>;
}

export default InlineCodeLink;