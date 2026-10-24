import { PluginState } from "../../Core/PluginState";
import { Setting } from 'obsidian';
import FullCalendarPlugin from '../../main';
import { t } from "../../Features/I18n/i18n";
import { createDescWithDocs } from "../../Ui/Settings/docsLinks";
import { TasksIntegrationSettingsModal } from './TasksIntegrationSettingsModal';

export function renderTasksIntegrationSettings(
  containerEl: HTMLElement,
  plugin: FullCalendarPlugin,
  onChange: () => void
): void {
  const hasTasksCalendar = PluginState.getSettings().calendarSources.some(
    source => source.type === 'tasks'
  );
  if (!hasTasksCalendar) {
    return;
  }

  new Setting(containerEl)
    .setName(t('settings.tasksIntegration.title'))
    .setDesc(
      createDescWithDocs(t('settings.tasksIntegration.description'), [
        { text: 'Tasks integration', path: 'user/calendars/tasks-plugin-integration' }
      ])
    )
    .setHeading()
    .addExtraButton(button => {
      button
        .setIcon('gear')
        .setTooltip(t('settings.tasksIntegration.configButton'))
        .onClick(() => {
          new TasksIntegrationSettingsModal(plugin, onChange).open();
        });
    });
}
