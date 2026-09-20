// A parent's visibility always bounds the visibility of its descendants.
export function projectDocument(document, variant) {
  function project(value) {
    if (Array.isArray(value)) return value.filter(v => !v?.visibility || v.visibility === 'both' || v.visibility === variant).map(project);
    if (!value || typeof value !== 'object') return value;
    if ('text' in value && 'visibility' in value) return project(value.text);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['visibility', 'fieldVisibility'].includes(key))
      .filter(([key]) => !value.fieldVisibility?.[key] || ['both', variant].includes(value.fieldVisibility[key]))
      .map(([key, child]) => [key, project(child)]));
  }
  return project(document);
}
