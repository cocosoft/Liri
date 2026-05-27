export type Locale = string;

export interface TranslationMap {
  [key: string]: string | TranslationMap;
}

export type I18nRegistryOptions = {
  defaultLocale?: Locale;
  fallbackLocales?: Locale[];
};
