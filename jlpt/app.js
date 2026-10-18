(() => {
    const STORE_KEY = "jlpt-study-v1";
    const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
    const SRS_DAYS = [0, 1, 2, 4, 7, 15]; // box 번호별 다음 복습까지 일수
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
        const base = { level: "N5", srs: {}, wrong: {}, days: {}, roadmap: {}, furigana: true, newPerDay: 10 };
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
    const isKanaOnly = (w) => w[0] === w[1];
    // 초보 모드: 한자 위에 읽는 법을 작게 표시
    const withFuri = (w, cls = "big") => (state.furigana && !isKanaOnly(w)
        ? `<div class="furi jp">${esc(w[1])}</div><div class="${cls} jp">${esc(w[0])}</div>`
        : `<div class="${cls} jp">${esc(w[0])}</div>`);

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
        const fresh = list.filter((w) => !state.srs[vocabKey(level, w)]).slice(0, state.newPerDay);
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
            <div class="scoreline"><span>${flash.i + 1} / ${flash.deck.length}${w[3] ? ` · ${esc(w[3])}` : ""}</span><span>${s ? `단계 ${s.box}` : "새 단어"}</span></div>
            <div class="flashcard" id="card" tabindex="0">
                ${flash.flipped ? `<div class="big jp">${esc(w[0])}</div>` : withFuri(w)}
                ${flash.flipped
                    ? `<div class="reading jp">${isKanaOnly(w) ? "" : esc(w[1])} ${speakBtn(w[1])}</div><div class="meaning">${esc(w[2])}</div>`
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
            furi: mode === "meaning" && state.furigana && !isKanaOnly(w) ? w[1] : "",
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
                ${q.furi ? `<div class="furi jp" style="text-align:center">${esc(q.furi)}</div>` : ""}
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
        // 읽기 문제에서는 가나로만 된 단어(문제 = 정답)를 제외
        const pool = mode === "reading" ? words().filter((w) => !isKanaOnly(w)) : words();
        const qs = shuffle(pool).slice(0, QUIZ_LENGTH).map((w) => makeVocabQ(state.level, w, mode));
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
    const romajiOk = (input, romaji) => {
        const v = input.trim().toLowerCase();
        return v === romaji || (ROMAJI_ALT[romaji] || []).includes(v);
    };

    $("#kana-range").innerHTML = KANA_RANGES.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join("");

    const kanaPool = () => {
        const r = KANA_RANGES.find((x) => x.id === $("#kana-range").value) || KANA_RANGES[0];
        if (r.yoon) return KANA_YOON;
        return [...KANA_BASE.slice(r.from, r.to), ...(r.withYoon ? KANA_YOON : [])];
    };

    const renderKanaChart = () => {
        const kata = $("#kana-mode").value === "kata";
        const conv = (c) => (kata ? toKata(c) : c);
        const cell = (k) => (k
            ? `<button class="kana-cell" data-speak="${esc(k[0])}"><b class="jp">${esc(conv(k[0]))}</b><small>${k[1]}</small></button>`
            : `<span class="kana-cell empty-cell"></span>`);
        const find = (c) => KANA_BASE.find((k) => k[0] === c);
        // 표 모양을 맞추기 위해 빈 칸(null) 포함
        const rows = [
            "あいうえお", "かきくけこ", "さしすせそ", "たちつてと", "なにぬねの", "はひふへほ", "まみむめも",
            "や ゆ よ", "らりるれろ", "わ   を", "ん    "
        ];
        const daku = ["がぎぐげご", "ざじずぜぞ", "だ  でど", "ばびぶべぼ", "ぱぴぷぺぽ"];
        const grid = (lines) => lines.map((l) => [...l.padEnd(5)].map((c) => cell(c === " " ? null : find(c))).join("")).join("");
        $("#kana-chart").innerHTML = `
            <p class="chart-title">기본 (청음)</p><div class="kana-grid">${grid(rows)}</div>
            <p class="chart-title">탁음·반탁음</p><div class="kana-grid">${grid(daku)}</div>
            <p class="chart-title">요음</p><div class="kana-grid yoon">${KANA_YOON.map(cell).join("")}</div>`;
    };

    const renderKana = () => {
        const area = $("#kana-area");
        const mode = $("#kana-mode").value;
        renderKanaChart();
        const pool = kanaPool();
        const deck = shuffle(pool).slice(0, Math.min(20, pool.length)).map(([h, r]) => {
            const kata = mode === "kata" || (mode === "mix" && Math.random() < 0.5);
            return [kata ? toKata(h) : h, r, h];
        });
        let i = 0;
        let score = 0;
        const missed = [];
        keyHandler = null;

        // 입력창은 세션 동안 하나만 두고 재사용: 모바일에서 다시 그리면 키보드가 닫히기 때문
        area.innerHTML = `
            <div class="scoreline"><span id="kana-count"></span><span id="kana-score"></span></div>
            <div class="flashcard" style="min-height:160px;cursor:default">
                <div class="big jp" id="kana-char"></div>
                <div class="hint">로마자로 읽는 법을 입력하고 확인 (모르면 비워 두고 확인)</div>
            </div>
            <form class="kana-form" id="kana-form" autocomplete="off">
                <input class="kana-input" id="kana-input" type="text" inputmode="latin" lang="en" enterkeyhint="go"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="예: ka" aria-label="로마자 입력">
                <button type="submit" class="primary" id="kana-submit">확인</button>
            </form>
            <div id="kana-feedback"></div>`;
        const form = $("#kana-form");
        const input = $("#kana-input");
        const submitBtn = $("#kana-submit");
        let done = false;

        // 버튼을 눌러도 입력창 포커스(=모바일 키보드)가 유지되도록
        submitBtn.addEventListener("pointerdown", (e) => e.preventDefault());

        const finish = () => {
            input.blur();
            area.innerHTML = `<div class="feedback"><strong>${deck.length}개 중 ${score}개 정답</strong>
                ${missed.length ? `<br>다시 볼 글자: <span class="jp">${missed.map((m) => `${esc(m[0])}(${m[1]})`).join(" · ")}</span>` : "<br>완벽해요! 다음 범위로 넘어가 보세요."}</div>
                <div class="actions"><button class="primary" id="kana-again">다시 하기</button></div>`;
            $("#kana-again").onclick = renderKana;
        };

        const show = () => {
            if (i >= deck.length) {
                finish();
                return;
            }
            done = false;
            $("#kana-count").textContent = `${i + 1} / ${deck.length}`;
            $("#kana-score").textContent = `정답 ${score}`;
            $("#kana-char").textContent = deck[i][0];
            $("#kana-feedback").innerHTML = "";
            input.value = "";
            input.setAttribute("enterkeyhint", "go");
            submitBtn.textContent = "확인";
        };

        const check = () => {
            const [ch, romaji, hira] = deck[i];
            done = true;
            const ok = romajiOk(input.value, romaji);
            if (ok) score++;
            else missed.push([ch, romaji]);
            logStudy();
            save();
            renderDashboard();
            $("#kana-score").textContent = `정답 ${score}`;
            input.setAttribute("enterkeyhint", "next");
            submitBtn.textContent = i + 1 < deck.length ? "다음" : "결과 보기";
            $("#kana-feedback").innerHTML = `<div class="feedback">${ok ? "⭕ 정답!" : `❌ 정답은 <strong>${romaji}</strong>`} ${speakBtn(hira)}</div>`;
            speak(hira);
        };

        // 모바일 키보드의 Enter(이동/완료)와 버튼 탭 모두 submit으로 들어옴
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (!done) {
                check();
            } else {
                i++;
                show();
            }
        });
        // 정답 확인 후 입력이 바뀌지 않도록 (readOnly는 iOS에서 키보드를 닫아서 사용하지 않음)
        // Enter(insertLineBreak)까지 막으면 submit이 안 되므로 글자 입력만 막음
        input.addEventListener("beforeinput", (e) => {
            if (done && e.inputType !== "insertLineBreak") e.preventDefault();
        });

        show();
        input.focus();
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
        const cats = [...new Set(words().map((w) => w[3]).filter(Boolean))];
        const catSel = $("#list-cat");
        const prevCat = catSel.value;
        catSel.innerHTML = `<option value="">전체 주제</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}`;
        catSel.value = cats.includes(prevCat) ? prevCat : "";
        catSel.classList.toggle("hidden", !cats.length);
        const cat = catSel.value;
        const term = $("#list-search").value.trim().toLowerCase();
        const rows = words().filter((w) => (!cat || w[3] === cat) && (!term || w.slice(0, 3).some((f) => f.toLowerCase().includes(term))));
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
    $("#list-cat").addEventListener("change", renderList);

    // ---------- 로드맵 ----------
    const ROADMAP = [
        { id: "hira", week: "1주차", title: "히라가나 46자", desc: "50음도 표로 먼저 눈에 익히고, あ~そ → た~ほ → ま~ん 순서로 범위를 나눠 연습하세요. 모든 공부의 기초입니다.", go: ["kana", "hira", "a-so"] },
        { id: "hira2", week: "1~2주차", title: "탁음·반탁음·요음 (が, ぱ, きゃ…)", desc: "기본 46자를 거의 맞히게 되면 넘어가세요.", go: ["kana", "hira", "dakuon"] },
        { id: "kata", week: "2주차", title: "가타카나", desc: "외래어(コーヒー, テレビ…)에 쓰입니다. 히라가나와 같은 소리라 더 빨리 외워집니다.", go: ["kana", "kata", "basic"] },
        { id: "w1", week: "3주차", title: "기초 단어: 인사·지시어·숫자·시간", desc: "플래시카드는 주제 순서대로 새 단어를 꺼냅니다. 매일 새 단어 + 복습 대기 카드를 0으로 만드세요.", go: ["flash"] },
        { id: "g1", week: "3~4주차", title: "조사: は・が・を・に・で・へ・と・の・から・まで", desc: "N5 문법 문제의 절반이 조사입니다. 문법 퀴즈 해설을 꼭 읽어 보세요.", go: ["grammar"] },
        { id: "w2", week: "4주차", title: "단어: 사람·장소·음식·물건", desc: "단어장에서 주제별로 훑어본 뒤 플래시카드로 외우세요.", go: ["list"] },
        { id: "g2", week: "5주차", title: "동사 ます형·て형, 형용사 활용", desc: "～ます/ました/ません, ～てください, ～ています, い형용사 ～くない, な형용사 ～な+명사.", go: ["grammar"] },
        { id: "w3", week: "5~6주차", title: "단어: 자연·동사·형용사·부사", desc: "동사와 형용사는 활용과 함께 외우면 문법 문제도 같이 풀립니다.", go: ["flash"] },
        { id: "g3", week: "6~7주차", title: "문법 퀴즈 80% 이상", desc: "여러 번 반복해서 모든 문제를 맞힐 때까지. 틀린 것은 오답노트로 모입니다.", go: ["grammar"] },
        { id: "real", week: "7주차", title: "청해·독해 실전 연습", desc: "JLPT 공식 사이트(jlpt.jp)의 N5 샘플 문제로 시험 형식에 익숙해지세요. 청해는 매일 조금씩 듣는 것이 좋습니다.", go: null },
        { id: "final", week: "시험 주", title: "오답노트 비우기 + 복습 대기 0", desc: "새로운 것보다 틀렸던 것을 확실히. 시험 전날은 가볍게 단어만 훑으세요.", go: ["wrong"] }
    ];

    const renderRoad = () => {
        keyHandler = null;
        const done = ROADMAP.filter((r) => state.roadmap[r.id]).length;
        $("#road-progress").textContent = `${done} / ${ROADMAP.length} 완료`;

        const exam = nextExamDate();
        const daysLeft = exam ? Math.round((exam - new Date().setHours(0, 0, 0, 0)) / 86400000) : 0;
        const n5 = JLPT_VOCAB.N5;
        const unseen = n5.filter((w) => !state.srs[vocabKey("N5", w)]).length;
        // 가나 2주 + 마지막 1주를 빼고 남은 날에 새 단어를 나눔
        const studyDays = Math.max(1, daysLeft - (state.roadmap.kata ? 0 : 14) - 7);
        const perDay = Math.ceil(unseen / studyDays);
        $("#road-pace").innerHTML = exam
            ? `시험까지 <strong>${daysLeft}일</strong>. 남은 N5 단어 ${unseen}개를 시험 1주 전까지 한 바퀴 돌리려면 <strong>하루 새 단어 약 ${perDay}개</strong>가 필요해요.
               ${perDay > state.newPerDay ? `<br>지금 설정(${state.newPerDay}개)보다 많습니다. 위의 “하루 새 단어” 설정을 올려 보세요.` : ""}
               <br><span class="note-inline">이 앱의 단어는 N5 핵심 ${n5.length}개입니다. 실제 시험 범위(약 700~800개)는 교재로 보충하세요.</span>`
            : "";

        $("#road-area").innerHTML = ROADMAP.map((r) => `
            <li class="${state.roadmap[r.id] ? "done" : ""}">
                <input type="checkbox" data-road="${r.id}" ${state.roadmap[r.id] ? "checked" : ""} aria-label="${esc(r.title)} 완료">
                <div><div class="road-week">${r.week}</div><div class="road-title">${esc(r.title)}</div><div class="road-desc">${esc(r.desc)}</div></div>
                ${r.go ? `<button class="ghost" data-go="${r.id}">시작</button>` : `<a class="ghost" href="https://www.jlpt.jp/samples/forlearners.html" target="_blank" rel="noopener noreferrer">샘플</a>`}
            </li>`).join("");

        $("#road-area").querySelectorAll("[data-road]").forEach((c) => (c.onchange = () => {
            if (c.checked) state.roadmap[c.dataset.road] = true;
            else delete state.roadmap[c.dataset.road];
            save();
            renderRoad();
        }));
        $("#road-area").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
            const [tab, kanaMode, range] = ROADMAP.find((r) => r.id === b.dataset.go).go;
            if (state.level !== "N5") setLevel("N5");
            if (tab === "kana") {
                $("#kana-mode").value = kanaMode;
                $("#kana-range").value = range;
                $("#kana-chart-wrap").open = true;
            }
            openTab(tab);
            document.querySelector(".tabs").scrollIntoView({ behavior: "smooth" });
        }));
    };

    // ---------- 탭 / 레벨 ----------
    const renderers = { road: renderRoad, flash: renderFlash, vocab: renderVocab, grammar: renderGrammar, kana: renderKana, wrong: renderWrong, list: renderList };
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
    const setLevel = (level) => {
        state.level = level;
        save();
        flash = null;
        renderDashboard();
    };
    document.querySelectorAll(".level").forEach((b) => (b.onclick = () => {
        setLevel(b.dataset.level);
        openTab(currentTab);
    }));
    $("#vocab-mode").onchange = renderVocab;
    $("#kana-mode").onchange = renderKana;
    $("#kana-range").onchange = renderKana;

    $("#opt-furigana").checked = state.furigana;
    $("#opt-furigana").onchange = (e) => {
        state.furigana = e.target.checked;
        save();
        openTab(currentTab);
    };
    $("#opt-new").value = String(state.newPerDay);
    $("#opt-new").onchange = (e) => {
        state.newPerDay = Number(e.target.value);
        save();
        flash = null;
        openTab(currentTab);
    };

    if (!LEVELS.includes(state.level)) state.level = "N5";
    renderDashboard();
    // 학습 기록이 없으면 로드맵부터
    openTab(Object.keys(state.days).length ? "flash" : "road");
})();
