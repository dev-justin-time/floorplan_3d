        function toggleTheme() {
            document.documentElement.classList.toggle('dark');
        }
        // Tab Switching Logic
        function switchTab(tabName) {
            document.querySelectorAll('.calc-content').forEach(el => el.classList.add('hidden'));
            document.getElementById('calc-' + tabName).classList.remove('hidden');
            
            document.querySelectorAll('.calc-tab').forEach(el => {
                el.classList.remove('active', 'text-white');
                el.classList.add('text-gray-600', 'dark:text-gray-300');
            });
            const activeBtn = document.getElementById('tab-' + tabName);
            activeBtn.classList.add('active');
            activeBtn.classList.remove('text-gray-600', 'dark:text-gray-300');
        }

        // 1. Lumber Span Calculator
        function calcSpan() {
            const [fb, e] = document.getElementById('span-species').value.split(',').map(Number);
            const [b, d, s, i] = document.getElementById('span-size').value.split(',').map(Number);
            const spacing = Number(document.getElementById('span-spacing').value);
            const load = Number(document.getElementById('span-load').value);

            const w = load * (spacing / 12); // plf
            
            // Bending limit: L = sqrt((8 * Fb * S) / w) / 12 (to feet)
            const spanBendInches = Math.sqrt((8 * fb * s) / w);
            const spanBendFt = (spanBendInches / 12).toFixed(2);

            // Deflection limit (L/360): L = cbrt((384 * E * I) / (1800 * w)) / 12
            const spanDefInches = Math.cbrt((384 * e * i) / (1800 * w));
            const spanDefFt = (spanDefInches / 12).toFixed(2);

            const finalSpan = Math.min(Number(spanBendFt), Number(spanDefFt)).toFixed(2);

            document.getElementById('res-span-bend').textContent = spanBendFt + ' ft';
            document.getElementById('res-span-def').textContent = spanDefFt + ' ft';
            document.getElementById('res-span-final').textContent = finalSpan + ' ft';
            document.getElementById('span-result').classList.remove('hidden');
        }

        // 2. Stair Calculator
        function calcStairs() {
            const totalRise = Number(document.getElementById('stair-rise').value);
            const targetRun = Number(document.getElementById('stair-run').value);
            
            let numRisers = Math.round(totalRise / 7.5); // Target ~7.5" rise
            if (numRisers < 2) numRisers = 2;
            
            const actualRise = (totalRise / numRisers).toFixed(2);
            const numTreads = numRisers - 1;
            const totalRun = (numTreads * targetRun).toFixed(1);
            
            // Stringer length (hypotenuse of one step * num treads, plus a bit for top/bottom cuts)
            const stepHypotenuse = Math.sqrt(Math.pow(actualRise, 2) + Math.pow(targetRun, 2));
            const stringerLength = ((stepHypotenuse * numTreads) / 12).toFixed(2);

            const codeCheck = (actualRise <= 7.75 && targetRun >= 10) 
                ? "✅ Meets standard IRC code (Max rise 7.75\", Min run 10\")" 
                : "⚠️ Check local codes: Rise should be ≤ 7.75\" and Run ≥ 10\"";

            document.getElementById('res-stair-risers').textContent = numRisers;
            document.getElementById('res-stair-actual-rise').textContent = actualRise + '"';
            document.getElementById('res-stair-total-run').textContent = totalRun + '"';
            document.getElementById('res-stair-stringer').textContent = stringerLength + ' ft';
            document.getElementById('stair-code-check').textContent = codeCheck;
            document.getElementById('stair-result').classList.remove('hidden');
        }

        // 3. Concrete Calculator
        let concreteShape = 'rect';
        function setConcreteShape(shape) {
            concreteShape = shape;
            document.getElementById('shape-rect').className = shape === 'rect' ? 'flex-1 py-2 px-4 rounded-lg border border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium' : 'flex-1 py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';
            document.getElementById('shape-round').className = shape === 'round' ? 'flex-1 py-2 px-4 rounded-lg border border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium' : 'flex-1 py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';
            
            document.getElementById('concrete-rect-inputs').classList.toggle('hidden', shape !== 'rect');
            document.getElementById('concrete-round-inputs').classList.toggle('hidden', shape !== 'round');
        }

        function calcConcrete() {
            let yards = 0;
            if (concreteShape === 'rect') {
                const l = Number(document.getElementById('conc-l').value);
                const w = Number(document.getElementById('conc-w').value);
                const d = Number(document.getElementById('conc-d').value) / 12; // to feet
                yards = (l * w * d) / 27;
            } else {
                const dia = Number(document.getElementById('conc-dia').value) / 12; // to feet
                const radius = dia / 2;
                const depth = Number(document.getElementById('conc-depth').value);
                const qty = Number(document.getElementById('conc-qty').value);
                yards = (Math.PI * Math.pow(radius, 2) * depth * qty) / 27;
            }
            document.getElementById('res-concrete-yards').textContent = yards.toFixed(2);
            document.getElementById('concrete-result').classList.remove('hidden');
        }

        // 4. Roof Calculator
        function calcRoof() {
            const run = Number(document.getElementById('roof-run').value);
            const rise = Number(document.getElementById('roof-rise').value);
            
            const pitch = (rise / run * 12).toFixed(1);
            const angle = (Math.atan(rise / run) * (180 / Math.PI)).toFixed(1);
            const length = Math.sqrt(Math.pow(run, 2) + Math.pow(rise, 2)).toFixed(2);

            document.getElementById('res-roof-pitch').textContent = pitch + " in 12";
            document.getElementById('res-roof-angle').textContent = angle + "°";
            document.getElementById('res-roof-length').textContent = length + " ft";
            document.getElementById('roof-result').classList.remove('hidden');
        }

        // 5. Deck Calculator
        function calcDeck() {
            const load = Number(document.getElementById('deck-load').value);
            const spacing = Number(document.getElementById('deck-spacing').value);
            const soil = Number(document.getElementById('deck-soil').value);

            const tributaryArea = spacing * spacing;
            const totalLoad = load * tributaryArea * 1.5; // 1.5 safety factor
            
            // Area needed in sq ft = totalLoad / soil
            const areaSqFt = totalLoad / soil;
            // Area = pi * r^2 -> r = sqrt(area / pi)
            const radiusFt = Math.sqrt(areaSqFt / Math.PI);
            const diameterInches = (radiusFt * 2 * 12).toFixed(1);

            document.getElementById('res-deck-load').textContent = Math.round(totalLoad).toLocaleString() + " lbs";
            document.getElementById('res-deck-dia').textContent = diameterInches + " inches";
            document.getElementById('deck-result').classList.remove('hidden');
        }
