/** E04: references to original materials, not replicated study content. */
export const RESOURCE_TYPES = Object.freeze([
  { key: 'audio', label: 'Áudios originais', fragment: '' },
  { key: 'transcription', label: 'Transcrições', fragment: '#transcricao' },
  { key: 'summary', label: 'Resumos', fragment: '#resumo' },
  { key: 'questions', label: 'Questões', fragment: '#questoes' },
]);

export function groupLibraryResources(materials, availability) {
  const owned = new Set();
  const uniqueMaterials = [];
  for (const material of materials) {
    if (!material?.id || owned.has(material.id)) continue;
    owned.add(material.id);
    uniqueMaterials.push(material);
  }
  return RESOURCE_TYPES.map((type) => ({
    type: type.key,
    label: type.label,
    items: uniqueMaterials
      .filter((material) => availability?.[material.id]?.[type.key] === true)
      .map((material) => ({
        materialId: material.id,
        title: material.title,
        subject: material.subject || 'Sem disciplina',
        href: `./material.html?id=${encodeURIComponent(material.id)}${type.fragment}`,
      })),
  })).filter((group) => group.items.length > 0);
}
