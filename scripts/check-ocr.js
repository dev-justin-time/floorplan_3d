import {
    extractWords,
    groupWords,
    classifyLine,
    parseDimension,
    parseArea,
    parseScaleNote,
    parsePlanText,
    planTextSummary,
    ocrLineLabel,
    recognizePlanText
} from '../features/ocr.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
    if (ok) {
        pass += 1;
        console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        fail += 1;
        console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
};
const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance;

const word = (text, x0, y0, x1, y1, confidence = 90) => ({
    text, confidence, bbox: { x0, y0, x1, y1 }
});

console.log('\nDimensions');
const feetInches = parseDimension(`12'-6"`);
check('feet and inches convert to metres', feetInches.unit === 'ft-in' && near(feetInches.metres, 3.81), `${feetInches.metres} m`);
check('inches alone convert', near(parseDimension('48 in').metres, 1.219, 0.001));
check('millimetres convert', near(parseDimension('4200 mm').metres, 4.2));
check('centimetres convert', near(parseDimension('420 cm').metres, 4.2));
check('metres pass through', near(parseDimension('3.5 m').metres, 3.5));
check('a bare 4200 is millimetres', parseDimension('4200').unit === 'mm' && near(parseDimension('4200').metres, 4.2));
check('a bare 420 is centimetres', parseDimension('420').unit === 'cm' && near(parseDimension('420').metres, 4.2));
check('no unit means no metres', parseDimension('BEDROOM 2') === null);
check('decimal comma reads', near(parseDimension('3,5 m').metres, 3.5));

console.log('\nScale and areas');
check('metric scale note', parseScaleNote('SCALE 1:100')?.ratio === 100);
check('imperial architect scale', parseScaleNote(`1/4" = 1'-0"`)?.ratio === 48);
check('inch to feet scale', parseScaleNote('1 in = 4 ft')?.ratio === 48);
check('a room label is not a scale', parseScaleNote('BEDROOM') === null);
check('square feet convert', near(parseArea('120 sq ft').squareMetres, 11.15, 0.01));
check('square metres convert', near(parseArea('45 m²').squareMetres, 45));
check('SF shorthand works', parseArea('480 SF')?.value === 480);
check('a dimension is not an area', parseArea('4200 mm') === null);

console.log('\nClassification');
check('dimension line', classifyLine('4200 mm').category === 'dimension');
check('room line', classifyLine('MASTER BEDROOM').category === 'room');
check('room with a number', classifyLine('BEDROOM 2').category === 'room');
check('scale line', classifyLine('SCALE 1:100').category === 'scale');
check('area line', classifyLine('120 sq ft').category === 'area');
check('label line', classifyLine('WASHER/DRYER').category === 'label');
check('empty line', classifyLine('   ').category === 'empty');
check('bath abbreviation is a room', classifyLine('BATH').category === 'room');
check('dining is a room', classifyLine('DINING').category === 'room');

console.log('\nWord extraction and lines');
const nested = {
    blocks: [{
        paragraphs: [{
            lines: [{
                words: [
                    word('KITCHEN', 10, 10, 90, 30),
                    word('12\'', 10, 50, 30, 68),
                    word('-6"', 34, 50, 60, 68)
                ]
            }]
        }]
    }],
    text: 'KITCHEN 12\'-6"'
};
const words = extractWords(nested);
check('nested blocks give every word once', words.length === 3, `${words.length} words`);
check('flat word lists also read', extractWords({ words: [word('A', 0, 0, 5, 5)] }).length === 1);
const duplicated = word('KITCHEN', 10, 10, 90, 30);
check('the same word in words and blocks counts once',
    extractWords({ words: [duplicated], blocks: [{ paragraphs: [{ lines: [{ words: [{ ...duplicated }] }] }] }] }).length === 1);
check('empty words are dropped', extractWords({ words: [{ text: '  ', confidence: 90 }] }).length === 0);
check('bbox is normalized', words[0].bbox.x0 === 10 && words[0].bbox.x1 === 90);

const grouped = groupWords([
    word('KITCHEN', 10, 10, 90, 30),
    word('BEDROOM', 200, 12, 290, 32),
    word('2', 295, 12, 305, 32),
    word('20', 10, 100, 40, 118, 12)
]);
check('far-apart labels are separate lines', grouped.length === 2, `${grouped.length} lines`);
check('adjacent words join one line', grouped[0].text === 'KITCHEN' || grouped[0].text === 'BEDROOM 2');
check('low-confidence words are dropped', !grouped.some((line) => line.text === '20'));

const joined = groupWords([
    word('MASTER', 10, 10, 70, 30),
    word('BEDROOM', 74, 10, 150, 30)
]);
check('nearby words join', joined.length === 1 && joined[0].text === 'MASTER BEDROOM', joined[0]?.text);

console.log('\nPlan payload');
const parsed = parsePlanText({
    text: 'KITCHEN\n12\'-6"\nMASTER BEDROOM\n120 sq ft\nSCALE 1:100',
    blocks: [{
        paragraphs: [{
            lines: [
                { words: [word('KITCHEN', 10, 10, 90, 30)] },
                { words: [word(`12'-6"`, 10, 60, 80, 78)] },
                { words: [word('MASTER', 200, 10, 270, 30), word('BEDROOM', 275, 10, 360, 30)] },
                { words: [word('120', 200, 60, 235, 78), word('sq', 240, 60, 260, 78), word('ft', 264, 60, 278, 78)] },
                { words: [word('SCALE', 400, 400, 460, 418), word('1:100', 465, 400, 520, 418)] }
            ]
        }]
    }]
}, { width: 800, height: 600 });

check('payload names its engine', parsed.engine === 'tesseract.js');
check('payload keeps the image size', parsed.width === 800 && parsed.height === 600);
check('rooms are counted', parsed.counts.rooms === 2, `${parsed.counts.rooms}`);
check('dimensions are counted', parsed.counts.dimensions === 1, `${parsed.counts.dimensions}`);
check('areas are counted', parsed.counts.areas === 1);
check('scale notes are counted', parsed.counts.scales === 1);
check('dimension carries metres', near(parsed.dimensions[0].metres, 3.81));
check('area carries square metres', near(parsed.areas[0].squareMetres, 11.15, 0.01));
check('scale carries its ratio', parsed.scales[0].scale.ratio === 100);
check('raw text is kept', parsed.text.includes('KITCHEN'));

const summary = planTextSummary(parsed);
check('summary lists the counts', /2 rooms/.test(summary) && /1 dimension/.test(summary) && /1 scale note/.test(summary), summary);
check('empty summary', planTextSummary(null) === 'No text read yet');
check('line label appends metres', ocrLineLabel(parsed.dimensions[0]) === `12'-6" — 3.81 m`, ocrLineLabel(parsed.dimensions[0]));
check('line label appends area', /11\.\d m²/.test(ocrLineLabel(parsed.areas[0])), ocrLineLabel(parsed.areas[0]));

const fallback = parsePlanText({ words: [word('GARAGE', 0, 0, 50, 20)] });
check('text falls back to the lines', fallback.text === 'GARAGE');
check('word positions are exposed for drawing', fallback.lines[0].bbox.x1 === 50);

console.log('\nInjected recognizer');
let received = null;
const result = await recognizePlanText('plan.png', {
    lang: 'eng',
    recognize: async (source, options) => {
        received = { source, options };
        return {
            width: 640,
            height: 480,
            text: 'DINING',
            words: [word('DINING', 20, 20, 100, 40)]
        };
    }
});
check('injected recognizer is used', received?.source === 'plan.png');
check('language is passed down', received?.options?.lang === 'eng');
check('injected result is parsed', result.counts.rooms === 1 && result.width === 640);
check('no worker is started without the engine', result.engine === 'tesseract.js');

let failed = false;
try {
    await recognizePlanText('plan.png', { recognize: async () => { throw new Error('engine unavailable'); } });
} catch (error) {
    failed = /engine unavailable/.test(error.message);
}
check('recognizer errors surface', failed);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
