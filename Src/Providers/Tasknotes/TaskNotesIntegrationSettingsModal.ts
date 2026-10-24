import { PluginState } from "../../Core/PluginState";
import { Modal, Setting } from 'obsidian';
import FullCalendarPlugin from '../../main';
import { t } from "../../Features/I18n/i18n";

type TaskNotesDispatchMode = 'search' | 'create';

export class TaskNotesIntegrationSettingsModal extends Modal {
  private selectedSourceId: string | null = null;

  constructor(
    private plugin: FullCalendarPlugin,
    private onChange: () => void
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText(t('settings.tasknotesIntegration.modal.title'));
    this.render();
  }

  private render(): void {
    this.contentEl.empty();

    const taskNotesSources = PluginState.getSettings().calendarSources.filter(
      source => source.type === 'tasknotes'
    );

    if (taskNotesSources.length === 0) {
      this.contentEl.createEl('p', {
        text: t('settings.tasknotesIntegration.noSource')
      });
      return;
    }

    if (
      !this.selectedSourceId ||
      !taskNotesSources.some(source => source.id === this.selectedSourceId)
    ) {
      this.selectedSourceId = taskNotesSources[0].id;
    }

    if (taskNotesSources.length > 1) {
      new Setting(this.contentEl)
        .setName(t('settings.tasknotesIntegration.source.label'))
        .setDesc(t('settings.tasknotesIntegration.source.description'))
        .addDropdown(dropdown => {
          taskNotesSources.forEach(source => {
            dropdown.addOption(source.id, source.name || source.id);
          });

          dropdown.setValue(this.selectedSourceId || taskNotesSources[0].id).onChange(value => {
            this.selectedSourceId = value;
            this.render();
          });
        });
    }

    const currentSource = taskNotesSources.find(source => source.id === this.selectedSourceId);
    if (!currentSource || currentSource.type !== 'tasknotes') {
      return;
    }

    const currentMode = currentSource.dispatchMode || 'search';

    new Setting(this.contentEl)
      .setName(t('settings.tasknotesIntegration.dispatchMode.label'))
      .setDesc(t('settings.tasknotesIntegration.dispatchMode.description'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('search', t('settings.tasknotesIntegration.dispatchMode.options.search'))
          .addOption('create', t('settings.tasknotesIntegration.dispatchMode.options.create'))
          .setValue(currentMode)
          .onChange(async value => {
            const mode = value as TaskNotesDispatchMode;
            const settings = PluginState.getSettings();
            const source = settings.calendarSources.find(s => s.id === currentSource.id);

            if (!source || source.type !== 'tasknotes') {
              return;
            }

            source.dispatchMode = mode;
            await PluginState.saveSettings();
            this.onChange();
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
