(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cv = document.getElementById('blueprint-canvas');
  const rect = cv.getBoundingClientRect();
  const fire = (type, dx, dy) => cv.dispatchEvent(new PointerEvent(type, {
    clientX: rect.left + dx,
    clientY: rect.top + dy,
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse'
  }));
  const out = {};
  await sleep(500);

  out.stories = document.getElementById('story-select').options.length;

  document.querySelector('.item-button[data-item="shaker_base_cabinet"]').click();
  out.tool = window.AppState.currentTool;

  const before = window.AppState.fixtures.length;
  fire('pointerdown', 200, 200);
  fire('pointerup', 200, 200);
  await sleep(400);
  out.placed = window.AppState.fixtures.length - before;
  const item = window.AppState.fixtures[window.AppState.fixtures.length - 1];
  out.placedType = item && item.type;

  fire('pointerdown', 200, 200);
  fire('pointermove', 320, 240);
  fire('pointerup', 320, 240);
  await sleep(400);
  out.dragDeltaPx = item ? { x: Math.round(item.x - 200), y: Math.round(item.y - 200) } : null;

  const toggle = document.getElementById('view-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
  await sleep(1200);
  out.view = window.AppState.currentView;
  out.view3DDisplay = getComputedStyle(document.getElementById('render-3d-view')).display;

  window.undo();
  await sleep(400);
  out.afterUndo = window.AppState.fixtures.length;
  window.redo();
  await sleep(400);
  out.afterRedo = window.AppState.fixtures.length;

  return out;
})()
