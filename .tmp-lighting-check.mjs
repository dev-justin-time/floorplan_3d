import { createPlan, addDevice, autoLights, autoSockets, autoSwitches, autoCircuits, validateLayout, toggleSwitch } from './features/lighting/plan.js';
import { designLighting, designCsv, GLOSSARY } from './features/lighting/engine.js';
import { roomPresetById } from './features/lighting/catalog.js';

for (const room of ['living', 'kitchen', 'bathroom', 'stairs', 'outdoor']) {
  const p = roomPresetById(room);
  const plan = createPlan({ roomType: room, width: room === 'hallway' ? 5 : 4.5, depth: 4 });
  autoLights(plan, { typeId: p.ambient });
  autoSockets(plan, { typeId: p.socketType, minCount: p.minSockets });
  autoSwitches(plan, { typeId: p.switchType });
  autoCircuits(plan);
  const d = designLighting(plan);
  console.log(room, {
    lights: d.luminaires.length, sockets: d.sockets.length, switches: d.switches.length,
    lux: d.metrics.averageLux, target: d.metrics.targetLux, uni: d.metrics.uniformity,
    errors: d.errors.map(e => e.id), warns: d.warnings.map(e => e.id).slice(0,6),
    circuits: d.circuits.map(c => `${c.name}:${c.load.amps}A/${c.breakerA}`), total: d.cost.total
  });
  if (room === 'living') {
    console.log('csv lines', designCsv(d).split('\n').length);
    const sw = d.switches[0];
    const lights = toggleSwitch(plan, sw.id);
    console.log('toggle', lights.length, lights.every(l => l.on === false));
    console.log('checks', validateLayout(plan).map(c => c.id));
  }
}
console.log('glossary', GLOSSARY.length);
