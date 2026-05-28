import type { ThemeToken } from './types';

export const baseTokens: ThemeToken = {
  color: {
    primary: '#3B82F6',
    secondary: '#6366F1',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#06B6D4',
    background: {
      primary: '#FFFFFF',
      secondary: '#F9FAFB',
      tertiary: '#F3F4F6',
      elevated: '#FFFFFF',
    },
    text: {
      primary: '#111827',
      secondary: '#4B5563',
      tertiary: '#9CA3AF',
      disabled: '#D1D5DB',
    },
    border: {
      default: '#E5E7EB',
      hover: '#D1D5DB',
      active: '#9CA3AF',
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    xxl: '3rem',
  },
  radius: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },
};

export const darkTokens: ThemeToken = {
  ...baseTokens,
  color: {
    ...baseTokens.color,
    primary: '#60A5FA',
    secondary: '#818CF8',
    success: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    info: '#22D3EE',
    background: {
      primary: '#111827',
      secondary: '#1F2937',
      tertiary: '#374151',
      elevated: '#1F2937',
    },
    text: {
      primary: '#F9FAFB',
      secondary: '#D1D5DB',
      tertiary: '#9CA3AF',
      disabled: '#6B7280',
    },
    border: {
      default: '#374151',
      hover: '#4B5563',
      active: '#6B7280',
    },
  },
};

export const getTokens = (mode: 'light' | 'dark'): ThemeToken => {
  return mode === 'dark' ? darkTokens : baseTokens;
};