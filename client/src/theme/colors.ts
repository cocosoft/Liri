import type { ThemeColors } from './types';

export const lightColors: ThemeColors = {
  primary: '#3B82F6',
  secondary: '#6366F1',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  background: {
    primary: '#FFFFFF',
    secondary: '#F9FAFB',
    tertiary: '#F3F4F6',
  },
  text: {
    primary: '#111827',
    secondary: '#4B5563',
    tertiary: '#9CA3AF',
  },
  border: '#E5E7EB',
  card: '#FFFFFF',
};

export const darkColors: ThemeColors = {
  primary: '#60A5FA',
  secondary: '#818CF8',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  background: {
    primary: '#111827',
    secondary: '#1F2937',
    tertiary: '#374151',
  },
  text: {
    primary: '#F9FAFB',
    secondary: '#D1D5DB',
    tertiary: '#9CA3AF',
  },
  border: '#374151',
  card: '#1F2937',
};

export const getColors = (mode: 'light' | 'dark'): ThemeColors => {
  return mode === 'dark' ? darkColors : lightColors;
};