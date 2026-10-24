/**
 * @file categoryParser.test.ts
 * @brief Tests for categoryParser utility functions
 */

import { constructTitle, parseTitle, parseSubcategoryTitle } from './categoryParser';
import { EventEnhancer } from "../../Core/EventEnhancer";
import { OFCEvent } from "../../Types/schema";
import { FullCalendarSettings, DEFAULT_SETTINGS } from "../../Types/settings";

describe('constructTitle', () => {
  it('should return just title when no category or subcategory', () => {
    const result = constructTitle(undefined, undefined, 'Meeting');
    expect(result).toBe('Meeting');
  });

  it('should return "Category - Title" when only category provided', () => {
    const result = constructTitle('Work', undefined, 'Meeting');
    expect(result).toBe('Work - Meeting');
  });

  it('should return "SubCategory - Title" when only subcategory provided', () => {
    const result = constructTitle(undefined, 'Important', 'Meeting');
    expect(result).toBe('Important - Meeting');
  });

  it('should return "Category - SubCategory - Title" when both provided', () => {
    const result = constructTitle('Important', 'Work', 'Meeting');
    expect(result).toBe('Important - Work - Meeting');
  });
});

describe('parseSubcategoryTitle', () => {
  it('should parse "SubCategory - Title" format', () => {
    const result = parseSubcategoryTitle('Important - Meeting');
    expect(result).toEqual({
      subCategory: 'Important',
      title: 'Meeting'
    });
  });

  it('should handle title only (no subcategory)', () => {
    const result = parseSubcategoryTitle('Meeting');
    expect(result).toEqual({
      subCategory: undefined,
      title: 'Meeting'
    });
  });

  it('should handle title with multiple dashes', () => {
    const result = parseSubcategoryTitle('Important - Meeting - Discussion');
    expect(result).toEqual({
      subCategory: 'Important',
      title: 'Meeting - Discussion'
    });
  });

  it('should handle empty subcategory', () => {
    const result = parseSubcategoryTitle(' - Meeting');
    expect(result).toEqual({
      subCategory: undefined,
      title: ' - Meeting'
    });
  });
});

describe('parseTitle', () => {
  it('should parse "Category - SubCategory - Title" format', () => {
    const result = parseTitle('Work - Important - Meeting');
    expect(result).toEqual({
      category: 'Work',
      subCategory: 'Important',
      title: 'Meeting'
    });
  });

  it('should parse "Category - Title" format', () => {
    const result = parseTitle('Work - Meeting');
    expect(result).toEqual({
      category: 'Work',
      subCategory: undefined,
      title: 'Meeting'
    });
  });

  it('should handle title only', () => {
    const result = parseTitle('Meeting');
    expect(result).toEqual({
      category: undefined,
      subCategory: undefined,
      title: 'Meeting'
    });
  });
});

describe('EventEnhancer.enhance', () => {
  const mockEvent: OFCEvent = {
    title: 'Work - Important - Meeting',
    type: 'single',
    date: '2024-01-01',
    endDate: null,
    allDay: true
  };

  it('should enhance event when advanced categorization is enabled', () => {
    const settings: FullCalendarSettings = {
      ...DEFAULT_SETTINGS,
      enableAdvancedCategorization: true,
      categorySettings: [{ name: 'Work', color: 'red' }]
    };

    const enhancer = new EventEnhancer(settings);
    const result = enhancer.enhance(mockEvent);
    expect(result).toEqual({
      ...mockEvent,
      title: 'Important - Meeting',
      category: 'Work',
      subCategory: 'Important'
    });
  });

  it('should not enhance event when advanced categorization is disabled', () => {
    const settings: FullCalendarSettings = {
      ...DEFAULT_SETTINGS,
      enableAdvancedCategorization: false
    };

    const enhancer = new EventEnhancer(settings);
    const result = enhancer.enhance(mockEvent);
    expect(result).toEqual(mockEvent);
  });
});

describe('EventEnhancer.prepareForStorage', () => {
  const settings: FullCalendarSettings = {
    ...DEFAULT_SETTINGS,
    enableAdvancedCategorization: true,
    categorySettings: [{ name: 'Wellness', color: 'green' }]
  };

  it('should preserve subcategory when storing a clean UI title', () => {
    const event: OFCEvent = {
      title: 'Call',
      category: 'Wellness',
      subCategory: 'Social',
      type: 'single',
      date: '2026-05-02',
      endDate: null,
      allDay: true
    };

    const enhancer = new EventEnhancer(settings);
    const result = enhancer.prepareForStorage(event);

    expect(result.title).toBe('Wellness - Social - Call');
    expect(result.category).toBeUndefined();
    expect(result.subCategory).toBeUndefined();
  });

  it('should not duplicate subcategory when the display title already includes it', () => {
    const event: OFCEvent = {
      title: 'Social - Call',
      category: 'Wellness',
      subCategory: 'Social',
      type: 'single',
      date: '2026-05-02',
      endDate: null,
      allDay: true
    };

    const enhancer = new EventEnhancer(settings);
    const result = enhancer.prepareForStorage(event);

    expect(result.title).toBe('Wellness - Social - Call');
    expect(result.category).toBeUndefined();
    expect(result.subCategory).toBeUndefined();
  });
});

describe('Title Parsing Logic for EditEvent Component', () => {
  it('should use parseSubcategoryTitle when enableCategory is true', () => {
    const enableCategory = true;
    const titleInput = 'Important - Meeting';

    // This simulates the logic from EditEvent.tsx handleSubmit
    let parsedSubCategory: string | undefined;
    let parsedTitle: string;

    if (enableCategory) {
      const parsed = parseSubcategoryTitle(titleInput);
      parsedSubCategory = parsed.subCategory;
      parsedTitle = parsed.title;
    } else {
      const parsed = parseTitle(titleInput);
      parsedSubCategory = parsed.subCategory;
      parsedTitle = parsed.title;
    }

    expect(parsedSubCategory).toBe('Important');
    expect(parsedTitle).toBe('Meeting');
  });

  it('should keep title literal when enableCategory is false', () => {
    const enableCategory = false;
    const titleInput = 'Important - Meeting';

    // This simulates the logic from EditEvent.tsx handleSubmit
    let parsedSubCategory: string | undefined;
    let parsedTitle: string;

    if (enableCategory) {
      const parsed = parseSubcategoryTitle(titleInput);
      parsedSubCategory = parsed.subCategory;
      parsedTitle = parsed.title;
    } else {
      parsedSubCategory = undefined;
      parsedTitle = titleInput;
    }

    expect(parsedSubCategory).toBe(undefined);
    expect(parsedTitle).toBe('Important - Meeting');
  });

  it('should preserve subcategory when round-tripping through edit modal', () => {
    // Start with an event that has category, subcategory, and title
    const originalEvent = {
      title: 'Meeting',
      category: 'Work',
      subCategory: 'Important'
    };

    // Simulate how EditEvent initializes the title input when enableCategory=true
    const titleInput = constructTitle(undefined, originalEvent.subCategory, originalEvent.title);
    expect(titleInput).toBe('Important - Meeting');

    // Simulate how EditEvent parses the title input on submit when enableCategory=true
    const parsed = parseSubcategoryTitle(titleInput);

    // The final event should preserve the original subcategory
    expect(parsed.subCategory).toBe('Important');
    expect(parsed.title).toBe('Meeting');
  });
});
