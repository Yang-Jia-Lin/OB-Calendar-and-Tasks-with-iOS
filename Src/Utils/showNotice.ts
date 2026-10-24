import { Notice as ObsidianNotice } from 'obsidian';

export function showNotice(message: string, timeout?: number): ObsidianNotice {
  return timeout === undefined ? new ObsidianNotice(message) : new ObsidianNotice(message, timeout);
}
