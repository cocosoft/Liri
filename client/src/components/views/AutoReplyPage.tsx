import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/configStore";

interface AutoReplyRule {
  id: string;
  name: string;
  keywords: string[];
  reply: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  usageCount: number;
}

function AutoReplyPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const [rules, setRules] = useState<AutoReplyRule[]>([
    {
      id: "1",
      name: "欢迎消息",
      keywords: ["你好", "您好", "hi", "hello"],
      reply: "您好！欢迎使用本系统，请问有什么可以帮助您的？",
      priority: 1,
      enabled: true,
      createdAt: "2026-05-28 09:00",
      usageCount: 156,
    },
    {
      id: "2",
      name: "帮助请求",
      keywords: ["帮助", "help", "怎么用", "教程"],
      reply: "您可以查看帮助中心获取详细使用指南，或联系管理员获取支持。",
      priority: 2,
      enabled: true,
      createdAt: "2026-05-27 10:00",
      usageCount: 89,
    },
    {
      id: "3",
      name: "常见问题",
      keywords: ["问题", "故障", "错误", "报错"],
      reply: "遇到问题请先查看常见问题文档，如仍无法解决请提交工单。",
      priority: 3,
      enabled: false,
      createdAt: "2026-05-26 14:00",
      usageCount: 42,
    },
    {
      id: "4",
      name: "反馈",
      keywords: ["反馈", "意见", "建议"],
      reply: "感谢您的反馈！我们会认真听取每一条建议并持续改进。",
      priority: 2,
      enabled: true,
      createdAt: "2026-05-25 11:00",
      usageCount: 67,
    },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReplyRule | null>(null);
  const [newRule, setNewRule] = useState({
    name: "",
    keywords: "",
    reply: "",
    priority: 1,
  });

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const toggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  const deleteRule = (ruleId: string) => {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  const handleSubmit = () => {
    if (!newRule.name || !newRule.keywords || !newRule.reply) return;

    const keywordsArray = newRule.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const rule: AutoReplyRule = {
      id: Date.now().toString(),
      name: newRule.name,
      keywords: keywordsArray,
      reply: newRule.reply,
      priority: newRule.priority,
      enabled: true,
      createdAt: new Date().toLocaleString(),
      usageCount: 0,
    };

    setRules((prev) => [...prev, rule]);
    setShowForm(false);
    setNewRule({ name: "", keywords: "", reply: "", priority: 1 });
  };

  const handleEdit = (rule: AutoReplyRule) => {
    setEditingRule(rule);
    setNewRule({
      name: rule.name,
      keywords: rule.keywords.join(", "),
      reply: rule.reply,
      priority: rule.priority,
    });
    setShowForm(true);
  };

  const handleUpdate = () => {
    if (!editingRule || !newRule.name || !newRule.keywords || !newRule.reply)
      return;

    const keywordsArray = newRule.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    setRules((prev) =>
      prev.map((r) =>
        r.id === editingRule.id
          ? {
              ...r,
              name: newRule.name,
              keywords: keywordsArray,
              reply: newRule.reply,
              priority: newRule.priority,
            }
          : r,
      ),
    );
    setShowForm(false);
    setEditingRule(null);
    setNewRule({ name: "", keywords: "", reply: "", priority: 1 });
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
                  关键词（逗号分隔）
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
              使用次数
            </span>
            <span
              className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              操作
            </span>
          </div>

          {rules.length === 0 ? (
            <div className="text-center py-12">
              <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                暂无自动回复规则
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
                    {rule.keywords.map((keyword) => (
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
                    {rule.reply}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${getPriorityColor(rule.priority)}`}
                  >
                    {getPriorityLabel(rule.priority)}
                  </span>
                  <span
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {rule.usageCount}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(rule)}
                      className={`px-2 py-1 text-xs rounded ${isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => toggleRule(rule.id)}
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
