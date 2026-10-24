import { showNotice } from "../../Utils/showNotice";
/**
 * @file SettingsTab.tsx
 * @brief Implements the Full Calendar plugin's settings tab UI for Obsidian.
 *
 * @description
 * This file defines the `FullCalendarSettingTab` class, which extends Obsidian's
 * `PluginSettingTab`. It acts as an orchestrator, calling dedicated rendering
 * modules for each section of the settings UI.
 *
 * @exports FullCalendarSettingTab
 * @exports ensureCalendarIds
 *
 * @license See LICENSE.md
 */

import { PluginState } from "../../Core/PluginState";
import FullCalendarPlugin from '../../main';
import { App, DropdownComponent, setIcon, Setting, TFile, TFolder } from 'obsidian';

import ReactModal from '../ReactModal';
import * as ReactDOM from 'react-dom/client';
import React, { createElement, createRef } from 'react';

import { CalendarSettingsRef } from "./Sections/Calendars/CalendarSetting";
import { getDailyNoteSettings } from 'obsidian-daily-notes-interface';
import { CalendarInfo } from "../../Types/calendar_settings";
import { ProviderRegistry } from "../../Providers/ProviderRegistry";
import { makeDefaultPartialCalendarSource } from "../../Types/calendar_settings";

import { generateCalendarId } from "../../Types/calendar_settings";
import { t } from "../../Features/I18n/i18n";
import { createDescWithDocs, createDocsLinksFragment } from './docsLinks';

import { canAddCalendarOfType } from './calendarSourceValidation';
import { CredentialStore } from "../../Features/Credentials/CredentialStore";

// Import the new React components

type SettingsCategoryId = 'general' | 'appearance' | 'calendars' | 'organization' | 'integrations';

interface SettingsCategory {
  id: SettingsCategoryId;
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'general'
  },
  {
    id: 'appearance'
  },
  {
    id: 'calendars'
  },
  {
    id: 'organization'
  },
  {
    id: 'integrations'
  }
];

function getCategoryLabel(id: SettingsCategoryId): string {
  switch (id) {
    case 'general':
      return t('settings.categories.general.label');
    case 'appearance':
      return t('settings.categories.appearance.label');
    case 'calendars':
      return t('settings.categories.calendars.label');
    case 'organization':
      return t('settings.categories.organization.label');
    case 'integrations':
      return t('settings.categories.integrations.label');
  }
}

function getCategoryDescription(id: SettingsCategoryId): string {
  switch (id) {
    case 'general':
      return t('settings.categories.general.description');
    case 'appearance':
      return t('settings.categories.appearance.description');
    case 'calendars':
      return t('settings.categories.calendars.description');
    case 'organization':
      return t('settings.categories.organization.description');
    case 'integrations':
      return t('settings.categories.integrations.description');
  }
}

export function addCalendarButton(
  plugin: FullCalendarPlugin,
  containerEl: HTMLElement,
  submitCallback: (setting: CalendarInfo | CalendarInfo[]) => void,
  listUsedDirectories?: () => string[]
) {
  let dropdown: DropdownComponent;

  return new Setting(containerEl)
    .setName(t('settings.calendars.title'))
    .setDesc(t('settings.calendars.addCalendar'))
    .addDropdown(
      d =>
        (dropdown = d.addOptions({
          local: t('settings.calendars.types.local'),
          dailynote: t('settings.calendars.types.dailynote'),
          journals: t('settings.calendars.types.journals'),
          icloud: t('settings.calendars.types.icloud'),
          caldav: t('settings.calendars.types.caldav'),
          caldavtasks: t('settings.calendars.types.caldavTasks'),
          ical: t('settings.calendars.types.ical'),
          google: t('settings.calendars.types.google'),
          googletasks: 'Google Tasks',
          outlook: t('settings.calendars.types.outlook'),
          tasks: t('settings.calendars.types.tasks'),
          tasknotes: t('settings.calendars.types.tasknotes'),
          bases: t('settings.calendars.types.bases'),
          holidays: t('settings.calendars.types.holidays')
        }))
    )
    .addExtraButton(button => {
      button.setTooltip(t('settings.calendars.addCalendarTooltip'));
      button.setIcon('plus-with-circle');
      button.onClick(async () => {
        const sourceType = dropdown.getValue();

        if (sourceType === 'bases') {
          const app = plugin.app as unknown as {
            internalPlugins?: { getPluginById: (id: string) => unknown };
            plugins?: { getPlugin: (id: string) => unknown };
          };
          const basesPlugin =
            app.internalPlugins?.getPluginById('bases') || app.plugins?.getPlugin('bases');
          if (!basesPlugin) {
            showNotice(t('modals.workspace.fields.notices.enableBases'));
            return;
          }
        }

        const providerType = sourceType === 'icloud' ? 'caldav' : sourceType;

        const providerClass =
          await PluginState.getProviderRegistry().getProviderForType(providerType);
        if (!providerClass) {
          showNotice(t('notices.providerNotRegistered', { providerType }));
          return;
        }
        // Provider classes expose a static getConfigurationComponent; keep a loose unknown cast locally.
        const ConfigComponent = (
          providerClass as unknown as {
            // Providers expose a static method returning a React component.
            getConfigurationComponent(): React.ComponentType<Record<string, unknown>>;
          }
        ).getConfigurationComponent();

        const modal = new ReactModal(plugin.app, async () => {
          await PluginState.loadSettings();

          const usedDirectories = listUsedDirectories ? listUsedDirectories() : [];
          const directories = plugin.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map(f => f.path);

          let headings: string[] = [];
          let { template } = getDailyNoteSettings();
          if (template) {
            if (!template.endsWith('.md')) template += '.md';
            const file = plugin.app.vault.getAbstractFileByPath(template);
            if (file instanceof TFile) {
              headings =
                plugin.app.metadataCache.getFileCache(file)?.headings?.map(h => h.heading) || [];
            }
          }

          const existingCalendarColors = PluginState.getSettings().calendarSources.map(
            s => s.color
          );

          const initialConfig =
            sourceType === 'icloud'
              ? { url: 'https://caldav.icloud.com' }
              : sourceType === 'journals'
                ? { provider: 'journals' }
                : sourceType === 'dailynote'
                  ? { provider: 'daily-notes' }
                  : {};

          // Base props for all provider components
          // Minimal shared config component props; provider-specific components can accept additional fields.
          interface BaseConfigProps {
            plugin: FullCalendarPlugin;
            config: Record<string, unknown>;
            context: {
              allDirectories: string[];
              usedDirectories: string[];
              headings: string[];
            };
            onClose: () => void;
            onConfigChange: (c: Record<string, unknown>) => void;
            onSave: (
              finalConfigs: Record<string, unknown> | Record<string, unknown>[],
              accountId?: string
            ) => void;
          }
          const componentProps: BaseConfigProps = {
            plugin: plugin, // Pass plugin for GoogleConfigComponent
            config: initialConfig,
            context: {
              allDirectories: directories.filter(dir => usedDirectories.indexOf(dir) === -1),
              usedDirectories: usedDirectories,
              headings: headings
            },
            onClose: () => modal.close(),
            onConfigChange: (): void => {
              /* no-op */
            },
            onSave: (
              finalConfigs: Record<string, unknown> | Record<string, unknown>[],
              accountId?: string
            ): void => {
              void (async () => {
                const configs = Array.isArray(finalConfigs) ? finalConfigs : [finalConfigs];

                // Validate: only one dailynote source allowed
                if (
                  !canAddCalendarOfType(
                    providerType as CalendarInfo['type'],
                    PluginState.getSettings().calendarSources
                  )
                ) {
                  showNotice(t('settings.warnings.oneDailyNote'));
                  modal.close();
                  return;
                }
                // Collect IDs from both settings and ProviderRegistry to prevent race conditions
                const settingsIds = PluginState.getSettings().calendarSources.map(s => s.id);
                const registryIds = PluginState.getProviderRegistry()
                  .getAllSources()
                  .map(s => s.id);
                const existingIds = Array.from(new Set([...settingsIds, ...registryIds]));

                const finalSources: CalendarInfo[] = [];

                for (const finalConfig of configs) {
                  const effectiveType =
                    typeof finalConfig.type === 'string' && finalConfig.type
                      ? (finalConfig.type as CalendarInfo['type'])
                      : (providerType as CalendarInfo['type']);

                  const candidateId =
                    typeof finalConfig.id === 'string' &&
                    finalConfig.id &&
                    !existingIds.includes(finalConfig.id) &&
                    providerType !== 'google' &&
                    providerType !== 'googletasks' &&
                    providerType !== 'outlook'
                      ? finalConfig.id
                      : generateCalendarId(effectiveType, existingIds);
                  existingIds.push(candidateId);

                  const partialSource = makeDefaultPartialCalendarSource(
                    effectiveType,
                    existingCalendarColors
                  );

                  if (sourceType === 'journals') {
                    const journalId = finalConfig.journalId;
                    partialSource.name =
                      typeof journalId === 'string' && journalId.length > 0
                        ? `${t('settings.calendars.defaults.journals')}: ${journalId}`
                        : t('settings.calendars.defaults.journals');
                  }

                  const color =
                    typeof finalConfig.color === 'string' && finalConfig.color
                      ? finalConfig.color
                      : partialSource.color;

                  // Create the full, valid CalendarInfo object first.
                  const finalSource = {
                    ...partialSource,
                    ...finalConfig,
                    id: candidateId,
                    color,
                    ...(providerType === 'google' && accountId && { googleAccountId: accountId }),
                    ...(providerType === 'googletasks' &&
                      accountId && { googleAccountId: accountId }),
                    ...(providerType === 'outlook' &&
                      accountId && { microsoftAccountId: accountId }),
                    // For Google, the config's 'id' is the calendarId for the API.
                    ...((providerType === 'google' || providerType === 'outlook') && {
                      calendarId: finalConfig.id as string
                    }),
                    ...(providerType === 'googletasks' && {
                      listId: finalConfig.id as string
                    })
                  } as CalendarInfo;

                  if (
                    (effectiveType === 'caldav' || effectiveType === 'caldavtasks') &&
                    typeof finalConfig.password === 'string' &&
                    finalConfig.password
                  ) {
                    CredentialStore.setCalDAVPassword(finalSource.id, finalConfig.password);
                  }

                  // Add the provider instance to the registry BEFORE updating the UI.
                  await PluginState.getProviderRegistry().addInstance(finalSource);

                  finalSources.push(finalSource);
                  existingCalendarColors.push(finalSource.color);
                }

                if (finalSources.length > 0) {
                  submitCallback(finalSources.length === 1 ? finalSources[0] : finalSources);
                }
                modal.close();
              })();
            }
          };

          return createElement(
            ConfigComponent,
            componentProps as unknown as Record<string, unknown>
          );
        });
        modal.open();
      });
    });
}

export class FullCalendarSettingTab {
  app: App;
  plugin: FullCalendarPlugin;
  containerEl!: HTMLElement;

  private activeCategory: SettingsCategoryId = 'general';
  private searchQuery = '';
  private searchExpanded = false;
  private searchDebounceId: number | null = null;
  private calendarSettingsRef: React.RefObject<CalendarSettingsRef | null> =
    createRef<CalendarSettingsRef>();
  registry: ProviderRegistry;
  private reactRoots: ReactDOM.Root[] = [];

  constructor(app: App, plugin: FullCalendarPlugin, registry: ProviderRegistry) {
    this.app = app;
    this.plugin = plugin;
    this.registry = registry;
  }

  public registerReactRoot(root: ReactDOM.Root): void {
    this.reactRoots.push(root);
  }

  public unmountReactRoots(): void {
    this.reactRoots.forEach(root => {
      try {
        root.unmount();
      } catch (e) {
        console.warn('Full Calendar: Failed to unmount React root', e);
      }
    });
    this.reactRoots = [];
  }

  hide(): void {
    void PluginState.flushDebouncedSave();
    this.unmountReactRoots();
  }

  display(): void {
    this.renderSettings();
  }

  renderSettings(): void {
    this.unmountReactRoots();
    void (async () => {
      this.containerEl.empty();
      await this._renderMainSettings();
    })();
  }

  private async _renderMainSettings(): Promise<void> {
    const shellEl = this.containerEl.createDiv('full-calendar-settings-shell');
    const headerEl = shellEl.createDiv('full-calendar-settings-header');
    headerEl.createEl('p', {
      text: t('global.settingsHeader')
    });

    const tabsRowEl = shellEl.createDiv('full-calendar-settings-tabs-row');
    tabsRowEl.addClass('full-calendar-settings-tabs-row');

    const tabsEl = tabsRowEl.createDiv('full-calendar-settings-tabs');
    SETTINGS_CATEGORIES.forEach(category => {
      const isActive = category.id === this.activeCategory;
      const button = tabsEl.createEl('button', {
        cls: `full-calendar-settings-tab${isActive ? ' is-active' : ''}`,
        text: getCategoryLabel(category.id)
      });
      button.type = 'button';
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (this.activeCategory === category.id) {
          return;
        }
        this.activeCategory = category.id;
        this.renderSettings();
      });
    });

    const contentEl = shellEl.createDiv('full-calendar-settings-content');

    const searchWrapEl = tabsRowEl.createDiv('full-calendar-settings-search-wrap');
    searchWrapEl.addClass('full-calendar-settings-search-wrap-style');

    const searchButtonEl = searchWrapEl.createEl('button', {
      cls: 'clickable-icon full-calendar-settings-search-trigger'
    });
    searchButtonEl.type = 'button';
    searchButtonEl.ariaLabel = 'Search settings';
    searchButtonEl.addClass('full-calendar-settings-search-button-style');
    setIcon(searchButtonEl, 'search');

    const inputWrapEl = searchWrapEl.createDiv('full-calendar-settings-search-input-wrap');
    inputWrapEl.setCssProps({
      position: 'relative',
      width: this.searchExpanded || this.searchQuery ? '170px' : '0px',
      overflow: 'hidden',
      transition: 'width 140ms ease'
    });

    const searchInputEl = inputWrapEl.createEl('input', {
      cls: 'full-calendar-settings-search-input'
    });
    searchInputEl.type = 'text';
    searchInputEl.placeholder = 'Search settings...';
    searchInputEl.value = this.searchQuery;
    searchInputEl.addClass('full-calendar-settings-search-input-style');

    const clearButtonEl = inputWrapEl.createEl('button', {
      cls: 'clickable-icon full-calendar-settings-search-clear'
    });
    clearButtonEl.type = 'button';
    clearButtonEl.ariaLabel = 'Clear search';
    clearButtonEl.setCssProps({
      position: 'absolute',
      right: '6px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: this.searchQuery ? 'inline-flex' : 'none'
    });
    setIcon(clearButtonEl, 'x');

    const renderSearchResults = () => {
      void this._renderSettingsContent(contentEl);
      clearButtonEl.setCssProps({ display: this.searchQuery ? 'inline-flex' : 'none' });
      searchButtonEl.setCssProps({
        display: this.searchExpanded || !!this.searchQuery ? 'none' : 'inline-flex'
      });
      searchButtonEl.toggleClass('is-active', this.searchExpanded || !!this.searchQuery);
      inputWrapEl.toggleClass('is-active-query', !!this.searchQuery);
    };

    searchButtonEl.addEventListener('click', () => {
      this.searchExpanded = true;
      inputWrapEl.setCssProps({ width: '170px' });
      searchButtonEl.setCssProps({ display: 'none' });
      searchInputEl.focus();
      searchButtonEl.toggleClass('is-active', true);
    });

    searchInputEl.addEventListener('blur', () => {
      if (this.searchQuery) return;
      this.searchExpanded = false;
      inputWrapEl.setCssProps({ width: '0px' });
      searchButtonEl.setCssProps({ display: 'inline-flex' });
      searchButtonEl.toggleClass('is-active', false);
    });

    searchInputEl.addEventListener('input', () => {
      this.searchQuery = searchInputEl.value;
      if (this.searchDebounceId !== null) {
        window.clearTimeout(this.searchDebounceId);
      }
      this.searchDebounceId = window.setTimeout(renderSearchResults, 80);
    });

    clearButtonEl.addEventListener('mousedown', evt => {
      evt.preventDefault();
      this.searchQuery = '';
      searchInputEl.value = '';
      renderSearchResults();
      searchInputEl.focus();
    });

    await this._renderSettingsContent(contentEl);

    const { renderFooter } = await import("./Sections/Calendars/renderFooter");
    renderFooter(shellEl);
  }

  private async _renderSettingsContent(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    const query = this.searchQuery.trim();

    if (!query) {
      const activeCategory = SETTINGS_CATEGORIES.find(
        category => category.id === this.activeCategory
      );
      const introEl = containerEl.createDiv('full-calendar-settings-category-intro');
      if (activeCategory) {
        introEl.createEl('p', { text: getCategoryDescription(activeCategory.id) });
      }
      const panelEl = containerEl.createDiv('full-calendar-settings-panel');
      await this._renderActiveCategory(panelEl, this.activeCategory);
      return;
    }

    let hasAnyMatches = false;
    for (const category of SETTINGS_CATEGORIES) {
      const sectionEl = containerEl.createDiv('full-calendar-settings-search-section');
      const introEl = sectionEl.createDiv('full-calendar-settings-category-intro');
      new Setting(introEl).setName(getCategoryLabel(category.id)).setHeading();
      introEl.createEl('p', { text: getCategoryDescription(category.id) });

      const panelEl = sectionEl.createDiv('full-calendar-settings-panel');
      await this._renderActiveCategory(panelEl, category.id);

      const sectionHasMatches = this._applySearchFilter(panelEl, query);
      if (!sectionHasMatches) {
        sectionEl.remove();
      } else {
        hasAnyMatches = true;
      }
    }

    if (!hasAnyMatches) {
      const emptyEl = containerEl.createDiv('full-calendar-settings-search-empty');
      emptyEl.createEl('p', {
        text: `No settings match "${query}".`
      });
    }
  }

  private _applySearchFilter(containerEl: HTMLElement, query: string): boolean {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const settingEls = Array.from(containerEl.querySelectorAll<HTMLElement>('.setting-item'));

    let visibleCount = 0;
    settingEls.forEach(settingEl => {
      const titleEl = settingEl.querySelector<HTMLElement>('.setting-item-name');
      const descriptionEl = settingEl.querySelector<HTMLElement>('.setting-item-description');
      const title = titleEl?.textContent ?? '';
      const description = descriptionEl?.textContent ?? '';
      const haystack = `${title} ${description}`.toLowerCase();

      // Strict search: every token must appear in visible title/description text.
      const isMatch = tokens.every(token => haystack.includes(token));
      settingEl.setCssProps({ display: isMatch ? '' : 'none' });
      if (isMatch) {
        this._highlightSearchTokens(titleEl, tokens);
        this._highlightSearchTokens(descriptionEl, tokens);
        visibleCount += 1;
      }
    });

    return visibleCount > 0;
  }

  private _highlightSearchTokens(el: HTMLElement | null, tokens: string[]): void {
    if (!el) {
      return;
    }
    const rawText = el.textContent ?? '';
    if (!rawText || tokens.length === 0) {
      return;
    }

    const escapedTokens = tokens
      .filter(Boolean)
      .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escapedTokens.length === 0) {
      return;
    }

    const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
    const fragment = createFragment();
    let lastIndex = 0;

    for (const match of rawText.matchAll(regex)) {
      const matchText = match[0];
      const matchIndex = match.index ?? -1;
      if (matchIndex < 0) {
        continue;
      }

      if (matchIndex > lastIndex) {
        fragment.append(rawText.slice(lastIndex, matchIndex));
      }

      const markEl = createEl('mark', { text: matchText });
      fragment.append(markEl);
      lastIndex = matchIndex + matchText.length;
    }

    if (lastIndex < rawText.length) {
      fragment.append(rawText.slice(lastIndex));
    }

    el.empty();
    el.append(fragment);
  }

  private async _renderActiveCategory(
    containerEl: HTMLElement,
    categoryId: SettingsCategoryId
  ): Promise<void> {
    switch (categoryId) {
      case 'general': {
        const [
          { renderGeneralSettings },
          { renderRemindersSettings },

          { renderBreakTimerSettings }
        ] = await Promise.all([
          import("./Sections/renderGeneral"),
          import("../../Features/Notifications/Ui/renderReminders"),

          import("../../Features/Break_timer/Ui/renderBreakTimerSettings")
        ]);

        this._renderInitialSetupNotice(containerEl);
        renderGeneralSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderRemindersSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderBreakTimerSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });

        break;
      }
      case 'appearance': {
        const [{ renderAppearanceSettings }] = await Promise.all([
          import("./Sections/renderAppearance")
        ]);
        renderAppearanceSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        break;
      }
      case 'calendars': {
        const [{ renderCalendarManagement }] = await Promise.all([
          import("./Sections/renderCalendars")
        ]);
        renderCalendarManagement(
          containerEl,
          this,
          this.calendarSettingsRef as unknown as React.RefObject<CalendarSettingsRef>
        );
        break;
      }
      case 'organization': {
        const [{ renderWorkspaceSettings }, { renderCategorizationSettings }] = await Promise.all([
          import("../../Features/Workspaces/Ui/renderWorkspaces"),
          import("../../Features/Category/Ui/renderCategorization")
        ]);

        renderWorkspaceSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderCategorizationSettings(containerEl, this, () => {
          this.renderSettings();
        });
        break;
      }
      case 'integrations': {
        const [
          { renderActivityWatchSettings },
          { renderGoogleSettings },
          { renderOutlookSettings },
          { renderTasksIntegrationSettings },
          { renderTaskNotesIntegrationSettings },
          { renderApiAccessSettings },
          { renderFcrReminderSettings },
          { renderCredentialsSettings },

        ] = await Promise.all([
          import("../../Features/Activitywatch/Ui/renderActivityWatch"),
          import("../../Providers/Google/Ui/renderGoogle"),
          import("../../Providers/Outlook/Ui/renderOutlook"),
          import("../../Providers/Tasks/renderTasksIntegration"),
          import("../../Providers/Tasknotes/renderTaskNotesIntegration"),
          import("./Sections/renderApiAccess"),
          import("../../Features/Fcr_reminder/Ui/renderFcrReminder"),
          import("../../Features/Credentials/Ui/renderCredentialsSettings"),

        ]);

        renderCredentialsSettings(containerEl, () => {
          this.renderSettings();
        });

        renderActivityWatchSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderTasksIntegrationSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderTaskNotesIntegrationSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderFcrReminderSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderGoogleSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderOutlookSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });
        renderApiAccessSettings(containerEl, this.plugin, () => {
          this.renderSettings();
        });

        break;
      }
    }
  }

  private _renderInitialSetupNotice(containerEl: HTMLElement): void {
    if (PluginState.getSettings().calendarSources.length === 0) {
      const notice = containerEl.createDiv('full-calendar-initial-setup-notice');
      new Setting(notice).setName('').setHeading();
      notice.createEl('p', {
        text: t('settings.quickStart.description')
      });
      const docsPara = notice.createEl('p');
      docsPara.append(
        createDocsLinksFragment([
          { text: 'Onboarding and daily use', path: 'user/guides/' },
          { text: 'Calendar types', path: 'user/calendars/' },
          { text: 'Troubleshooting', path: 'user/guides/troubleshooting' }
        ])
      );
    }
  }
}

// These functions remain pure and outside the class.

// ensureCalendarIds and sanitizeInitialView moved to ./utils to avoid loading this heavy
// settings module (and React) during plugin startup. Keep imports above.
// settings module (and React) during plugin startup. Keep imports above.
// These functions remain pure and outside the class.

// ensureCalendarIds and sanitizeInitialView moved to ./utils to avoid loading this heavy
// settings module (and React) during plugin startup. Keep imports above.
// settings module (and React) during plugin startup. Keep imports above.
