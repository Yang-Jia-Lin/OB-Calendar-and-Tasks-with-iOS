import { App } from 'obsidian';

/**
 * Interface for Obsidian's internal settings manager.
 * This is an unofficial but stable API used for programmatic navigation.
 */
export interface SettingsManager {
  /** Opens the main settings modal. */
  open(): void;
  /** Navigates to a specific settings tab by its ID. */
  openTabById(id: string): void;
}

/**
 * Extension of the Obsidian App type that includes the settings manager.
 */
export type AppWithSettings = App & {
  /** Access to the internal settings manager. */
  setting: SettingsManager;
};
