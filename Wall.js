import React from 'react';
import { Box, Text } from '@react-three/drei';

export default function Wall({ position, size, name, showLabels }) {
  const children = [
    React.createElement(Box, { args: size, castShadow: true, receiveShadow: true, key: 'wallbox' },
      React.createElement('meshStandardMaterial', { color: '#e0e0e0', roughness: 0.8 })
    )
  ];

  if (showLabels) {
    children.push(
      React.createElement(Text, {
        key: 'label',
        position: [0, size[1] / 2 + 0.1, -size[2] / 2 - 0.1],
        fontSize: 0.4,
        color: 'black',
        anchorX: 'center',
        anchorY: 'middle',
        rotation: [0, 0, 0]
      }, name)
    );
  }

  return React.createElement('group', { position }, children);
}

