(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { step: 'start' };
  try {
  const canvas = document.getElementById('blueprint-canvas');
  const rect = canvas.getBoundingClientRect();
  const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
    clientX: rect.left + x, clientY: rect.top + y, bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0
  }));
  const autosave = () => JSON.parse(localStorage.getItem('floorplan3d_autosave') || '{}');
  const tool = (name) => document.querySelector(`.tool-btn[data-tool="${name}"]`).click();

  await sleep(800);
  localStorage.removeItem('floorplan3d_autosave');

  // 1. draw a wall
  tool('wall');
  fire('pointerdown', 200, 200);
  fire('pointerup', 500, 200);
  await sleep(700);
  out.wallsAfterDraw = autosave().walls?.length ?? 0;

  // 2. select the wall
  tool('select');
  fire('pointerdown', 350, 200);
  fire('pointerup', 350, 200);
  await sleep(400);
  out.wallPanelVisible = !document.getElementById('selection-wall').classList.contains('hidden');
  out.wallLength = document.getElementById('sel-wall-len').textContent;
  out.wallHeightInput = document.getElementById('sel-wall-height').value;

  // 3. change the wall height
  const heightInput = document.getElementById('sel-wall-height');
  heightInput.value = '2';
  heightInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  out.wallHeightSaved = autosave().walls?.[0]?.height;

  // 4. roof toggle
  document.getElementById('roof-toggle').click();
  await sleep(900);
  out.roofChecked = document.getElementById('roof-toggle').checked;

  // 5. place a cabinet
  document.querySelector('.item-button[data-item="kitchen_cabinet"]').click();
  fire('pointerdown', 420, 320);
  fire('pointerup', 420, 320);
  await sleep(800);
  out.fixturesAfterPlace = autosave().fixtures?.length ?? 0;

  // 6. select it
  tool('select');
  fire('pointerdown', 420, 320);
  fire('pointerup', 420, 320);
  await sleep(400);
  out.itemPanelVisible = !document.getElementById('selection-item').classList.contains('hidden');
  out.itemName = document.getElementById('sel-item-name').textContent;
  out.itemPos = document.getElementById('sel-item-pos').textContent;

  // 7. hide
  document.getElementById('sel-item-visible').closest('button').click();
  await sleep(800);
  const hidden = autosave().fixtures?.[0];
  out.hiddenFlag = hidden?.visible;
  out.hideLabel = document.getElementById('sel-item-visible').textContent;

  // 8. show again, then lock and try to drag
  document.getElementById('sel-item-visible').closest('button').click();
  await sleep(800);
  document.getElementById('sel-item-lock').closest('button').click();
  await sleep(800);
  out.lockedFlag = autosave().fixtures?.[0]?.locked;
  const before = autosave().fixtures?.[0];
  fire('pointerdown', 420, 320);
  fire('pointermove', 540, 400);
  fire('pointerup', 540, 400);
  await sleep(900);
  const after = autosave().fixtures?.[0];
  out.lockedMoved = before && after ? (Math.round(before.x) !== Math.round(after.x) || Math.round(before.y) !== Math.round(after.y)) : 'n/a';

  // 9. unlock, duplicate, delete
  document.getElementById('sel-item-lock').closest('button').click();
  await sleep(500);
  document.querySelector('[onclick="window.duplicateSelected()"]').click();
  await sleep(800);
  out.afterDuplicate = autosave().fixtures?.length;
  document.querySelector('[onclick="window.deleteSelected()"]').click();
  await sleep(800);
  out.afterDelete = autosave().fixtures?.length;

  // 10. wall delete
  tool('select');
  fire('pointerdown', 350, 200);
  fire('pointerup', 350, 200);
  await sleep(300);
  document.querySelector('[onclick="window.deleteSelectedWall()"]').click();
  await sleep(800);
  out.afterWallDelete = autosave().walls?.length;
  } catch (error) {
    out.error = String(error && (error.stack || error.message || error));
  }
  return out;
})()
