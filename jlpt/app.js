(() => {
    const STORE_KEY = "jlpt-study-v1";
    const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
    const SRS_DAYS = [0, 1, 2, 4, 7, 15]; // box 번호별 다음 복습까지 일수
    const NEW_PER_SESSION = 10;
    const QUIZ_LENGTH = 10;

    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const shuffle = (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };
    const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const addDays = (n) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + n);
        return dayKey(d);
    };

    // ---------- 저장소 ----------
    const state = (() => {
        const base = { level: "N5", srs: {}, wrong: {}, days: {} };
        try {
            return { ...base, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
        } catch {
            return base;
        }
    })();
    const save = () => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch { /* 저장 불가 환경(시크릿 모드 등)에서는 무시 */ }
    };
    const logStudy = () => {
        const k = dayKey();
        state.days[k] = (state.days[k] || 0) + 1;
    };

    const vocabKey = (level, w) => `v|${level}|${w[0]}`;
    const grammarKey = (level, i) => `g|${level}|${i}`;
    const words = () => JLPT_VOCAB[state.level];

    // ---------- 음성 ----------
    const speak = (text) => {
        if (!("speechSynthesis" in window)) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ja-JP";
        u.rate = 0.9;
        const ja = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
        if (ja) u.voice = ja;
        speechSynthesis.speak(u);
    };
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-speak]");
        if (btn) {
            e.stopPropagation();
            speak(btn.dataset.speak);
        }
    });
    const speakBtn = (text) => `<button class="speak" data-speak="${esc(text)}" aria-label="발음 듣기">🔊</button>`;

    // ---------- 대시보드 ----------
    const nextExamDate = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
            for (const m of [6, 11]) { // 7월, 12월
                const d = new Date(y, m, 1);
                d.setDate(1 + ((7 - d.getDay()) % 7)); // 첫째 일요일
                if (d >= today) return d;
            }
        }
        return null;
    };

    const dueCount = () => {
        const today = dayKey();
        return Object.entries(state.srs).filter(([k, v]) => k.startsWith(`v|${state.level}|`) && v.due <= today).length;
    };

    const streak = () => {
        let n = 0;
        const d = new Date();
        if (!state.days[dayKey(d)]) d.setDate(d.getDate() - 1);
        while (state.days[dayKey(d)]) {
            n++;
            d.setDate(d.getDate() - 1);
        }
        return n;
    };

    const renderDashboard = () => {
        const exam = nextExamDate();
        if (exam) {
            const diff = Math.round((exam - new Date().setHours(0, 0, 0, 0)) / 86400000);
            $("#dday-label").textContent = `다음 JLPT (${exam.getFullYear()}.${exam.getMonth() + 1}.${exam.getDate()} 예상)`;
            $("#dday-value").textContent = diff === 0 ? "D-DAY" : `D-${diff}`;
        }
        $("#stat-today").textContent = state.days[dayKey()] || 0;
        $("#stat-streak").textContent = `${streak()}일`;
        $("#stat-due").textContent = dueCount();
        $("#stat-wrong").textContent = Object.keys(state.wrong).length;

        const list = words();
        const learned = list.filter((w) => (state.srs[vocabKey(state.level, w)]?.box || 0) >= 3).length;
        const pct = Math.round((learned / list.length) * 100);
        $("#progress-label").textContent = `${state.level} 단어 암기율 (${learned}/${list.length}, 3단계 이상)`;
        $("#progress-pct").textContent = `${pct}%`;
        $("#progress-bar").style.width = `${pct}%`;

        document.querySelectorAll(".level").forEach((b) => {
            b.classList.toggle("active", b.dataset.level === state.level);
            b.setAttribute("aria-checked", b.dataset.level === state.level);
        });
    };

    // ---------- 키보드 ----------
    let keyHandler = null;
    document.addEventListener("keydown", (e) => {
        if (e.target.matches("input, select, textarea")) return;
        keyHandler?.(e);
    });

    // ---------- 플래시카드 ----------
    let flash = null;

    const buildFlashDeck = () => {
        const level = state.level;
        const today = dayKey();
        const list = words();
        const due = list.filter((w) => {
            const s = state.srs[vocabKey(level, w)];
            return s && s.due <= today;
        });
        const fresh = list.filter((w) => !state.srs[vocabKey(level, w)]).slice(0, NEW_PER_SESSION);
        return { deck: [...shuffle(due), ...shuffle(fresh)], i: 0, flipped: false, dueN: due.length, newN: fresh.length, ok: 0 };
    };

    const renderFlash = () => {
        const area = $("#flash-area");
        if (!flash) flash = buildFlashDeck();
        $("#flash-info").textContent = `복습 ${flash.dueN} · 새 단어 ${flash.newN}`;

        if (flash.i >= flash.deck.length) {
            keyHandler = null;
            const left = words().filter((w) => !state.srs[vocabKey(state.level, w)]).length;
            area.innerHTML = `
                <div class="feedback">
                    ${flash.deck.length ? `<strong>세션 완료!</strong> ${flash.deck.length}장 중 ${flash.ok}장을 알고 있었어요.` : "<strong>오늘 학습할 카드가 없습니다.</strong>"}
                    <br>아직 시작하지 않은 ${state.level} 단어: ${left}개
                </div>
                <div class="actions">
                    <button class="primary" id="flash-more">${left ? "새 단어 더 학습" : "처음부터 다시 보기"}</button>
                </div>`;
            $("#flash-more").onclick = () => {
                if (!left) {
                    flash = { deck: shuffle(words()), i: 0, flipped: false, dueN: 0, newN: 0, ok: 0, review: true };
                } else {
                    flash = buildFlashDeck();
                }
                renderFlash();
            };
            return;
        }

        const w = flash.deck[flash.i];
        const s = state.srs[vocabKey(state.level, w)];
        area.innerHTML = `
            <div class="scoreline"><span>${flash.i + 1} / ${flash.deck.length}</span><span>${s ? `단계 ${s.box}` : "새 단어"}</span></div>
            <div class="flashcard" id="card" tabindex="0">
                <div class="big jp">${esc(w[0])}</div>
                ${flash.flipped
                    ? `<div class="reading jp">${esc(w[1])} ${speakBtn(w[1])}</div><div class="meaning">${esc(w[2])}</div>`
                    : `<div class="hint">눌러서 뒤집기 (Space)</div>`}
            </div>
            <div class="actions">
                ${flash.flipped
                    ? `<button class="primary danger" id="btn-no">몰라요 (1)</button><button class="primary" id="btn-yes">알아요 (2)</button>`
                    : `<button class="primary" id="btn-flip">정답 보기</button>`}
            </div>`;

        const flip = () => {
            flash.flipped = true;
            renderFlash();
            speak(w[1]);
        };
        const grade = (known) => {
            const k = vocabKey(state.level, w);
            if (!flash.review) {
                const box = known ? Math.min((state.srs[k]?.box || 0) + 1, SRS_DAYS.length - 1) : 1;
                state.srs[k] = { box, due: addDays(known ? SRS_DAYS[box] : 0) };
                // 몰라요 카드는 이번 세션 끝에 한 번 더
                if (!known) flash.deck.push(w);
            }
            if (known) flash.ok++;
            logStudy();
            save();
            flash.i++;
            flash.flipped = false;
            renderFlash();
            renderDashboard();
        };

        $("#card").onclick = () => !flash.flipped && flip();
        $("#btn-flip")?.addEventListener("click", flip);
        $("#btn-no")?.addEventListener("click", () => grade(false));
        $("#btn-yes")?.addEventListener("click", () => grade(true));
        keyHandler = (e) => {
            if (!flash.flipped && (e.code === "Space" || e.key === "Enter")) {
                e.preventDefault();
                flip();
            } else if (flash.flipped && e.key === "1") grade(false);
            else if (flash.flipped && e.key === "2") grade(true);
        };
    };

    // ---------- 공통 퀴즈 엔진 ----------
    const makeVocabQ = (level, w, mode) => {
        const pool = JLPT_VOCAB[level].filter((x) => x[0] !== w[0]);
        const field = mode === "reading" ? 1 : mode === "reverse" ? 0 : 2;
        const answer = w[field];
        const distract = shuffle(pool.map((x) => x[field]).filter((v, i, a) => v !== answer && a.indexOf(v) === i)).slice(0, 3);
        const options = shuffle([answer, ...distract]);
        return {
            key: vocabKey(level, w),
            level,
            prompt: mode === "reverse" ? w[2] : w[0],
            jpPrompt: mode !== "reverse",
            jpOptions: mode !== "meaning",
            options,
            answer: options.indexOf(answer),
            explain: `${w[0]} (${w[1]}) — ${w[2]}`,
            say: w[1]
        };
    };

    const makeGrammarQ = (level, i) => {
        const g = JLPT_GRAMMAR[level][i];
        const order = shuffle([0, 1, 2, 3]);
        return {
            key: grammarKey(level, i),
            level,
            prompt: g.q,
            sentence: true,
            jpPrompt: true,
            jpOptions: true,
            options: order.map((j) => g.o[j]),
            answer: order.indexOf(g.a),
            explain: `<span class="jp">${esc(g.q.replace("＿＿", `【${g.o[g.a]}】`))}</span><br>${esc(g.e)}`,
            explainHtml: true,
            say: g.q.replace("＿＿", g.o[g.a])
        };
    };

    const runQuiz = (area, questions, onRestart) => {
        let i = 0;
        let score = 0;
        let answered = false;

        const show = () => {
            if (i >= questions.length) {
                keyHandler = null;
                const pct = Math.round((score / questions.length) * 100);
                area.innerHTML = `
                    <div class="feedback"><strong>${questions.length}문제 중 ${score}문제 정답 (${pct}%)</strong><br>
                    ${pct >= 80 ? "훌륭해요! 이 레벨을 잘 소화하고 있어요." : pct >= 60 ? "합격권이에요. 틀린 문제는 오답노트에서 다시 확인하세요." : "조금 더 연습이 필요해요. 플래시카드로 단어부터 다져 보세요."}</div>
                    <div class="actions"><button class="primary" id="quiz-again">다시 풀기</button></div>`;
                $("#quiz-again").onclick = onRestart;
                return;
            }
            const q = questions[i];
            answered = false;
            area.innerHTML = `
                <div class="scoreline"><span>${q.level} · ${i + 1} / ${questions.length}</span><span>정답 ${score}</span></div>
                <div class="question ${q.sentence ? "sentence" : ""} ${q.jpPrompt ? "jp" : ""}">${esc(q.prompt)}</div>
                <div class="options">
                    ${q.options.map((o, j) => `<button class="option ${q.jpOptions ? "jp" : ""}" data-i="${j}"><span class="num">${j + 1}</span>${esc(o)}</button>`).join("")}
                </div>
                <div id="quiz-feedback"></div>`;
            area.querySelectorAll(".option").forEach((b) => (b.onclick = () => pick(Number(b.dataset.i))));
            keyHandler = (e) => {
                if (!answered && /^[1-4]$/.test(e.key)) pick(Number(e.key) - 1);
                else if (answered && (e.key === "Enter" || e.code === "Space")) {
                    e.preventDefault();
                    next();
                }
            };
        };

        const pick = (j) => {
            if (answered) return;
            answered = true;
            const q = questions[i];
            const correct = j === q.answer;
            const btns = area.querySelectorAll(".option");
            btns.forEach((b) => (b.disabled = true));
            btns[q.answer].classList.add("correct");
            if (correct) {
                score++;
                delete state.wrong[q.key];
            } else {
                btns[j].classList.add("wrong");
                state.wrong[q.key] = { at: dayKey() };
            }
            logStudy();
            save();
            renderDashboard();
            $("#quiz-feedback").innerHTML = `
                <div class="feedback">${correct ? "⭕ 정답!" : "❌ 오답"}<br>${q.explainHtml ? q.explain : `<span class="jp">${esc(q.explain)}</span>`} ${speakBtn(q.say)}</div>
                <div class="actions"><button class="primary" id="quiz-next">다음 (Enter)</button></div>`;
            $("#quiz-next").onclick = next;
        };

        const next = () => {
            i++;
            show();
        };

        show();
    };

    // ---------- 단어 퀴즈 ----------
    const renderVocab = () => {
        const mode = $("#vocab-mode").value;
        const qs = shuffle(words()).slice(0, QUIZ_LENGTH).map((w) => makeVocabQ(state.level, w, mode));
        runQuiz($("#vocab-area"), qs, renderVocab);
    };

    // ---------- 문법 퀴즈 ----------
    const renderGrammar = () => {
        const n = JLPT_GRAMMAR[state.level].length;
        const qs = shuffle([...Array(n).keys()]).slice(0, QUIZ_LENGTH).map((i) => makeGrammarQ(state.level, i));
        runQuiz($("#grammar-area"), qs, renderGrammar);
    };

    // ---------- 가나 연습 ----------
    const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    const renderKana = () => {
        const area = $("#kana-area");
        const mode = $("#kana-mode").value;
        const deck = shuffle(KANA_BASE).slice(0, 20).map(([h, r]) => {
            const kata = mode === "kata" || (mode === "mix" && Math.random() < 0.5);
            return [kata ? toKata(h) : h, r];
        });
        let i = 0;
        let score = 0;
        keyHandler = null;

        const show = () => {
            if (i >= deck.length) {
                area.innerHTML = `<div class="feedback"><strong>${deck.length}개 중 ${score}개 정답</strong></div>
                    <div class="actions"><button class="primary" id="kana-again">다시 하기</button></div>`;
                $("#kana-again").onclick = renderKana;
                return;
            }
            const [ch, romaji] = deck[i];
            area.innerHTML = `
                <div class="scoreline"><span>${i + 1} / ${deck.length}</span><span>정답 ${score}</span></div>
                <div class="flashcard" style="min-height:160px;cursor:default">
                    <div class="big jp">${esc(ch)}</div>
                    <div class="hint">로마자로 읽는 법을 입력하고 Enter</div>
                </div>
                <input class="kana-input" id="kana-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="예: ka">
                <div id="kana-feedback"></div>`;
            const input = $("#kana-input");
            input.focus();
            let done = false;
            input.onkeydown = (e) => {
                if (e.key !== "Enter" || e.isComposing) return;
                if (done) {
                    i++;
                    show();
                    return;
                }
                done = true;
                const ok = input.value.trim().toLowerCase() === romaji;
                if (ok) score++;
                logStudy();
                save();
                renderDashboard();
                input.readOnly = true;
                $("#kana-feedback").innerHTML = `<div class="feedback">${ok ? "⭕ 정답!" : `❌ 정답은 <strong>${romaji}</strong>`} ${speakBtn(ch)} — Enter로 다음</div>`;
                speak(ch);
            };
        };
        show();
    };

    // ---------- 오답노트 ----------
    const resolveWrong = (key) => {
        const [type, level, id] = key.split("|");
        if (type === "v") {
            const w = JLPT_VOCAB[level]?.find((x) => x[0] === id);
            return w && { type, level, w };
        }
        const i = Number(id);
        return JLPT_GRAMMAR[level]?.[i] && { type, level, i };
    };

    const renderWrong = () => {
        const area = $("#wrong-area");
        keyHandler = null;
        const items = Object.keys(state.wrong).map((k) => [k, resolveWrong(k)]).filter(([, v]) => v);
        if (!items.length) {
            area.innerHTML = `<p class="empty">오답이 없습니다. 퀴즈를 풀어 보세요!</p>`;
            return;
        }
        area.innerHTML = `
            <div class="actions" style="margin:0 0 12px"><button class="primary" id="wrong-retry">오답 ${items.length}개 다시 풀기</button></div>
            ${items.map(([, v]) => v.type === "v"
                ? `<div class="word-row"><span class="jp"><strong>${esc(v.w[0])}</strong></span><span class="jp">${esc(v.w[1])}</span><span>${esc(v.w[2])}</span><span class="badge">${v.level} 단어</span></div>`
                : `<div class="word-row" style="grid-template-columns:1fr auto"><span><span class="jp">${esc(JLPT_GRAMMAR[v.level][v.i].q.replace("＿＿", `【${JLPT_GRAMMAR[v.level][v.i].o[JLPT_GRAMMAR[v.level][v.i].a]}】`))}</span><br><span class="note-inline">${esc(JLPT_GRAMMAR[v.level][v.i].e)}</span></span><span class="badge">${v.level} 문법</span></div>`
            ).join("")}`;
        $("#wrong-retry").onclick = () => {
            const qs = shuffle(items).map(([, v]) => (v.type === "v" ? makeVocabQ(v.level, v.w, "meaning") : makeGrammarQ(v.level, v.i)));
            runQuiz(area, qs, renderWrong);
        };
    };

    $("#wrong-clear").onclick = () => {
        if (!Object.keys(state.wrong).length || !confirm("오답노트를 모두 비울까요?")) return;
        state.wrong = {};
        save();
        renderWrong();
        renderDashboard();
    };

    // ---------- 단어장 ----------
    const renderList = () => {
        keyHandler = null;
        const term = $("#list-search").value.trim().toLowerCase();
        const rows = words().filter((w) => !term || w.some((f) => f.toLowerCase().includes(term)));
        $("#list-area").innerHTML = rows.length
            ? rows.map((w) => {
                const box = state.srs[vocabKey(state.level, w)]?.box || 0;
                return `<div class="word-row">
                    <span class="jp"><strong>${esc(w[0])}</strong> ${speakBtn(w[1])}</span>
                    <span class="jp">${esc(w[1])}</span>
                    <span>${esc(w[2])}</span>
                    <span class="badge ${box >= 3 ? "learned" : ""}">${box ? `${box}단계` : "미학습"}</span>
                </div>`;
            }).join("")
            : `<p class="empty">검색 결과가 없습니다.</p>`;
    };
    $("#list-search").addEventListener("input", renderList);

    // ---------- 탭 / 레벨 ----------
    const renderers = { flash: renderFlash, vocab: renderVocab, grammar: renderGrammar, kana: renderKana, wrong: renderWrong, list: renderList };
    let currentTab = "flash";

    const openTab = (tab) => {
        currentTab = tab;
        document.querySelectorAll(".tab").forEach((b) => {
            b.classList.toggle("active", b.dataset.tab === tab);
            b.setAttribute("aria-selected", b.dataset.tab === tab);
        });
        document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${tab}`));
        renderers[tab]();
    };

    document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));
    document.querySelectorAll(".level").forEach((b) => (b.onclick = () => {
        state.level = b.dataset.level;
        save();
        flash = null;
        renderDashboard();
        openTab(currentTab);
    }));
    $("#vocab-mode").onchange = renderVocab;
    $("#kana-mode").onchange = renderKana;

    if (!LEVELS.includes(state.level)) state.level = "N5";
    renderDashboard();
    openTab("flash");
})();
