import React from 'react';
import { FileText } from 'lucide-react';

export default function Cutlist({ cabinets }) {
  const generateCutlist = () => {
    const materials = {};
    cabinets.forEach((cabinet) => {
      const material = cabinet.material || 'Plywood';
      if (!materials[material]) {
        materials[material] = [];
      }
      const [width, height, depth] = cabinet.size;
      materials[material].push({ piece: `${cabinet.name} - Top/Bottom`, qty: 2, width, height: depth, material });
      materials[material].push({ piece: `${cabinet.name} - Sides`, qty: 2, width: height, height: depth, material });
      materials[material].push({ piece: `${cabinet.name} - Back`, qty: 1, width, height, material });
    });
    return materials;
  };

  const cutlistData = generateCutlist();

  const header = React.createElement('div', { className: 'flex items-center gap-2 mb-4' }, [
    React.createElement(FileText, { className: 'w-5 h-5 text-blue-600', key: 'icon' }),
    React.createElement('h3', { className: 'text-lg font-semibold text-gray-800', key: 'title' }, 'Cutlist & NKBA Guidelines')
  ]);

  const materialBlocks = Object.entries(cutlistData).map(([material, pieces]) => {
    const pieceRows = pieces.map((piece, index) =>
      React.createElement('div', { key: `${material}-${index}`, className: 'flex justify-between text-sm text-gray-600' }, [
        React.createElement('span', null, piece.piece),
        React.createElement('span', null, `${piece.qty}x (${piece.width}" × ${piece.height}")`)
      ])
    );
    return React.createElement('div', { key: material, className: 'border border-gray-200 rounded-lg p-4' }, [
      React.createElement('h4', { className: 'font-medium text-gray-700 mb-2' }, material),
      React.createElement('div', { className: 'space-y-2' }, pieceRows)
    ]);
  });

  const guidelines = React.createElement('div', { className: 'mt-6 p-4 bg-blue-50 rounded-lg' }, [
    React.createElement('h4', { className: 'font-medium text-blue-800 mb-2' }, 'NKBA Guidelines Applied:'),
    React.createElement('ul', { className: 'text-sm text-blue-700 space-y-1' }, [
      React.createElement('li', null, '• Work Triangle: ≤ 26 ft total, each leg 4-9 ft'),
      React.createElement('li', null, '• Walkways: ≥ 42" (1-way), ≥ 48" (2-way)'),
      React.createElement('li', null, '• Cabinet Heights: Base 34.5", Wall 54" from floor'),
      React.createElement('li', null, '• Appliance Clearance: ≥ 15" landing space')
    ])
  ]);

  return React.createElement('div', { className: 'bg-white rounded-lg shadow-lg p-6 h-96 overflow-y-auto' }, [
    header,
    React.createElement('div', { className: 'space-y-4' }, materialBlocks),
    guidelines
  ]);
}