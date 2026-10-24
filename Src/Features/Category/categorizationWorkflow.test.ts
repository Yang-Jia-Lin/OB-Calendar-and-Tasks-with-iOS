import {
  hasCategoryLikeTitle,
  shouldSkipBulkCategorization,
  BulkCategorizeChoice
} from './categorizationWorkflow';

describe('hasCategoryLikeTitle', () => {
  it('returns true for Category - Title format', () => {
    expect(hasCategoryLikeTitle('Research - Essay')).toBe(true);
  });

  it('returns true for Category - SubCategory - Title format', () => {
    expect(hasCategoryLikeTitle('Work - Deep Focus - Sprint Planning')).toBe(true);
  });

  it('returns false for plain titles', () => {
    expect(hasCategoryLikeTitle('Sprint Planning')).toBe(false);
  });

  it('returns false for malformed category-like titles', () => {
    expect(hasCategoryLikeTitle(' - Sprint Planning')).toBe(false);
  });
});

describe('shouldSkipBulkCategorization', () => {
  const makeEvent = (title: string, category?: string, subCategory?: string) => ({
    title,
    category,
    subCategory
  });

  const forcedModes: BulkCategorizeChoice[] = ['force_folder', 'force_default'];

  it('skips smart mode when title already looks categorized', () => {
    const event = makeEvent('test - test - temp1');
    expect(shouldSkipBulkCategorization(event, 'smart')).toBe(true);
  });

  it('skips smart mode when structured category fields already exist', () => {
    const event = makeEvent('temp1', 'Work', 'Project');
    expect(shouldSkipBulkCategorization(event, 'smart')).toBe(true);
  });

  it('does not skip smart mode for uncategorized titles', () => {
    const event = makeEvent('temp1');
    expect(shouldSkipBulkCategorization(event, 'smart')).toBe(false);
  });

  it.each(forcedModes)('never skips forced mode: %s', mode => {
    const event = makeEvent('test - test - temp1');
    expect(shouldSkipBulkCategorization(event, mode)).toBe(false);
  });
});
