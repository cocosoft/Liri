/**
 * ModuleCard — 办公模块卡片组件
 * 从 OfficePage 提取，供入口页和子页面复用
 */

import { useNavigate } from "react-router-dom";
import { OfficeStatusBadge } from "./OfficeStatusBadge";
import type { ModuleCardStatus } from "./OfficeStatusBadge";

/** 模块卡片 Props */
interface ModuleCardProps {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  description: string;
  status: ModuleCardStatus;
  statusText: string;
  path: string;
}

/** 办公模块入口卡片 */
export function ModuleCard({
  id,
  name,
  icon: IconComp,
  description,
  status,
  statusText,
  path,
}: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <div
      key={id}
      onClick={() => navigate(path)}
      className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 cursor-pointer
        hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:scale-[1.02]
        active:scale-[0.98] transition-all duration-200 ease-in-out"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
          <IconComp className="text-blue-600 dark:text-blue-400" size={20} />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {name}
          </h2>
          <OfficeStatusBadge status={status} text={statusText} />
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
    </div>
  );
}
