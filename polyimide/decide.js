// 의사결정 탭: 다기준 후보 평가(만족도 지수·가중합·TOPSIS + 가중치 민감도), DOE, 결정 기록

import { $, $$, store, esc, num, fmt, kpi, flash, copyText, download, niceTicks, today } from './common.js';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ================= 1. 후보 평가 ================= */

const NOTE_FIELDS = [
    ['', '직접 입력'], ['tg', 'Tg (°C)'], ['td5', 'Td5% (°C)'], ['cte', 'CTE (ppm/K)'], ['ts', '인장강도 (MPa)'],
    ['eb', '연신율 (%)'], ['t550', 'T@550nm (%)'], ['yi', 'YI'], ['dk', 'Dk'], ['df', 'Df'],
    ['cure', '최종 경화 (°C)'], ['thick', '두께 (µm)'], ['visc', '점도 (cP)'], ['inh', 'η_inh (dL/g)'],
    ['mw', 'Mw (kg/mol)'], ['solid', '고형분 (wt%)'],
];

// [이름, 노트 항목, 방향, a, b, 가중치] — max/min: a=합격선, b=목표 / target: a=목표값, b=허용폭
const PRESETS = {
    cpi: [
        ['투과율 T550 (%)', 't550', 'max', 85, 90, 8],
        ['YI', 'yi', 'min', 5, 2, 8],
        ['Tg (°C)', 'tg', 'max', 300, 350, 5],
        ['CTE (ppm/K)', 'cte', 'min', 50, 20, 4],
        ['인장강도 (MPa)', 'ts', 'max', 100, 150, 3],
    ],
    fccl: [
        ['CTE (ppm/K)', 'cte', 'target', 17, 8, 8],
        ['Tg (°C)', 'tg', 'max', 300, 360, 5],
        ['인장강도 (MPa)', 'ts', 'max', 150, 250, 4],
        ['연신율 (%)', 'eb', 'max', 10, 40, 3],
        ['Dk', 'dk', 'min', 3.5, 3.0, 3],
    ],
    lowdk: [
        ['Dk', 'dk', 'min', 3.0, 2.6, 8],
        ['Df', 'df', 'min', 0.005, 0.002, 8],
        ['Tg (°C)', 'tg', 'max', 250, 300, 4],
        ['CTE (ppm/K)', 'cte', 'min', 40, 20, 3],
    ],
    pkg: [
        ['최종 경화 (°C)', 'cure', 'min', 350, 230, 8],
        ['Tg (°C)', 'tg', 'max', 230, 280, 5],
        ['연신율 (%)', 'eb', 'max', 20, 50, 6],
        ['인장강도 (MPa)', 'ts', 'max', 120, 170, 3],
        ['CTE (ppm/K)', 'cte', 'min', 60, 30, 4],
    ],
};
const fromPreset = (key) => PRESETS[key].map(([name, field, dir, a, b, w]) => ({ id: uid(), name, field, dir, a, b, w }));

const DEMO = [
    ['6FDA/TFMB (예시)', { t550: 89, yi: 2.1, tg: 335, cte: 48, ts: 110 }],
    ['BPDA/TFMB (예시)', { t550: 82, yi: 6.5, tg: 360, cte: 22, ts: 160 }],
    ['6FDA·BPDA 5:5/TFMB (예시)', { t550: 87, yi: 3.4, tg: 345, cte: 35, ts: 130 }],
    ['CBDA/TFMB (예시)', { t550: 88, yi: 2.8, tg: 330, cte: 30, ts: 125 }],
    ['6FDA/TFMB·DABA 7:3 (예시)', { t550: 86, yi: 4.0, tg: 350, cte: 38, ts: 140 }],
];

let dc = loadDecide();

function loadDecide() {
    const saved = store.get('pi.decide', null);
    return {
        criteria: fromPreset('cpi'), candidates: [], method: 'D', spread: 30, px: '', py: '',
        ...(saved || {}),
    };
}
const saveDecide = () => store.set('pi.decide', dc);

function noteValue(note, field) {
    if (!note || !field) return '';
    if (field === 'dk' || field === 'df') {
        const parts = String(note.dk || '').split('/').map((s) => num(s));
        const v = field === 'dk' ? parts[0] : parts[1];
        return Number.isFinite(v) ? v : '';
    }
    return Number.isFinite(note[field]) ? note[field] : '';
}

function syncFromNotes(onlyCritId = null) {
    const notes = store.get('pi.notes', []);
    for (const cand of dc.candidates) {
        if (!cand.noteKey) continue;
        const note = notes.find((n) => n._key === cand.noteKey);
        if (!note) continue;
        for (const c of dc.criteria) {
            if (!c.field || (onlyCritId && c.id !== onlyCritId)) continue;
            cand.vals[c.id] = noteValue(note, c.field);
        }
    }
}

// 기준별 효용: 클수록 좋은 값으로 변환
function utility(c, y) {
    if (c.dir === 'min') return -y;
    if (c.dir === 'target') return Number.isFinite(num(c.a)) ? -Math.abs(y - num(c.a)) : y;
    return y;
}

// 스펙 기반 만족도(Derringer). 스펙 미설정이면 null
function specDesirability(c, y) {
    const a = num(c.a), b = num(c.b);
    if (c.dir === 'target') {
        if (!Number.isFinite(a) || !(b > 0)) return null;
        return { d: clamp01(1 - Math.abs(y - a) / b), pass: Math.abs(y - a) <= b };
    }
    if (!Number.isFinite(a)) return null;
    const pass = c.dir === 'max' ? y >= a : y <= a;
    if (Number.isFinite(b) && b !== a) return { d: clamp01((y - a) / (b - a)), pass };
    return { d: pass ? 1 : 0, pass };
}

function specText(c) {
    const a = num(c.a), b = num(c.b);
    if (c.dir === 'target') return Number.isFinite(a) ? `${a} ± ${Number.isFinite(b) ? b : '?'}` : '';
    if (!Number.isFinite(a)) return '';
    return `${c.dir === 'max' ? '≥' : '≤'} ${a}`;
}

// 평가 행렬을 한 번 만들고, 가중치만 바꿔 여러 번 점수를 낼 수 있게 한다
function buildMatrix() {
    const C = dc.criteria;
    const cands = dc.candidates;
    const Y = cands.map((cd) => C.map((c) => num(cd.vals[c.id])));
    const U = Y.map((row) => row.map((y, j) => (Number.isFinite(y) ? utility(C[j], y) : NaN)));
    const norm = Y.map(() => C.map(() => NaN));
    C.forEach((c, j) => {
        const col = U.map((r) => r[j]).filter(Number.isFinite);
        const lo = Math.min(...col), hi = Math.max(...col);
        U.forEach((r, i) => {
            if (Number.isFinite(r[j])) norm[i][j] = hi > lo ? (r[j] - lo) / (hi - lo) : 1;
        });
    });
    const spec = Y.map((row) => row.map((y, j) => (Number.isFinite(y) ? specDesirability(C[j], y) : null)));
    const dEff = Y.map((row, i) => row.map((y, j) => (Number.isFinite(y) ? (spec[i][j] ? spec[i][j].d : norm[i][j]) : NaN)));

    // TOPSIS 원값: 이익형(max)은 그대로, 비용형(min)·목표형(편차)은 작을수록 좋음. 결측은 열의 최악값으로 대체
    const benefit = C.map((c) => c.dir === 'max');
    const X = Y.map((row) => row.map((y, j) => (Number.isFinite(y) && C[j].dir === 'target' && Number.isFinite(num(C[j].a)) ? Math.abs(y - num(C[j].a)) : y)));
    C.forEach((c, j) => {
        const col = X.map((r) => r[j]).filter(Number.isFinite);
        const worst = col.length ? (benefit[j] ? Math.min(...col) : Math.max(...col)) : 0;
        X.forEach((r) => {
            if (!Number.isFinite(r[j])) r[j] = worst;
        });
    });
    const colNorm = C.map((_, j) => Math.sqrt(X.reduce((s, r) => s + r[j] ** 2, 0)) || 1);
    const R = X.map((r) => r.map((x, j) => x / colNorm[j]));

    return { C, cands, Y, norm, spec, dEff, R, benefit };
}

function scoreAll(M, weights) {
    const n = M.cands.length;
    const wsum = (i, src) => {
        let s = 0, ws = 0;
        weights.forEach((w, j) => {
            if (w > 0 && Number.isFinite(src[i][j])) {
                s += w * src[i][j];
                ws += w;
            }
        });
        return ws > 0 ? s / ws : NaN;
    };
    const D = [], WSM = [], TOPSIS = [];
    const wTot = weights.reduce((s, w) => s + Math.max(0, w), 0) || 1;
    const V = M.R.map((r) => r.map((x, j) => (Math.max(0, weights[j]) / wTot) * x));
    const best = M.C.map((_, j) => (M.benefit[j] ? Math.max(...V.map((r) => r[j])) : Math.min(...V.map((r) => r[j]))));
    const worst = M.C.map((_, j) => (M.benefit[j] ? Math.min(...V.map((r) => r[j])) : Math.max(...V.map((r) => r[j]))));
    for (let i = 0; i < n; i++) {
        // 만족도 지수: 가중 기하평균, 하나라도 0이면 0
        let lsum = 0, ws = 0, zero = false;
        weights.forEach((w, j) => {
            const d = M.dEff[i][j];
            if (!(w > 0) || !Number.isFinite(d)) return;
            if (d <= 0) zero = true;
            else lsum += w * Math.log(d);
            ws += w;
        });
        D.push(ws > 0 ? (zero ? 0 : Math.exp(lsum / ws)) : NaN);
        WSM.push(wsum(i, M.norm));
        const sp = Math.sqrt(V[i].reduce((s, v, j) => s + (v - best[j]) ** 2, 0));
        const sm = Math.sqrt(V[i].reduce((s, v, j) => s + (v - worst[j]) ** 2, 0));
        TOPSIS.push(sp + sm > 0 ? sm / (sp + sm) : 1);
    }
    return { D, WSM, TOPSIS };
}

const rankOrder = (scores) => scores.map((s, i) => [Number.isFinite(s) ? s : -1, i]).sort((x, y) => y[0] - x[0]).map((p) => p[1]);

function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sensitivity(M, weights, method, spread, runs = 1000) {
    const n = M.cands.length;
    const first = new Array(n).fill(0), rankSum = new Array(n).fill(0);
    const rnd = mulberry32(20261013);
    for (let k = 0; k < runs; k++) {
        const w = weights.map((x) => Math.max(0, x * (1 + spread * (2 * rnd() - 1))));
        const order = rankOrder(scoreAll(M, w)[method]);
        first[order[0]] += 1;
        order.forEach((i, r) => (rankSum[i] += r + 1));
    }
    return { p1: first.map((c) => c / runs), meanRank: rankSum.map((s) => s / runs) };
}

function evaluate() {
    const M = buildMatrix();
    const weights = M.C.map((c) => Math.max(0, num(c.w) || 0));
    const scores = scoreAll(M, weights);
    const order = rankOrder(scores[dc.method]);
    const sens = M.cands.length > 1 ? sensitivity(M, weights, dc.method, Math.max(0, num(dc.spread) || 0) / 100) : null;
    const rows = order.map((i, r) => {
        const used = M.C.map((c, j) => j).filter((j) => weights[j] > 0);
        const specJ = used.filter((j) => M.spec[i][j]);
        return {
            i, rank: r + 1, cand: M.cands[i],
            score: scores[dc.method][i], D: scores.D[i], WSM: scores.WSM[i], TOPSIS: scores.TOPSIS[i],
            passN: specJ.filter((j) => M.spec[i][j].pass).length, specN: specJ.length,
            failing: specJ.filter((j) => !M.spec[i][j].pass),
            missing: used.filter((j) => !Number.isFinite(M.Y[i][j])),
            p1: sens?.p1[i] ?? 1, meanRank: sens?.meanRank[i] ?? 1,
        };
    });
    return { M, weights, rows };
}

/* ---- 렌더링 ---- */

function renderCriteria() {
    $('#dc-criteria').innerHTML = dc.criteria.map((c) => {
        const isT = c.dir === 'target';
        return `<tr data-id="${c.id}">
            <td><input type="text" class="w-l" data-f="name" value="${esc(c.name)}"></td>
            <td><select data-f="field">${NOTE_FIELDS.map(([k, l]) => `<option value="${k}"${k === (c.field || '') ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><select data-f="dir">
                <option value="max"${c.dir === 'max' ? ' selected' : ''}>클수록 ↑</option>
                <option value="min"${c.dir === 'min' ? ' selected' : ''}>작을수록 ↓</option>
                <option value="target"${isT ? ' selected' : ''}>목표값 ◎</option></select></td>
            <td><input type="number" step="any" class="w-s" data-f="a" value="${esc(c.a)}" placeholder="${isT ? '목표값' : '합격선'}" title="${isT ? '목표값' : '합격선'}"></td>
            <td><input type="number" step="any" class="w-s" data-f="b" value="${esc(c.b)}" placeholder="${isT ? '허용폭' : '목표'}" title="${isT ? '허용폭(±)' : '목표'}"></td>
            <td><input type="number" step="1" min="0" max="10" class="w-s" data-f="w" value="${esc(c.w)}"></td>
            <td><button class="icon-btn" data-del title="삭제">✕</button></td>
        </tr>`;
    }).join('');
}

function renderCandidates() {
    const C = dc.criteria;
    $('#dc-count').textContent = `${dc.candidates.length}개`;
    $('#dc-cand-head').innerHTML = `<tr><th>후보</th>${C.map((c) => `<th>${esc(c.name)}<br><small>${esc(specText(c))}</small></th>`).join('')}<th></th></tr>`;
    $('#dc-cand-body').innerHTML = dc.candidates.length ? dc.candidates.map((cd) => `
        <tr data-id="${cd.id}">
            <td><input type="text" class="w-l" data-f="name" value="${esc(cd.name)}" style="width:210px" title="${esc(cd.name)}">${cd.noteKey ? ' <span class="tag" title="실험 노트 연동">노트</span>' : ''}</td>
            ${C.map((c) => `<td><input type="number" step="any" class="w-s" data-c="${c.id}" value="${esc(cd.vals[c.id] ?? '')}"></td>`).join('')}
            <td><button class="icon-btn" data-del title="삭제">✕</button></td>
        </tr>`).join('') : `<tr><td colspan="${C.length + 2}" class="empty">후보가 없습니다. 실험 노트에서 가져오거나 직접 추가하세요. (“예시 데이터”로 먼저 둘러봐도 좋아요)</td></tr>`;
    renderParetoSelects();
}

const dColor = (d) => (Number.isFinite(d) ? `hsl(${Math.round(d * 120)} 62% 90%)` : 'transparent');
const pct = (v) => `${fmt(v * 100, 0)}%`;
const METHOD_LABEL = { D: '만족도 D', WSM: '가중합', TOPSIS: 'TOPSIS' };

let lastEval = null;

function renderResults() {
    saveDecide();
    const ev = evaluate();
    lastEval = ev;
    const { M, rows } = ev;
    const C = M.C;

    $('#dc-res-head').innerHTML = `<tr><th>순위</th><th>후보</th><th>${METHOD_LABEL[dc.method]}</th><th>D</th><th>가중합</th><th>TOPSIS</th><th>스펙 통과</th><th>1위 확률</th><th>평균 순위</th>${C.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>`;
    if (!rows.length) {
        $('#dc-res-body').innerHTML = `<tr><td colspan="${C.length + 9}" class="empty">후보를 추가하면 결과가 표시됩니다.</td></tr>`;
        $('#dc-kpis').innerHTML = '';
        $('#dc-summary').innerHTML = '';
        renderPareto();
        return;
    }
    $('#dc-res-body').innerHTML = rows.map((r) => `
        <tr class="${r.rank === 1 ? 'top' : ''}">
            <td><span class="rank">${r.rank}</span></td>
            <td><strong>${esc(r.cand.name)}</strong>${r.missing.length ? ` <span class="badge mid" title="결측: ${esc(r.missing.map((j) => C[j].name).join(', '))}">결측 ${r.missing.length}</span>` : ''}</td>
            <td><span class="meter"><i style="width:${clamp01(r.score) * 100}%"></i></span>${fmt(r.score, 3)}</td>
            <td class="num">${fmt(r.D, 3)}</td>
            <td class="num">${fmt(r.WSM, 3)}</td>
            <td class="num">${fmt(r.TOPSIS, 3)}</td>
            <td>${r.specN ? `<span class="badge ${r.passN === r.specN ? 'ok' : 'bad'}">${r.passN}/${r.specN}</span>` : '–'}</td>
            <td class="num">${pct(r.p1)}</td>
            <td class="num">${fmt(r.meanRank, 1)}</td>
            ${C.map((c, j) => {
                const y = M.Y[r.i][j], d = M.dEff[r.i][j], sp = M.spec[r.i][j];
                return `<td class="d-cell" style="background:${dColor(d)}" title="만족도 ${fmt(d, 2)}">${Number.isFinite(y) ? +y.toPrecision(6) : '–'}${sp && !sp.pass ? '<small>스펙 미달</small>' : ''}</td>`;
            }).join('')}
        </tr>`).join('');

    const top = rows[0];
    const allPass = rows.filter((r) => r.specN && r.passN === r.specN).length;
    const missingTotal = rows.reduce((s, r) => s + r.missing.length, 0);
    $('#dc-kpis').innerHTML = [
        kpi('추천 후보', esc(top.cand.name), `${METHOD_LABEL[dc.method]} ${fmt(top.score, 3)}`),
        kpi('전 항목 스펙 통과', `${allPass} / ${rows.length}`),
        kpi('추천 견고성 (1위 확률)', pct(top.p1), `가중치 ±${num(dc.spread) || 0}% 변동 시`),
        kpi('결측 데이터', `${missingTotal}칸`, missingTotal ? '측정 보완 필요' : '완전'),
    ].join('');
    $('#dc-summary').innerHTML = `<div class="summary">${summaryLines(ev).map((l) => `<div>${l}</div>`).join('')}</div>`;
    renderPareto();
}

// 결과를 사람이 읽는 판단 문장으로 정리
function summaryLines(ev) {
    const { M, rows, weights } = ev;
    const C = M.C;
    const top = rows[0];
    const out = [];
    out.push(`<strong>추천: ${esc(top.cand.name)}</strong> (${METHOD_LABEL[dc.method]} ${fmt(top.score, 3)})`);
    if (rows[1]) {
        const gap = top.score - rows[1].score;
        out.push(gap < 0.05
            ? `· 2위 <strong>${esc(rows[1].cand.name)}</strong>와 점수 차가 ${fmt(gap, 3)}로 근소합니다 → 반복 측정이나 추가 물성으로 구분하세요.`
            : `· 2위 ${esc(rows[1].cand.name)}와 ${fmt(gap, 3)} 차이로 앞섭니다.`);
        out.push(top.p1 >= 0.8
            ? `· 가중치를 흔들어도 ${pct(top.p1)} 확률로 1위 유지 → <strong>가중치에 둔감한 견고한 결정</strong>입니다.`
            : top.p1 >= 0.5
                ? `· 1위 유지 확률 ${pct(top.p1)} → 대체로 유지되지만, 가중치 설정을 한 번 더 검토하세요.`
                : `· 1위 유지 확률 ${pct(top.p1)} → <strong>가중치에 따라 결론이 바뀝니다.</strong> 기준 우선순위부터 팀과 합의하세요.`);
    }
    const passAll = rows.filter((r) => r.specN && r.passN === r.specN);
    if (top.failing.length) {
        out.push(`· 추천 후보의 스펙 미달: ${top.failing.map((j) => `${esc(C[j].name)} ${+M.Y[top.i][j].toPrecision(4)} (기준 ${esc(specText(C[j]))})`).join(', ')}`);
        if (!passAll.length) out.push('· <strong>모든 스펙을 통과한 후보가 없습니다.</strong> 위 항목을 다음 실험의 개선 목표로 삼으세요.');
    }
    const used = C.map((_, j) => j).filter((j) => weights[j] > 0 && Number.isFinite(M.dEff[top.i][j]));
    if (used.length) {
        const weakest = used.reduce((a, b) => (M.dEff[top.i][a] <= M.dEff[top.i][b] ? a : b));
        if (M.dEff[top.i][weakest] < 0.7) out.push(`· 약점: <strong>${esc(C[weakest].name)}</strong> (만족도 ${fmt(M.dEff[top.i][weakest], 2)}) → 다음 배합 최적화 대상`);
    }
    const missing = rows.filter((r) => r.missing.length && r.rank <= 3);
    if (missing.length) out.push(`· 측정 우선순위: ${missing.map((r) => `${esc(r.cand.name)}의 ${r.missing.map((j) => esc(C[j].name)).join('·')}`).join(', ')}`);
    return out;
}

function summaryPlain(ev) {
    return summaryLines(ev).map((l) => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")).join('\n');
}

function rankingPlain(ev) {
    return ev.rows.map((r) => `${r.rank}. ${r.cand.name} — ${METHOD_LABEL[dc.method]} ${fmt(r.score, 3)}, 스펙 ${r.specN ? `${r.passN}/${r.specN}` : '-'}, 1위 확률 ${pct(r.p1)}`).join('\n');
}

/* ---- 파레토 ---- */

function renderParetoSelects() {
    const C = dc.criteria;
    if (!C.find((c) => c.id === dc.px)) dc.px = C[0]?.id || '';
    if (!C.find((c) => c.id === dc.py)) dc.py = C[1]?.id || C[0]?.id || '';
    const opts = (sel) => C.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    $('#dc-px').innerHTML = opts(dc.px);
    $('#dc-py').innerHTML = opts(dc.py);
}

function renderPareto() {
    const box = $('#dc-pareto');
    const cx = dc.criteria.find((c) => c.id === dc.px), cy = dc.criteria.find((c) => c.id === dc.py);
    if (!cx || !cy || cx === cy) {
        box.innerHTML = '<p class="empty">서로 다른 두 기준을 선택하세요.</p>';
        return;
    }
    const pts = dc.candidates
        .map((cd) => ({ name: cd.name, x: num(cd.vals[cx.id]), y: num(cd.vals[cy.id]) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ ...p, ux: utility(cx, p.x), uy: utility(cy, p.y) }));
    if (pts.length < 2) {
        box.innerHTML = '<p class="empty">두 기준 값이 모두 있는 후보가 2개 이상 필요합니다.</p>';
        return;
    }
    pts.forEach((p) => {
        p.front = !pts.some((q) => q !== p && q.ux >= p.ux && q.uy >= p.uy && (q.ux > p.ux || q.uy > p.uy));
    });

    const W = 760, H = 360, L = 64, R = 24, T = 20, B = 50;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const px = (x1 - x0) * 0.12 || Math.abs(x0) * 0.1 || 1, py = (y1 - y0) * 0.12 || Math.abs(y0) * 0.1 || 1;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const dirTxt = (c) => (c.dir === 'max' ? ' (↑ 좋음)' : c.dir === 'min' ? ' (↓ 좋음)' : ` (목표 ${c.a})`);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="파레토 프런트">`;
    for (const v of niceTicks(y0, y1, 5)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${+v.toPrecision(4)}</text>`;
    for (const v of niceTicks(x0, x1, 6)) svg += `<line class="grid" y1="${T}" y2="${H - B}" x1="${sx(v)}" x2="${sx(v)}"/><text class="tick" y="${H - B + 16}" x="${sx(v)}" text-anchor="middle">${+v.toPrecision(4)}</text>`;
    svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    svg += `<text class="lbl" x="${(L + W - R) / 2}" y="${H - 10}" text-anchor="middle">${esc(cx.name + dirTxt(cx))}</text>`;
    svg += `<text class="lbl" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(cy.name + dirTxt(cy))}</text>`;
    const front = pts.filter((p) => p.front).sort((a, b) => a.x - b.x);
    if (front.length > 1) svg += `<path d="${front.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')}" fill="none" stroke="#2d6a4f" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    for (const p of pts) {
        svg += `<g><title>${esc(p.name)}: ${p.x}, ${p.y}${p.front ? ' (파레토)' : ''}</title>
            <circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${p.front ? 7 : 5}" fill="${p.front ? '#2d6a4f' : '#b9b2a6'}"/>
            <text class="pt-label" x="${sx(p.x) > W - 200 ? sx(p.x) - 9 : sx(p.x) + 9}" y="${sy(p.y) - 7}" text-anchor="${sx(p.x) > W - 200 ? 'end' : 'start'}"${p.front ? ' font-weight="600"' : ' fill-opacity="0.6"'}>${esc(p.name)}</text></g>`;
    }
    svg += '</svg>';
    box.innerHTML = `${svg}<div class="legend"><span><i style="background:#2d6a4f"></i>파레토 최적 (${front.length})</span><span><i style="background:#b9b2a6"></i>열위 후보 (${pts.length - front.length})</span></div>`;
}

/* ---- 이벤트 ---- */

$('#dc-criteria').addEventListener('input', (e) => {
    const c = dc.criteria.find((x) => x.id === e.target.closest('tr').dataset.id);
    const f = e.target.dataset.f;
    if (!c || !f) return;
    c[f] = e.target.value;
    if (f === 'field') syncFromNotes(c.id);
    if (f === 'dir') renderCriteria();
    renderCandidates();
    renderResults();
});
$('#dc-criteria').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    const id = e.target.closest('tr').dataset.id;
    dc.criteria = dc.criteria.filter((c) => c.id !== id);
    renderCriteria();
    renderCandidates();
    renderResults();
});
$('#dc-add-crit').addEventListener('click', () => {
    dc.criteria.push({ id: uid(), name: '새 기준', field: '', dir: 'max', a: '', b: '', w: 5 });
    renderCriteria();
    renderCandidates();
    renderResults();
});
$('#dc-preset').addEventListener('change', (e) => {
    const key = e.target.value;
    e.target.value = '';
    if (!key) return;
    if (dc.criteria.length && !confirm('현재 평가 기준을 프리셋으로 바꿀까요? (후보는 유지)')) return;
    dc.criteria = fromPreset(key);
    syncFromNotes();
    renderCriteria();
    renderCandidates();
    renderResults();
});

$('#dc-cand-body').addEventListener('input', (e) => {
    const cd = dc.candidates.find((x) => x.id === e.target.closest('tr').dataset.id);
    if (!cd) return;
    if (e.target.dataset.f === 'name') cd.name = e.target.value;
    else if (e.target.dataset.c) cd.vals[e.target.dataset.c] = e.target.value;
    renderResults();
});
$('#dc-cand-body').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    const id = e.target.closest('tr').dataset.id;
    dc.candidates = dc.candidates.filter((c) => c.id !== id);
    renderCandidates();
    renderResults();
});
$('#dc-add-cand').addEventListener('click', () => {
    dc.candidates.push({ id: uid(), name: `후보 ${dc.candidates.length + 1}`, vals: {} });
    renderCandidates();
    renderResults();
});
$('#dc-import').addEventListener('click', () => {
    const notes = store.get('pi.notes', []);
    const have = new Set(dc.candidates.map((c) => c.noteKey).filter(Boolean));
    const fresh = notes.filter((n) => !have.has(n._key));
    for (const n of fresh) {
        dc.candidates.push({ id: uid(), name: [n.id, n.comp].filter(Boolean).join(' · '), noteKey: n._key, vals: {} });
    }
    syncFromNotes();
    renderCandidates();
    renderResults();
    flash($('#dc-status'), notes.length ? `새 기록 ${fresh.length}건을 가져오고, 기존 연동 후보 값을 갱신했습니다.` : '실험 노트에 기록이 없습니다.');
});
$('#dc-demo').addEventListener('click', () => {
    if (dc.candidates.length && !confirm('예시 데이터로 바꿀까요? 현재 후보는 지워집니다.')) return;
    dc.criteria = fromPreset('cpi');
    const byField = Object.fromEntries(dc.criteria.map((c) => [c.field, c.id]));
    dc.candidates = DEMO.map(([name, v]) => ({
        id: uid(), name, vals: Object.fromEntries(Object.entries(v).map(([f, val]) => [byField[f], val])),
    }));
    renderCriteria();
    renderCandidates();
    renderResults();
});
$('#dc-clear').addEventListener('click', () => {
    if (!dc.candidates.length || !confirm('모든 후보를 지울까요?')) return;
    dc.candidates = [];
    renderCandidates();
    renderResults();
});
$('#dc-method').addEventListener('input', (e) => { dc.method = e.target.value; renderResults(); });
$('#dc-spread').addEventListener('input', (e) => { dc.spread = e.target.value; renderResults(); });
$('#dc-px').addEventListener('input', (e) => { dc.px = e.target.value; saveDecide(); renderPareto(); });
$('#dc-py').addEventListener('input', (e) => { dc.py = e.target.value; saveDecide(); renderPareto(); });
$('#dc-copy').addEventListener('click', () => {
    if (lastEval?.rows.length) copyText(`${summaryPlain(lastEval)}\n\n[순위]\n${rankingPlain(lastEval)}`, $('#dc-res-status'));
});
$('#dc-to-log').addEventListener('click', () => {
    if (!lastEval?.rows.length) return flash($('#dc-res-status'), '평가할 후보가 없습니다.');
    resetLogForm();
    $('#dl-title').value = `후보 선정 (${dc.criteria.map((c) => c.name.replace(/\s*\(.*\)/, '')).join('·')})`;
    $('#dl-options').value = rankingPlain(lastEval);
    $('#dl-choice').value = lastEval.rows[0].cand.name;
    $('#dl-rationale').value = `${summaryPlain(lastEval)}\n\n[기준] ${dc.criteria.map((c) => `${c.name} ${specText(c)} (w${c.w})`).join(', ')}`;
    showSub('log');
    $('#dl-title').focus();
});

/* ================= 2. DOE ================= */

// 표준 직교배열 (수준 번호 1부터)
const OA = {
    L4: { levels: 2, rows: ['111', '122', '212', '221'] },
    L8: { levels: 2, rows: ['1111111', '1112222', '1221122', '1222211', '2121212', '2122121', '2211221', '2212112'] },
    L9: { levels: 3, rows: ['1111', '1222', '1333', '2123', '2231', '2312', '3132', '3213', '3321'] },
    L18: {
        levels: 'mixed',
        rows: ['11111111', '11222222', '11333333', '12112233', '12223311', '12331122', '13121323', '13232131', '13313212',
            '21133221', '21211332', '21322113', '22123132', '22231213', '22312321', '23132312', '23213123', '23321231'],
    },
};

let doe = store.get('pi.doe', null) || {
    factors: [
        { name: '몰비 (DA/DAm)', levels: '0.99, 1.00, 1.01' },
        { name: '고형분 (wt%)', levels: '12, 15, 18' },
        { name: '최종 경화 (°C)', levels: '300, 350, 400' },
    ],
    design: 'auto', resp: 'CTE (ppm/K)', dir: 'min', target: '', random: false, runs: [], snap: [],
};
const saveDoe = () => store.set('pi.doe', doe);

const parseLevels = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

// 인자 수준 구성에 맞는 설계 후보와 열 배정
function availableDesigns(factors) {
    const k = factors.length;
    const n = factors.map((f) => parseLevels(f.levels).length);
    const out = [];
    if (!k || n.some((x) => x < 2)) return out;
    const full = n.reduce((a, b) => a * b, 1);
    out.push({ key: 'full', label: `완전요인 (${full}회)`, runs: full });
    if (n.every((x) => x === 2) && k <= 3) out.push({ key: 'L4', label: 'L4 직교배열 (4회)', runs: 4, cols: factors.map((_, i) => i) });
    if (n.every((x) => x === 2) && k <= 7) out.push({ key: 'L8', label: 'L8 직교배열 (8회)', runs: 8, cols: factors.map((_, i) => i) });
    if (n.every((x) => x === 3) && k <= 4) out.push({ key: 'L9', label: 'L9 직교배열 (9회)', runs: 9, cols: factors.map((_, i) => i) });
    const twos = n.filter((x) => x === 2).length;
    if (n.every((x) => x === 2 || x === 3) && twos <= 1 && n.filter((x) => x === 3).length <= 7) {
        let next = 1;
        const cols = n.map((x) => (x === 2 ? 0 : next++));
        out.push({ key: 'L18', label: 'L18 직교배열 (18회)', runs: 18, cols });
    }
    return out;
}

function pickDesign(list, key) {
    if (key !== 'auto') return list.find((d) => d.key === key) || list[0];
    return list.reduce((best, d) => (d.runs < best.runs ? d : best), list[0]);
}

function renderDoeSetup() {
    $('#doe-factors').innerHTML = doe.factors.map((f, i) => `
        <tr data-idx="${i}">
            <td><input type="text" class="w-l" data-f="name" value="${esc(f.name)}"></td>
            <td><input type="text" class="w-l" data-f="levels" value="${esc(f.levels)}" style="width:220px"></td>
            <td class="num">${parseLevels(f.levels).length}</td>
            <td><button class="icon-btn" data-del title="삭제" ${doe.factors.length === 1 ? 'disabled' : ''}>✕</button></td>
        </tr>`).join('');
    renderDesignSelect();
    $('#doe-resp').value = doe.resp;
    $('#doe-dir').value = doe.dir;
    $('#doe-target').value = doe.target;
    $('#doe-random').checked = !!doe.random;
    $('#doe-target-wrap').hidden = doe.dir !== 'target';
}

function renderDesignSelect() {
    const list = availableDesigns(doe.factors);
    const auto = list.length ? pickDesign(list, 'auto') : null;
    $('#doe-design').innerHTML = `<option value="auto">자동 (${auto ? auto.label : '수준을 2개 이상 입력'})</option>`
        + list.map((d) => `<option value="${d.key}"${d.key === doe.design ? ' selected' : ''}>${d.label}</option>`).join('');
    if (doe.design !== 'auto' && !list.find((d) => d.key === doe.design)) doe.design = 'auto';
    $('#doe-design').value = doe.design;
}

function generateRuns() {
    const list = availableDesigns(doe.factors);
    if (!list.length) return flash($('#doe-status'), '모든 인자에 수준을 2개 이상 입력하세요.');
    const d = pickDesign(list, doe.design);
    const snap = doe.factors.map((f) => ({ name: f.name, levels: parseLevels(f.levels) }));
    let rows;
    if (d.key === 'full') {
        rows = [[]];
        for (const f of snap) rows = rows.flatMap((r) => f.levels.map((_, l) => [...r, l]));
    } else {
        rows = OA[d.key].rows.map((r) => d.cols.map((c) => +r[c] - 1));
    }
    if (doe.runs.some((r) => r.y !== '' && r.y != null) && !confirm('입력한 결과가 있는 실험표를 새로 만들까요? 기존 결과는 지워집니다.')) return;
    const order = rows.map((_, i) => i + 1);
    if (doe.random) {
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
    }
    doe.snap = snap;
    doe.designUsed = d.label;
    doe.runs = rows.map((lv, i) => ({ no: i + 1, order: order[i], lv, y: '', memo: '' }));
    saveDoe();
    renderRuns();
    renderDoeAnalysis();
    flash($('#doe-status'), `${d.label} 실험표를 만들었습니다.`);
}

function renderRuns() {
    const snap = doe.snap || [];
    $('#doe-count').textContent = doe.runs.length ? `${doe.designUsed || ''} · ${doe.runs.filter((r) => Number.isFinite(num(r.y))).length}/${doe.runs.length} 입력` : '';
    $('#doe-run-head').innerHTML = `<tr><th>Run</th><th>실행 순서</th>${snap.map((f) => `<th>${esc(f.name)}</th>`).join('')}<th>${esc(doe.resp)}</th><th>메모</th></tr>`;
    $('#doe-run-body').innerHTML = doe.runs.length ? [...doe.runs].sort((a, b) => a.order - b.order).map((r) => `
        <tr data-no="${r.no}">
            <td>#${r.no}</td><td class="num">${r.order}</td>
            ${r.lv.map((l, f) => `<td>${esc(snap[f]?.levels[l] ?? '?')}</td>`).join('')}
            <td><input type="number" step="any" class="w-s" data-f="y" value="${esc(r.y)}"></td>
            <td><input type="text" class="w-l" data-f="memo" value="${esc(r.memo)}"></td>
        </tr>`).join('') : '<tr><td colspan="4" class="empty">“실험표 생성”을 누르세요.</td></tr>';
}

function analyzeDoe() {
    const snap = doe.snap || [];
    const data = doe.runs.map((r) => ({ ...r, yv: num(r.y) })).filter((r) => Number.isFinite(r.yv));
    if (data.length < 2 || !snap.length) return null;
    const grand = data.reduce((s, r) => s + r.yv, 0) / data.length;
    const ssTot = data.reduce((s, r) => s + (r.yv - grand) ** 2, 0);
    const target = num(doe.target);
    const better = (a, b) => (doe.dir === 'max' ? a > b : doe.dir === 'min' ? a < b : Math.abs(a - target) < Math.abs(b - target));
    const factors = snap.map((f, fi) => {
        const means = f.levels.map((_, l) => {
            const ys = data.filter((r) => r.lv[fi] === l).map((r) => r.yv);
            return { n: ys.length, mean: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : NaN };
        });
        const valid = means.filter((m) => Number.isFinite(m.mean));
        const range = valid.length ? Math.max(...valid.map((m) => m.mean)) - Math.min(...valid.map((m) => m.mean)) : NaN;
        const ss = means.reduce((s, m) => s + (Number.isFinite(m.mean) ? m.n * (m.mean - grand) ** 2 : 0), 0);
        let best = -1;
        means.forEach((m, l) => {
            if (Number.isFinite(m.mean) && (best < 0 || better(m.mean, means[best].mean))) best = l;
        });
        return { name: f.name, levels: f.levels, means, range, ss, contrib: ssTot > 0 ? ss / ssTot : 0, best };
    });
    const complete = factors.every((f) => f.best >= 0 && f.means.every((m) => m.n > 0));
    const predicted = complete ? grand + factors.reduce((s, f) => s + (f.means[f.best].mean - grand), 0) : NaN;
    const bestLv = factors.map((f) => f.best);
    const existing = doe.runs.find((r) => r.lv.every((l, i) => l === bestLv[i]));
    const bestObserved = data.reduce((a, b) => (better(b.yv, a.yv) ? b : a));
    return { data, grand, ssTot, factors, predicted, complete, existing, bestObserved };
}

function renderDoeAnalysis() {
    saveDoe();
    const A = analyzeDoe();
    if (!A) {
        $('#doe-summary').innerHTML = '<p class="empty">실험표를 만들고 결과를 2개 이상 입력하면 분석이 표시됩니다.</p>';
        $('#doe-kpis').innerHTML = '';
        $('#doe-chart').innerHTML = '';
        $('#doe-effects').innerHTML = '';
        return;
    }
    const ranked = [...A.factors].sort((a, b) => b.contrib - a.contrib);
    const unexplained = 1 - A.factors.reduce((s, f) => s + f.contrib, 0);
    const condTxt = A.factors.map((f) => `${f.name} = ${f.best >= 0 ? f.levels[f.best] : '?'}`).join(', ');
    const lines = [
        `<strong>가장 큰 영향 인자: ${esc(ranked[0].name)}</strong> (기여율 ${pct(ranked[0].contrib)})`,
        `· 추천 조건: ${esc(condTxt)}${Number.isFinite(A.predicted) ? ` → 예측 ${esc(doe.resp)} ≈ <strong>${fmt(A.predicted, 2)}</strong>` : ''}`,
        A.existing
            ? `· 이 조합은 실험표 Run #${A.existing.no}에 있습니다${Number.isFinite(num(A.existing.y)) ? ` (실측 ${A.existing.y})` : ' — 결과를 입력하세요'}.`
            : '· 이 조합은 실험표에 없습니다 → <strong>확인 실험</strong>으로 예측값을 검증하세요.',
    ];
    if (!A.complete) lines.push('· 일부 수준의 결과가 없어 예측이 불완전합니다.');
    if (A.data.length < doe.runs.length) lines.push(`· 결과 미입력 ${doe.runs.length - A.data.length}회`);
    if (unexplained > 0.3 && A.data.length === doe.runs.length) lines.push(`· 인자로 설명되지 않는 변동이 ${pct(unexplained)}입니다 → 교호작용이나 측정 오차가 큽니다. 반복 실험을 고려하세요.`);
    $('#doe-summary').innerHTML = `<div class="summary">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
    $('#doe-kpis').innerHTML = [
        kpi('전체 평균', fmt(A.grand, 2), `${A.data.length}회 측정`),
        kpi('실측 최고', fmt(A.bestObserved.yv, 2), `Run #${A.bestObserved.no}`),
        kpi('예측 최적값', Number.isFinite(A.predicted) ? fmt(A.predicted, 2) : '–', '가법 모형'),
        kpi('미설명 변동', pct(Math.max(0, unexplained)), '오차 + 교호작용'),
    ].join('');
    $('#doe-effects').innerHTML = ranked.map((f, i) => `
        <tr>
            <td><span class="rank">${i + 1}</span></td>
            <td><strong>${esc(f.name)}</strong></td>
            <td>${f.means.map((m, l) => `${esc(f.levels[l])}: <strong>${fmt(m.mean, 2)}</strong>`).join(' · ')}</td>
            <td><span class="meter"><i style="width:${f.contrib * 100}%"></i></span>${fmt(f.range, 2)} (${pct(f.contrib)})</td>
            <td>${f.best >= 0 ? `<span class="badge ok">${esc(f.levels[f.best])}</span>` : '–'}</td>
        </tr>`).join('');
    $('#doe-chart').innerHTML = mainEffectsChart(A);
}

// 인자별 주효과를 같은 y축의 작은 패널로 나란히 그린다
function mainEffectsChart(A) {
    const k = A.factors.length;
    const W = 760, H = 260, L = 56, B = 54, T = 16, gap = 18;
    const pw = (W - L - 10 - gap * (k - 1)) / k;
    const all = A.factors.flatMap((f) => f.means.map((m) => m.mean)).filter(Number.isFinite);
    let y0 = Math.min(...all, A.grand), y1 = Math.max(...all, A.grand);
    const pad = (y1 - y0) * 0.15 || Math.abs(y1) * 0.05 || 1;
    y0 -= pad; y1 += pad;
    const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주효과도">`;
    for (const v of niceTicks(y0, y1, 4)) svg += `<line class="grid" x1="${L}" x2="${W - 10}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${+v.toPrecision(4)}</text>`;
    svg += `<line x1="${L}" x2="${W - 10}" y1="${sy(A.grand)}" y2="${sy(A.grand)}" stroke="#6e6a64" stroke-dasharray="4 4"/>`;
    A.factors.forEach((f, fi) => {
        const x0 = L + fi * (pw + gap);
        const n = f.levels.length;
        const sx = (l) => x0 + (n === 1 ? pw / 2 : 14 + (l / (n - 1)) * (pw - 28));
        svg += `<line class="axis" x1="${x0}" x2="${x0 + pw}" y1="${H - B}" y2="${H - B}"/>`;
        const pts = f.means.map((m, l) => [sx(l), m.mean]).filter((p) => Number.isFinite(p[1]));
        svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${sy(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="#3a6ea5" stroke-width="2.2"/>`;
        f.means.forEach((m, l) => {
            if (!Number.isFinite(m.mean)) return;
            const isBest = l === f.best;
            svg += `<circle cx="${sx(l)}" cy="${sy(m.mean)}" r="${isBest ? 6 : 4}" fill="${isBest ? '#2d6a4f' : '#3a6ea5'}"/>`;
        });
        f.levels.forEach((lv, l) => (svg += `<text class="tick" x="${sx(l)}" y="${H - B + 16}" text-anchor="middle">${esc(lv)}</text>`));
        svg += `<text class="lbl" x="${x0 + pw / 2}" y="${H - 12}" text-anchor="middle">${esc(f.name)}</text>`;
    });
    svg += '</svg>';
    return `${svg}<div class="legend"><span><i style="background:#2d6a4f"></i>추천 수준</span><span><i style="background:#6e6a64"></i>전체 평균 (점선)</span></div>`;
}

$('#doe-factors').addEventListener('input', (e) => {
    const f = doe.factors[+e.target.closest('tr').dataset.idx];
    f[e.target.dataset.f] = e.target.value;
    saveDoe();
    if (e.target.dataset.f === 'levels') {
        e.target.closest('tr').children[2].textContent = parseLevels(f.levels).length;
        renderDesignSelect();
    }
});
$('#doe-factors').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    doe.factors.splice(+e.target.closest('tr').dataset.idx, 1);
    saveDoe();
    renderDoeSetup();
});
$('#doe-add-factor').addEventListener('click', () => {
    doe.factors.push({ name: `인자 ${doe.factors.length + 1}`, levels: '' });
    saveDoe();
    renderDoeSetup();
});
$('#doe-design').addEventListener('input', (e) => { doe.design = e.target.value; saveDoe(); });
$('#doe-resp').addEventListener('input', (e) => { doe.resp = e.target.value; renderRuns(); renderDoeAnalysis(); });
$('#doe-dir').addEventListener('input', (e) => {
    doe.dir = e.target.value;
    $('#doe-target-wrap').hidden = doe.dir !== 'target';
    renderDoeAnalysis();
});
$('#doe-target').addEventListener('input', (e) => { doe.target = e.target.value; renderDoeAnalysis(); });
$('#doe-random').addEventListener('input', (e) => { doe.random = e.target.checked; saveDoe(); });
$('#doe-generate').addEventListener('click', generateRuns);
$('#doe-run-body').addEventListener('input', (e) => {
    const run = doe.runs.find((r) => r.no === +e.target.closest('tr').dataset.no);
    if (!run) return;
    run[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.f === 'y') {
        $('#doe-count').textContent = `${doe.designUsed || ''} · ${doe.runs.filter((r) => Number.isFinite(num(r.y))).length}/${doe.runs.length} 입력`;
        renderDoeAnalysis();
    } else saveDoe();
});
$('#doe-csv').addEventListener('click', () => {
    if (!doe.runs.length) return;
    const snap = doe.snap || [];
    const header = ['Run', '실행순서', ...snap.map((f) => f.name), doe.resp, '메모'];
    const rows = [...doe.runs].sort((a, b) => a.order - b.order)
        .map((r) => [r.no, r.order, ...r.lv.map((l, f) => snap[f]?.levels[l]), r.y, r.memo].map(csvCell).join(','));
    download(`pi-doe-${today()}.csv`, '﻿' + [header.map(csvCell).join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
});

/* ================= 3. 결정 기록 ================= */

let decisions = store.get('pi.decisions', []);
let editingDecision = null;
const DL_FIELDS = ['title', 'date', 'status', 'review', 'options', 'choice', 'rationale', 'risks'];
const STATUS_CLS = { 검토중: 'mid', 확정: 'ok', 보류: '', 번복: 'bad' };

const isDue = (d) => d.review && d.review <= today() && d.status !== '번복';

function resetLogForm() {
    $('#dl-form').reset();
    $('#dl-date').value = today();
    editingDecision = null;
    $('#dl-submit').textContent = '저장';
    $('#dl-cancel').hidden = true;
}

function renderDecisions() {
    const filter = $('#dl-filter').value;
    const list = decisions
        .filter((d) => !filter || (filter === 'due' ? isDue(d) : d.status === filter))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const due = decisions.filter(isDue).length;
    $('#dl-count').textContent = `${decisions.length}건${due ? ` · 재검토 도래 ${due}건` : ''}`;
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
    $('#dl-list').innerHTML = list.length ? list.map((d) => `
        <article class="dl-item${isDue(d) ? ' due' : ''}" data-key="${esc(d._key)}">
            <header>
                <div><strong>${esc(d.title)}</strong> <small>${esc(d.date)}</small>
                    <span class="badge ${STATUS_CLS[d.status] || ''}">${esc(d.status)}</span>
                    ${isDue(d) ? '<span class="badge mid">재검토 필요</span>' : ''}</div>
                <div class="inline"><button class="ghost" data-act="edit">수정</button><button class="icon-btn" data-act="del" title="삭제">✕</button></div>
            </header>
            <dl>${row('결정', d.choice)}${row('선택지', d.options)}${row('근거', d.rationale)}${row('리스크·가정', d.risks)}${row('재검토일', d.review)}</dl>
        </article>`).join('') : '<p class="empty">기록이 없습니다.</p>';
}

$('#dl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const entry = Object.fromEntries(DL_FIELDS.map((f) => [f, $(`#dl-${f}`).value.trim()]));
    if (editingDecision) {
        const i = decisions.findIndex((d) => d._key === editingDecision);
        if (i >= 0) decisions[i] = { ...decisions[i], ...entry };
    } else {
        decisions.push({ ...entry, _key: uid() });
    }
    store.set('pi.decisions', decisions);
    resetLogForm();
    renderDecisions();
});
$('#dl-cancel').addEventListener('click', resetLogForm);
$('#dl-filter').addEventListener('input', renderDecisions);
$('#dl-list').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const key = e.target.closest('.dl-item').dataset.key;
    const d = decisions.find((x) => x._key === key);
    if (!d) return;
    if (act === 'del') {
        if (!confirm(`“${d.title}” 기록을 삭제할까요?`)) return;
        decisions = decisions.filter((x) => x._key !== key);
        store.set('pi.decisions', decisions);
        renderDecisions();
        return;
    }
    for (const f of DL_FIELDS) $(`#dl-${f}`).value = d[f] ?? '';
    editingDecision = key;
    $('#dl-submit').textContent = '수정 저장';
    $('#dl-cancel').hidden = false;
    $('#dl-form').scrollIntoView({ behavior: 'smooth' });
});
$('#dl-csv').addEventListener('click', () => {
    const labels = ['주제', '날짜', '상태', '재검토일', '선택지', '결정', '근거', '리스크·가정'];
    const rows = decisions.map((d) => DL_FIELDS.map((f) => csvCell(d[f])).join(','));
    download(`pi-decisions-${today()}.csv`, '﻿' + [labels.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
});

/* ================= 하위 탭 · 초기화 ================= */

function showSub(name) {
    if (!$(`[data-subpanel="${name}"]`)) name = 'rank';
    $$('.subtab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.sub === name)));
    $$('.subpanel').forEach((p) => (p.hidden = p.dataset.subpanel !== name));
    store.set('pi.decideSub', name);
}
$$('.subtab').forEach((t) => t.addEventListener('click', () => showSub(t.dataset.sub)));

function renderAll() {
    $('#dc-method').value = dc.method;
    $('#dc-spread').value = dc.spread;
    renderCriteria();
    renderCandidates();
    renderResults();
    renderDoeSetup();
    renderRuns();
    renderDoeAnalysis();
    resetLogForm();
    renderDecisions();
}

// 실험 노트 백업 복원 시 다시 읽기
document.addEventListener('pi:restored', () => {
    dc = loadDecide();
    doe = store.get('pi.doe', null) || doe;
    decisions = store.get('pi.decisions', []);
    renderAll();
});

// 노트 탭에서 값이 바뀌었을 수 있으니 의사결정 탭을 열 때 연동 값을 갱신
$('[data-tab="decide"]').addEventListener('click', () => {
    syncFromNotes();
    renderCandidates();
    renderResults();
    renderDecisions();
});

renderAll();
showSub(store.get('pi.decideSub', 'rank'));
