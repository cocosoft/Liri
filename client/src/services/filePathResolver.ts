import { getBackendBaseUrl } from "./backendUrl";

/**
 * 解析可能不完整的文件路径为完整路径
 * 调用后端 /api/file/resolve-path 完成解析（后端有文件系统访问权限）
 * 后端会尝试将相对路径、~ 起始路径等不完整路径拼接为完整绝对路径
 */
export async function resolveFilePath(rawPath: string): Promise<string> {
  const baseUrl = getBackendBaseUrl();
  const encodedPath = encodeURIComponent(rawPath);
  const res = await fetch(
    `${baseUrl}/api/file/resolve-path?path=${encodedPath}`,
  );
  if (res.ok) {
    const data = await res.json();
    // 检查后端返回的 exists 和 restricted 标志
    if (data.restricted || data.exists === false) {
      return rawPath; // 文件不在允许范围内或不存在，返回原始路径让后续 file-read 给出准确错误
    }
    return data.resolvedPath;
  }
  return rawPath;
}
