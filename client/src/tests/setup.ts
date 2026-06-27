import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

// jsdom 环境下每个测试后自动清理
afterEach(() => {
  document.body.innerHTML = '';
});

// Mock react-i18next 避免测试环境 NO_I18NEXT_INSTANCE 警告，保证 t() 返回原始 key
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: {},
}));
