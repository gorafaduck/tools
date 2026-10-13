const TYPE_LABEL = { news: '뉴스', paper: '논문', preprint: '프리프린트' };
const LAST_VISIT_KEY = 'pi-digest:last-visit';
const PAGE_SIZE = 50;

const state = {
    items: [],
    tags: [],
    type: 'all',
    activeTags: new Set(),
    query: '',
    period: 30,
    sort: 'date',
    lang: 'all',
    onlyNew: false,
    shown: PAGE_SIZE,
    lastVisit: null,
};

const $ = (sel) => document.querySelector(sel);

function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 비공개 모드 등 */ }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safe.replace(re, '<mark>$1</mark>');
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}

function itemDate(it) {
    return it.date || it.first_seen || '';
}

function isNew(it) {
    return state.lastVisit && it.first_seen && it.first_seen > state.lastVisit;
}

function baseFiltered() {
    const since = daysAgo(state.period);
    const q = state.query.toLowerCase();
    return state.items.filter((it) => {
        if (itemDate(it) < since) return false;
        if (state.lang !== 'all' && it.lang !== state.lang) return false;
        if (state.onlyNew && !isNew(it)) return false;
        if (q) {
            const hay = [it.title, it.abstract, it.source, (it.authors || []).join(' '), (it.tags || []).join(' ')]
                .join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function applyFilters() {
    const base = baseFiltered();
    const filtered = base.filter((it) => {
        if (state.type !== 'all' && it.type !== state.type) return false;
        for (const t of state.activeTags) {
            if (!(it.tags || []).includes(t)) return false;
        }
        return true;
    });
    const sorters = {
        date: (a, b) => itemDate(b).localeCompare(itemDate(a)) || b.score - a.score,
        score: (a, b) => b.score - a.score || itemDate(b).localeCompare(itemDate(a)),
        cited: (a, b) => (b.cited_by || 0) - (a.cited_by || 0) || itemDate(b).localeCompare(itemDate(a)),
    };
    filtered.sort(sorters[state.sort]);
    return { base, filtered };
}

function renderStats(base) {
    const count = (type) => base.filter((it) => it.type === type).length;
    const fresh = base.filter(isNew).length;
    const cards = [
        ['기간 내 전체', base.length],
        ['뉴스', count('news')],
        ['논문', count('paper')],
        ['프리프린트', count('preprint')],
    ];
    if (state.lastVisit) cards.push(['지난 방문 이후 신규', fresh]);
    $('#stats').innerHTML = cards
        .map(([label, n]) => `<div class="stat"><span class="label">${label}</span><strong>${n}</strong></div>`)
        .join('');
}

function renderTags(base) {
    const counts = {};
    base.forEach((it) => (it.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    $('#tags').innerHTML = state.tags
        .map((t) => `<button type="button" class="chip${state.activeTags.has(t) ? ' on' : ''}" data-tag="${escapeHtml(t)}"
            aria-pressed="${state.activeTags.has(t)}">${escapeHtml(t)}<span class="n">${counts[t] || 0}</span></button>`)
        .join('');
}

function renderEntry(it, idx) {
    const q = state.query;
    const authors = it.authors || [];
    const authorText = authors.length > 3 ? `${authors.slice(0, 3).join(', ')} 외` : authors.join(', ');
    const meta = [itemDate(it), it.source, authorText, it.cited_by ? `피인용 ${it.cited_by}` : '']
        .filter(Boolean).map((m) => highlight(m, q)).join(' · ');
    const tags = (it.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const abstract = it.abstract
        ? `<details><summary>초록</summary><p>${highlight(it.abstract, q)}</p></details>` : '';
    const tools = it.type !== 'news'
        ? `<div class="tools"><button type="button" class="ghost" data-copy="${idx}">인용 복사</button></div>` : '';
    return `<article class="entry">
        <div><span class="badge ${it.type}">${TYPE_LABEL[it.type]}</span>${isNew(it) ? '<span class="badge new">NEW</span>' : ''}</div>
        <h3><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer">${highlight(it.title, q)}</a></h3>
        <div class="meta">${meta}</div>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        ${abstract}
        ${tools}
    </article>`;
}

let current = [];

function render() {
    const { base, filtered } = applyFilters();
    current = filtered;
    renderStats(base);
    renderTags(base);
    $('#result-count').textContent = `${filtered.length}건`;
    const list = $('#list');
    if (!filtered.length) {
        list.innerHTML = '<div class="card empty">조건에 맞는 항목이 없습니다. 기간을 늘리거나 필터를 줄여 보세요.</div>';
        return;
    }
    let html = filtered.slice(0, state.shown).map(renderEntry).join('');
    if (filtered.length > state.shown) {
        html += `<button type="button" class="primary" id="more">더 보기 (${filtered.length - state.shown}건 남음)</button>`;
    }
    list.innerHTML = html;
}

function citation(it) {
    const authors = it.authors || [];
    const a = authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al.` : authors.join(', ');
    const year = (it.date || '').slice(0, 4);
    return `${a ? a + '. ' : ''}${it.title}. ${it.source || ''}${year ? ` (${year})` : ''}.${it.doi ? ` https://doi.org/${it.doi}` : ` ${it.url}`}`;
}

function bibtex(it, i) {
    const first = ((it.authors || [])[0] || 'anon').split(' ').pop().replace(/[^A-Za-z]/g, '') || 'anon';
    const year = (it.date || '').slice(0, 4);
    const fields = {
        title: it.title,
        author: (it.authors || []).join(' and '),
        journal: it.type === 'preprint' && it.source === 'arXiv' ? 'arXiv preprint' : it.source,
        year,
        doi: it.doi,
        url: it.url,
    };
    const body = Object.entries(fields).filter(([, v]) => v)
        .map(([k, v]) => {
            const val = String(v).replace(/[{}]/g, '');
            return k === 'title' ? `  title = {{${val}}}` : `  ${k} = {${val}}`;
        }).join(',\n');
    return `@article{${first.toLowerCase()}${year}_${i + 1},\n${body}\n}`;
}

function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function exportCsv() {
    const cols = ['type', 'date', 'title', 'source', 'authors', 'doi', 'url', 'tags', 'score', 'cited_by', 'first_seen'];
    const cell = (v) => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...current.map((it) => cols.map((c) => cell(it[c])).join(','))];
    download(`polyimide-${daysAgo(0)}.csv`, '﻿' + rows.join('\n'), 'text/csv;charset=utf-8');
}

function exportBib() {
    const papers = current.filter((it) => it.type !== 'news');
    if (!papers.length) {
        alert('내보낼 논문/프리프린트가 없습니다.');
        return;
    }
    download(`polyimide-${daysAgo(0)}.bib`, papers.map(bibtex).join('\n\n'), 'application/x-bibtex');
}

function bind() {
    let timer;
    $('#q').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.query = e.target.value.trim(); state.shown = PAGE_SIZE; render(); }, 150);
    });
    $('#type-filter').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-type]');
        if (!btn) return;
        state.type = btn.dataset.type;
        document.querySelectorAll('#type-filter button').forEach((b) => b.classList.toggle('on', b === btn));
        state.shown = PAGE_SIZE;
        render();
    });
    $('#tags').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const t = chip.dataset.tag;
        state.activeTags.has(t) ? state.activeTags.delete(t) : state.activeTags.add(t);
        state.shown = PAGE_SIZE;
        render();
    });
    $('#period').addEventListener('change', (e) => { state.period = Number(e.target.value); render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    $('#lang').addEventListener('change', (e) => { state.lang = e.target.value; render(); });
    $('#only-new').addEventListener('change', (e) => { state.onlyNew = e.target.checked; render(); });
    $('#reset').addEventListener('click', () => {
        Object.assign(state, { type: 'all', query: '', period: 30, sort: 'date', lang: 'all', onlyNew: false, shown: PAGE_SIZE });
        state.activeTags.clear();
        $('#q').value = '';
        $('#period').value = '30';
        $('#sort').value = 'date';
        $('#lang').value = 'all';
        $('#only-new').checked = false;
        document.querySelectorAll('#type-filter button').forEach((b) => b.classList.toggle('on', b.dataset.type === 'all'));
        render();
    });
    $('#export-csv').addEventListener('click', exportCsv);
    $('#export-bib').addEventListener('click', exportBib);
    $('#list').addEventListener('click', async (e) => {
        if (e.target.id === 'more') {
            state.shown += PAGE_SIZE;
            render();
            return;
        }
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        const it = current[Number(btn.dataset.copy)];
        try {
            await navigator.clipboard.writeText(citation(it));
            btn.textContent = '복사됨';
        } catch {
            prompt('인용 정보를 복사하세요', citation(it));
        }
    });
}

async function init() {
    state.lastVisit = storageGet(LAST_VISIT_KEY);
    bind();
    try {
        const res = await fetch(`data.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        if (!data.generated_at) throw new Error('아직 수집 기록 없음');
        state.items = data.items || [];
        state.tags = data.tags || [];
        const updated = data.generated_at ? new Date(data.generated_at).toLocaleString('ko-KR') : '-';
        $('#updated').textContent = `마지막 업데이트: ${updated}`;
    } catch (err) {
        $('#list').innerHTML = `<div class="card empty">데이터를 불러오지 못했습니다 (${escapeHtml(err.message)}).
            아직 첫 수집이 실행되지 않았다면 GitHub Actions에서 "Polyimide digest" 워크플로를 실행해 주세요.</div>`;
        return;
    }
    render();
    storageSet(LAST_VISIT_KEY, daysAgo(0));
}

init();
