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
import { useTranslation } from "react-i18next";

interface SecurityOverviewContentProps {
  isDark: boolean;
}

interface LayerBlock {
  layerKey: string;
  color: string;
  descKey: string;
  memberKeys: string[];
}

const LAYERS: LayerBlock[] = [
  {
    layerKey: "settings.safetyLayerSystem",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    descKey: "securityOverview.layerSystemDesc",
    memberKeys: ["settings.trustedWorkspaces", "settings.customRules"],
  },
  {
    layerKey: "settings.safetyLayerUser",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    descKey: "securityOverview.layerUserDesc",
    memberKeys: ["securityOverview.perm", "settings.apiKeys", "settings.oauth"],
  },
  {
    layerKey: "settings.safetyLayerApp",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    descKey: "securityOverview.layerAppDesc",
    memberKeys: ["securityOverview.memberPermExec"],
  },
];

const FAQ_ITEMS: { qKey: string; aKey: string }[] = [
  {
    qKey: "securityOverview.faqTrustedWsQ",
    aKey: "securityOverview.faqTrustedWsA",
  },
  {
    qKey: "securityOverview.faqRulesOverrideQ",
    aKey: "securityOverview.faqRulesOverrideA",
  },
  {
    qKey: "securityOverview.faqAnonymousQ",
    aKey: "securityOverview.faqAnonymousA",
  },
];

function SecurityOverviewContent({ isDark }: SecurityOverviewContentProps) {
  const { t } = useTranslation();
  const card = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3
          className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          {t("securityOverview.modelTitle")}
        </h3>
        <Link
          to="/security"
          className={`text-xs px-3 py-1.5 rounded ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
        >
          {t("securityOverview.goDashboard")}
        </Link>
      </div>

      {/* 三级模型图 */}
      <div className="grid gap-3 md:grid-cols-3">
        {LAYERS.map((l) => (
          <div key={l.layerKey} className={`rounded-lg border p-4 ${card}`}>
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded mb-2 ${l.color}`}
            >
              {t(l.layerKey)}
            </span>
            <p
              className={`text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t(l.descKey)}
            </p>
            <div className="flex flex-wrap gap-1">
              {l.memberKeys.map((m) => (
                <span
                  key={m}
                  className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
                >
                  {t(m)}
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
          {t("securityOverview.attribution")}
        </h4>
        <table
          className={`w-full text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          <thead>
            <tr
              className={`text-left ${isDark ? "text-gray-500" : "text-gray-500"}`}
            >
              <th className="py-1.5 pr-3 font-medium">
                {t("securityOverview.colBlock")}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("securityOverview.colLevel")}
              </th>
              <th className="py-1.5 font-medium">
                {t("securityOverview.colQuestion")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">{t("settings.trustedWorkspaces")}</td>
              <td className="py-2 pr-3">{t("settings.safetyLayerSystem")}</td>
              <td className="py-2">{t("settings.wsBannerQuestion")}</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">{t("settings.customRules")}</td>
              <td className="py-2 pr-3">{t("settings.safetyLayerSystem")}</td>
              <td className="py-2">{t("settings.rulesBannerQuestion")}</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">{t("securityOverview.perm")}</td>
              <td className="py-2 pr-3">{t("securityOverview.userApp")}</td>
              <td className="py-2">{t("securityOverview.permQuestion")}</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">{t("settings.apiKeys")}</td>
              <td className="py-2 pr-3">{t("settings.safetyLayerUser")}</td>
              <td className="py-2">{t("securityOverview.apiKeyQuestion")}</td>
            </tr>
            <tr className="border-t dark:border-gray-700 border-gray-200">
              <td className="py-2 pr-3">{t("settings.oauth")}</td>
              <td className="py-2 pr-3">{t("securityOverview.userPending")}</td>
              <td className="py-2">{t("securityOverview.oauthQuestion")}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 常见疑问 */}
      <div className={`rounded-lg border p-4 ${card}`}>
        <h4
          className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          {t("securityOverview.faq")}
        </h4>
        <div className="space-y-3">
          {FAQ_ITEMS.map((f) => (
            <div key={f.qKey}>
              <p
                className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
              >
                {t(f.qKey)}
              </p>
              <p
                className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t(f.aKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SecurityOverviewContent;
