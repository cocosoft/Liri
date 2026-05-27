export type { Locale, TranslationMap, I18nRegistryOptions } from './types.js';

export { I18nRegistry } from './registry.js';
export {
  I18nTranslationRegistry,
  getI18nTranslationRegistry,
  t,
  initializeBuiltinTranslations,
} from './extended';
export type { TranslationEntry, SupportedLocale } from './extended';
