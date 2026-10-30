        import { BUILD_STAGES, stageStatus, nextStage, renderWorkflowStrip } from '../../shared/project-workflow.js';
        const host = document.getElementById('project-workflow');
        if (host) renderWorkflowStrip(host, 'costs');
        const stages = stageStatus();
        const next = nextStage();
        const flowNext = document.getElementById('flow-next');
        if (flowNext) flowNext.textContent = `Next: ${next.step} ${next.label} → ${next.page} · ${stages.filter((s) => s.started).length}/${stages.length} stages started`;
        const list = document.getElementById('plan-checklist');
        if (list) {
            const items = [
                ['01 · Floorplan (Editor)', 'Draw exterior + partitions, add doors/windows, name rooms — this is the plan every suite stacks onto.', 'Editor.html'],
                ['02–04 · Shell (walls, framing, roof)', 'Finishes, studs/headers, then trusses and covering — structure before services.', 'wall-designer.html'],
                ['05 · Stairs', 'Lock runs and headroom before cutting openings for services.', 'stair-designer.html'],
                ['06–08 · Services (plumbing, electrical, lighting)', 'Rough-in water/DWV/gas, then panel/circuits and lights on the same footprint.', 'plumbing-designer.html'],
                ['09 · Fit-out + outdoor (kitchen, deck, landscape)', 'Cabinets and clearances, then deck framing and planting.', 'kitchen-designer.html'],
                ['10–11 · Costs (price book → bid → dashboard)', 'Price lines, build the bid, review here. You are here.', 'bid-builder.html']
            ];
            list.innerHTML = items.map(([t, d, href]) => `<li><b>${t}.</b> ${d} <a class="underline" href="${href}">Open →</a></li>`).join('');
        }
        document.getElementById('open-project-3d')?.addEventListener('click', () => {
            import('../../shared/project-viewer.js').then(({ openProjectViewer }) => openProjectViewer());
        });
        void BUILD_STAGES;
