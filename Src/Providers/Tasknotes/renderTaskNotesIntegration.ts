import { showNotice } from "../../Utils/showNotice";
import { PluginState } from "../../Core/PluginState";
import { Setting } from 'obsidian';
import FullCalendarPlugin from '../../main';
import { createDescWithDocs } from "../../Ui/Settings/docsLinks";
import { TaskNotesIntegrationSettingsModal } from './TaskNotesIntegrationSettingsModal';
import { t } from "../../Features/I18n/i18n";

export function renderTaskNotesIntegrationSettings(
  containerEl: HTMLElement,
  plugin: FullCalendarPlugin,
  onChange: () => void
): void {
  const hasTaskNotesCalendar = PluginState.getSettings().calendarSources.some(
    source => source.type === 'tasknotes'
  );

  new Setting(containerEl)
    .setName(t('settings.tasknotesIntegration.title'))
    .setDesc(
      createDescWithDocs(
        hasTaskNotesCalendar
          ? t('settings.tasknotesIntegration.descriptionConfigured')
          : t('settings.tasknotesIntegration.descriptionMissingSource'),
        [{ text: t('settings.tasknotesIntegration.docsLink'), path: 'user/calendars/tasknotes' }]
      )
    )
    .setHeading()
    .addExtraButton(button => {
      button
        .setIcon('gear')
        .setTooltip(t('settings.tasknotesIntegration.configButton'))
        .onClick(() => {
          if (!hasTaskNotesCalendar) {
            showNotice(t('notices.tasknotes.addSourceFirst'));
            return;
          }

          new TaskNotesIntegrationSettingsModal(plugin, onChange).open();
        });
    });
}
