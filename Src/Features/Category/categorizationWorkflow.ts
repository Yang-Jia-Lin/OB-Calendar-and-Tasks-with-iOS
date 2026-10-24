import { OFCEvent } from "../../Types";
import { parseTitle } from './categoryParser';

export type BulkCategorizeChoice = 'smart' | 'force_folder' | 'force_default';

/**
 * Detects whether a title already follows category-style formatting,
 * such as "Category - Title" or "Category - SubCategory - Title".
 */
export function hasCategoryLikeTitle(title: string): boolean {
  const { category } = parseTitle(title);
  return !!category;
}

/**
 * Smart mode should skip events that are already categorized by structured fields
 * or by title formatting. Forced modes never skip.
 */
export function shouldSkipBulkCategorization(
  event: Pick<OFCEvent, 'title' | 'category' | 'subCategory'>,
  choice: BulkCategorizeChoice
): boolean {
  if (choice !== 'smart') {
    return false;
  }

  if (event.category || event.subCategory) {
    return true;
  }

  return hasCategoryLikeTitle(event.title);
}
