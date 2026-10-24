/**
 * @file holidays-custom.ts
 * @brief Dynamic loader and proxy constructor for the `date-holidays` library.
 *
 * @description
 * Creates a transparent Proxy for the bundled `Holidays` class constructor.
 *
 * @license See LICENSE.md
 */

import { App } from 'obsidian';

import type HolidaysType from 'date-holidays';

// Extend the global Window interface to type window.Holidays safely without any casts
declare global {
  interface Window {
    Holidays?: typeof HolidaysType;
  }
}

let holidaysClass: typeof HolidaysType | null = null;
let holidaysPromise: Promise<void> | null = null;

// Define explicit types to satisfy ESLint typescript rules
type HolidaysConstructor = new (...args: unknown[]) => HolidaysType;

interface ImportHolidaysModule {
  default?: typeof HolidaysType;
}

/**
 * Triggers loading of the date-holidays library.
 * Bundled via esbuild and dynamically imported here to support lazy loading.
 */
export async function ensureHolidaysLoaded(_app: App): Promise<void> {
  if (holidaysClass) {
    return;
  }

  if (holidaysPromise) {
    return holidaysPromise;
  }

  holidaysPromise = (async () => {
    try {
      const module = await import('date-holidays');
      const rawHolidays =
        (module as ImportHolidaysModule).default || (module as unknown as typeof HolidaysType);
      if (typeof rawHolidays === 'function') {
        holidaysClass = rawHolidays;
      }
      window.Holidays = holidaysClass || undefined;

      if (!holidaysClass) {
        throw new Error('Holidays constructor is not a valid class/constructor function.');
      }
    } catch (err) {
      holidaysPromise = null; // Allow retry on failure
      throw err;
    }
  })();

  return holidaysPromise;
}

interface ActiveHolidaysWrapper {
  default?: HolidaysConstructor;
}

/**
 * Transparent proxy for the Holidays constructor class.
 * Intercepts calls to new Holidays() and instantiates the global window.Holidays class dynamically.
 */
export const HolidaysProxy = new Proxy(function () {} as unknown as typeof HolidaysType, {
  construct(target, argumentsList) {
    const activeHolidays = window.Holidays || holidaysClass;
    if (!activeHolidays) {
      throw new Error(
        'date-holidays library is not loaded yet! Please await ensureHolidaysLoaded() first.'
      );
    }

    // Handle module default wrapper if dynamic import returned it differently
    let constructorFn: HolidaysConstructor = activeHolidays as unknown as HolidaysConstructor;
    const activeHolidaysObj = activeHolidays as unknown as ActiveHolidaysWrapper;
    if (activeHolidaysObj.default && typeof activeHolidaysObj.default === 'function') {
      constructorFn = activeHolidaysObj.default;
    }

    const constructorToCall = constructorFn as unknown as new (...args: unknown[]) => unknown;
    return Reflect.construct(constructorToCall, argumentsList) as HolidaysType;
  }
});
