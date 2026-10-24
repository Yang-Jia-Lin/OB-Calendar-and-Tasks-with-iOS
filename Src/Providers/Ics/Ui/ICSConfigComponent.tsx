import { UrlInput } from "../../../Ui/Components/Forms/UrlInput";
import * as React from 'react';

import { ICSProviderConfig } from '../typesICS';
import { t } from "../../../Features/I18n/i18n";
import FullCalendarPlugin from '../../../main';
import { TFile } from 'obsidian';

interface ICSConfigComponentProps {
  plugin: FullCalendarPlugin;
  config: Partial<ICSProviderConfig>;
  onConfigChange: (newConfig: Partial<ICSProviderConfig>) => void;
  onSave: (finalConfig: ICSProviderConfig) => void;
  onClose: () => void; // Required prop
}

export const ICSConfigComponent: React.FC<ICSConfigComponentProps> = ({
  plugin,
  config,
  onConfigChange,
  onSave,
  onClose: _onClose
}) => {
  const [mode, setMode] = React.useState<'url' | 'local'>('url');
  const [url, setUrl] = React.useState(config.url || '');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [localFiles, setLocalFiles] = React.useState<TFile[]>([]);

  React.useEffect(() => {
    // Detect mode from existing URL
    if (config.url && !config.url.startsWith('http') && !config.url.startsWith('webcal')) {
      setMode('local');
    }
    // Load local ICS files
    const files = plugin.app.vault.getFiles().filter(f => f.extension === 'ics');
    setLocalFiles(files);
  }, [config.url, plugin.app.vault]);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!url) return;

    setIsSubmitting(true);
    onSave({ ...config, id: config.id || '', url });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{t('settings.calendars.ics.url.label')}</div>
          <div className="setting-item-description">
            Choose between a remote URL or a local file in your vault.
          </div>
        </div>
        <div className="setting-item-control">
          <select
            className="dropdown"
            value={mode}
            onChange={e => {
              setMode(e.target.value as 'url' | 'local');
              setUrl(''); // Reset URL when switching modes to avoid confusion
            }}
          >
            <option value="url">Remote URL</option>
            <option value="local">Local File</option>
          </select>
        </div>
      </div>

      {mode === 'url' ? (
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">Calendar URL</div>
            <div className="setting-item-description">
              {t('settings.calendars.ics.url.description')}
            </div>
          </div>
          <div className="setting-item-control">
            <UrlInput
              value={url}
              onChange={newValue => {
                setUrl(newValue);
                onConfigChange({ ...config, url: newValue });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">Select File</div>
            <div className="setting-item-description">Select an .ics file from your vault.</div>
          </div>
          <div className="setting-item-control">
            <select
              className="dropdown"
              value={url}
              onChange={e => {
                setUrl(e.target.value);
                onConfigChange({ ...config, url: e.target.value });
              }}
            >
              <option value="" disabled>
                Select a file...
              </option>
              {localFiles.map(f => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="setting-item">
        <div className="setting-item-info" />
        <div className="setting-item-control">
          <button className="mod-cta" type="submit" disabled={isSubmitting || !url}>
            {t('ui.buttons.addCalendar')}
          </button>
        </div>
      </div>
    </form>
  );
};
