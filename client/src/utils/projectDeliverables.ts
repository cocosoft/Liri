/**
 * 成果面板的合并口径（P2-1，2026-11-06）
 *
 * 面板有两类数据源：
 * ① 正式成果（`ProjectArtifactStore`，由 `write_project_file` 落盘时自动登记）；
 * ② 沙箱目录扫描（`GET /v1/projects/:id/files`，覆盖 `write` / `bash` 等通用写路径）。
 *
 * 旧实现是"artifacts 非空就不扫目录" ⇒ 混合产出（部分走 `write_project_file`、
 * 部分走 `bash`）时，未登记的那批文件在面板里直接消失。现口径改为**两者合并去重**：
 * 目录扫描结果里已被正式成果覆盖的路径不再重复展示。
 *
 * 纯函数、无 I/O，便于单测。
 */

/** 交付类扩展名（与后端 `WriteProjectFileTool` 自动登记口径一致） */
export const DELIVERABLE_EXTENSIONS = [
  ".docx",
  ".pptx",
  ".pdf",
  ".html",
  ".xlsx",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
];

/** 参与去重的最小成果形态（`ProjectArtifact` 的子集） */
export interface DeliverableArtifactLike {
  title: string;
  /** 自动登记时写入相对路径；手工成果可能是一段正文 */
  content: string;
}

/** 参与去重的最小文件形态（`ProjectFileEntry` 的子集） */
export interface DeliverableFileLike {
  name: string;
}

/** 路径归一：统一分隔符、去 `./` 前缀与首尾空白 */
function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** 是否交付类文件（跳过 `_` 临时文件与输入/过程目录） */
export function isDeliverableFile(name: string): boolean {
  const normalized = normalizePath(name);
  if (!normalized || basename(normalized).startsWith("_")) return false;
  // 只认 output/ 目录或根目录交付文件，排除输入/过程目录
  if (
    normalized.startsWith("00_input/") ||
    normalized.startsWith("01_work/") ||
    normalized.startsWith("02_") ||
    normalized.startsWith("03_")
  ) {
    return false;
  }
  const lower = normalized.toLowerCase();
  return DELIVERABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** `content` 是否像路径/文件名（剔除多行正文与超长文本） */
function looksLikePath(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\r\n]/.test(value);
}

/** 成果覆盖的路径集合：`content` 是路径按路径比，否则按 `title` 或文件名单比 */
function coveredPathsOf(artifacts: readonly DeliverableArtifactLike[]): {
  paths: Set<string>;
  basenames: Set<string>;
} {
  const paths = new Set<string>();
  const basenames = new Set<string>();
  for (const artifact of artifacts) {
    const content = normalizePath(artifact.content ?? "");
    if (content.includes("/")) {
      paths.add(content);
      continue;
    }
    // `content` 无目录分隔：可能是根目录文件名（自动登记）或正文（手工成果）
    if (looksLikePath(content)) basenames.add(content);
    else if (artifact.title) basenames.add(basename(artifact.title));
  }
  return { paths, basenames };
}

/**
 * 从目录扫描结果里挑出**尚未被正式成果覆盖**的交付类文件。
 *
 * 覆盖判据：完整相对路径相等，或在 `content` 无目录前缀时按文件名相等。
 */
export function selectUnregisteredDeliverables<F extends DeliverableFileLike>(
  artifacts: readonly DeliverableArtifactLike[],
  files: readonly F[],
): F[] {
  const { paths, basenames } = coveredPathsOf(artifacts);
  return files.filter((file) => {
    const name = normalizePath(file.name);
    if (!isDeliverableFile(name)) return false;
    if (paths.has(name)) return false;
    if (basenames.has(basename(name))) return false;
    return true;
  });
}
