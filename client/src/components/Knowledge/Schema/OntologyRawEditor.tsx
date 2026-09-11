import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { schemaService, type OntologyDraft } from "../../../services/schemaService";
import type {
  OntologyDiffResult,
  OntologyFileDiff,
  OntologySchemaFile,
  OntologySchemaInfo,
  OntologyValidationResult,
} from "../../../types/project";
import { OntologyIssueList } from "./OntologyIssueList";

/**
 * 本体「原始 YAML 模式」编辑器（D1 = C 的另一半，B2b）
 *
 * 定位：表单模式覆盖不了的内容（自定义键、注释、任意结构）在这里手改；
 * 两条路径**共用**同一份服务端校验器与同一个写入接口（`PUT /schema/{file}`），
 * 差异只在于提交的是 `{ content }`（原始文本）还是 `{ model }`（结构化模型）。
 *
 * diff 由服务端 `POST /schema/diff` 生成（复用 `computeUnifiedDiff`），本组件只渲染。
 * 已知限制：保存经 js-yaml 原样写入，用户手写的注释会**保留**（原始模式不做 dump）。
 */

const FILES: OntologySchemaFile[] = [
  "entities.yaml",
  "edges.yaml",
  "xref.yaml",
];

/** 文件 → `info.files` 中的存在性字段（避免三元链） */
const FILE_KEY: Record<OntologySchemaFile, "entities" | "edges" | "xref"> = {
  "entities.yaml": "entities",
  "edges.yaml": "edges",
  "xref.yaml": "xref",
};

/** 文件不存在时的占位示例（仅 placeholder，不会写入） */
const PLACEHOLDER: Record<OntologySchemaFile, string> = {
  "entities.yaml": "entities:\n  - kind: note\n    displayName: 笔记\n",
  "edges.yaml":
    "edges:\n  - type: mentions\n    displayName: 提及\n    endpoints: { from: note, to: person }\n    direction: directed\n",
  "xref.yaml":
    "xref:\n  - from: mentions\n    to: created_by\n    auto: true\n    bidirectional: true\n",
};

interface OntologyRawEditorProps {
  info: OntologySchemaInfo;
  isDark: boolean;
  /** 保存成功后通知父组件重新拉取（磁盘是唯一事实来源） */
  onSaved: () => void;
}

export function OntologyRawEditor({
  info,
  isDark,
  onSaved,
}: OntologyRawEditorProps) {
  const [activeFile, setActiveFile] =
    useState<OntologySchemaFile>("entities.yaml");
  const [drafts, setDrafts] = useState<Record<OntologySchemaFile, string>>(
    () => readDrafts(info),
  );
  const [busy, setBusy] = useState<"none" | "validate" | "diff" | "save">(
    "none",
  );
  const [result, setResult] = useState<OntologyValidationResult | null>(null);
  const [diffs, setDiffs] = useState<OntologyDiffResult["diffs"] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 磁盘重新加载后（保存完成 / 切换 Tab）以磁盘为准重置草稿
  useEffect(() => {
    setDrafts(readDrafts(info));
    setDiffs(null);
  }, [info]);

  const isDirty = useCallback(
    (file: OntologySchemaFile) => drafts[file] !== (info.raw[file] ?? ""),
    [drafts, info],
  );
  const changedFiles = useMemo(
    () => FILES.filter((file) => isDirty(file)),
    [isDirty],
  );

  /** 按文件名收集待提交草稿（显式构造，确保类型收敛到 Partial<Record<...>>） */
  const draftPayload = useCallback(
    (files: OntologySchemaFile[]): OntologyDraft["files"] => {
      const out: Partial<Record<OntologySchemaFile, string>> = {};
      for (const file of files) {
        out[file] = drafts[file];
      }
      return out;
    },
    [drafts],
  );

  const cardClass = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const textareaClass = `w-full h-80 font-mono text-xs leading-relaxed p-3 border rounded-md resize-y ${
    isDark
      ? "bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-500"
      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
  }`;
  const secondaryButton = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
    isDark
      ? "border-gray-600 text-gray-300 hover:bg-gray-700"
      : "border-gray-300 text-gray-700 hover:bg-gray-100"
  }`;

  const validateCurrent = async () => {
    setBusy("validate");
    setError("");
    setMessage("");
    try {
      const checked = await schemaService.validate(
        { files: draftPayload([activeFile]) },
        // O17：带上当前域（域优先、域未声明本体时回落全局）
        info.domain ?? undefined,
      );
      setResult(checked);
      if (!checked.ok) setError("校验未通过：请先修正下列问题");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? `校验失败：${err.message}` : "校验失败");
    } finally {
      setBusy("none");
    }
  };

  const previewDiff = async () => {
    setBusy("diff");
    setError("");
    setMessage("");
    try {
      const targets = changedFiles.length > 0 ? changedFiles : FILES;
      const preview = await schemaService.diff(
        { files: draftPayload(targets) },
        info.domain ?? undefined,
      );
      setDiffs(preview.diffs);
    } catch (err) {
      setDiffs(null);
      setError(
        err instanceof Error ? `预览变更失败：${err.message}` : "预览变更失败",
      );
    } finally {
      setBusy("none");
    }
  };

  const writtenFiles: string[] = [];

  const save = async () => {
    if (changedFiles.length === 0) {
      setMessage("没有改动需要保存");
      return;
    }
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const checked = await schemaService.validate(
        { files: draftPayload(changedFiles) },
        info.domain ?? undefined,
      );
      setResult(checked);
      if (!checked.ok) {
        setError("校验未通过，未写入任何文件");
        return;
      }
      for (const file of changedFiles) {
        const written = await schemaService.putFile(
          file,
          { content: drafts[file] },
          info.domain ?? undefined,
        );
        writtenFiles.push(written.backup ? `${file}（旧版本已备份）` : file);
      }
      setMessage(
        `已保存 ${writtenFiles.join("、")}。写入只影响下一次编译，不会改动已入库的数据。`,
      );
      setDiffs(null);
      onSaved();
    } catch (err) {
      const failure = err instanceof Error ? err.message : "保存失败，请稍后重试";
      setError(
        writtenFiles.length > 0
          ? `已保存 ${writtenFiles.join("、")}；其余未写入：${failure}`
          : failure,
      );
    } finally {
      setBusy("none");
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div
          className={`px-3 py-2 rounded-md text-xs ${
            isDark
              ? "bg-red-900/30 text-red-300 border border-red-800"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {error}
        </div>
      )}
      {message && !error && (
        <div
          className={`px-3 py-2 rounded-md text-xs ${
            isDark
              ? "bg-emerald-900/30 text-emerald-300 border border-emerald-800"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {message}
        </div>
      )}

      {/* 文件页签 */}
      <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
        <div
          className={`flex items-center gap-1 px-2 pt-2 border-b ${
            isDark ? "border-gray-700" : "border-gray-200"
          }`}
        >
          {FILES.map((file) => {
            const active = file === activeFile;
            return (
              <button
                key={file}
                onClick={() => setActiveFile(file)}
                className={`px-3 py-1.5 text-xs font-mono rounded-t-md transition-colors ${
                  active
                    ? isDark
                      ? "bg-gray-900 text-gray-100"
                      : "bg-gray-100 text-gray-900"
                    : textSecondary
                }`}
              >
                {file}
                {!info.files[FILE_KEY[file]] && (
                  <span className={textSecondary}>（不存在）</span>
                )}
                {isDirty(file) && <span className="text-amber-500"> ●</span>}
              </button>
            );
          })}
        </div>

        <div className="p-3">
          <textarea
            value={drafts[activeFile]}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                [activeFile]: event.target.value,
              }))
            }
            placeholder={PLACEHOLDER[activeFile]}
            spellCheck={false}
            className={textareaClass}
          />
          <div className={`mt-2 flex items-center gap-2 text-xs ${textSecondary}`}>
            {changedFiles.length > 0
              ? `有未保存的改动：${changedFiles.join("、")}`
              : "与磁盘一致"}
          </div>
        </div>

        <div
          className={`px-3 py-2 border-t flex items-center gap-2 ${
            isDark ? "border-gray-700" : "border-gray-200"
          }`}
        >
          <button
            onClick={() => void save()}
            disabled={busy !== "none" || changedFiles.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {busy === "save" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            保存
          </button>
          <button
            onClick={() => void validateCurrent()}
            disabled={busy !== "none"}
            className={secondaryButton}
          >
            {busy === "validate" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            校验当前文件
          </button>
          <button
            onClick={() => void previewDiff()}
            disabled={busy !== "none"}
            className={secondaryButton}
          >
            {busy === "diff" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : null}
            查看变更
          </button>
          <span className={`text-xs ${textSecondary}`}>
            原始模式按你写的内容原样保存（含注释）
          </span>
        </div>
      </div>

      {/* 校验结果 */}
      {result && (
        <div className={`border rounded-lg p-4 ${cardClass}`}>
          <div className="flex items-center gap-2">
            {result.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <span className="w-4 h-4 text-red-500">!</span>
            )}
            <span className={`text-sm font-medium ${textPrimary}`}>
              {result.ok ? "校验通过" : "存在错误"}
            </span>
            <span className={`text-xs ${textSecondary}`}>
              {result.errors.length} 个错误 · {result.warnings.length} 个提醒
            </span>
          </div>
          <OntologyIssueList
            issues={[...result.errors, ...result.warnings]}
            isDark={isDark}
          />
        </div>
      )}

      {/* diff 预览 */}
      {diffs && (
        <div className={`border rounded-lg overflow-hidden ${cardClass}`}>
          <div
            className={`px-4 py-2.5 text-sm font-medium border-b ${textPrimary} ${
              isDark ? "border-gray-700" : "border-gray-200"
            }`}
          >
            变更预览（磁盘 → 待保存）
          </div>
          {Object.keys(diffs).length === 0 ? (
            <div className={`px-4 py-4 text-xs ${textSecondary}`}>
              没有需要对比的文件
            </div>
          ) : (
            <div className="divide-y divide-gray-200/20">
              {Object.entries(diffs).map(([file, fileDiff]) => (
                <div key={file}>
                  <div
                    className={`px-4 py-2 text-xs font-mono flex items-center gap-3 ${textSecondary}`}
                  >
                    <span className={textPrimary}>{file}</span>
                    {fileDiff.skipped ? (
                      <span>文件过大，已跳过对比</span>
                    ) : fileDiff.diff === "" ? (
                      <span>无改动</span>
                    ) : (
                      <span>
                        <span className="text-green-600 dark:text-green-400">
                          +{fileDiff.additions}
                        </span>
                        {" / "}
                        <span className="text-red-600 dark:text-red-400">
                          -{fileDiff.deletions}
                        </span>
                      </span>
                    )}
                  </div>
                  {fileDiff.diff !== "" && (
                    <pre className="text-xs font-mono leading-relaxed m-0 overflow-x-auto">
                      {renderDiffLines(fileDiff, isDark)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function readDrafts(
  info: OntologySchemaInfo,
): Record<OntologySchemaFile, string> {
  return {
    "entities.yaml": info.raw["entities.yaml"] ?? "",
    "edges.yaml": info.raw["edges.yaml"] ?? "",
    "xref.yaml": info.raw["xref.yaml"] ?? "",
  };
}

/**
 * 渲染 unified diff 各行
 *
 * 行前缀/配色沿用 `ChatArea/DiffBlock.tsx` 的约定（header/add/del/normal），
 * 使其与聊天区的 diff 展示观感一致。此处不直接复用 DiffBlock：
 * 该组件绑定 `DiffData`（文件 + 统计）且底部是聊天专用的"接受/拒绝（复制到剪贴板）"操作栏。
 */
function renderDiffLines(fileDiff: OntologyFileDiff, isDark: boolean) {
  const lines = fileDiff.diff.split("\n");
  return lines.map((line, index) => {
    const type =
      line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")
        ? "header"
        : line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : "normal";
    const tone =
      type === "add"
        ? isDark
          ? "bg-green-900/20 text-green-300"
          : "bg-green-50 text-green-800"
        : type === "del"
          ? isDark
            ? "bg-red-900/20 text-red-300"
            : "bg-red-50 text-red-800"
          : type === "header"
            ? isDark
              ? "bg-blue-900/20 text-blue-300"
              : "bg-blue-50 text-blue-800"
            : isDark
              ? "text-gray-300"
              : "text-gray-700";
    return (
      <div key={index} className={`px-4 ${tone}`}>
        {line === "" ? " " : line}
      </div>
    );
  });
}
