import { getLanguage, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import { initializeI18n, i18n, t } from './i18n';

function offlineApp() {
  const adapter = {
    exists: jest.fn().mockRejectedValue(new Error('No file access')),
    read: jest.fn().mockRejectedValue(new Error('No file access')),
    write: jest.fn().mockRejectedValue(new Error('No file access'))
  };
  return { app: { vault: { adapter } } as unknown as App, adapter };
}

describe('bundled interface languages', () => {
  beforeEach(() => {
    (getLanguage as jest.Mock).mockReset().mockReturnValue('en');
    (requestUrl as jest.Mock).mockClear();
  });

  it('loads the English interface', async () => {
    await initializeI18n(offlineApp().app, 'calendar-test');
    expect(i18n.language).toBe('en');
    expect(t('commands.newEvent')).toBe('New Event');
    expect(t('commands.resetCache')).toBe('Reset Event Cache');
  });

  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'zh_CN'])(
    'loads Chinese offline for %s without reading old caches', async language => {
      (getLanguage as jest.Mock).mockReturnValue(language);
      const { app, adapter } = offlineApp();
      await initializeI18n(app, 'calendar-test');
      expect(i18n.language).toBe('zh');
      expect(t('commands.newEvent')).toBe('新建事件');
      expect(requestUrl).not.toHaveBeenCalled();
      expect(adapter.exists).not.toHaveBeenCalled();
      expect(adapter.read).not.toHaveBeenCalled();
      expect(adapter.write).not.toHaveBeenCalled();
    }
  );

  it.each(['de', 'fr', 'en-GB', undefined])('uses English for %s', async language => {
    (getLanguage as jest.Mock).mockReturnValue(language);
    await initializeI18n(offlineApp().app, 'calendar-test');
    expect(i18n.language).toBe('en');
    expect(t('commands.newEvent')).toBe('New Event');
  });

  it('uses English if language detection fails', async () => {
    (getLanguage as jest.Mock).mockImplementation(() => { throw new Error('Unavailable'); });
    await initializeI18n(offlineApp().app, 'calendar-test');
    expect(t('commands.newEvent')).toBe('New Event');
  });

  it('falls back to English when a Chinese label is missing', async () => {
    (getLanguage as jest.Mock).mockReturnValue('zh');
    await initializeI18n(offlineApp().app, 'calendar-test');
    i18n.addResource('en', 'translation', 'testOnly.englishFallback', 'English fallback');
    expect(t('testOnly.englishFallback')).toBe('English fallback');
    delete i18n.getResourceBundle('en', 'translation').testOnly;
  });

  it('keeps interpolation and returns unknown keys', async () => {
    await initializeI18n(offlineApp().app, 'calendar-test');
    expect(t('notices.providerNotRegistered', { providerType: 'CalDAV' })).toBe(
      'CalDAV provider is not registered.'
    );
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
});
