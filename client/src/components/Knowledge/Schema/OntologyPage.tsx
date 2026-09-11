import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { schemaService } from "../../../services/schemaService";
import type {
  OntologyDomainItem,
  OntologySchemaInfo,
  OntologyValidationResult,
} from "../../../types/project";
import { OntologyBackupPanel } from "./OntologyBackupPanel";
import { OntologyForm } from "./OntologyForm";
import { OntologyIssueList } from "./OntologyIssueList";
import { OntologyRawEditor } from "./OntologyRawEditor";
import { OntologyTypeDispositionPanel } from "./OntologyTypeDispositionPanel";
import { useConfigStore } from "../../../stores/configStore";

/**
 * 知识本体（知识库「本体」Tab，位于「知识图谱」之前）
 *
 * 展示 schema 约束状态（当前模式 freeform / constrained、本体目录、实体/关系白名单），
 * 并在文件内容可被表单表达时提供**可编辑的表单模式**（D1 = C）：
 * 实体/关系类型的增删改 + 关系端点下拉（只列已声明的实体 kind）。
 * 校验、序列化、备份与原子写全在服务端；本页只负责编辑与展示。
 *
 * 数据来源：GET /v1/knowledge/schema、POST /v1/knowledge/schema/validate、
 * PUT /v1/knowledge/schema/{file}
 * —— 读取接口不创建任何文件（不会把用户从 freeform 静默切成 constrained）。
 */
interface OntologyPageProps {
  /** 当前是否为激活 Tab —— 切回时重新读取（本体文件可能被外部改动） */
  active?: boolean;
}

export function OntologyPage({ active = true }: OntologyPageProps) {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [info, setInfo] = useState<OntologySchemaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<OntologyValidationResult | null>(null);

  const bgClass = isDark ? "bg-gray-900" : "bg-gray-50";
  const cardClass = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";

  // D6-3：当前域（默认 knowledge）与域清单
  const [domain, setDomain] = useState("knowledge");
  const [domains, setDomains] = useState<OntologyDomainItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setInfo(await schemaService.getSchema(domain));
    } catch (err) {
      // 前端文案不含技术术语；技术细节留给日志
      setError(
        err instanceof Error
          ? `读取本体配置失败：${err.message}`
          : "读取本体配置失败",
      );
    } finally {
      setLoading(false);
    }
  }, [domain]);

  // D6-3：域清单（后端保证"默认域"始终在列表内）
  useEffect(() => {
    void (async () => {
      try {
        const data = await schemaService.listDomains();
        setDomains(data.domains);
      } catch {
        // @ignore-catch 域清单是辅助信息，取不到时仅剩默认域，不阻塞本体页
      }
    })();
  }, []);

  useEffect(() => {
    // 切回本 Tab（active=true）时重新读取，避免停留在过期快照
    if (active) load();
  }, [load, active]);

  const runValidate = useCallback(async () => {
    setValidating(true);
    setError("");
    try {
      setResult(await schemaService.validate());
    } catch (err) {
      setError(err instanceof Error ? `校验失败：${err.message}` : "校验失败");
    } finally {
      setValidating(false);
    }
  }, []);

  const isConstrained = info?.mode === "constrained";
  // 表单模式可用性：任一文件含表单无法表达的内容 → 禁用表单并强制原始模式（禁止有损转换）
  const isFormEditable =
    info?.form.entities.expressible === true &&
    info?.form.edges.expressible === true;
  const formBlockReason = [
    info?.form.entities.reason,
    info?.form.edges.reason,
  ]
    .filter(Boolean)
    .join("；");
  const [editorMode, setEditorMode] = useState<"form" | "raw">("form");
  const effectiveMode: "form" | "raw" = isFormEditable ? editorMode : "raw";

  return (
    <div className={`flex-1 overflow-y-auto ${bgClass}`}>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h1 className={`text-lg font-semibold ${textPrimary}`}>知识本体</h1>
            <p className={`text-xs mt-1 ${textSecondary}`}>
              约束知识图谱能抽出哪些实体类型与关系类型；未声明时由模型自由发挥
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* D6-3：域选择器 —— 本体按域隔离（域优先、全局兜底），默认域 knowledge */}
            <div className="flex items-center gap-1.5">
              <select
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                title="本体按域隔离：域目录未声明本体时回落全局 .schema"
                className={`px-2 py-1.5 text-xs rounded-md border ${
                  isDark
                    ? "bg-gray-900 border-gray-600 text-gray-100"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
              >
                {(domains.length > 0
                  ? domains
                  : ([
                      {
                        name: "knowledge",
                        label: "默认域",
                        description: "",
                        keywordTags: [],
                        wikiPageCount: 0,
                        isDefault: true,
                      },
                    ] as OntologyDomainItem[])
                ).map((item) => (
                  <option key={item.name} value={item.name}>
                    域：{item.name}
                    {item.isDefault ? "（默认）" : ""}
                  </option>
                ))}
              </select>
              {info?.domain && info.domain !== "knowledge" && (
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  title={`保存将写入该域目录：${info?.writeDir ?? ""}`}
                >
                  保存写入本域目录
                </span>
              )}
              {info?.domainFallback && (
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  title="该域缺少部分本体文件，缺失项按**逐文件**继承全局 .schema"
                >
                  部分文件继承全局
                </span>
              )}
            </div>
            {/* 模式切换（D1 = C）：表单模式覆盖常见场景，原始 YAML 兜住一切 */}
            <div
              className={`flex items-center rounded-md border overflow-hidden ${
                isDark ? "border-gray-600" : "border-gray-300"
              }`}
            >
              <button
                onClick={() => setEditorMode("form")}
                disabled={!isFormEditable}
                title={
                  isFormEditable
                    ? "表单模式编辑实体/关系类型"
                    : `表单模式不可用：${formBlockReason || "文件内容无法映射为表单"}`
                }
                className={`px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  effectiveMode === "form"
                    ? "bg-blue-600 text-white"
                    : isDark
                      ? "text-gray-300 hover:bg-gray-700"
                      : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                表单模式
              </button>
              <button
                onClick={() => setEditorMode("raw")}
                className={`px-2.5 py-1.5 text-xs transition-colors ${
                  effectiveMode === "raw"
                    ? "bg-blue-600 text-white"
                    : isDark
                      ? "text-gray-300 hover:bg-gray-700"
                      : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                原始 YAML
              </button>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50 ${
                isDark
                  ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </button>
            <button
              onClick={runValidate}
              disabled={validating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {validating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              校验
            </button>
          </div>
        </div>

        {error && (
          <div
            className={`mb-4 px-3 py-2 rounded-md text-xs ${
              isDark
                ? "bg-red-900/30 text-red-300 border border-red-800"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {error}
          </div>
        )}

        {loading && !info ? (
          <div className={`text-xs ${textSecondary}`}>加载中…</div>
        ) : info ? (
          <div className="space-y-4">
            {/* 模式 + 概览 */}
            <div className={`border rounded-lg p-4 ${cardClass}`}>
              <div className="flex items-center gap-2 mb-3">
                {isConstrained ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                )}
                <span
                  className={`text-sm font-medium px-2 py-0.5 rounded ${
                    isConstrained
                      ? isDark
                        ? "bg-emerald-900/40 text-emerald-300"
                        : "bg-emerald-50 text-emerald-700"
                      : isDark
                        ? "bg-amber-900/40 text-amber-300"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {isConstrained
                    ? "constrained（已约束）"
                    : "freeform（自由抽取）"}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div className="flex gap-2">
                  <dt className={textSecondary}>本体目录</dt>
                  <dd className={`font-mono break-all ${textPrimary}`}>
                    {info.schemaDir}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className={textSecondary}>文件</dt>
                  <dd className={textPrimary}>
                    {(
                      [
                        ["entities.yaml", info.files.entities],
                        ["edges.yaml", info.files.edges],
                        ["xref.yaml", info.files.xref],
                      ] as const
                    ).map(([name, exists]) => (
                      <span key={name} className="mr-3">
                        <span
                          className={
                            exists ? "text-emerald-500" : textSecondary
                          }
                        >
                          {exists ? "●" : "○"}
                        </span>{" "}
                        <span className="font-mono">{name}</span>
                      </span>
                    ))}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className={textSecondary}>白名单条目</dt>
                  <dd className={textPrimary}>
                    实体 {info.counts.entities} · 关系 {info.counts.edges} ·
                    链接契约 {info.counts.xref}
                  </dd>
                </div>
              </dl>

              {!isConstrained && (
                <p
                  className={`mt-3 pt-3 text-xs border-t ${
                    isDark
                      ? "border-gray-700 text-gray-400"
                      : "border-gray-200 text-gray-500"
                  }`}
                >
                  当前没有任何本体声明：抽取结果完全由模型决定。放入{" "}
                  <span className="font-mono">entities.yaml</span> /{" "}
                  <span className="font-mono">edges.yaml</span> 后即进入
                  constrained；只放实体声明时关系不受约束（全部保留）。
                </p>
              )}
            </div>

            {/* 校验结果 */}
            {result && (
              <div className={`border rounded-lg p-4 ${cardClass}`}>
                <div className="flex items-center gap-2">
                  {result.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${textPrimary}`}>
                    {result.ok ? "校验通过" : "存在错误"}
                  </span>
                  <span className={`text-xs ${textSecondary}`}>
                    {result.errors.length} 个错误 · {result.warnings.length}{" "}
                    个提醒
                  </span>
                </div>
                <OntologyIssueList
                  issues={[...result.errors, ...result.warnings]}
                  isDark={isDark}
                />
              </div>
            )}

            {!isFormEditable && (
              <div
                className={`px-3 py-2 rounded-md text-xs border ${
                  isDark
                    ? "bg-amber-900/20 text-amber-300 border-amber-800"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                表单模式不可用：{formBlockReason || "文件内容无法映射为表单"}
                。已使用原始 YAML 模式编辑（表单无法表达的内容不会被丢弃）。
              </div>
            )}

            {effectiveMode === "raw" ? (
              /* 原始 YAML 模式（D1 = C 的另一半）：手改全文，同一校验器 + 同一写入接口 */
              <OntologyRawEditor info={info} isDark={isDark} onSaved={load} />
            ) : (
              /* 表单模式（D1 = C）：可编辑实体/关系类型；序列化与校验都在服务端 */
              <OntologyForm info={info} isDark={isDark} onSaved={load} />
            )}

            {/* D4：白名单外关系类型处置（默认保留，绝不自动删数据） */}
            <OntologyTypeDispositionPanel
              info={info}
              isDark={isDark}
              onChanged={load}
            />

            {/* 历史备份与恢复（B2c）：每次保存/恢复都会先备份上一个版本 */}
            <OntologyBackupPanel
              isDark={isDark}
              onChanged={load}
              domain={info?.domain ?? undefined}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

