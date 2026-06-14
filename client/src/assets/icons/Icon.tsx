/**
 * 图标组件 — 按需动态加载图标分类模块，按类别 chunk 分离
 */
import { useState, useEffect, createElement, type ComponentType } from "react";

interface IconProps {
  name: string;
  className?: string;
  size?: number;
  color?: string;
}

type IconComponent = ComponentType<{ className?: string; size?: number; color?: string }>;

// 分类加载缓存（按模块 chunk 分离，不会一次性加载所有图标）
const categoryCache: Record<string, Record<string, IconComponent>> = {};

// 单图标缓存（名称 → 组件）
const iconCache: Record<string, IconComponent> = {};

// 缺失图标记录（避免重复尝试）
const missingIcons = new Set<string>();

/** 按分类动态加载图标模块 chunk */
async function loadCategory(category: string): Promise<Record<string, IconComponent>> {
  if (categoryCache[category]) return categoryCache[category];
  const mod = await import(`./${category}.tsx`);
  categoryCache[category] = mod as Record<string, IconComponent>;
  return categoryCache[category];
}

/** 顺序尝试所有分类查找图标 */
async function resolveIcon(lowerName: string): Promise<IconComponent | null> {
  // 已缓存
  if (iconCache[lowerName]) return iconCache[lowerName];
  if (missingIcons.has(lowerName)) return null;

  const iconKey = `${capitalize(lowerName)}Icon`;

  // 依次尝试 navigation → actions → status
  for (const category of ["navigation", "actions", "status"]) {
    try {
      const icons = await loadCategory(category);
      const comp = icons[iconKey];
      if (comp) {
        iconCache[lowerName] = comp;
        return comp;
      }
    } catch {
      // 模块加载失败，继续尝试下一个
    }
  }

  missingIcons.add(lowerName);
  console.warn(`Icon "${lowerName}" not found in any category`);
  return null;
}

export default function Icon({ name, className = "", size = 24, color = "currentColor" }: IconProps) {
  const lowerName = name.toLowerCase();
  const [Component, setComponent] = useState<IconComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveIcon(lowerName).then((comp) => {
      if (!cancelled) setComponent(() => comp);
    });
    return () => { cancelled = true; };
  }, [lowerName]);

  if (!Component) return null;
  return createElement(Component, { className, size, color });
}

/** 首字母大写（如 "home" → "Home"） */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}