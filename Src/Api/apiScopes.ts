import type { ApiScope } from "../Types/settings";

export type ApiScopeDefinition = {
  id: ApiScope;
  label: string;
  description: string;
  risky?: boolean;
};

export const FULL_ACCESS_SCOPE: ApiScope = 'system:full-access';

export const API_SCOPES: ApiScopeDefinition[] = [
  {
    id: 'ui:open-calendar',
    label: 'Open calendar',
    description: 'Open or focus the main calendar view.'
  },
  {
    id: 'ui:open-sidebar',
    label: 'Open sidebar',
    description: 'Open or focus the calendar sidebar view.'
  },
  {
    id: 'ui:change-view',
    label: 'Change view',
    description: 'Switch between day, week, month, and timeline views.'
  },
  {
    id: 'ui:modals',
    label: 'Open modals',
    description: 'Open the create/edit event modals.'
  },
  {
    id: 'events:read',
    label: 'Read events',
    description: 'Read cached events and event details.'
  },
  {
    id: 'events:write',
    label: 'Write events',
    description: 'Create, update, move, and delete events.'
  },
  {
    id: 'providers:read',
    label: 'Read providers',
    description: 'List calendar sources and provider capabilities.'
  },
  {
    id: 'providers:write',
    label: 'Control providers',
    description: 'Trigger provider refresh or remote revalidation.'
  },
  {
    id: 'settings:read',
    label: 'Read settings',
    description: 'Read plugin settings and configuration.'
  },
  {
    id: 'settings:write',
    label: 'Write settings',
    description: 'Update and persist plugin settings.'
  },
  {
    id: FULL_ACCESS_SCOPE,
    label: 'Full control (unsafe)',
    description: 'Unrestricted access to internal state and APIs.',
    risky: true
  }
];

const scopeIds = new Set<ApiScope>(API_SCOPES.map(scope => scope.id));

export function normalizeApiScopes(scopes?: ApiScope[]): ApiScope[] {
  const requested: ApiScope[] = scopes && scopes.length > 0 ? scopes : ['events:read'];
  const unique = new Set<ApiScope>();
  requested.forEach((scope: ApiScope) => {
    if (scopeIds.has(scope)) {
      unique.add(scope);
    }
  });
  return Array.from(unique);
}

export function hasApiScope(granted: Iterable<ApiScope>, required: ApiScope): boolean {
  const grantSet = new Set(granted);
  return grantSet.has(FULL_ACCESS_SCOPE) || grantSet.has(required);
}

export function getScopeDefinition(scope: ApiScope): ApiScopeDefinition | undefined {
  return API_SCOPES.find(entry => entry.id === scope);
}
