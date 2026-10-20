// Ölçü birimleri. Sahnede 1 birim = 100 mm kabul edilir.
export const MM_PER_UNIT = 100;

export const UNITS = {
  mm: { label: 'mm', perUnit: MM_PER_UNIT, digits: 1 },
  cm: { label: 'cm', perUnit: MM_PER_UNIT / 10, digits: 2 },
  m: { label: 'm', perUnit: MM_PER_UNIT / 1000, digits: 4 },
  in: { label: 'in', perUnit: MM_PER_UNIT / 25.4, digits: 3 },
};

let current = 'mm';

export function getUnit() { return current; }

export function setUnit(unit) {
  if (UNITS[unit]) current = unit;
}

export const unitLabel = () => UNITS[current].label;

// Sahne birimini seçili birime çevirir.
export const toDisplay = (value) => value * UNITS[current].perUnit;

// Seçili birimdeki değeri sahne birimine çevirir.
export const fromDisplay = (value) => value / UNITS[current].perUnit;

export function round(value) {
  const f = 10 ** UNITS[current].digits;
  return Math.round(value * f) / f;
}

export const format = (value) => `${round(toDisplay(value)).toLocaleString('tr-TR')} ${unitLabel()}`;

// Seçili birimde bir adım (ızgaraya yaslama ve sayı kutuları için).
export function displayStep() {
  return { mm: 1, cm: 0.1, m: 0.001, in: 0.05 }[current];
}
