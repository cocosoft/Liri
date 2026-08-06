// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 安全功能关系概览（M1，方案 §5.3）
 * 三级权限模型图 + 功能归属表 + 常见疑问 + 安全仪表盘跳转。
 * 本页讲"关系"，/security 讲"实时状态"（风险分布/审计事件），互相跳转不合并。
 */
import { Link } from "react-router-dom";

interface SecurityOverviewContentProps {
  isDark: boolean;
}

interface LayerBlock {
  layer: string;
  color: string;
  desc: string;
  members: string[];
}

const LAYERS: LayerBlock[] = [
  {
    layer: "系统边界",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    desc: "应用内强制兜底（非操作系统授权）：AI 不可逾越的本地边界",
    members: ["信任工作区", "自定义规则"],
  },
  {
    layer: "用户级",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    desc: "用户明确的配置决策：允许什么、凭据是谁的",
    members: ["权限", "API 密钥", "OAuth 认证"],
  },
  {
    layer: "应用级",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    desc: "Liri 直接执行：应用运行时按配置做决策",
    members: ["权限执行（allow/deny/ask）"],
  },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "信任工作区和权限有什么区别？",
    a: "信任工作区是系统级文件边界（允许 AI 碰哪些本地路径，应用内强制兜底）；权限是用户级能力开关（工具/操作允不允许执行）。二者独立，工作区信任不能越权调用被禁工具，权限 allow 也不能突破文件边界。",
  },
  {
    q: "自定义规则能覆盖权限的 allow 吗？",
    a: "不能。自定义规则（命令/目录黑名单）是系统级强制兜底，黑名单命中即拒，任何一级的 allow 都无法覆盖。",
  },
  {
    q: "未登录时权限如何判定？",
    a: "未登录 = 应用默认行为（本地回环信任基线），管理写 API 放行；登录后按角色收紧——非 admin 调用管理写 API 返回 403。",
  },
];

function SecurityOverviewContent({ isDark }: SecurityOverviewContentProps) {
  const card = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3
          className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          三级权限模型
        </h3>
        <Link
          to="/security"
          className={`text-xs px-3 py-1.5 rounded ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
        >
          前往安全仪表盘（实时状态）→
        </Link>
      </div>

      {/* 三级模型图 */}
      <div className="grid gap-3 md:grid-cols-3">
        {LAYERS.map((l) => (
          <div key={l.layer} className={`rounded-lg border p-4 ${card}`}>
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded mb-2 ${l.color}`}
            >
              {l.layer}
            </span>
            <p
              className={`text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {l.desc}
            </p>
            <div className="flex flex-wrap gap-1">
              {l.members.map((m) => (
                <span
                  key={m}
                  className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 归属表 */}
      <div className={`rounded-lg border p-4 ${card}`}>
        <h4
          className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          功能归属
        </h4>
        <table
          className={`w-full text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          <thead>
            <tr
              className={`text-left ${isDark ? "text-gray-500" : "text-gray-500"}`}
            >
              <th className="py-1.5 pr-3 font-medium">功能块</th>
              <th className="py-1.5 pr-3 font-medium">所属级别</th>
              <th className="py-1.5 font-medium">回答的问题</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">信任工作区</td>
              <td className="py-2 pr-3">系统边界</td>
              <td className="py-2">允许 AI 碰哪些本地路径</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">自定义规则</td>
              <td className="py-2 pr-3">系统边界</td>
              <td className="py-2">哪些危险命令/目录必拦</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">权限</td>
              <td className="py-2 pr-3">用户级 → 应用级</td>
              <td className="py-2">工具/操作允不允许执行</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">API 密钥</td>
              <td className="py-2 pr-3">用户级</td>
              <td className="py-2">程序凭什么访问</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">OAuth 认证</td>
              <td className="py-2 pr-3">用户级（未接入）</td>
              <td className="py-2">第三方账号登录（方向待定）</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 常见疑问 */}
      <div className={`rounded-lg border p-4 ${card}`}>
        <h4
          className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          常见疑问
        </h4>
        <div className="space-y-3">
          {FAQ_ITEMS.map((f) => (
            <div key={f.q}>
              <p
                className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
              >
                {f.q}
              </p>
              <p
                className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {f.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SecurityOverviewContent;
