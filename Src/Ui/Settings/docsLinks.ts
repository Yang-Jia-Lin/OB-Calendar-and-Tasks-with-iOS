/**
 * @file docsLinks.ts
 * @brief Shared helpers for adding documentation links to settings descriptions.
 * @license See LICENSE.md
 */

import { t } from "../../Features/I18n/i18n";
import {
  createLinksFragment,
  createMarkdownLinksFragment,
  LinkItem,
  linkItemsToSegments
} from './linkTextFragments';

export interface DocsLink {
  text: string;
  path: string;
}

const DOCS_ROOT = 'https://obsidian-full-calendar-remastered.github.io/plugin-full-calendar/';

export function toDocsUrl(path: string): string {
  return `${DOCS_ROOT}${path.replace(/^\/+/, '')}`;
}

export function createDocsLinksFragment(
  links: DocsLink[],
  prefix = t('global.learnMore')
): DocumentFragment {
  if (links.length === 0) {
    return createFragment();
  }

  const fragment = createFragment();
  fragment.append(prefix, ' ');

  const linkItems: LinkItem[] = links.map(link => ({
    text: link.text,
    href: toDocsUrl(link.path)
  }));

  fragment.append(createLinksFragment(linkItemsToSegments(linkItems), { betweenLinksText: ' | ' }));
  return fragment;
}

export function createDescWithDocs(description: string, links: DocsLink[]): DocumentFragment {
  const fragment = createFragment();
  fragment.append(createMarkdownLinksFragment(description));
  if (links.length > 0) {
    fragment.append(' ');
    fragment.append(createDocsLinksFragment(links));
  }
  return fragment;
}
