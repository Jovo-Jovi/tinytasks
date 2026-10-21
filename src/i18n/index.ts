import ar from './locales/ar.json';
import en from './locales/en.json';

export const locales = ['en', 'ar'] as const;

export type Locale = (typeof locales)[number];

const catalogues = { en, ar };

export function translate(locale: Locale, key: string): string {
  const catalogue = catalogues[locale];
  if (!Object.hasOwn(catalogue, key)) {
    throw new Error(
      `i18n key "${key}" is not configured for locale "${locale}". See src/i18n/locales and docs/ARCHITECTURE.md.`,
    );
  }
  return catalogue[key as keyof typeof catalogue];
}
