import { App } from 'obsidian';
import { Calendar } from '@fullcalendar/core';
import FullCalendarPlugin from '../../main';
import { ViewEnhancer } from "../../Core/ViewEnhancer";

export interface ViewContext {
  plugin: FullCalendarPlugin;
  app: App;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  inSidebar: boolean;

  get fullCalendarView(): Calendar | null;
  get viewEnhancer(): ViewEnhancer | null;

  // Method to trigger a full re-render (onOpen)
  refreshView(): Promise<void>;
}
