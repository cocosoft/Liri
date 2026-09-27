import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import KeyboardShortcutsHelp from "../common/KeyboardShortcutsHelp";
import { httpLegacy as http } from "../../services/httpClient";
import { useAutoUpdate } from "../../hooks/useAutoUpdate";

/** 帮助中心导航项 */
interface HelpNavItem {
  id: string;
  labelKey: string;
  icon: string;
}

/** 文档分类 */
interface DocCategory {
  id: string;
  labelKey: string;
  dir: string;
  files: string[];
  collapsed?: boolean;
}

const NAV_ITEMS: HelpNavItem[] = [
  { id: "docs", labelKey: "help.helpDocs", icon: "D" },
  { id: "shortcuts", labelKey: "help.shortcuts", icon: "S" },
  { id: "about", labelKey: "help.aboutLiri", icon: "A" },
];

const ACTIVE_NAV_KEY = "liri-help-active-nav";

/**
 * 文档分类索引（与 app/docs/ 目录结构同步）
 */
const DOC_CATEGORIES: DocCategory[] = [
  {
    id: "quickstart",
    labelKey: "help.catQuickstart",
    dir: "快速入门",
    files: [
      "index",
      "installation",
      "onboarding",
      "quickstart",
      "setup",
      "upgrading",
    ],
  },
  {
    id: "install",
    labelKey: "help.catInstall",
    dir: "安装部署",
    files: [
      "index",
      "configuration",
      "docker",
      "linux",
      "macos",
      "source",
      "windows",
      "troubleshooting",
    ],
  },
  {
    id: "dev-guide",
    labelKey: "help.catDevGuide",
    dir: "开发指南",
    files: [
      "index",
      "add-ai-provider",
      "add-platform-channel",
      "add-tool-command-skill",
      "api-reference",
      "architecture",
      "code-style",
      "contributing",
      "getting-started",
      "internationalization-design",
      "module-dev",
      "module-to-plugin-migration",
      "security",
      "testing",
    ],
  },
  {
    id: "core-modules",
    labelKey: "help.catCoreModules",
    dir: "核心模块",
    files: [
      "index",
      "acp-protocol",
      "app-core",
      "auth",
      "auto-reply",
      "cache-system",
      "config-manager",
      "context-engine",
      "coordinator",
      "cron-scheduler",
      "di-container",
      "error-handling",
      "event-bus",
      "flow-engine",
      "gateway",
      "i18n-registry",
      "logging",
      "markdown-render",
      "media-generation",
      "media-understanding",
      "memory-host",
      "notification",
      "session-manager",
      "state-management",
      "task-system",
    ],
  },
  {
    id: "tools",
    labelKey: "help.catTools",
    dir: "工具参考",
    files: [
      "index",
      "agent-tools",
      "bash",
      "browser",
      "code-execution",
      "file-edit",
      "file-read",
      "file-write",
      "image-generation",
      "lsp",
      "mcp",
      "music-generation",
      "pdf",
      "thinking",
      "tts",
      "video-generation",
      "web-fetch",
      "web-search",
    ],
  },
  {
    id: "plugins",
    labelKey: "help.catPlugins",
    dir: "插件系统",
    files: [
      "index",
      "api-reference",
      "building-plugins",
      "bundled-plugins",
      "hooks",
      "lifecycle",
      "manifest",
      "marketplace",
      "overview",
      "plugin-sdk",
      "review-process",
      "skills",
    ],
  },
  {
    id: "concepts",
    labelKey: "help.catConcepts",
    dir: "概念与架构",
    files: [
      "index",
      "agent-model",
      "architecture",
      "design-philosophy",
      "plugin-architecture",
      "session",
      "streaming",
      "tool-system",
    ],
  },
  {
    id: "channels",
    labelKey: "help.catChannels",
    dir: "渠道",
    files: [
      "index",
      "channel-routing",
      "channel-testing",
      "dingtalk",
      "discord",
      "feishu",
      "irc",
      "line",
      "matrix",
      "overview",
      "qq",
      "signal",
      "slack",
      "telegram",
      "web",
      "wechat",
      "wecom",
      "whatsapp",
    ],
  },
  {
    id: "config-security",
    labelKey: "help.catConfigSecurity",
    dir: "配置与安全",
    files: [
      "index",
      "audit",
      "configuration",
      "governance",
      "network-security",
      "oauth",
      "permissions",
      "sandbox",
      "secrets",
      "smart-router",
    ],
  },
  {
    id: "automation",
    labelKey: "help.catAutomation",
    dir: "自动化",
    files: ["index", "cron", "hooks", "tasks", "webhooks"],
  },
  {
    id: "support",
    labelKey: "help.catSupport",
    dir: "帮助与支持",
    files: [
      "index",
      "debugging",
      "environment",
      "faq-install",
      "faq",
      "support",
      "troubleshooting",
    ],
  },
  {
    id: "knowledge",
    labelKey: "help.catKnowledge",
    dir: "知识库",
    files: ["index"],
  },
  {
    id: "voice",
    labelKey: "help.catVoice",
    dir: "语音",
    files: ["语音生成功"],
  },
  {
    id: "top-level",
    labelKey: "help.catTopLevel",
    dir: ".",
    files: [
      "API",
      "CORE_MODULES",
      "DEVELOPMENT",
      "SKILLS",
      "TOOLS",
      "USAGE",
      "index",
    ],
  },
];

// 语言中立/品牌名文档标签（其余中文标签走 i18n `help.labels.*`）
const DOC_LABELS: Record<string, string> = {
  discord: "Discord",
  irc: "IRC",
  line: "LINE",
  matrix: "Matrix",
  qq: "QQ",
  signal: "Signal",
  slack: "Slack",
  telegram: "Telegram",
  web: "Web",
  whatsapp: "WhatsApp",
  "plugin-sdk": "Plugin SDK",
  skills: "Skills",
  hooks: "Hooks",
  webhooks: "Webhooks",
  cron: "Cron",
  docker: "Docker",
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  oauth: "OAuth",
  lsp: "LSP",
  mcp: "MCP",
  pdf: "PDF",
  tts: "TTS",
  bash: "Bash",
};

/** 格式化文档名（i18n 优先，DOC_LABELS 为 fallback） */
function formatDocLabel(name: string, tFn: (key: string) => string): string {
  const key = `help.labels.${name.replace(/-/g, "_")}`;
  const translated = tFn(key);
  if (translated !== key) return translated;
  return DOC_LABELS[name] || name;
}

function HelpPage() {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState(() => {
    try {
      const s = localStorage.getItem(ACTIVE_NAV_KEY);
      if (s && NAV_ITEMS.some((n) => n.id === s)) return s;
    } catch {
      /* ignore */
    }
    return "docs";
  });
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<{
    title: string;
    html: string;
  } | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  // 应用版本：唯一事实来源 /v1/app/info（后端从 app/package.json 读取）
  useEffect(() => {
    http
      .get<{ version: string }>("/v1/app/info")
      .then((r) => setAppVersion(r.version))
      .catch(() => {});
  }, []);

  // 更新检查
  const {
    checking,
    downloading,
    result: updateResult,
    error: updateError,
    check: checkUpdate,
  } = useAutoUpdate();

  useEffect(() => {
    if (docContent) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [docContent]);

  const switchNav = (id: string) => {
    setActiveNav(id);
    setDocContent(null);
    try {
      localStorage.setItem(ACTIVE_NAV_KEY, id);
    } catch {
      /* ignore */
    }
  };

  /** 加载文档内容 */
  const loadDoc = async (cat: DocCategory, fileName: string) => {
    setLoadingDoc(true);
    const docPath = `app/docs/${cat.dir}/${fileName}.md`;
    try {
      const res = await http.get<{ ok: boolean; data: string }>(
        "/api/file/read",
        {
          params: { path: docPath },
        },
      );
      if (res?.ok && res?.data) {
        // 简单将 markdown 换行转为段落
        const lines = res.data.split("\n");
        let html = "";
        let inCode = false;
        for (const line of lines) {
          if (line.startsWith("```")) {
            inCode = !inCode;
            html += inCode
              ? "<pre class='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto my-2'>"
              : "</pre>";
            continue;
          }
          if (inCode) {
            html += line + "\n";
            continue;
          }
          if (line.startsWith("# ")) {
            html += `<h1 class="text-xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-3">${line.slice(2)}</h1>`;
          } else if (line.startsWith("## ")) {
            html += `<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-5 mb-2">${line.slice(3)}</h2>`;
          } else if (line.startsWith("### ")) {
            html += `<h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1">${line.slice(4)}</h3>`;
          } else if (line.trim()) {
            html += `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">${line}</p>`;
          }
        }
        setDocContent({ title: formatDocLabel(fileName, t), html });
      } else {
        setDocContent({
          title: formatDocLabel(fileName, t),
          html: `<p class='text-red-500'>${t("help.loadFailed")}</p>`,
        });
      }
    } catch {
      setDocContent({
        title: formatDocLabel(fileName, t),
        html: `<p class='text-red-500'>${t("help.loadFailedBackend")}</p>`,
      });
    }
    setLoadingDoc(false);
  };

  const toggleCategory = (catId: string) => {
    setExpandedCat(expandedCat === catId ? null : catId);
  };

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-52 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("help.helpCenter")}
          </h2>
        </div>
        <nav className="pb-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => switchNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium border-r-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <span className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {item.icon}
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800 relative">
        {activeNav === "docs" && renderDocs()}
        {activeNav === "shortcuts" && renderShortcuts()}
        {activeNav === "about" && renderAbout()}

        {/* 文档查看器浮层 */}
        {docContent && (
          <div className="absolute inset-0 bg-white dark:bg-gray-800 z-10 overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {docContent.title}
              </h3>
              <button
                onClick={() => setDocContent(null)}
                className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-300"
              >
                {t("common.back")}
              </button>
            </div>
            <div className="px-6 py-4 max-w-3xl">
              {loadingDoc ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <div
                  className="max-w-none"
                  dangerouslySetInnerHTML={{ __html: docContent.html }}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );

  /** 帮助文档 - 分类浏览器 */
  function renderDocs() {
    return (
      <div className="p-6 max-w-4xl">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            {t("help.helpDocs")}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("help.docsDesc")}
          </p>
        </div>

        <div className="space-y-2">
          {DOC_CATEGORIES.map((cat) => {
            const isExpanded = expandedCat === cat.id;
            return (
              <div
                key={cat.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* 分类头部 */}
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <span>{t(cat.labelKey)}</span>
                  <span
                    className={`text-gray-400 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  >
                    &gt;
                  </span>
                </button>

                {/* 文件列表 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    {cat.files.map((file) => (
                      <button
                        key={file}
                        onClick={() => loadDoc(cat, file)}
                        disabled={loadingDoc}
                        className="w-full text-left px-5 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        {formatDocLabel(file, t)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-sm text-gray-400 dark:text-gray-500">
          {t("help.moreDocs")}{" "}
          <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">
            app/docs/
          </code>{" "}
          {t("help.directory")}
        </p>
      </div>
    );
  }

  /** 快捷键 */
  function renderShortcuts() {
    return (
      <div className="p-6 max-w-3xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("help.shortcuts")}
        </h3>
        <KeyboardShortcutsHelp />
      </div>
    );
  }

  /** 关于 Liri */
  function renderAbout() {
    return (
      <div className="p-6 max-w-3xl space-y-8">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t("help.aboutLiri")}
          </h3>

          {/* 应用信息 */}
          <div className="flex items-center gap-4 mb-6 p-5 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
              L
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Liri
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("help.versionLabel", { version: appVersion })}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {t("help.aboutDesc")}
              </p>
              <button
                onClick={checkUpdate}
                disabled={checking || downloading}
                className="mt-3 px-4 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded transition-colors"
              >
                {checking
                  ? t("help.checking")
                  : downloading
                    ? t("help.downloading")
                    : t("help.checkUpdate")}
              </button>
              {updateResult?.available && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                  {t("help.newVersionAvailable", {
                    version: updateResult.latestVersion,
                  })}
                </p>
              )}
              {updateResult && !updateResult.available && !checking && (
                <p className="text-xs text-gray-400 mt-1">
                  {t("help.upToDate")}
                </p>
              )}
              {updateError && (
                <p className="text-xs text-red-500 mt-1">{updateError}</p>
              )}
            </div>
          </div>

          {/* 详细信息 */}
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">
                {t("help.license")}
              </span>
              <span className="text-gray-900 dark:text-gray-100 font-medium">
                MIT License
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">
                {t("help.techStack")}
              </span>
              <span className="text-gray-900 dark:text-gray-100">
                {t("help.techStackValue")}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
              <span className="text-gray-600 dark:text-gray-400">
                {t("help.runtime")}
              </span>
              <span className="text-gray-900 dark:text-gray-100">
                {t("help.runtimeValue")}
              </span>
            </div>
          </div>
        </div>

        {/* 核心功能 */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
            {t("help.coreFeatures")}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                {t("help.aiChat")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("help.aiChatDesc")}
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                {t("help.taskMgmt")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("help.taskMgmtDesc")}
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                {t("help.knowledge")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("help.knowledgeDesc")}
              </p>
            </div>
            <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                {t("help.automation")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("help.automationDesc")}
              </p>
            </div>
          </div>
        </div>

        {/* 链接 */}
        <div>
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
            {t("help.relatedLinks")}
          </h4>
          <div className="space-y-2 text-sm">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                switchNav("docs");
              }}
              className="block px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("help.viewDocs")}
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default HelpPage;
