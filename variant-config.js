// Unknown and local hostnames intentionally fall back to the resume variant.
export const DEFAULT_VARIANT_ID = 'resume';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const VARIANT_CONFIGS = {
  resume: {
    id: 'resume',
    hostnames: ['resume.kaufmann.dev'],
    pdfFile: 'resume.pdf',
    pdfDownloadName: 'David_Kaufmann_Resume.pdf',
    pageTitle: {
      en: 'David Kaufmann - Resume',
      de: 'David Kaufmann - Resume'
    },
    authButtonLabel: {
      en: 'View Resume',
      de: 'Resume ansehen'
    },
    switchNote: {
      en: {
        text: 'For a more comprehensive version, see',
        href: 'https://cv.kaufmann.dev',
        label: 'cv.kaufmann.dev'
      },
      de: {
        text: 'Für eine umfassendere Version siehe',
        href: 'https://cv.kaufmann.dev',
        label: 'cv.kaufmann.dev'
      }
    }
  },
  cv: {
    id: 'cv',
    hostnames: ['cv.kaufmann.dev'],
    pdfFile: 'resume.pdf',
    pdfDownloadName: 'David_Kaufmann_Resume.pdf',
    pageTitle: {
      en: 'David Kaufmann - CV',
      de: 'David Kaufmann - CV'
    },
    authButtonLabel: {
      en: 'View CV',
      de: 'CV ansehen'
    },
    switchNote: {
      en: {
        text: 'For a concise version, see',
        href: 'https://resume.kaufmann.dev',
        label: 'resume.kaufmann.dev'
      },
      de: {
        text: 'Für eine kompakte Version siehe',
        href: 'https://resume.kaufmann.dev',
        label: 'resume.kaufmann.dev'
      }
    }
  }
};

export function normalizeHostname(value = '') {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return '';

  const firstValue = rawValue.split(',')[0].trim();

  try {
    return new URL(firstValue).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${firstValue}`).hostname.toLowerCase();
    } catch {
      return firstValue.toLowerCase();
    }
  }
}

export function isLocalDevelopmentHostname(hostname = '') {
  return LOCAL_HOSTNAMES.has(normalizeHostname(hostname));
}

export function isKnownVariant(variantId = '') {
  return variantId === 'edit' || Object.prototype.hasOwnProperty.call(VARIANT_CONFIGS, variantId);
}

export function getVariantConfigById(variantId = DEFAULT_VARIANT_ID) {
  return VARIANT_CONFIGS[isKnownVariant(variantId) ? variantId : DEFAULT_VARIANT_ID];
}

export function resolveVariantId(hostname = '') {
  const normalizedHostname = normalizeHostname(hostname);

  for (const variant of Object.values(VARIANT_CONFIGS)) {
    if (variant.hostnames.includes(normalizedHostname)) {
      return variant.id;
    }
  }

  return DEFAULT_VARIANT_ID;
}

export function getVariantConfig(hostname = '') {
  return getVariantConfigById(resolveVariantId(hostname));
}
