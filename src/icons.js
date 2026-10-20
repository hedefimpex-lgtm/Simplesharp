import {
  createElement, Square, Circle, Pentagon, Box, Cylinder, Globe, Cone, Torus, ArrowUpFromLine, Blend, Triangle, Shell, Move3d, Scaling, FlipHorizontal2, Rows3, Ruler, Upload, Copy, Trash2, X, Eye, EyeOff, Pencil, Download, House, Undo2, Redo2, Settings, Focus, Layers, Menu, RotateCw,
} from 'lucide';

const LUCIDE = { Square, Circle, Pentagon, Box, Cylinder, Globe, Cone, Torus, ArrowUpFromLine, Blend, Triangle, Shell, Move3d, Scaling, FlipHorizontal2, Rows3, Ruler, Upload, Copy, Trash2, X, Eye, EyeOff, Pencil, Download, House, Undo2, Redo2, Settings, Focus, Layers, Menu, RotateCw };

// Lucide simgeleri ve boolean işlemleri için çizilmiş özel simgeler.
const CUSTOM = {
  // İki daire: birleşim, fark ve kesişim.
  BoolUnion: '<path d="M9 5a5 5 0 1 0 0 10a5 5 0 0 0 6 4a5 5 0 1 0 0-10a5 5 0 0 0-6-4z" fill="currentColor" fill-opacity=".35"/><circle cx="9" cy="10" r="5"/><circle cx="15" cy="14" r="5"/>',
  BoolSubtract: '<circle cx="9" cy="10" r="5" fill="currentColor" fill-opacity=".35"/><circle cx="15" cy="14" r="5" stroke-dasharray="2 2"/>',
  BoolIntersect: '<path d="M10.2 14.9a5 5 0 0 1 3.6-5.8a5 5 0 0 1-3.6 5.8z" fill="currentColor" fill-opacity=".6"/><circle cx="9" cy="10" r="5"/><circle cx="15" cy="14" r="5"/>',
};

export function icon(name, size = 20) {
  if (CUSTOM[name]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
    svg.innerHTML = CUSTOM[name];
    svg.classList.add('icon');
    return svg;
  }
  const node = LUCIDE[name] || Circle;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('icon');
  return svg;
}
