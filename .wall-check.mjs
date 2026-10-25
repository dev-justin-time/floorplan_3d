import { Wall, wallBox, ItemFactory } from './items.js';

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const round = (n) => Math.round(n * 1e6) / 1e6;
const rnd = (arr) => arr.map(round);

// left wall of KitchenScene's 20x12x6 room
const left = new Wall(-10, -6, -10, 6, 0.2);
const lb = wallBox(left, { height: 6 });
check('left wall position', eq(rnd(lb.position), [-10, 3, 0]), JSON.stringify(rnd(lb.position)));
check('left wall size', eq(rnd(lb.size), [12, 6, 0.2]), JSON.stringify(rnd(lb.size)));
check('left wall rotation', eq(rnd(lb.rotation), [0, round(-Math.PI / 2), 0]), JSON.stringify(rnd(lb.rotation)));
check('left wall length', round(lb.length) === 12);

// back wall
const back = new Wall(-10, -6, 10, -6, 0.2);
const bb = wallBox(back, { height: 6 });
check('back wall position', eq(rnd(bb.position), [0, 3, -6]));
check('back wall size', eq(rnd(bb.size), [20, 6, 0.2]));
check('back wall rotation 0', eq(rnd(bb.rotation), [0, 0, 0]));

// defaults come from world-space
const plain = wallBox(new Wall(0, 0, 2, 0));
check('default height 2.7', plain.size[1] === 2.7, String(plain.size[1]));
check('thickness falls back to the model', plain.size[2] === 10, String(plain.size[2]));

// diagonal: 45 degree wall of length sqrt(2)
const diag = wallBox(new Wall(0, 0, 1, 1, 0.15), { height: 2.7, thickness: 0.15 });
check('diagonal length', round(diag.length) === round(Math.SQRT2));
check('diagonal rotation', round(diag.rotation[1]) === round(-Math.PI / 4), JSON.stringify(rnd(diag.rotation)));
check('explicit thickness', diag.size[2] === 0.15);

// degenerate
check('zero-length wall still returns a box', wallBox(new Wall(1, 1, 1, 1)).length === 0);
check('null-safe', wallBox(null) === null && wallBox({}) === null);

// the model still serialises/restores
const restored = Wall.fromJSON(left.toJSON());
check('fromJSON round trip', restored.start.x === -10 && restored.end.y === 6 && restored.thickness === 0.2);
check('items still factory-built', ItemFactory.create('shaker_base_cabinet', 0, 0).type === 'shaker_base_cabinet');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
