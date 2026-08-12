/**
 * SvgPreviewResult
 * SVG 生成结果渲染 — 内嵌 SVG 预览 + 代码切换
 * 安全过滤：移除 <script> 标签和事件处理器
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  data: Record<string, unknown>;
}

/** N1 修复：SVG 安全过滤改为 DOMParser + 白名单。
 * 原正则黑名单可被绕过（无引号事件属性 onload=alert(1)、实体编码协议
 * java&#115;cript:、未闭合 script 标签等）。白名单方案：
 * 解析成 DOM → 移除非白名单标签 / on* 属性 / 危险协议 href → 重新序列化。
 * 属性值已被解析器实体解码，编码绕过无效。 */
const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon",
  "ellipse", "text", "textpath", "tspan", "defs", "symbol", "use", "image",
  "marker", "lineargradient", "radialgradient", "stop", "clippath", "mask",
  "pattern", "filter", "feblend", "fecolormatrix", "fecomponenttransfer",
  "fecomposite", "feconvolvematrix", "fediffuselighting", "fedisplacementmap",
  "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg",
  "fefuncr", "fegaussianblur", "feimage", "femerge", "femergenode",
  "femorphology", "feoffset", "fepointlight", "fespecularlighting",
  "fespotlight", "fetile", "feturbulence", "title", "desc", "metadata",
  "style", "a",
  // 注意：script/foreignObject/object/iframe/link 等一律不在白名单 → 整节点删除
]);

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** href/src 协议白名单；无协议（相对/锚点）放行 */
function isSafeSvgUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  const proto = v.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!proto) return true;
  return SAFE_URL_PROTOCOLS.has(`${proto}:`);
}

function sanitizeSvgElement(el: Element): void {
  const children = Array.from(el.children);
  if (!ALLOWED_SVG_TAGS.has(el.tagName.toLowerCase())) {
    el.remove();
    return;
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === "href" || name === "xlink:href" || name === "src") {
      if (!isSafeSvgUrl(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const child of children) {
    sanitizeSvgElement(child as Element);
  }
}

/** 解析失败（XML 非法）或根节点非 svg 时返回空串，不渲染不可信内容 */
function sanitizeSvg(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror")) return "";
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") return "";
    sanitizeSvgElement(root);
    return new XMLSerializer().serializeToString(root);
  } catch {
    return "";
  }
}

export default function SvgPreviewResult({ data }: Props) {
  const { t } = useTranslation();
  const [showCode, setShowCode] = useState(false);

  const rawSvg = (data.svg as string) || "";
  const filePath = (data.filePath as string) || undefined;
  const size = (data.size as string) || "";
  const validation = data.validation as
    { valid?: boolean; errors?: string[]; warnings?: string[] } | undefined;

  const safeSvg = useMemo(() => sanitizeSvg(rawSvg), [rawSvg]);

  return (
    <div className="space-y-2">
      {/* SVG 预览 */}
      {!showCode && safeSvg ? (
        <div className="bg-white/5 rounded p-2 flex justify-center">
          <div
            className="max-w-full overflow-hidden"
            dangerouslySetInnerHTML={{ __html: safeSvg }}
          />
        </div>
      ) : (
        <pre className="m-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#a9b1d6] font-mono bg-black/15 p-2 rounded max-h-[300px] overflow-y-auto">
          {rawSvg}
        </pre>
      )}

      {/* 控制栏 */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
        <button
          onClick={() => setShowCode(!showCode)}
          className="text-[#7aa2f7] hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          {showCode ? t("image.showPreview") : t("image.showCode")}
        </button>
        {size && (
          <span>
            {t("image.size")}: {size}
          </span>
        )}
        {filePath && (
          <span className="text-gray-500">
            {t("image.saved")}: {filePath}
          </span>
        )}
        {rawSvg && (
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rawSvg)}`}
            download={
              filePath
                ? filePath.split(/[/\\]/).pop() || "image.svg"
                : "image.svg"
            }
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 no-underline"
          >
            ↓ {t("image.download")}
          </a>
        )}
      </div>

      {/* 校验结果 */}
      {validation && !validation.valid && (
        <div className="bg-yellow-900/20 border border-yellow-800/40 rounded px-2 py-1 text-yellow-300 text-[10px]">
          {validation.errors?.map((err, i) => (
            <div key={i} className="text-red-400">
              Error: {err}
            </div>
          ))}
          {validation.warnings?.map((warn, i) => (
            <div key={i} className="text-yellow-400">
              Warning: {warn}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
