/**
 * 设计系统组件（UI样式常量 + 布局辅助）
 */
export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  borderRadius: Record<string, number>;
  fontSize: Record<string, number>;
}

export const designTokens: DesignTokens = {
  colors: {
    primary: '#6c63ff',
    primaryLight: '#8b83ff',
    primaryDark: '#4a42cc',
    success: '#44bb44',
    warning: '#ffaa44',
    error: '#ff4444',
    info: '#44aaff',
    bg: '#1a1a2e',
    bgLight: '#2a2a4e',
    fg: '#e0e0e0',
    fgDim: '#8888aa',
    border: '#444466',
    selection: '#6c63ff44',
  },
  spacing: { xs: 1, sm: 2, md: 4, lg: 8, xl: 16 },
  borderRadius: { sm: 4, md: 8, lg: 12 },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 24 },
} as const;

export type ColorToken = keyof typeof designTokens.colors;
export type SpacingToken = keyof typeof designTokens.spacing;

export function color(name: ColorToken): string {
  return designTokens.colors[name];
}

export function space(name: SpacingToken): number {
  return designTokens.spacing[name];
}

export interface BadgeStyle {
  label: string;
  bg: string;
  fg: string;
}

export function statusBadge(status: string): BadgeStyle {
  switch (status) {
    case 'success': case 'ok': return { label: 'OK', bg: color('success'), fg: '#fff' };
    case 'warning': return { label: 'WARN', bg: color('warning'), fg: '#000' };
    case 'error': case 'fail': return { label: 'ERR', bg: color('error'), fg: '#fff' };
    case 'info': return { label: 'INFO', bg: color('info'), fg: '#fff' };
    default: return { label: status.toUpperCase(), bg: color('border'), fg: color('fg') };
  }
}
