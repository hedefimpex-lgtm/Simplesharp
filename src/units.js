// Ölçü birimleri. Model her zaman milimetre cinsindendir; birim yalnızca gösterimi etkiler.
export const UNITS = {
  mm: { label: 'mm', perMm: 1, digits: 2 },
  cm: { label: 'cm', perMm: 0.1, digits: 3 },
  m: { label: 'm', perMm: 0.001, digits: 5 },
  in: { label: 'in', perMm: 1 / 25.4, digits: 4 },
};

let current = 'mm';

export const getUnit = () => current;
export function setUnit(unit) { if (UNITS[unit]) current = unit; }
export const unitLabel = () => UNITS[current].label;

// mm -> seçili birim
export const toDisplay = (mm) => mm * UNITS[current].perMm;
// seçili birim -> mm
export const fromDisplay = (value) => value / UNITS[current].perMm;

export function round(value, digits = UNITS[current].digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

const fmt = (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: UNITS[current].digits });

export const format = (mm) => `${fmt(round(toDisplay(mm)))} ${unitLabel()}`;
export const formatArea = (mm2) => `${fmt(round(mm2 * UNITS[current].perMm ** 2))} ${unitLabel()}²`;
export const formatVolume = (mm3) => `${fmt(round(mm3 * UNITS[current].perMm ** 3))} ${unitLabel()}³`;
