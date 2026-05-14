import type { Locale, TranslationMap, I18nRegistryOptions } from "./types.js";

function resolveTranslation(map: TranslationMap, key: string): string | undefined {
  const parts = key.split(".");
  let current: TranslationMap | string | undefined = map;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = current[part];
  }

  return typeof current === "string" ? current : undefined;
}

function setNestedValue(map: TranslationMap, key: string, value: string): void {
  const parts = key.split(".");
  let current = map;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as TranslationMap;
  }

  current[parts[parts.length - 1]] = value;
}

function interpolate(text: string, params?: Record<string, string>): string {
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    return params[name] ?? `{${name}}`;
  });
}

export class I18nRegistry {
  private translations = new Map<Locale, TranslationMap>();
  private defaultLocale: Locale;
  private fallbackLocales: Locale[];

  constructor(options?: I18nRegistryOptions) {
    this.defaultLocale = options?.defaultLocale ?? "en";
    this.fallbackLocales = options?.fallbackLocales ?? [];
  }

  registerTranslation(locale: Locale, map: TranslationMap): void {
    const existing = this.translations.get(locale) ?? {};
    this.translations.set(locale, { ...existing, ...map });
  }

  registerEntry(locale: Locale, key: string, value: string): void {
    let map = this.translations.get(locale);
    if (!map) {
      map = {};
      this.translations.set(locale, map);
    }
    setNestedValue(map, key, value);
  }

  t(
    key: string,
    params?: Record<string, string>,
    locale?: Locale,
  ): string {
    const locales = this.buildLocaleChain(locale);

    for (const loc of locales) {
      const map = this.translations.get(loc);
      if (!map) {
        continue;
      }
      const value = resolveTranslation(map, key);
      if (value !== undefined) {
        return interpolate(value, params);
      }
    }

    return key;
  }

  setDefaultLocale(locale: Locale): void {
    this.defaultLocale = locale;
  }

  getDefaultLocale(): Locale {
    return this.defaultLocale;
  }

  getSupportedLocales(): Locale[] {
    return Array.from(this.translations.keys());
  }

  hasTranslation(locale: Locale, key: string): boolean {
    const map = this.translations.get(locale);
    if (!map) {
      return false;
    }
    return resolveTranslation(map, key) !== undefined;
  }

  private buildLocaleChain(requested?: Locale): Locale[] {
    const chain: Locale[] = [];
    const seen = new Set<Locale>();

    if (requested && requested !== this.defaultLocale) {
      chain.push(requested);
      seen.add(requested);
    }

    if (!seen.has(this.defaultLocale)) {
      chain.push(this.defaultLocale);
      seen.add(this.defaultLocale);
    }

    for (const fallback of this.fallbackLocales) {
      if (!seen.has(fallback)) {
        chain.push(fallback);
        seen.add(fallback);
      }
    }

    return chain;
  }
}
