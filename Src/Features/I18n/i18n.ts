/** Local Chinese and English interface resources. See LICENSE.md. */
import i18next from 'i18next';
import { getLanguage } from 'obsidian';
import type { App } from 'obsidian';
import en from "../../../Data/I18n/en.json";
import zh from "../../../Data/I18n/zh.json";

function getInterfaceLanguage(): 'zh' | 'en' {
  try {
    const language = getLanguage();
    return typeof language === 'string' && /^zh(?:$|[-_])/i.test(language) ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export async function initializeI18n(_app: App, _pluginId: string): Promise<void> {
  await i18next.init({
    lng: getInterfaceLanguage(),
    supportedLngs: ['zh', 'en'],
    fallbackLng: 'en',
    resources: { en: { translation: en }, zh: { translation: zh } },
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false
  });
}

export const i18n = i18next;

export const t = (key: string, options?: Record<string, string | number | null>): string => {
  return i18next.t(key, options);
};
