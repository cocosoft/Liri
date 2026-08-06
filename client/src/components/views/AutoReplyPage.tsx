import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import {
  autoReplyService,
  type AutoReplyRule,
  type AutoReplyPattern,
} from "../../services/autoReplyService";
import { handleClientError } from "../../utils/handleError";

/** 关键词（逗号分隔）→ pattern：单关键词用 substring，多关键词拼正则 */
function keywordsToPattern(keywords: string): AutoReplyPattern {
  const kws = keywords
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (kws.length === 1) return { type: "substring", value: kws[0] };
  const escaped = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { type: "regexp", value: `(?:${escaped.join("|")})` };
}

/** pattern → 关键词展示 */
function patternToKeywords(p: AutoReplyPattern): string {
  if (p.type === "substring") return p.value;
  const inner = p.value
    .replace(/^\(\?:/, "")
    .replace(/\)$/, "")
    .replace(/\\/g, "");
  return inner.split("|").join(", ");
}

function AutoReplyPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReplyRule | null>(null);
  const [newRule, setNewRule] = useState({
    name: "",
    keywords: "",
    reply: "",
    priority: 1,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await autoReplyService.listRules();
      setRules(data.rules);
    } catch (e) {
      handleClientError(e, { module: "views:AutoReplyPage", action: "load" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    load();
  }, [loadConfig, load]);

  const toggleRule = async (rule: AutoReplyRule) => {
    try {
      const updated = await autoReplyService.updateRule(rule.id, {
        enabled: !rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (e) {
      handleClientError(e, { module: "views:AutoReplyPage", action: "toggle" });
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await autoReplyService.deleteRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (e) {
      handleClientError(e, { module: "views:AutoReplyPage", action: "delete" });
    }
  };

  const handleSubmit = async () => {
    if (!newRule.name || !newRule.keywords || !newRule.reply) return;
    try {
      const created = await autoReplyService.createRule({
        name: newRule.name,
        pattern: keywordsToPattern(newRule.keywords),
        response: newRule.reply,
        priority: newRule.priority,
      });
      setRules((prev) => [...prev, created]);
      setShowForm(false);
      setNewRule({ name: "", keywords: "", reply: "", priority: 1 });
    } catch (e) {
      handleClientError(e, { module: "views:AutoReplyPage", action: "create" });
    }
  };

  const handleUpdate = async () => {
    if (!editingRule || !newRule.name || !newRule.keywords || !newRule.reply)
      return;
    try {
      const updated = await autoReplyService.updateRule(editingRule.id, {
        name: newRule.name,
        pattern: keywordsToPattern(newRule.keywords),
        response: newRule.reply,
        priority: newRule.priority,
      });
      setRules((prev) =>
        prev.map((r) => (r.id === editingRule.id ? updated : r)),
      );
      setShowForm(false);
      setEditingRule(null);
      setNewRule({ name: "", keywords: "", reply: "", priority: 1 });
    } catch (e) {
      handleClientError(e, { module: "views:AutoReplyPage", action: "update" });
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority === 1)
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    if (priority === 2)
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    return "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400";
  };

  const getPriorityLabel = (priority: number) => {
    if (priority === 1) return "高";
    if (priority === 2) return "中";
    return "低";
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              自动回复管理
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              配置关键词触发的自动回复规则
            </p>
          </div>
          <button
            onClick={() => {
              setEditingRule(null);
              setNewRule({ name: "", keywords: "", reply: "", priority: 1 });
              setShowForm(true);
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            添加规则
          </button>
        </div>

        {showForm && (
          <div
            className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6 mb-6`}
          >
            <h3
              className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {editingRule ? "编辑规则" : "新建规则"}
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  规则名称
                </label>
                <input
                  type="text"
                  value={newRule.name}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  placeholder="输入规则名称"
                />
              </div>
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  匹配关键词（逗号分隔）
                </label>
                <input
                  type="text"
                  value={newRule.keywords}
                  onChange={(e) =>
                    setNewRule((prev) => ({
                      ...prev,
                      keywords: e.target.value,
                    }))
                  }
                  className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  placeholder="如: 你好, 您好, hello"
                />
              </div>
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  回复内容
                </label>
                <textarea
                  value={newRule.reply}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, reply: e.target.value }))
                  }
                  className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  rows={3}
                  placeholder="输入自动回复内容"
                />
              </div>
              <div>
                <label
                  className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  优先级
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        setNewRule((prev) => ({ ...prev, priority: p }))
                      }
                      className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                        newRule.priority === p
                          ? getPriorityColor(p)
                          : isDark
                            ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                            : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                      }`}
                    >
                      {getPriorityLabel(p)}优先级
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingRule(null);
                  }}
                  className={`px-4 py-2 text-sm rounded-lg ${isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                >
                  取消
                </button>
                <button
                  onClick={editingRule ? handleUpdate : handleSubmit}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  {editingRule ? "保存修改" : "添加规则"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} overflow-hidden`}
        >
          <div
            className={`grid grid-cols-6 gap-4 px-4 py-3 border-b ${isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-50"}`}
          >
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              规则名称
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              关键词
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              回复预览
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              优先级
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              匹配方式
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              操作
            </span>
          </div>

          {!loading && rules.length === 0 ? (
            <div className="text-center py-12">
              <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                暂无自动回复规则
              </p>
            </div>
          ) : loading ? (
            <div className="text-center py-12">
              <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                加载中...
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-6 gap-4 px-4 py-3 items-center"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      {rule.name}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${rule.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}
                    >
                      {rule.enabled ? "启用" : "禁用"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {patternToKeywords(rule.pattern)
                      .split(",")
                      .map((keyword) => (
                        <span
                          key={keyword}
                          className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-blue-900/30 text-blue-400" : "bg-blue-100 text-blue-700"}`}
                        >
                          {keyword}
                        </span>
                      ))}
                  </div>
                  <p
                    className={`text-xs truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {rule.response}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${getPriorityColor(rule.priority)}`}
                  >
                    {getPriorityLabel(rule.priority)}
                  </span>
                  <span
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {rule.pattern.type === "regexp" ? "关键词组" : "包含匹配"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingRule(rule);
                        setNewRule({
                          name: rule.name,
                          keywords: patternToKeywords(rule.pattern),
                          reply: rule.response,
                          priority: rule.priority,
                        });
                        setShowForm(true);
                      }}
                      className={`px-2 py-1 text-xs rounded ${isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => toggleRule(rule)}
                      className={`px-2 py-1 text-xs rounded ${rule.enabled ? "bg-yellow-50 hover:bg-yellow-100 text-yellow-700" : "bg-green-50 hover:bg-green-100 text-green-700"}`}
                    >
                      {rule.enabled ? "禁用" : "启用"}
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className={`px-2 py-1 text-xs rounded ${isDark ? "bg-red-900/30 hover:bg-red-900/50 text-red-400" : "bg-red-50 hover:bg-red-100 text-red-600"}`}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutoReplyPage;
