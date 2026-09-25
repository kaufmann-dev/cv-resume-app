// Renders a document (raw or projected) as human-readable Markdown in one locale,
// following the frontend fallback: requested locale, then English, then German.
export function renderMarkdown(document, locale = 'en') {
  const contentOf = node => (node && typeof node === 'object' && !Array.isArray(node) && 'text' in node ? node.text : node);
  const text = node => {
    const value = contentOf(node);
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value[locale] ?? value.en ?? value.de ?? '';
  };
  const renderEntry = item => {
    const lines = [];
    const heading = text(item.heading);
    if (heading) lines.push(`### ${heading}`);
    const subheading = text(item.subheading);
    if (subheading) lines.push(`*${subheading}*`);
    for (const key of ['info', 'subinfo']) {
      const value = text(item[key]);
      if (value) lines.push(value);
    }
    for (const highlight of item.highlights || []) {
      const value = text(highlight);
      if (value) lines.push(`- ${value}`);
    }
    const tags = (item.tags || []).map(text).filter(Boolean);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    return lines;
  };
  const renderPublication = item => {
    const authors = (item.authors || []).map(author => {
      const name = typeof author === 'string' ? author : author?.name;
      return name && typeof author === 'object' && author.bold ? `**${name}**` : name;
    }).filter(Boolean).join(', ');
    const parts = [];
    if (authors) parts.push(item.year ? `${authors} (${item.year})` : authors);
    else if (item.year) parts.push(`(${item.year})`);
    const title = text(item.title);
    if (title) parts.push(`*${title}*`);
    const institution = text(item.institution);
    if (institution) parts.push(institution);
    return parts.length ? `- ${parts.join('. ')}.` : '-';
  };
  const renderSection = section => {
    const lines = [`## ${text(section.title)}`];
    const blocks = [];
    if (section.type === 'info') {
      for (const row of section.rows || []) blocks.push(`- **${text(row.label)}:** ${text(row.value)}`);
    } else if (section.type === 'pub') {
      for (const item of section.items || []) blocks.push(renderPublication(item));
    } else {
      for (const item of section.items || []) {
        const block = renderEntry(item);
        if (block.length) blocks.push(block.join('\n'));
      }
    }
    if (blocks.length) lines.push('', blocks.join(section.type === 'info' || section.type === 'pub' ? '\n' : '\n\n'));
    return lines.join('\n');
  };
  return document.sections.length ? `${document.sections.map(renderSection).join('\n\n')}\n` : '';
}

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
