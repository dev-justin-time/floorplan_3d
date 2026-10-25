import React from 'react';

const Row = ({ label, children }) =>
  React.createElement('label', { className: 'flex items-center justify-between gap-2 py-1' },
    React.createElement('span', { className: 'text-[11px] text-gray-600' }, label),
    children
  );

const Check = ({ checked, onChange }) =>
  React.createElement('input', {
    type: 'checkbox',
    checked,
    onChange: (e) => onChange(e.target.checked),
    className: 'rounded border-gray-300 text-primary focus:ring-primary'
  });

const Section = ({ title, children }) =>
  React.createElement('div', { className: 'space-y-1 pb-3 border-b border-gray-100' },
    React.createElement('p', { className: 'text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1' }, title),
    children
  );

/**
 * Every lab capability now lives here: the toggles drive the main kitchen scene
 * (post FX, spring selection, instancing, pathfinding agent, shaker model with
 * physics, scene export), and the demo labs that need their own canvas open from
 * the buttons at the bottom, unchanged.
 */
export default function SceneLabPanel({ scene, update, exporters, labs = [], onOpenLab, targetName }) {
  const effects = scene.effects || {};

  return React.createElement('div', { className: 'flex-1 overflow-y-auto p-3 space-y-3' },
    React.createElement(Section, { title: 'Post-processing' },
      React.createElement(Row, { label: 'Bloom' },
        React.createElement(Check, {
          checked: !!effects.bloom,
          onChange: (value) => update({ effects: { ...effects, bloom: value } })
        })
      ),
      React.createElement(Row, { label: 'Depth of field' },
        React.createElement(Check, {
          checked: !!effects.dof,
          onChange: (value) => update({ effects: { ...effects, dof: value } })
        })
      ),
      React.createElement(Row, { label: 'Vignette' },
        React.createElement(Check, {
          checked: !!effects.vignette,
          onChange: (value) => update({ effects: { ...effects, vignette: value } })
        })
      )
    ),

    React.createElement(Section, { title: 'Motion' },
      React.createElement(Row, { label: 'Spring the selection' },
        React.createElement(Check, { checked: !!scene.spring, onChange: (value) => update({ spring: value }) })
      )
    ),

    React.createElement(Section, { title: 'GPU instancing' },
      React.createElement(Row, { label: `Instances: ${scene.instances || 0}` },
        React.createElement('input', {
          type: 'range',
          min: 0,
          max: 300,
          step: 10,
          value: scene.instances || 0,
          onChange: (e) => update({ instances: Number(e.target.value) }),
          className: 'w-28 accent-cyan-500'
        })
      )
    ),

    React.createElement(Section, { title: 'Shaker model (DRACO)' },
      React.createElement(Row, { label: 'Show in scene' },
        React.createElement(Check, {
          checked: !!scene.shaker?.visible,
          onChange: (value) => update({ shaker: { ...scene.shaker, visible: value } })
        })
      ),
      React.createElement(Row, { label: 'Shake' },
        React.createElement(Check, {
          checked: !!scene.shaker?.shaking,
          onChange: (value) => update({ shaker: { ...scene.shaker, shaking: value } })
        })
      ),
      React.createElement(Row, { label: `Intensity: ${Math.round((scene.shaker?.intensity ?? 0.5) * 100)}%` },
        React.createElement('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.1,
          value: scene.shaker?.intensity ?? 0.5,
          onChange: (e) => update({ shaker: { ...scene.shaker, intensity: Number(e.target.value) } }),
          className: 'w-28 accent-purple-500'
        })
      )
    ),

    React.createElement(Section, { title: 'Pathfinding' },
      React.createElement(Row, { label: 'Walk to selection' },
        React.createElement(Check, { checked: !!scene.agent, onChange: (value) => update({ agent: value }) })
      ),
      React.createElement('p', { className: 'text-[10px] text-gray-400 leading-snug' },
        targetName ? `Agent target: ${targetName}` : 'Select a cabinet to give the agent a destination.'
      )
    ),

    React.createElement(Section, { title: 'Scene export' },
      React.createElement('div', { className: 'grid grid-cols-3 gap-1' },
        ['GLTF', 'GLB', 'OBJ'].map((label) =>
          React.createElement('button', {
            key: label,
            className: 'text-[11px] font-semibold rounded-md border border-gray-200 py-1 hover:border-primary hover:text-primary',
            onClick: () => {
              if (!exporters?.current) return;
              if (label === 'OBJ') exporters.current.obj();
              else exporters.current.gltf(label === 'GLB');
            }
          }, label)
        )
      )
    ),

    React.createElement(Section, { title: 'Demo labs' },
      React.createElement('div', { className: 'grid grid-cols-2 gap-1' },
        labs.map((lab) =>
          React.createElement('button', {
            key: lab.key,
            className: 'item-button',
            onClick: () => onOpenLab(lab.key)
          }, lab.label)
        )
      )
    )
  );
}
