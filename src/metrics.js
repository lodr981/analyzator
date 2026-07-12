// Deterministický záchyt metrik z běžné řeči — pojistka, aby se výška/váha/
// spánek zapsaly i tehdy, když je AI z nějakého důvodu nezavolá (nebo když AI
// vůbec neběží). Konzervativní: bere jen jasné signály s jednotkou/slovesem.

// „52,3" → 52.3
const num = (s) => Number(String(s).replace(',', '.'));

// Vrátí { height_cm?, weight_kg?, sleep_hours? } — jen to, co se dá bezpečně určit.
export function parseMetrics(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const out = {};

  // VÝŠKA: „měřím 170", „vyrostl jsem na 172", „170 cm"
  let m = t.match(/(?:m[ěe]ř[íi]m|vyrost\w*)[^\d]{0,12}(\d{2,3}(?:[.,]\d)?)/);
  if (!m) m = t.match(/(\d{2,3}(?:[.,]\d)?)\s*cm\b/);
  if (m) {
    const v = num(m[1]);
    if (v >= 100 && v <= 220) out.height_cm = v;
  }

  // VÁHA: „vážím 52", „váha 52,3", „52 kg", „52 kilo"
  let w = t.match(/(?:v[aá]ž[íi]m|v[aá]ha)[^\d]{0,12}(\d{2,3}(?:[.,]\d)?)/);
  if (!w) w = t.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo|kila|kilogram\w*)\b/);
  if (w) {
    const v = num(w[1]);
    if (v >= 20 && v <= 150) out.weight_kg = v;
  }

  // SPÁNEK: „spal jsem 8 hodin", „spánek 7,5 h", „8 hodin spánku"
  let s = t.match(/spal\w*[^\d]{0,12}(\d{1,2}(?:[.,]\d)?)\s*(?:h\b|hod)/);
  if (!s) s = t.match(/sp[aá]nek[^\d]{0,12}(\d{1,2}(?:[.,]\d)?)\s*(?:h\b|hod)/);
  if (!s) s = t.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:h\b|hod\w*)\s*sp[aá]/);
  if (s) {
    const v = num(s[1]);
    if (v >= 2 && v <= 14) out.sleep_hours = v;
  }

  return out;
}
