// PI 연구 워크벤치 — 모든 계산은 브라우저에서 수행되고, 데이터는 localStorage에만 저장된다.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* 저장 불가 환경에서도 계산은 동작한다 */
        }
    },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
};
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const kpi = (k, v, s = '') => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

function flash(el, msg) {
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 2500);
}

async function copyText(text, statusEl) {
    try {
        await navigator.clipboard.writeText(text);
        flash(statusEl, '클립보드에 복사했습니다.');
    } catch {
        flash(statusEl, '복사 실패 — 브라우저 권한을 확인하세요.');
    }
}

function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- 화학 계산 ---------------- */

const ATOMIC = {
    H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Si: 28.085,
    P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904, Ge: 72.63, Se: 78.971,
};
const ELEMENT_ORDER = ['C', 'H', 'N', 'O', 'F', 'S', 'Si', 'P', 'Cl', 'Br', 'I', 'B', 'Ge', 'Se'];
const WATER = 2 * ATOMIC.H + ATOMIC.O;

// "C14H10F6N2", "(C6H4)2O", "C6H4(NH2)2" 형태를 원소 개수 객체로 변환
function parseFormula(formula) {
    const src = String(formula).replace(/\s+/g, '');
    if (!src) throw new Error('빈 분자식');
    let i = 0;
    function group() {
        const counts = {};
        while (i < src.length && src[i] !== ')') {
            let part;
            if (src[i] === '(') {
                i += 1;
                part = group();
                if (src[i] !== ')') throw new Error('괄호가 닫히지 않았습니다');
                i += 1;
            } else {
                const m = /^[A-Z][a-z]?/.exec(src.slice(i));
                if (!m || !(m[0] in ATOMIC)) throw new Error(`알 수 없는 원소: ${src.slice(i, i + 2)}`);
                i += m[0].length;
                part = { [m[0]]: 1 };
            }
            const n = /^\d+(\.\d+)?/.exec(src.slice(i));
            const mult = n ? parseFloat(n[0]) : 1;
            if (n) i += n[0].length;
            for (const [el, c] of Object.entries(part)) counts[el] = (counts[el] || 0) + c * mult;
        }
        return counts;
    }
    const result = group();
    if (i !== src.length) throw new Error('괄호 짝이 맞지 않습니다');
    return result;
}

const massOf = (counts) => Object.entries(counts).reduce((s, [el, c]) => s + ATOMIC[el] * c, 0);
const addCounts = (acc, counts, k = 1) => {
    for (const [el, c] of Object.entries(counts)) acc[el] = (acc[el] || 0) + c * k;
    return acc;
};
const hillFormula = (counts) => ELEMENT_ORDER
    .filter((el) => counts[el] > 1e-9)
    .map((el) => {
        const c = Math.round(counts[el] * 100) / 100;
        return `${el}${c === 1 ? '' : c}`;
    })
    .join('');

/* ---------------- 모노머 DB ---------------- */

// kind: DA 이무수물, AM 디아민, CAP 모노무수물 말단봉지제, CAPA 모노아민 말단봉지제
const BUILTIN = [
    ['PMDA', 'DA', 'Pyromellitic dianhydride', 'C10H2O6', '강직, 고Tg, Kapton계'],
    ['BPDA', 'DA', '3,3′,4,4′-Biphenyltetracarboxylic dianhydride', 'C16H6O6', '저CTE, 고내열, Upilex계'],
    ['a-BPDA', 'DA', '2,3,3′,4′-Biphenyltetracarboxylic dianhydride', 'C16H6O6', '비대칭, 가용성, 고Tg'],
    ['BTDA', 'DA', '3,3′,4,4′-Benzophenonetetracarboxylic dianhydride', 'C17H6O7', '케톤, 광가교, 접착'],
    ['ODPA', 'DA', '4,4′-Oxydiphthalic anhydride', 'C16H6O7', '에테르, 유연, 저착색'],
    ['6FDA', 'DA', '4,4′-(Hexafluoroisopropylidene)diphthalic anhydride', 'C19H6F6O6', '불소, 무색, 저유전, 가용성'],
    ['BPADA', 'DA', '4,4′-(4,4′-Isopropylidenediphenoxy)bis(phthalic anhydride)', 'C31H20O8', '유연, 가용성, 열가소성'],
    ['DSDA', 'DA', '3,3′,4,4′-Diphenylsulfonetetracarboxylic dianhydride', 'C16H6O8S', '설폰, 가용성'],
    ['TAHQ', 'DA', 'p-Phenylene bis(trimellitate) dianhydride', 'C24H10O10', '에스터, 저흡습, 저CTE'],
    ['BPAF', 'DA', '9,9-Bis(3,4-dicarboxyphenyl)fluorene dianhydride', 'C29H14O6', '카도, 고Tg, 투명'],
    ['CBDA', 'DA', '1,2,3,4-Cyclobutanetetracarboxylic dianhydride', 'C8H4O6', '지환족, 무색, 액정배향막'],
    ['HPMDA', 'DA', '1,2,4,5-Cyclohexanetetracarboxylic dianhydride', 'C10H8O6', '지환족, 무색, 가용성'],
    ['ODA', 'AM', '4,4′-Oxydianiline', 'C12H12N2O', '범용, 유연, Kapton계'],
    ['3,4′-ODA', 'AM', '3,4′-Oxydianiline', 'C12H12N2O', '비대칭, 가공성'],
    ['p-PDA', 'AM', 'p-Phenylenediamine', 'C6H8N2', '강직, 저CTE'],
    ['m-PDA', 'AM', 'm-Phenylenediamine', 'C6H8N2', '굴곡, 가용성↑'],
    ['MDA', 'AM', '4,4′-Methylenedianiline', 'C13H14N2', '범용'],
    ['TFMB', 'AM', '2,2′-Bis(trifluoromethyl)benzidine', 'C14H10F6N2', '불소, 무색, 저CTE, CPI'],
    ['DMB', 'AM', '2,2′-Dimethylbenzidine (m-tolidine)', 'C14H16N2', '강직, 저CTE'],
    ['DABA', 'AM', '4,4′-Diaminobenzanilide', 'C13H13N3O', '아마이드, 수소결합, 저CTE'],
    ['BAPP', 'AM', '2,2-Bis[4-(4-aminophenoxy)phenyl]propane', 'C27H26N2O2', '유연, 열가소성, 저흡습'],
    ['BAPB', 'AM', '4,4′-Bis(4-aminophenoxy)biphenyl', 'C24H20N2O2', '유연, 고인성'],
    ['TPE-R', 'AM', '1,3-Bis(4-aminophenoxy)benzene', 'C18H16N2O2', '유연, 열가소성'],
    ['APB', 'AM', '1,3-Bis(3-aminophenoxy)benzene', 'C18H16N2O2', '메타, 저Tg, 접착'],
    ['4,4′-DDS', 'AM', '4,4′-Diaminodiphenyl sulfone', 'C12H12N2O2S', '설폰, 저착색'],
    ['3,3′-DDS', 'AM', '3,3′-Diaminodiphenyl sulfone', 'C12H12N2O2S', '설폰, 가용성'],
    ['6FpDA', 'AM', '4,4′-(Hexafluoroisopropylidene)dianiline', 'C15H12F6N2', '불소, 무색, 가용성'],
    ['bis-APAF', 'AM', '2,2-Bis(3-amino-4-hydroxyphenyl)hexafluoropropane', 'C15H12F6N2O2', 'OH, 감광성(PBO 전구체)'],
    ['BAPS', 'AM', 'Bis[4-(4-aminophenoxy)phenyl] sulfone', 'C24H20N2O4S', '설폰, 유연'],
    ['FDA', 'AM', '9,9-Bis(4-aminophenyl)fluorene', 'C25H20N2', '카도, 고Tg, 투명'],
    ['CHDA', 'AM', 'trans-1,4-Cyclohexanediamine', 'C6H14N2', '지환족, 염 형성 주의'],
    ['PA', 'CAP', 'Phthalic anhydride', 'C8H4O3', '아민 말단 봉지'],
    ['NA', 'CAP', '5-Norbornene-2,3-dicarboxylic anhydride (nadic)', 'C9H8O3', '반응성 말단, PMR'],
    ['PEPA', 'CAP', '4-Phenylethynylphthalic anhydride', 'C16H8O3', '반응성 말단, 열경화'],
    ['MA', 'CAP', 'Maleic anhydride', 'C4H2O3', '반응성 말단, BMI'],
    ['Aniline', 'CAPA', 'Aniline', 'C6H7N', '무수물 말단 봉지'],
].map(([id, kind, name, formula, tags]) => ({ id, kind, name, formula, tags: tags.split(', '), builtin: true }));

const SOLVENTS = {
    NMP: { name: 'NMP', density: 1.028 },
    DMAc: { name: 'DMAc', density: 0.937 },
    DMF: { name: 'DMF', density: 0.944 },
    GBL: { name: 'γ-Butyrolactone', density: 1.129 },
    DMSO: { name: 'DMSO', density: 1.100 },
    'm-cresol': { name: 'm-Cresol', density: 1.034 },
};

const KIND_LABEL = { DA: '이무수물', AM: '디아민', CAP: '봉지(무수물)', CAPA: '봉지(아민)' };

let customMonomers = store.get('pi.customMonomers', []);

function allMonomers() {
    return [...BUILTIN, ...customMonomers].map((m) => {
        let counts = null;
        let mw = num(m.mw);
        if (m.formula) {
            try {
                counts = parseFormula(m.formula);
                mw = massOf(counts);
            } catch {
                counts = null;
            }
        }
        return { ...m, counts, mw };
    });
}

let MONOMERS = allMonomers();
const byId = (id) => MONOMERS.find((m) => m.id === id);

/* ---------------- 탭 ---------------- */

function showTab(name) {
    if (!$(`[data-panel="${name}"]`)) name = 'recipe';
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
    store.set('pi.tab', name);
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}

$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

/* ---------------- 배합 계산 ---------------- */

const DEFAULT_RECIPE = {
    da: [{ id: '6FDA', frac: 100 }],
    am: [{ id: 'TFMB', frac: 100 }],
    ratio: 1,
    solid: 15,
    solvent: 'DMAc',
    basis: 'mass',
    basisVal: 50,
    p: 0.995,
    cap: '',
    capAmt: 0,
    actualRef: '',
    actualMass: '',
};

let recipe = { ...DEFAULT_RECIPE, ...store.get('pi.recipe', {}) };

function monomerOptions(kinds, selected, allowEmpty = false) {
    const opts = allowEmpty ? ['<option value="">없음</option>'] : [];
    for (const m of MONOMERS.filter((x) => kinds.includes(x.kind))) {
        opts.push(`<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.id)} (${fmt(m.mw, 2)})</option>`);
    }
    return opts.join('');
}

function renderCompRows() {
    for (const side of ['da', 'am']) {
        const kind = side === 'da' ? 'DA' : 'AM';
        const box = $(`#${side}-rows`);
        box.innerHTML = recipe[side].map((row, idx) => `
            <div class="comp-row" data-side="${side}" data-idx="${idx}">
                <select data-f="id" aria-label="모노머">${monomerOptions([kind], row.id)}</select>
                <input type="number" data-f="frac" step="any" min="0" value="${row.frac}" aria-label="mol%" title="mol% (해당 측 내)">
                <button class="icon-btn" data-del title="삭제" ${recipe[side].length === 1 ? 'disabled' : ''}>✕</button>
            </div>`).join('');
    }
    $('#r-cap').innerHTML = monomerOptions(['CAP', 'CAPA'], recipe.cap, true);
}

function renderStaticInputs() {
    $('#r-solvent').innerHTML = Object.entries(SOLVENTS)
        .map(([k, s]) => `<option value="${k}"${k === recipe.solvent ? ' selected' : ''}>${s.name} (ρ ${s.density})</option>`).join('');
    $('#r-ratio').value = recipe.ratio;
    $('#r-solid').value = recipe.solid;
    $('#r-basis').value = recipe.basis;
    $('#r-basis-val').value = recipe.basisVal;
    $('#r-p').value = recipe.p;
    $('#r-cap-amt').value = recipe.capAmt;
    $('#r-actual-mass').value = recipe.actualMass;
}

// 공중합 조성을 정규화하고 평균 반복단위·칭량값을 계산
function computeRecipe() {
    const warnings = [];
    const sides = {};
    for (const side of ['da', 'am']) {
        const rows = recipe[side]
            .map((r) => ({ ...r, m: byId(r.id), frac: Math.max(0, num(r.frac) || 0) }))
            .filter((r) => r.m);
        const sum = rows.reduce((s, r) => s + r.frac, 0);
        if (!rows.length || sum <= 0) return { error: `${side === 'da' ? '이무수물' : '디아민'} 조성을 입력하세요.` };
        if (Math.abs(sum - 100) > 0.01) warnings.push(`${side === 'da' ? '이무수물' : '디아민'} mol% 합이 ${fmt(sum, 2)}% → 100%로 정규화했습니다.`);
        rows.forEach((r) => (r.x = r.frac / sum));
        sides[side] = rows;
    }

    const ratio = num(recipe.ratio);
    const w = num(recipe.solid) / 100;
    if (!(ratio > 0)) return { error: '몰비를 입력하세요.' };
    if (!(w > 0 && w < 1)) return { error: '고형분은 0~100 wt% 사이여야 합니다.' };

    const cap = recipe.cap ? byId(recipe.cap) : null;
    const c = cap ? Math.max(0, num(recipe.capAmt) || 0) / 100 : 0;
    if (cap && c === 0) warnings.push('말단봉지제를 선택했지만 양이 0입니다.');

    const MA = sides.da.reduce((s, r) => s + r.x * r.m.mw, 0);
    const MB = sides.am.reduce((s, r) => s + r.x * r.m.mw, 0);
    const perMolB = MB + ratio * MA + c * (cap?.mw || 0);

    let nB;
    let monoMass;
    const basisVal = num(recipe.basisVal);
    if (!(basisVal > 0)) return { error: '계산 기준 값을 입력하세요.' };
    if (recipe.basis === 'mass') {
        monoMass = basisVal * w;
        nB = monoMass / perMolB;
    } else {
        nB = basisVal / 1000;
        monoMass = nB * perMolB;
    }

    const lines = [
        ...sides.am.map((r, i) => ({ key: `am:${i}`, kind: 'AM', m: r.m, x: r.x, mol: nB * r.x })),
        ...sides.da.map((r, i) => ({ key: `da:${i}`, kind: 'DA', m: r.m, x: r.x, mol: nB * ratio * r.x })),
    ];
    if (cap && c > 0) lines.push({ key: 'cap', kind: cap.kind, m: cap, x: null, mol: nB * c });
    lines.forEach((l) => (l.mass = l.mol * l.m.mw));

    let scale = 1;
    if (recipe.actualRef && num(recipe.actualMass) > 0) {
        const ref = lines.find((l) => l.key === recipe.actualRef);
        if (ref) scale = num(recipe.actualMass) / ref.mass;
    }
    lines.forEach((l) => {
        l.mol *= scale;
        l.mass *= scale;
    });
    monoMass *= scale;
    nB *= scale;

    const solutionMass = monoMass / w;
    const solventMass = solutionMass - monoMass;
    const solvent = SOLVENTS[recipe.solvent] || SOLVENTS.NMP;

    // 평균 반복단위 (이무수물 1 + 디아민 1)
    const paaCounts = {};
    let countsOk = true;
    for (const r of [...sides.da, ...sides.am]) {
        if (!r.m.counts) countsOk = false;
        else addCounts(paaCounts, r.m.counts, r.x);
    }
    const piCounts = countsOk ? addCounts({ ...paaCounts }, { H: 4, O: 2 }, -1) : null;
    const M_PAA = MA + MB;
    const M_PI = M_PAA - 2 * WATER;

    // Carothers: 관능기 수 비교로 과잉 측을 정하고, 과잉 측과 같은 종류의 단관능 봉지제만 r에 반영
    const capA = cap?.kind === 'CAP' ? c : 0;
    const capB = cap?.kind === 'CAPA' ? c : 0;
    const FA = 2 * ratio + capA;
    const FB = 2 + capB;
    const r = FA > FB ? 1 / (ratio + capA) : ratio / (1 + capB);
    const p = Math.min(1, Math.max(0, num(recipe.p) || 0));
    const Xn = r >= 1 && p >= 1 ? Infinity : (1 + r) / (1 + r - 2 * r * p);
    const XnMax = r >= 1 ? Infinity : (1 + r) / (1 - r);
    const M0 = M_PAA / 2;

    if (ratio > 1.05 || ratio < 0.95) warnings.push('몰비가 1에서 5% 이상 벗어나 고분자량 PAA를 얻기 어렵습니다.');

    const label = [
        sides.da.map((r) => (sides.da.length > 1 ? `${r.m.id}(${fmt(r.x * 100, 0)})` : r.m.id)).join('·'),
        sides.am.map((r) => (sides.am.length > 1 ? `${r.m.id}(${fmt(r.x * 100, 0)})` : r.m.id)).join('·'),
    ].join(' / ');

    return {
        warnings, sides, lines, ratio, w, cap, c, nB, monoMass, solutionMass, solventMass, solvent, scale,
        MA, MB, M_PAA, M_PI, paaCounts: countsOk ? paaCounts : null, piCounts, r, p, Xn, XnMax, M0, label,
    };
}

function renderRecipe() {
    store.set('pi.recipe', recipe);
    const res = computeRecipe();
    lastResult = res;

    // 실칭량 기준 선택지
    const refSel = $('#r-actual-ref');
    const refOpts = ['<option value="">사용 안 함</option>'];
    if (!res.error) {
        for (const l of res.lines) refOpts.push(`<option value="${l.key}"${l.key === recipe.actualRef ? ' selected' : ''}>${esc(l.m.id)}</option>`);
    }
    refSel.innerHTML = refOpts.join('');
    $('#r-basis-label').textContent = recipe.basis === 'mass' ? '용액 총량 (g)' : '디아민 총 mmol';

    if (res.error) {
        $('#recipe-warn').innerHTML = `<div class="warn">${esc(res.error)}</div>`;
        $('#recipe-kpis').innerHTML = '';
        $('#recipe-table').innerHTML = '';
        renderMw(res);
        renderFilm();
        return;
    }

    const warns = [...res.warnings];
    if (res.scale !== 1) warns.unshift(`실칭량 보정 적용: 전체 배합 × ${fmt(res.scale, 4)}`);
    $('#recipe-warn').innerHTML = warns.map((w) => `<div class="warn">${esc(w)}</div>`).join('');

    $('#recipe-kpis').innerHTML = [
        kpi('모노머 합계', `${fmt(res.monoMass, 3)} g`, `고형분 ${fmt(res.w * 100, 1)} wt%`),
        kpi(`용매 (${res.solvent.name})`, `${fmt(res.solventMass, 2)} g`, `${fmt(res.solventMass / res.solvent.density, 2)} mL`),
        kpi('용액 총량', `${fmt(res.solutionMass, 2)} g`),
        kpi('예상 PAA Mn', Number.isFinite(res.Xn) ? `${fmt((res.Xn * res.M0) / 1000, 1)} kg/mol` : '∞', `r = ${fmt(res.r, 4)}, p = ${res.p}`),
    ].join('');

    const rows = res.lines.map((l) => `
        <tr>
            <td><span class="badge ${l.kind}">${KIND_LABEL[l.kind]}</span></td>
            <td><strong>${esc(l.m.id)}</strong></td>
            <td class="num">${fmt(l.m.mw, 2)}</td>
            <td class="num">${l.x == null ? '–' : fmt(l.x, 3)}</td>
            <td class="num">${fmt(l.mol * 1000, 3)}</td>
            <td class="num"><strong>${fmt(l.mass, 4)}</strong></td>
        </tr>`);
    rows.push(`<tr class="total"><td colspan="4">용매 ${esc(res.solvent.name)}</td><td class="num">${fmt(res.solventMass / res.solvent.density, 2)} mL</td><td class="num">${fmt(res.solventMass, 3)}</td></tr>`);
    rows.push(`<tr class="total"><td colspan="5">합계</td><td class="num">${fmt(res.solutionMass, 3)}</td></tr>`);
    $('#recipe-table').innerHTML = rows.join('');

    renderMw(res);
    renderFilm();
}

let lastResult = null;

function recipeText(res) {
    const lines = [
        `[PAA 배합] ${res.label}  몰비 DA/DAm = ${res.ratio}`,
        `고형분 ${fmt(res.w * 100, 1)} wt%, 용매 ${res.solvent.name}`,
        ...res.lines.map((l) => `- ${l.m.id}: ${fmt(l.mass, 4)} g (${fmt(l.mol * 1000, 3)} mmol)`),
        `- ${res.solvent.name}: ${fmt(res.solventMass, 3)} g (${fmt(res.solventMass / res.solvent.density, 2)} mL)`,
        `합계 ${fmt(res.solutionMass, 3)} g`,
        `반복단위 PAA ${fmt(res.M_PAA, 2)} / PI ${fmt(res.M_PI, 2)} g/mol`,
    ];
    return lines.join('\n');
}

// 이벤트: 조성 행
for (const side of ['da', 'am']) {
    $(`#${side}-rows`).addEventListener('input', (e) => {
        const row = e.target.closest('.comp-row');
        if (!row) return;
        recipe[side][+row.dataset.idx][e.target.dataset.f] = e.target.value;
        renderRecipe();
    });
    $(`#${side}-rows`).addEventListener('click', (e) => {
        if (!e.target.matches('[data-del]')) return;
        const row = e.target.closest('.comp-row');
        recipe[side].splice(+row.dataset.idx, 1);
        recipe.actualRef = '';
        renderCompRows();
        renderRecipe();
    });
}

$$('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const side = btn.dataset.add === 'DA' ? 'da' : 'am';
    const used = new Set(recipe[side].map((r) => r.id));
    const next = MONOMERS.find((m) => m.kind === btn.dataset.add && !used.has(m.id));
    recipe[side].push({ id: next?.id || recipe[side][0].id, frac: 0 });
    renderCompRows();
    renderRecipe();
}));

const fieldMap = {
    'r-ratio': 'ratio', 'r-solid': 'solid', 'r-solvent': 'solvent', 'r-basis': 'basis',
    'r-basis-val': 'basisVal', 'r-p': 'p', 'r-cap': 'cap', 'r-cap-amt': 'capAmt',
    'r-actual-ref': 'actualRef', 'r-actual-mass': 'actualMass',
};
for (const [id, key] of Object.entries(fieldMap)) {
    $(`#${id}`).addEventListener('input', (e) => {
        recipe[key] = e.target.value;
        if (key === 'basis') recipe.basisVal = e.target.value === 'mass' ? 50 : 10;
        if (key === 'basis') $('#r-basis-val').value = recipe.basisVal;
        renderRecipe();
    });
}

$('#btn-copy-recipe').addEventListener('click', () => {
    if (lastResult && !lastResult.error) copyText(recipeText(lastResult), $('#recipe-status'));
});

$('#btn-log-recipe').addEventListener('click', () => {
    if (!lastResult || lastResult.error) return;
    fillNoteFromRecipe();
    showTab('notebook');
    $('#n-id').focus();
});

/* ---------------- 분자량·조성 ---------------- */

const SERIES_COLORS = ['#2d6a4f', '#c8553d', '#3a6ea5', '#b08900', '#7b4fa0'];

function renderMw(res) {
    if (res.error) {
        $('#mw-kpis').innerHTML = `<div class="warn">${esc(res.error)}</div>`;
        $('#elem-table').innerHTML = '';
        $('#carothers-kpis').innerHTML = '';
        $('#carothers-chart').innerHTML = '';
        return;
    }
    const lossPct = (2 * WATER / res.M_PAA) * 100;
    $('#mw-kpis').innerHTML = [
        kpi('조성', esc(res.label)),
        kpi('PAA 반복단위', `${fmt(res.M_PAA, 2)}`, res.paaCounts ? hillFormula(res.paaCounts) : 'g/mol'),
        kpi('PI 반복단위', `${fmt(res.M_PI, 2)}`, res.piCounts ? hillFormula(res.piCounts) : 'g/mol'),
        kpi('이미드화 질량 감소', `${fmt(lossPct, 2)} %`, '2 H₂O / 반복단위'),
        kpi('이미드기 함량', `${fmt((2 * (2 * ATOMIC.C + ATOMIC.N + 2 * ATOMIC.O)) / res.M_PI * 100, 1)} wt%`, '−CO−N−CO− 기준'),
    ].join('');

    if (res.paaCounts) {
        const mPAA = massOf(res.paaCounts);
        const mPI = massOf(res.piCounts);
        $('#elem-table').innerHTML = ELEMENT_ORDER
            .filter((el) => res.paaCounts[el] > 1e-9)
            .map((el) => `<tr><td>${el}</td><td class="num">${fmt((ATOMIC[el] * res.paaCounts[el]) / mPAA * 100, 2)}</td><td class="num">${fmt((ATOMIC[el] * (res.piCounts[el] || 0)) / mPI * 100, 2)}</td></tr>`)
            .join('');
    } else {
        $('#elem-table').innerHTML = '<tr><td colspan="3">분자식이 없는 모노머가 포함되어 원소 조성을 계산할 수 없습니다.</td></tr>';
    }

    const mn = (x) => (Number.isFinite(x) ? `${fmt((x * res.M0) / 1000, 1)} kg/mol` : '∞');
    $('#carothers-kpis').innerHTML = [
        kpi('r (관능기 비)', fmt(res.r, 4)),
        kpi(`X̄n @ p=${res.p}`, Number.isFinite(res.Xn) ? fmt(res.Xn, 0) : '∞'),
        kpi('PAA Mn (예상)', mn(res.Xn), `PI Mn ≈ ${Number.isFinite(res.Xn) ? fmt((res.Xn * res.M_PI / 2) / 1000, 1) + ' kg/mol' : '∞'}`),
        kpi('최대 Mn (p = 1)', mn(res.XnMax), `X̄n,max = ${Number.isFinite(res.XnMax) ? fmt(res.XnMax, 0) : '∞'}`),
    ].join('');

    const rs = [...new Set([1, 0.995, 0.99, 0.98, Math.round(res.r * 10000) / 10000])].sort((a, b) => b - a);
    const series = rs.map((r, i) => {
        const pts = [];
        for (let p = 0.98; p <= 0.99951; p += 0.0005) {
            const xn = (1 + r) / (1 + r - 2 * r * p);
            pts.push([p, (xn * res.M0) / 1000]);
        }
        const isCurrent = Math.abs(r - res.r) < 1e-4;
        return { name: `r = ${r}${isCurrent ? ' (현재)' : ''}`, pts, color: isCurrent ? '#1b1b1b' : SERIES_COLORS[i % SERIES_COLORS.length], dash: isCurrent ? '5 4' : '' };
    });
    $('#carothers-chart').innerHTML = lineChart(series, { xLabel: '전환율 p', yLabel: 'PAA Mn (kg/mol, log)', logY: true, xFmt: (v) => v.toFixed(3) });
}

$('#formula-in').addEventListener('input', renderFormula);
function renderFormula() {
    const out = $('#formula-out');
    try {
        const counts = parseFormula($('#formula-in').value);
        const m = massOf(counts);
        out.innerHTML = kpi('분자량', `${fmt(m, 3)} g/mol`, hillFormula(counts)) + ELEMENT_ORDER
            .filter((el) => counts[el])
            .map((el) => kpi(`${el} wt%`, fmt((ATOMIC[el] * counts[el]) / m * 100, 2)))
            .join('');
    } catch (err) {
        out.innerHTML = `<div class="warn">${esc(err.message)}</div>`;
    }
}

/* ---------------- 차트 (SVG) ---------------- */

function niceTicks(min, max, count = 5) {
    const span = max - min || 1;
    const step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= count) || mag * 10;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return ticks;
}

let chartSeq = 0;

function lineChart(series, opt = {}) {
    const clipId = `clip-${++chartSeq}`;
    const W = 760, H = 320, L = 64, R = 16, T = 16, B = 46;
    const all = series.flatMap((s) => s.pts);
    if (!all.length) return '<p class="empty">표시할 데이터가 없습니다.</p>';
    let [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
    const ys = all.map((p) => p[1]).filter((y) => Number.isFinite(y) && (!opt.logY || y > 0));
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    if (opt.yMin != null) y0 = opt.yMin;
    if (x1 === x0) x1 = x0 + 1;
    const ty = opt.logY ? Math.log10 : (v) => v;
    let ly0 = ty(y0), ly1 = ty(y1);
    if (opt.logY) {
        ly0 = Math.floor(ly0);
        ly1 = Math.ceil(ly1);
    } else {
        const pad = (ly1 - ly0) * 0.08 || 1;
        ly1 += pad;
        if (opt.yMin == null) ly0 -= pad;
    }
    if (ly1 === ly0) ly1 = ly0 + 1;
    const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const sy = (y) => T + (1 - (ty(y) - ly0) / (ly1 - ly0)) * (H - T - B);

    const xt = niceTicks(x0, x1, 6);
    const yt = opt.logY ? Array.from({ length: ly1 - ly0 + 1 }, (_, i) => 10 ** (ly0 + i)) : niceTicks(ly0, ly1, 5);
    const xFmt = opt.xFmt || ((v) => v);
    const yFmt = opt.yFmt || ((v) => (Math.abs(v) >= 1000 ? v.toExponential(0) : +v.toPrecision(3)));

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.yLabel || '')}">`;
    for (const v of yt) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
    for (const v of xt) svg += `<line class="grid" y1="${T}" y2="${H - B}" x1="${sx(v)}" x2="${sx(v)}"/><text class="tick" y="${H - B + 16}" x="${sx(v)}" text-anchor="middle">${xFmt(v)}</text>`;
    svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    svg += `<text class="lbl" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(opt.xLabel || '')}</text>`;
    svg += `<text class="lbl" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(opt.yLabel || '')}</text>`;
    svg += `<clipPath id="${clipId}"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath>`;
    for (const s of series) {
        const d = s.pts.filter((p) => Number.isFinite(p[1]) && (!opt.logY || p[1] > 0))
            .map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
        svg += `<path class="series" clip-path="url(#${clipId})" d="${d}" stroke="${s.color}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    }
    svg += '</svg>';
    const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return svg + legend;
}

function scatterChart(points, opt) {
    const W = 760, H = 340, L = 64, R = 20, T = 16, B = 46;
    if (points.length === 0) return '<p class="empty">두 항목이 모두 입력된 기록이 없습니다.</p>';
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const px = (x1 - x0) * 0.1 || Math.abs(x0) * 0.1 || 1;
    const py = (y1 - y0) * 0.1 || Math.abs(y0) * 0.1 || 1;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const color = { 성공: '#2d6a4f', 보통: '#b08900', 실패: '#c8553d' };
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="물성 상관 플롯">`;
    for (const v of niceTicks(y0, y1, 5)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${+v.toPrecision(4)}</text>`;
    for (const v of niceTicks(x0, x1, 6)) svg += `<line class="grid" y1="${T}" y2="${H - B}" x1="${sx(v)}" x2="${sx(v)}"/><text class="tick" y="${H - B + 16}" x="${sx(v)}" text-anchor="middle">${+v.toPrecision(4)}</text>`;
    svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    svg += `<text class="lbl" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(opt.xLabel)}</text>`;
    svg += `<text class="lbl" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(opt.yLabel)}</text>`;
    for (const p of points) {
        svg += `<g><title>${esc(p.label)}: (${p.x}, ${p.y})</title><circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5.5" fill="${color[p.rating] || '#3a6ea5'}" fill-opacity="0.85"/>`;
        svg += `<text class="pt-label" x="${sx(p.x) + 8}" y="${sy(p.y) - 6}">${esc(p.label)}</text></g>`;
    }
    return `${svg}</svg><div class="legend"><span><i style="background:#2d6a4f"></i>성공</span><span><i style="background:#b08900"></i>보통</span><span><i style="background:#c8553d"></i>실패</span><span><i style="background:#3a6ea5"></i>미평가</span></div>`;
}

/* ---------------- 이미드화·필름 ---------------- */

function renderDoi() {
    const s = num($('#doi-s1').value) / num($('#doi-s2').value);
    const r = num($('#doi-r1').value) / num($('#doi-r2').value);
    const doi = (s / r) * 100;
    $('#doi-out').innerHTML = kpi('이미드화도', Number.isFinite(doi) ? `${fmt(doi, 1)} %` : '–', doi > 100.5 ? '기준 시료보다 높음 — 기준 재확인' : '')
        + kpi('시료 비', fmt(s, 3)) + kpi('기준 비', fmt(r, 3));
}

function renderVis() {
    const t = num($('#vis-t').value), t0 = num($('#vis-t0').value), c = num($('#vis-c').value);
    const etaRel = t / t0;
    const inh = Math.log(etaRel) / c;
    const sp = (etaRel - 1) / c;
    // Solomon–Ciuta 단일점 근사로 고유점도 추정
    const intr = Math.sqrt(2 * (etaRel - 1 - Math.log(etaRel))) / c;
    $('#vis-out').innerHTML = kpi('η_inh', `${fmt(inh, 3)} dL/g`)
        + kpi('η_rel', fmt(etaRel, 3))
        + kpi('η_sp / c', `${fmt(sp, 3)} dL/g`)
        + kpi('[η] (Solomon–Ciuta)', `${fmt(intr, 3)} dL/g`, '단일점 근사');
}

function renderFilm() {
    const res = lastResult;
    const out = $('#film-out');
    if (!res || res.error) {
        out.innerHTML = '<div class="warn">배합 탭의 조성을 먼저 입력하세요.</div>';
        return;
    }
    const wet = num($('#film-wet').value), rsol = num($('#film-rsol').value), rpi = num($('#film-rpi').value), target = num($('#film-target').value);
    const factor = res.w * (rsol / rpi) * (res.M_PI / res.M_PAA);
    out.innerHTML = kpi('예상 PI 두께', `${fmt(wet * factor, 1)} µm`, `습막 대비 ${fmt(factor * 100, 2)} %`)
        + kpi('목표 두께용 습막', `${fmt(target / factor, 0)} µm`, `목표 ${fmt(target, 1)} µm`)
        + kpi('적용 고형분', `${fmt(res.w * 100, 1)} wt%`, esc(res.label));
}

['doi-s1', 'doi-s2', 'doi-r1', 'doi-r2'].forEach((id) => $(`#${id}`).addEventListener('input', renderDoi));
['vis-t', 'vis-t0', 'vis-c'].forEach((id) => $(`#${id}`).addEventListener('input', renderVis));
['film-wet', 'film-rsol', 'film-rpi', 'film-target'].forEach((id) => $(`#${id}`).addEventListener('input', renderFilm));

/* ---------------- 경화 프로파일 ---------------- */

const CURE_PRESETS = {
    standard: [[80, 5, 30], [150, 5, 30], [250, 5, 30], [350, 5, 60], [50, 5, 0]],
    fast: [[100, 10, 30], [200, 10, 30], [300, 10, 60], [50, 10, 0]],
    high: [[100, 5, 30], [200, 5, 30], [300, 5, 30], [400, 3, 30], [50, 5, 0]],
    low: [[80, 3, 30], [150, 3, 30], [200, 3, 30], [250, 3, 60], [50, 3, 0]],
};
const toSteps = (arr) => arr.map(([T, rate, hold]) => ({ T, rate, hold }));

let cure = store.get('pi.cure', { start: 25, atm: 'N₂', steps: toSteps(CURE_PRESETS.standard) });

function cureTimeline() {
    let t = 0;
    let T = num(cure.start) || 25;
    const pts = [[0, T]];
    let maxT = T;
    let above300 = 0;
    const segs = [];
    for (const s of cure.steps) {
        const target = num(s.T), rate = num(s.rate), hold = Math.max(0, num(s.hold) || 0);
        if (!Number.isFinite(target)) continue;
        const ramp = rate > 0 ? Math.abs(target - T) / rate : 0;
        // 램프 구간 중 300 °C 이상 체류시간 (선형 보간)
        if (ramp > 0) {
            const lo = Math.min(T, target), hi = Math.max(T, target);
            if (hi > 300) above300 += ramp * (hi - Math.max(lo, 300)) / (hi - lo);
        }
        t += ramp;
        pts.push([t, target]);
        if (hold > 0) {
            if (target >= 300) above300 += hold;
            t += hold;
            pts.push([t, target]);
        }
        segs.push({ from: T, to: target, ramp, hold });
        T = target;
        maxT = Math.max(maxT, T);
    }
    return { pts, total: t, maxT, above300, segs };
}

function renderCure() {
    store.set('pi.cure', cure);
    $('#cure-start').value = cure.start;
    $('#cure-atm').value = cure.atm;
    $('#cure-rows').innerHTML = cure.steps.map((s, i) => `
        <tr data-idx="${i}">
            <td>${i + 1}</td>
            <td><input type="number" data-f="T" step="any" value="${esc(s.T)}"></td>
            <td><input type="number" data-f="rate" step="any" min="0" value="${esc(s.rate)}"></td>
            <td><input type="number" data-f="hold" step="any" min="0" value="${esc(s.hold)}"></td>
            <td><button class="icon-btn" data-del title="삭제">✕</button></td>
        </tr>`).join('');
    renderCureOutput();
}

function renderCureOutput() {
    store.set('pi.cure', cure);
    const tl = cureTimeline();
    const h = (m) => `${Math.floor(m / 60)}시간 ${Math.round(m % 60)}분`;
    $('#cure-kpis').innerHTML = kpi('총 소요 시간', h(tl.total), `${fmt(tl.total, 0)} min`)
        + kpi('최고 온도', `${fmt(tl.maxT, 0)} °C`, `분위기 ${esc(cure.atm)}`)
        + kpi('300 °C 이상 체류', `${fmt(tl.above300, 0)} min`)
        + kpi('단계 수', String(cure.steps.length));
    $('#cure-chart').innerHTML = lineChart([{ name: '온도', pts: tl.pts.map(([t, T]) => [t / 60, T]), color: '#c8553d' }], {
        xLabel: '시간 (h)', yLabel: '온도 (°C)', yMin: 0, xFmt: (v) => +v.toFixed(2),
    });
}

$('#cure-rows').addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    cure.steps[+tr.dataset.idx][e.target.dataset.f] = e.target.value;
    renderCureOutput();
});
$('#cure-rows').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    cure.steps.splice(+e.target.closest('tr').dataset.idx, 1);
    renderCure();
});
$('#cure-add').addEventListener('click', () => {
    const last = cure.steps.at(-1);
    cure.steps.push({ T: last ? Math.min(+last.T + 50, 450) : 100, rate: last?.rate ?? 5, hold: 30 });
    renderCure();
});
$('#cure-start').addEventListener('input', (e) => { cure.start = e.target.value; renderCureOutput(); });
$('#cure-atm').addEventListener('input', (e) => { cure.atm = e.target.value; renderCureOutput(); });
$('#cure-preset').addEventListener('change', (e) => {
    if (!e.target.value) return;
    cure.steps = toSteps(CURE_PRESETS[e.target.value]);
    e.target.value = '';
    renderCure();
});
$('#cure-copy').addEventListener('click', () => {
    const tl = cureTimeline();
    const lines = [`[경화 프로파일] 분위기 ${cure.atm}, 시작 ${cure.start} °C`];
    tl.segs.forEach((s, i) => lines.push(`${i + 1}. ${fmt(s.from, 0)} → ${fmt(s.to, 0)} °C (${fmt(s.ramp, 0)} min) · 유지 ${fmt(s.hold, 0)} min`));
    lines.push(`총 ${fmt(tl.total, 0)} min, 최고 ${fmt(tl.maxT, 0)} °C`);
    copyText(lines.join('\n'), $('#cure-status'));
});

/* ---------------- 실험 노트 ---------------- */

const NOTE_FIELDS = [
    ['id', 'n-id', '샘플 ID', 'text'], ['date', 'n-date', '날짜', 'text'], ['comp', 'n-comp', '조성', 'text'],
    ['solid', 'n-solid', '고형분(wt%)', 'num'], ['visc', 'n-visc', '점도(cP)', 'num'], ['inh', 'n-inh', 'η_inh(dL/g)', 'num'],
    ['mw', 'n-mw', 'Mw(kg/mol)', 'num'], ['cure', 'n-cure', '최종경화(°C)', 'num'], ['thick', 'n-thick', '두께(µm)', 'num'],
    ['tg', 'n-tg', 'Tg(°C)', 'num'], ['td5', 'n-td5', 'Td5%(°C)', 'num'], ['cte', 'n-cte', 'CTE(ppm/K)', 'num'],
    ['ts', 'n-ts', '인장강도(MPa)', 'num'], ['eb', 'n-eb', '연신율(%)', 'num'], ['dk', 'n-dk', 'Dk/Df', 'text'],
    ['t550', 'n-t550', 'T550(%)', 'num'], ['yi', 'n-yi', 'YI', 'num'], ['rating', 'n-rating', '평가', 'text'],
    ['memo', 'n-memo', '메모', 'text'],
];

let notes = store.get('pi.notes', []);
let editingKey = null;

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function fillNoteFromRecipe() {
    const res = lastResult;
    if (!res || res.error) return;
    $("#n-comp").value = `${res.label} (${Number(res.ratio).toFixed(3)})`;
    $('#n-solid').value = +(res.w * 100).toFixed(2);
    const tl = cureTimeline();
    $('#n-cure').value = tl.maxT;
    if (!$('#n-date').value) $('#n-date').value = today();
    const memo = $('#n-memo');
    if (!memo.value.includes('[PAA 배합]')) memo.value = (memo.value ? memo.value + '\n' : '') + recipeText(res);
}

function resetNoteForm() {
    $('#note-form').reset();
    $('#n-date').value = today();
    editingKey = null;
    $('#n-submit').textContent = '저장';
    $('#n-cancel').hidden = true;
}

$('#n-fill').addEventListener('click', fillNoteFromRecipe);
$('#n-cancel').addEventListener('click', resetNoteForm);

$('#note-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const entry = {};
    for (const [key, id, , type] of NOTE_FIELDS) {
        const v = $(`#${id}`).value.trim();
        entry[key] = type === 'num' ? (v === '' ? null : num(v)) : v;
    }
    if (editingKey) {
        const idx = notes.findIndex((n) => n._key === editingKey);
        if (idx >= 0) notes[idx] = { ...entry, _key: editingKey };
    } else {
        notes.unshift({ ...entry, _key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    }
    store.set('pi.notes', notes);
    flash($('#note-status'), editingKey ? '수정했습니다.' : '저장했습니다.');
    resetNoteForm();
    renderNotes();
});

function renderNotes() {
    const q = $('#note-search').value.trim().toLowerCase();
    const list = notes.filter((n) => !q || [n.id, n.comp, n.memo, n.date].join(' ').toLowerCase().includes(q));
    $('#note-count').textContent = `${list.length} / ${notes.length}건`;
    const v = (x, d = 1) => (x == null || x === '' ? '–' : fmt(x, d));
    const ratingCls = { 성공: 'ok', 보통: 'mid', 실패: 'bad' };
    $('#note-table').innerHTML = list.length ? list.map((n) => `
        <tr data-key="${esc(n._key)}" title="${esc(n.memo)}">
            <td><strong>${esc(n.id)}</strong></td>
            <td>${esc(n.date)}</td>
            <td class="wrap">${esc(n.comp)}</td>
            <td class="num">${v(n.cure, 0)}</td>
            <td class="num">${v(n.tg, 0)}</td>
            <td class="num">${v(n.cte, 1)}</td>
            <td class="num">${v(n.ts, 0)} / ${v(n.eb, 1)}</td>
            <td class="num">${v(n.t550, 1)} / ${v(n.yi, 1)}</td>
            <td>${n.rating ? `<span class="badge ${ratingCls[n.rating] || ''}">${esc(n.rating)}</span>` : ''}</td>
            <td><button class="ghost" data-act="edit">수정</button> <button class="ghost" data-act="dup">복제</button> <button class="icon-btn" data-act="del" title="삭제">✕</button></td>
        </tr>`).join('') : '<tr><td colspan="10" class="empty">기록이 없습니다. 배합 탭에서 “실험 노트에 기록”을 눌러 시작하세요.</td></tr>';
    renderNotePlot();
}

$('#note-search').addEventListener('input', renderNotes);

$('#note-table').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const key = e.target.closest('tr').dataset.key;
    const n = notes.find((x) => x._key === key);
    if (!n) return;
    if (act === 'del') {
        if (!confirm(`${n.id} 기록을 삭제할까요?`)) return;
        notes = notes.filter((x) => x._key !== key);
        store.set('pi.notes', notes);
        renderNotes();
        return;
    }
    for (const [k, id] of NOTE_FIELDS) $(`#${id}`).value = n[k] ?? '';
    if (act === 'edit') {
        editingKey = key;
        $('#n-submit').textContent = '수정 저장';
        $('#n-cancel').hidden = false;
    } else {
        resetNoteFormKeepValues();
        $('#n-id').value = `${n.id}-b`;
        $('#n-date').value = today();
    }
    $('#note-form').scrollIntoView({ behavior: 'smooth' });
});

function resetNoteFormKeepValues() {
    editingKey = null;
    $('#n-submit').textContent = '저장';
    $('#n-cancel').hidden = true;
}

const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

$('#note-csv').addEventListener('click', () => {
    const header = NOTE_FIELDS.map((f) => f[2]).join(',');
    const rows = notes.map((n) => NOTE_FIELDS.map(([k]) => csvCell(n[k])).join(','));
    download(`pi-notes-${today()}.csv`, '﻿' + [header, ...rows].join('\n'), 'text/csv;charset=utf-8');
});

$('#note-json').addEventListener('click', () => {
    const backup = { version: 1, exported: new Date().toISOString(), notes, customMonomers, recipe, cure };
    download(`pi-workbench-backup-${today()}.json`, JSON.stringify(backup, null, 2), 'application/json');
});

$('#note-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.notes)) throw new Error('형식 오류');
        const keys = new Set(notes.map((n) => n._key));
        const incoming = data.notes.filter((n) => n && typeof n === 'object' && !keys.has(n._key));
        notes = [...incoming, ...notes];
        if (Array.isArray(data.customMonomers)) {
            const ids = new Set(MONOMERS.map((m) => m.id));
            customMonomers = [...customMonomers, ...data.customMonomers.filter((m) => m?.id && !ids.has(m.id))];
            store.set('pi.customMonomers', customMonomers);
            MONOMERS = allMonomers();
            renderDb();
            renderCompRows();
        }
        store.set('pi.notes', notes);
        renderNotes();
        flash($('#note-status'), `${incoming.length}건을 복원했습니다.`);
    } catch {
        flash($('#note-status'), '복원 실패: 올바른 백업 파일이 아닙니다.');
    }
    e.target.value = '';
});

const PLOT_FIELDS = NOTE_FIELDS.filter((f) => f[3] === 'num');
$('#plot-x').innerHTML = PLOT_FIELDS.map(([k, , l]) => `<option value="${k}"${k === 'cure' ? ' selected' : ''}>${l}</option>`).join('');
$('#plot-y').innerHTML = PLOT_FIELDS.map(([k, , l]) => `<option value="${k}"${k === 'cte' ? ' selected' : ''}>${l}</option>`).join('');
$('#plot-x').addEventListener('input', renderNotePlot);
$('#plot-y').addEventListener('input', renderNotePlot);

function renderNotePlot() {
    const xk = $('#plot-x').value, yk = $('#plot-y').value;
    const label = (k) => PLOT_FIELDS.find((f) => f[0] === k)[2];
    const pts = notes
        .filter((n) => Number.isFinite(n[xk]) && Number.isFinite(n[yk]))
        .map((n) => ({ x: n[xk], y: n[yk], label: n.id, rating: n.rating }));
    $('#note-chart').innerHTML = scatterChart(pts, { xLabel: label(xk), yLabel: label(yk) });
}

/* ---------------- 모노머 DB ---------------- */

function renderDb() {
    const type = $('#db-type').value;
    const q = $('#db-search').value.trim().toLowerCase();
    const list = MONOMERS.filter((m) => (!type || m.kind === type || (type === 'CAP' && m.kind === 'CAPA'))
        && (!q || [m.id, m.name, m.formula, ...(m.tags || [])].join(' ').toLowerCase().includes(q)));
    $('#db-table').innerHTML = list.map((m) => `
        <tr data-id="${esc(m.id)}">
            <td><strong>${esc(m.id)}</strong></td>
            <td><span class="badge ${m.kind}">${KIND_LABEL[m.kind]}</span></td>
            <td class="wrap">${esc(m.name)}</td>
            <td>${esc(m.formula || '–')}</td>
            <td class="num">${fmt(m.mw, 2)}</td>
            <td class="wrap">${(m.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
            <td><button class="ghost" data-act="use">배합에 추가</button>${m.builtin ? '' : ' <button class="icon-btn" data-act="del" title="삭제">✕</button>'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">검색 결과가 없습니다.</td></tr>';
}

$('#db-type').addEventListener('input', renderDb);
$('#db-search').addEventListener('input', renderDb);

$('#db-table').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const id = e.target.closest('tr').dataset.id;
    const m = byId(id);
    if (!m) return;
    if (act === 'del') {
        if (!confirm(`${id}을(를) 삭제할까요?`)) return;
        customMonomers = customMonomers.filter((x) => x.id !== id);
        store.set('pi.customMonomers', customMonomers);
        MONOMERS = allMonomers();
        for (const side of ['da', 'am']) {
            recipe[side] = recipe[side].filter((r) => r.id !== id);
            if (!recipe[side].length) recipe[side] = [...DEFAULT_RECIPE[side]];
        }
        if (recipe.cap === id) recipe.cap = '';
        renderDb();
        renderCompRows();
        renderRecipe();
        return;
    }
    if (m.kind === 'CAP' || m.kind === 'CAPA') {
        recipe.cap = id;
        if (!(num(recipe.capAmt) > 0)) recipe.capAmt = 2;
        $('#r-cap-amt').value = recipe.capAmt;
    } else {
        const side = m.kind === 'DA' ? 'da' : 'am';
        if (!recipe[side].some((r) => r.id === id)) recipe[side].push({ id, frac: 0 });
    }
    renderCompRows();
    renderRecipe();
    showTab('recipe');
});

$('#db-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#db-abbr').value.trim();
    const formula = $('#db-formula').value.trim();
    const mw = num($('#db-mw').value);
    const status = $('#db-status');
    if (byId(id)) return flash(status, '이미 존재하는 약어입니다.');
    if (formula) {
        try {
            parseFormula(formula);
        } catch (err) {
            return flash(status, `분자식 오류: ${err.message}`);
        }
    } else if (!(mw > 0)) {
        return flash(status, '분자식 또는 MW 중 하나는 입력하세요.');
    }
    customMonomers.push({
        id,
        kind: $('#db-kind').value,
        name: $('#db-name').value.trim() || id,
        formula,
        mw: formula ? undefined : mw,
        tags: ['사용자', ...$('#db-tags').value.split(',').map((t) => t.trim()).filter(Boolean)],
    });
    store.set('pi.customMonomers', customMonomers);
    MONOMERS = allMonomers();
    e.target.reset();
    flash(status, `${id}을(를) 추가했습니다.`);
    renderDb();
    renderCompRows();
    renderRecipe();
});

/* ---------------- 초기화 ---------------- */

// 저장된 배합이 삭제된 모노머를 참조하면 기본값으로 복구
for (const side of ['da', 'am']) {
    recipe[side] = (recipe[side] || []).filter((r) => byId(r.id));
    if (!recipe[side].length) recipe[side] = [...DEFAULT_RECIPE[side]];
}
if (recipe.cap && !byId(recipe.cap)) recipe.cap = '';

renderStaticInputs();
renderCompRows();
renderRecipe();
renderFormula();
renderDoi();
renderVis();
renderCure();
resetNoteForm();
renderNotes();
renderDb();
showTab(location.hash.slice(1) || store.get('pi.tab', 'recipe'));
