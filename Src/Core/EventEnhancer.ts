/**
 * @file EventEnhancer.ts
 * @brief Defines the event enhancement pipeline for advanced categorization.
 *
 * @description
 * This class provides a stateless pipeline for transforming OFCEvents. It decouples
 * the core data engine from the "Advanced Categorization" feature by centralizing
 * the logic for parsing categories from titles on the read path and reconstructing
 * titles for storage on the write path.
 *
 * @license See LICENSE.md
 */

import { OFCEvent } from "../Types";
import { FullCalendarSettings } from "../Types/settings";
import { constructTitle, parseTitle } from "../Features/Category/categoryParser";

export class EventEnhancer {
  private settings: FullCalendarSettings;

  constructor(settings: FullCalendarSettings) {
    this.settings = settings;
  }

  /**
   * Updates the settings object used by the enhancer.
   * @param newSettings The latest plugin settings.
   */
  public updateSettings(newSettings: FullCalendarSettings): void {
    this.settings = newSettings;
  }

  /**
   * The "read path" transformation.
   * Takes a raw event from a provider, parses its title for categories,
   * and converts its timezone to the user's display timezone.
   *
   * @param rawEvent The event object from a provider with an un-parsed title and source timezone.
   * @returns An enhanced OFCEvent ready for the cache and UI.
   */
  public enhance(rawEvent: OFCEvent): OFCEvent {
    // 1. First, parse categories from the title if the feature is enabled.
    let categorizedEvent = rawEvent;
    if (this.settings.enableAdvancedCategorization) {
      // Create a set of defined category names for validation
      const definedCategories = new Set(this.settings.categorySettings.map(cat => cat.name));
      const { category, subCategory, title } = parseTitle(rawEvent.title, definedCategories);
      categorizedEvent = {
        ...rawEvent,
        title: subCategory ? `${subCategory} - ${title}` : title,
        category: category || rawEvent.category,
        subCategory: subCategory || rawEvent.subCategory
      };
    }

    // Timezone conversion is no longer necessary here. We pass the event with its original coordinates.
    return categorizedEvent;
  }

  /**
   * The "write path" transformation.
   * Takes a structured event from the cache/UI, converts it back to its source timezone,
   * and constructs a flat title string for storage.
   *
   * @param structuredEvent An event from the cache, in the display timezone.
   * @returns A new event object ready to be written to a provider.
   */
  public prepareForStorage(structuredEvent: OFCEvent): OFCEvent {
    // Determine the target timezone for storage. If the event has one, use it.
    // Otherwise, it's a floating event that should be stored in the system's local time.
    const targetZone = structuredEvent.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    const eventForStorage = { ...structuredEvent };

    // Explicitly set/remove the timezone property to ensure
    // it is correctly serialized into the note file.
    if (!eventForStorage.allDay) {
      // For any timed event, ensure the timezone property is set to its target zone.
      // This "upgrades" legacy floating events to have an explicit timezone upon saving.
      eventForStorage.timezone = targetZone;
    } else {
      // All-day events MUST NOT have a timezone property.
      delete eventForStorage.timezone;
    }

    // 2. Second, construct the full title if categorization is enabled.
    if (!this.settings.enableAdvancedCategorization) {
      return eventForStorage;
    }

    // Create a new object for title construction to avoid mutating the one we just fixed.
    const finalEvent = { ...eventForStorage };
    const subCategoryPrefix = finalEvent.subCategory ? `${finalEvent.subCategory} - ` : '';
    const titleAlreadyIncludesSubCategory =
      !!subCategoryPrefix && finalEvent.title.startsWith(subCategoryPrefix);

    finalEvent.title = titleAlreadyIncludesSubCategory
      ? constructTitle(finalEvent.category, undefined, finalEvent.title)
      : constructTitle(finalEvent.category, finalEvent.subCategory, finalEvent.title);

    // Remove the separate category fields to avoid them being written to storage.
    delete finalEvent.category;
    delete finalEvent.subCategory;

    return finalEvent;
  }
}
