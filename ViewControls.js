import React from 'react';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';

export default function ViewControls({ showLabels, setShowLabels, resetView }) {
  const toggleBtn = React.createElement('button', {
    onClick: () => setShowLabels(!showLabels),
    className: 'p-2 bg-white rounded-lg shadow-md hover:bg-gray-50 transition-colors',
    title: showLabels ? 'Hide Labels' : 'Show Labels'
  }, showLabels ? React.createElement(EyeOff, { className: 'w-4 h-4' }) : React.createElement(Eye, { className: 'w-4 h-4' }));

  const resetBtn = React.createElement('button', {
    onClick: resetView,
    className: 'p-2 bg-white rounded-lg shadow-md hover:bg-gray-50 transition-colors',
    title: 'Reset View'
  }, React.createElement(RotateCcw, { className: 'w-4 h-4' }));

  return React.createElement('div', { className: 'absolute top-4 right-4 flex flex-col gap-2' }, [toggleBtn, resetBtn]);
}

