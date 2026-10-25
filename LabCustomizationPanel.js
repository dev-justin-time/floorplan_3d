import React from 'react';
import { TEXTURES } from './metadata.js';

export default function LabCustomizationPanel({
  roomHeight, onRoomHeightChange,
  roomColors, onRoomColorsChange,
  roomTextures, onRoomTexturesChange,
  wallThickness, onWallThicknessChange,
  lightIntensity, onLightIntensityChange
}) {
  
  const updateColor = (color) => {
    const newColors = {};
    Object.keys(roomColors).forEach(key => newColors[key] = color);
    onRoomColorsChange(newColors);
  };

  const handleTextureUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
              const url = evt.target.result;
              const newTextures = {};
              // Apply to all rooms for this demo since we don't have per-room selection state in this panel yet
              Object.keys(roomTextures).forEach(key => newTextures[key] = url);
              // Also ensures new rooms get it if we track default
              onRoomTexturesChange(newTextures);
          };
          reader.readAsDataURL(file);
      }
  };

  return React.createElement('div', { className: 'bg-white p-6 rounded-lg shadow-md space-y-6' },
    React.createElement('h3', { className: 'text-lg font-semibold border-b pb-2' }, 'Customization'),
    
    // Dimensions
    React.createElement('div', { className: 'space-y-4' },
      React.createElement('h4', { className: 'text-sm font-medium text-gray-500 uppercase tracking-wider' }, 'Dimensions'),
      
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm mb-1' }, `Wall Height: ${roomHeight}m`),
        React.createElement('input', {
          type: 'range', min: 2, max: 5, step: 0.1,
          value: roomHeight,
          onChange: (e) => onRoomHeightChange(parseFloat(e.target.value)),
          className: 'w-full accent-blue-600'
        })
      ),
      
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm mb-1' }, `Wall Thickness: ${wallThickness}m`),
        React.createElement('input', {
          type: 'range', min: 0.05, max: 0.5, step: 0.01,
          value: wallThickness,
          onChange: (e) => onWallThicknessChange(parseFloat(e.target.value)),
          className: 'w-full accent-blue-600'
        })
      )
    ),

    // Appearance
    React.createElement('div', { className: 'space-y-4' },
      React.createElement('h4', { className: 'text-sm font-medium text-gray-500 uppercase tracking-wider' }, 'Appearance'),
      
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm mb-2' }, 'Room Theme'),
        React.createElement('div', { className: 'flex gap-2' },
          ['#ffffff', '#f0f9ff', '#fff7ed', '#f0fdf4'].map(color => 
            React.createElement('button', {
              key: color,
              className: 'w-8 h-8 rounded-full border border-gray-200 shadow-sm hover:scale-110 transition-transform',
              style: { backgroundColor: color },
              onClick: () => updateColor(color)
            })
          )
        )
      )
    ),

    // Environment
    React.createElement('div', { className: 'space-y-4' },
      React.createElement('h4', { className: 'text-sm font-medium text-gray-500 uppercase tracking-wider' }, 'Environment'),
      
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm mb-1' }, `Light Intensity: ${Math.round(lightIntensity * 100)}%`),
        React.createElement('input', {
          type: 'range', min: 0, max: 2, step: 0.1,
          value: lightIntensity,
          onChange: (e) => onLightIntensityChange(parseFloat(e.target.value)),
          className: 'w-full accent-amber-500'
        })
      )
    )
  );
}


