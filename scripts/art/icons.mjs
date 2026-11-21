// A small icon family (24 × 24, 1.6 stroke, round caps, no fill) in currentColor. The renderer uses
// them as CSS masks, so the icon takes the text colour of wherever it is placed.
import { svg } from './lib.mjs';

const ICONS = {
  desk: 'M3 13 H21 M5 13 V20 M19 13 V20 M14 13 V16.5 H19 M6.5 10.5 Q9.2 9 12 10.5 Q14.8 9 17.5 10.5 V6.5 Q14.8 5 12 6.5 Q9.2 5 6.5 6.5 Z M12 6.5 V10.5',
  notebook:
    'M6 3 H18 A1 1 0 0 1 19 4 V20 A1 1 0 0 1 18 21 H6 Z M6 3 V21 M9 3 V21 M12 8 H16 M4 7 H6 M4 12 H6 M4 17 H6',
  cabinet: 'M4 3 H20 V21 H4 Z M4 9 H20 M4 15 H20 M10.5 6 H13.5 M10.5 12 H13.5 M10.5 18 H13.5',
  stamp:
    'M12 3 A9 9 0 1 1 11.99 3 M12 6.5 A5.5 5.5 0 1 1 11.99 6.5 M12 9.5 L12.8 11.2 L14.6 11.4 L13.3 12.6 L13.6 14.4 L12 13.5 L10.4 14.4 L10.7 12.6 L9.4 11.4 L11.2 11.2 Z',
  lantern:
    'M9 3 Q12 1 15 3 M8 7 L9 5 H15 L16 7 M7.5 7 H16.5 V17 A2 2 0 0 1 14.5 19 H9.5 A2 2 0 0 1 7.5 17 Z M12 10 Q14 12.5 12 15 Q10 12.5 12 10 M9 21 H15',
  lume: 'M12 8 A3 3 0 1 1 11.99 8 M12 14 V20 M10 8 Q8 4 6 3 M14 8 Q16 4 18 3 M11 13 Q5 7 3 10 Q2 15 10 15 M13 13 Q19 7 21 10 Q22 15 14 15 M10 16 Q6 18 7 20 Q9 21 11 18 M14 16 Q18 18 17 20 Q15 21 13 18',
  evidence:
    'M10.5 4 A6.5 6.5 0 1 1 10.49 4 M15.2 15.2 L20 20 M8 9 Q8 7.5 9.5 7.5 M11.5 9 Q11.5 7.5 13 7.5',
  investigation: 'M12 3 A9 9 0 1 1 11.99 3 M15.5 8.5 L13.2 13.2 L8.5 15.5 L10.8 10.8 Z',
  leaf: 'M5 19 C5 10 10 5 20 4 C19 14 14 19 5 19 Z M5 19 L13 11',
  teacup:
    'M4 9 H17 V13 A5 5 0 0 1 12 18 H9 A5 5 0 0 1 4 13 Z M17 10 H18.5 A2.5 2.5 0 0 1 18.5 15 H16.5 M3 21 H18 M9 6 Q8 4.5 9 3 M12.5 6 Q11.5 4.5 12.5 3',
  sparkle: 'M12 3 Q13 11 21 12 Q13 13 12 21 Q11 13 3 12 Q11 11 12 3 Z M19 3 V6 M17.5 4.5 H20.5',
  bookmark: 'M7 3 H17 V21 L12 17 L7 21 Z M10 7 H14',
  connection:
    'M6 6 A2.5 2.5 0 1 1 5.99 6 M18 6 A2.5 2.5 0 1 1 17.99 6 M12 16 A2.5 2.5 0 1 1 11.99 16 M8 9 L10.5 16 M16 9 L13.5 16 M8.5 8.5 H15.5',
  question: 'M9 9 Q9 5 12.5 5 Q16 5 16 8.5 Q16 11 13 12 Q12 12.5 12 15 M12 19 V19.1',
};

export const ICON_IDS = Object.keys(ICONS);

export function iconFiles() {
  const files = {};
  for (const [name, d] of Object.entries(ICONS))
    files[`icons/${name}.svg`] = svg({
      id: `icon.${name}`,
      width: 24,
      height: 24,
      body: `<path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    });
  return files;
}
