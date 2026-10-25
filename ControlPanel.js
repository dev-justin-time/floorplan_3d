import React from 'react';
import { Plus, Minus } from 'lucide-react';

export default function ControlPanel({ 
  project, 
  setProject, 
  selectedCabinet, 
  cabinets, 
  addCabinet, 
  removeCabinet, 
  dimensions, 
  setDimensions, 
  updateCabinet 
}) {
  const roomInputs = React.createElement('div', { className: 'grid grid-cols-3 gap-2' }, [
    React.createElement('div', { key: 'width' }, [
      React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Width'),
      React.createElement('input', {
        type: 'number',
        min: '4',
        max: '200',
        step: '0.5',
        value: project.room.width,
        onChange: (e) => setProject({ ...project, room: { ...project.room, width: parseFloat(e.target.value) || 0 } }),
        className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm'
      })
    ]),
    React.createElement('div', { key: 'depth' }, [
      React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Depth'),
      React.createElement('input', {
        type: 'number',
        min: '4',
        max: '200',
        step: '0.5',
        value: project.room.depth,
        onChange: (e) => setProject({ ...project, room: { ...project.room, depth: parseFloat(e.target.value) || 0 } }),
        className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm'
      })
    ]),
    React.createElement('div', { key: 'height' }, [
      React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Height'),
      React.createElement('input', {
        type: 'number',
        min: '4',
        max: '200',
        step: '0.5',
        value: project.room.height,
        onChange: (e) => setProject({ ...project, room: { ...project.room, height: parseFloat(e.target.value) || 0 } }),
        className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm'
      })
    ])
  ]);

  const header = React.createElement('div', { className: 'p-6 border-b border-gray-200' }, [
    React.createElement('h2', { className: 'text-lg font-semibold text-gray-800 mb-3', key: 'title' }, 'Project'),
    React.createElement('div', { className: 'space-y-3', key: 'inputs' }, [
      React.createElement('div', { key: 'clientName' }, [
        React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Client Name'),
        React.createElement('input', {
          type: 'text',
          value: project.clientName,
          onChange: (e) => setProject({ ...project, clientName: e.target.value }),
          className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm'
        })
      ]),
      React.createElement('div', { key: 'jobName' }, [
        React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Job Name'),
        React.createElement('input', {
          type: 'text',
          value: project.jobName,
          onChange: (e) => setProject({ ...project, jobName: e.target.value }),
          className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm'
        })
      ]),
      React.createElement('div', { key: 'room' }, [
        React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Room (units)'),
        roomInputs
      ])
    ])
  ]);

  const controlsHeader = React.createElement('div', { className: 'flex items-center justify-between mb-4' }, [
    React.createElement('h2', { className: 'text-lg font-semibold text-gray-800', key: 'cabTitle' }, 'Cabinet Controls'),
    React.createElement('div', { className: 'flex gap-2', key: 'buttons' }, [
      React.createElement('button', {
        onClick: addCabinet,
        className: 'p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors',
        title: 'Add Cabinet',
        key: 'add'
      }, React.createElement(Plus, { className: 'w-4 h-4' })),
      React.createElement('button', {
        onClick: removeCabinet,
        disabled: !selectedCabinet,
        className: 'p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors',
        title: 'Remove Cabinet',
        key: 'remove'
      }, React.createElement(Minus, { className: 'w-4 h-4' }))
    ])
  ]);

  const dimInputs = selectedCabinet ? React.createElement('div', { className: 'space-y-4' }, [
    React.createElement('div', { key: 'dims' }, [
      React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Dimensions (inches)'),
      React.createElement('div', { className: 'grid grid-cols-3 gap-2' }, [
        React.createElement('div', { key: 'w' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Width'),
          React.createElement('input', {
            type: 'number',
            value: dimensions.width,
            onChange: (e) => {
              const newWidth = parseFloat(e.target.value) || 0;
              setDimensions({ ...dimensions, width: newWidth });
              updateCabinet('size', [newWidth, dimensions.height, dimensions.depth]);
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            min: '1',
            max: '120'
          })
        ]),
        React.createElement('div', { key: 'h' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Height'),
          React.createElement('input', {
            type: 'number',
            value: dimensions.height,
            onChange: (e) => {
              const newHeight = parseFloat(e.target.value) || 0;
              setDimensions({ ...dimensions, height: newHeight });
              updateCabinet('size', [dimensions.width, newHeight, dimensions.depth]);
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            min: '1',
            max: '120'
          })
        ]),
        React.createElement('div', { key: 'd' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Depth'),
          React.createElement('input', {
            type: 'number',
            value: dimensions.depth,
            onChange: (e) => {
              const newDepth = parseFloat(e.target.value) || 0;
              setDimensions({ ...dimensions, depth: newDepth });
              updateCabinet('size', [dimensions.width, dimensions.height, newDepth]);
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            min: '1',
            max: '48'
          })
        ])
      ])
    ]),
    React.createElement('div', { key: 'pos' }, [
      React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Position'),
      React.createElement('div', { className: 'grid grid-cols-3 gap-2' }, [
        React.createElement('div', { key: 'x' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'X'),
          React.createElement('input', {
            type: 'number',
            value: cabinets.find(c => c.id === selectedCabinet)?.position[0] || 0,
            onChange: (e) => {
              const newX = parseFloat(e.target.value) || 0;
              const cabinet = cabinets.find(c => c.id === selectedCabinet);
              if (cabinet) {
                updateCabinet('position', [newX, cabinet.position[1], cabinet.position[2]]);
              }
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            step: '0.5'
          })
        ]),
        React.createElement('div', { key: 'y' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Y'),
          React.createElement('input', {
            type: 'number',
            value: cabinets.find(c => c.id === selectedCabinet)?.position[1] || 0,
            onChange: (e) => {
              const newY = parseFloat(e.target.value) || 0;
              const cabinet = cabinets.find(c => c.id === selectedCabinet);
              if (cabinet) {
                updateCabinet('position', [cabinet.position[0], newY, cabinet.position[2]]);
              }
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            min: '0',
            step: '0.5'
          })
        ]),
        React.createElement('div', { key: 'z' }, [
          React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Z'),
          React.createElement('input', {
            type: 'number',
            value: cabinets.find(c => c.id === selectedCabinet)?.position[2] || 0,
            onChange: (e) => {
              const newZ = parseFloat(e.target.value) || 0;
              const cabinet = cabinets.find(c => c.id === selectedCabinet);
              if (cabinet) {
                updateCabinet('position', [cabinet.position[0], cabinet.position[1], newZ]);
              }
            },
            className: 'w-full px-2 py-1 border border-gray-300 rounded text-sm',
            step: '0.5'
          })
        ])
      ])
    ])
  ]) : null;

  const controlsSection = React.createElement('div', { className: 'p-6 border-b border-gray-200' }, [
    controlsHeader,
    dimInputs
  ]);

  return React.createElement(React.Fragment, null, header, controlsSection);
}