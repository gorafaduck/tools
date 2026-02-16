document.addEventListener('DOMContentLoaded', () => {
    setupFortune();
    setupRecommendation();
    setupSalaryCalculator();
    setupGpaCalculator();
});

function setupFortune() {
    const button = document.getElementById('fortune-button');
    const output = document.getElementById('fortune-output');
    const textEl = document.getElementById('fortune-text');
    const shareButton = document.getElementById('fortune-share');
    const urlInput = document.getElementById('fortune-url');
    const copyButton = document.getElementById('fortune-copy');
    const statusEl = document.getElementById('fortune-status');
    if (!button || !output || !textEl || !shareButton || !urlInput || !copyButton || !statusEl) {
        return;
    }

    const fortunes = [
        '오늘은 연락하지 마라.',
        '지금 자소서 써라.',
        '오늘은 고기 먹는 날이다.',
        '오늘은 고백하면 망한다.',
        '오늘은 퇴근 후 산책이 답이다.',
        '미뤄둔 일 하나만 끝내자.',
        '오늘은 깔끔하게 정리하는 날.',
        '지금은 쉬어도 된다.',
        '오늘은 책 10쪽만 읽자.',
        '집중력 최고치, 몰입하자.',
        '연락은 내일로 미뤄라.',
        '오늘은 새로운 시도를 해라.',
    ];

    let currentFortune = '';
    let isAnimating = false;

    button.addEventListener('click', () => {
        if (isAnimating) {
            return;
        }
        isAnimating = true;
        button.disabled = true;
        shareButton.disabled = true;
        copyButton.disabled = true;
        urlInput.classList.add('hidden');
        copyButton.classList.add('hidden');
        statusEl.textContent = '';
        output.classList.remove('hidden');
        output.classList.add('fortune-loading');
        textEl.textContent = '운명을 보는 중...';

        window.setTimeout(() => {
            currentFortune = fortunes[Math.floor(Math.random() * fortunes.length)];
            textEl.textContent = currentFortune;
            output.classList.remove('fortune-loading');
            shareButton.disabled = false;
            button.disabled = false;
            isAnimating = false;
        }, 1200);
    });

    shareButton.addEventListener('click', () => {
        if (!currentFortune) {
            return;
        }

        const url = window.location.href;
        urlInput.value = url;
        urlInput.classList.remove('hidden');
        copyButton.classList.remove('hidden');
        copyButton.disabled = false;
        statusEl.textContent = 'URL이 표시되었습니다.';
        urlInput.focus();
        urlInput.select();
    });

    copyButton.addEventListener('click', async () => {
        if (!urlInput.value) {
            return;
        }

        try {
            await navigator.clipboard.writeText(urlInput.value);
            statusEl.textContent = 'URL이 복사되었습니다.';
        } catch (error) {
            statusEl.textContent = '복사에 실패했습니다.';
        }
    });
}

function setupRecommendation() {
    const form = document.getElementById('recommend-form');
    const moodSelect = document.getElementById('mood');
    const timeInput = document.getElementById('available-time');
    const outputSection = document.getElementById('recommend-output');
    const titleEl = document.getElementById('recommend-title');
    const listEl = document.getElementById('recommend-list');
    if (!form || !moodSelect || !timeInput || !outputSection || !titleEl || !listEl) {
        return;
    }

    const moodLabels = {
        energized: '에너지 넘침',
        focused: '집중하고 싶음',
        neutral: '보통',
        tired: '지침/무기력',
        stressed: '스트레스',
        anxious: '불안/우울',
    };

    const plans = {
        energized: {
            short: ['빠른 공간 정리 10분', '가벼운 스트레칭 5분', '오늘 목표 1개 적기'],
            medium: ['산책 20분', '메일/메시지 처리 15분', '짧은 학습 콘텐츠 1개'],
            long: ['운동 40분', '미뤄둔 작업 하나 마무리', '가벼운 집안일 정리'],
            extended: ['프로젝트 딥워크 60분', '운동 + 샤워 루틴', '주간 계획 정리'],
        },
        focused: {
            short: ['작업 환경 정리 10분', '알림 끄고 타이머 15분', '오늘 가장 중요한 1개 선정'],
            medium: ['딥워크 25분 + 5분 휴식', '자료 1개 요약', '작업 우선순위 재정렬'],
            long: ['딥워크 45분 + 10분 휴식', '프로젝트 핵심 파트 진행', '집중 업무 블록 2회'],
            extended: ['90분 몰입 세션', '중요 과제 완성', '성과 정리 및 다음 단계 설정'],
        },
        neutral: {
            short: ['물 한 잔 + 호흡 2분', '간단한 할 일 1개 처리', '책상 정리 5분'],
            medium: ['산책 15분', '읽기 20분', '가벼운 정리/청소'],
            long: ['취미 활동 40분', '학습 콘텐츠 1개', '친구/가족 안부 연락'],
            extended: ['집중 작업 60분', '취미 프로젝트 진행', '주간 정리'],
        },
        tired: {
            short: ['눈 감고 휴식 5분', '스트레칭 5분', '물 + 가벼운 간식'],
            medium: ['짧은 낮잠 20분', '가벼운 산책 15분', '쉬운 일 1개 처리'],
            long: ['루틴 정리 + 휴식 15분', '가벼운 집안일', '따뜻한 샤워'],
            extended: ['휴식 중심 루틴', '컨디션 회복 계획', '가벼운 정리 후 쉬기'],
        },
        stressed: {
            short: ['호흡 4-7-8 3분', '간단한 스트레칭', '해야 할 일 1개만 정리'],
            medium: ['산책 20분', '감정 노트 10분', '조용한 음악 듣기'],
            long: ['운동 30분', '미팅/업무 정리', '차분한 정리 작업'],
            extended: ['긴 산책 + 휴식', '환경 정리', '다음 주 계획 가볍게 정리'],
        },
        anxious: {
            short: ['호흡 2분 + 물', '창문 열고 환기', '가벼운 스트레칭'],
            medium: ['산책 15분', '짧은 글쓰기', '편한 음악 듣기'],
            long: ['루틴 재정비 30분', '가벼운 정리 작업', '따뜻한 샤워'],
            extended: ['휴식 + 간단한 정리', '마음이 편해지는 활동', '가벼운 산책'],
        },
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const minutes = Number.parseInt(timeInput.value, 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            outputSection.classList.add('hidden');
            return;
        }

        const mood = moodSelect.value;
        const bucket = getTimeBucket(minutes);
        const suggestions = plans[mood][bucket];

        titleEl.textContent = `${moodLabels[mood]} · ${minutes}분`;
        listEl.innerHTML = suggestions.map((item) => `<li>${item}</li>`).join('');
        outputSection.classList.remove('hidden');
    });

    function getTimeBucket(minutes) {
        if (minutes <= 15) {
            return 'short';
        }
        if (minutes <= 30) {
            return 'medium';
        }
        if (minutes <= 60) {
            return 'long';
        }
        return 'extended';
    }
}

function setupSalaryCalculator() {
    const form = document.getElementById('salary-form');
    const annualSalaryInput = document.getElementById('annual-salary');
    const basicDeductionInput = document.getElementById('basic-deduction');
    const extraDeductionInput = document.getElementById('extra-deduction');
    const pensionRateInput = document.getElementById('pension-rate');
    const healthRateInput = document.getElementById('health-rate');
    const ltcRateInput = document.getElementById('ltc-rate');
    const employmentRateInput = document.getElementById('employment-rate');

    const resultsSection = document.getElementById('results');

    const netMonthlyEl = document.getElementById('net-monthly');
    const grossMonthlyEl = document.getElementById('gross-monthly');
    const insuranceMonthlyEl = document.getElementById('insurance-monthly');
    const incomeTaxMonthlyEl = document.getElementById('income-tax-monthly');
    const pensionMonthlyEl = document.getElementById('pension-monthly');
    const healthMonthlyEl = document.getElementById('health-monthly');
    const ltcMonthlyEl = document.getElementById('ltc-monthly');
    const employmentMonthlyEl = document.getElementById('employment-monthly');
    const incomeTaxAnnualEl = document.getElementById('income-tax-annual');
    if (
        !form
        || !annualSalaryInput
        || !basicDeductionInput
        || !extraDeductionInput
        || !pensionRateInput
        || !healthRateInput
        || !ltcRateInput
        || !employmentRateInput
        || !resultsSection
        || !netMonthlyEl
        || !grossMonthlyEl
        || !insuranceMonthlyEl
        || !incomeTaxMonthlyEl
        || !pensionMonthlyEl
        || !healthMonthlyEl
        || !ltcMonthlyEl
        || !employmentMonthlyEl
        || !incomeTaxAnnualEl
    ) {
        return;
    }

    const formatter = new Intl.NumberFormat('ko-KR');

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        calculate();
    });

    function toNumber(value) {
        const num = parseFloat(value);
        return Number.isFinite(num) ? num : 0;
    }

    function calculateIncomeTax(taxableIncome) {
        if (taxableIncome <= 0) {
            return 0;
        }

        const brackets = [
            { limit: 14000000, rate: 0.06, deduction: 0 },
            { limit: 50000000, rate: 0.15, deduction: 1260000 },
            { limit: 88000000, rate: 0.24, deduction: 5760000 },
            { limit: 150000000, rate: 0.35, deduction: 15440000 },
            { limit: 300000000, rate: 0.38, deduction: 19940000 },
            { limit: 500000000, rate: 0.40, deduction: 25940000 },
            { limit: 1000000000, rate: 0.42, deduction: 35940000 },
            { limit: Infinity, rate: 0.45, deduction: 65940000 },
        ];

        const bracket = brackets.find((item) => taxableIncome <= item.limit) || brackets[brackets.length - 1];
        const tax = (taxableIncome * bracket.rate) - bracket.deduction;
        return Math.max(0, Math.round(tax));
    }

    function formatMoney(value) {
        return `${formatter.format(Math.round(value))}원`;
    }

    function calculate() {
        const annualSalary = toNumber(annualSalaryInput.value);
        if (annualSalary <= 0) {
            resultsSection.classList.add('hidden');
            return;
        }

        const basicDeduction = toNumber(basicDeductionInput.value);
        const extraDeduction = toNumber(extraDeductionInput.value);
        const pensionRate = toNumber(pensionRateInput.value) / 100;
        const healthRate = toNumber(healthRateInput.value) / 100;
        const ltcRate = toNumber(ltcRateInput.value) / 100;
        const employmentRate = toNumber(employmentRateInput.value) / 100;

        const pensionAnnual = annualSalary * pensionRate;
        const healthAnnual = annualSalary * healthRate;
        const ltcAnnual = healthAnnual * ltcRate;
        const employmentAnnual = annualSalary * employmentRate;

        const insuranceAnnual = pensionAnnual + healthAnnual + ltcAnnual + employmentAnnual;
        const taxableIncome = Math.max(0, annualSalary - insuranceAnnual - basicDeduction - extraDeduction);
        const incomeTaxAnnual = calculateIncomeTax(taxableIncome);

        const monthlySalary = annualSalary / 12;
        const insuranceMonthly = insuranceAnnual / 12;
        const incomeTaxMonthly = incomeTaxAnnual / 12;
        const netMonthly = monthlySalary - insuranceMonthly - incomeTaxMonthly;

        netMonthlyEl.textContent = formatMoney(netMonthly);
        grossMonthlyEl.textContent = formatMoney(monthlySalary);
        insuranceMonthlyEl.textContent = formatMoney(insuranceMonthly);
        incomeTaxMonthlyEl.textContent = formatMoney(incomeTaxMonthly);

        pensionMonthlyEl.textContent = formatMoney(pensionAnnual / 12);
        healthMonthlyEl.textContent = formatMoney(healthAnnual / 12);
        ltcMonthlyEl.textContent = formatMoney(ltcAnnual / 12);
        employmentMonthlyEl.textContent = formatMoney(employmentAnnual / 12);
        incomeTaxAnnualEl.textContent = formatMoney(incomeTaxAnnual);

        resultsSection.classList.remove('hidden');
    }
}

function setupGpaCalculator() {
    const courseForm = document.getElementById('course-form');
    const courseNameInput = document.getElementById('course-name');
    const creditsInput = document.getElementById('credits');
    const gradeSelect = document.getElementById('grade');
    const courseList = document.getElementById('course-list');
    const gpaDisplay = document.getElementById('gpa-display');
    if (!courseForm || !courseNameInput || !creditsInput || !gradeSelect || !courseList || !gpaDisplay) {
        return;
    }

    const courses = [];

    courseForm.addEventListener('submit', (event) => {
        event.preventDefault();
        addCourse();
    });

    function addCourse() {
        const name = courseNameInput.value.trim();
        const credits = parseFloat(creditsInput.value);
        const grade = parseFloat(gradeSelect.value);

        if (!name || Number.isNaN(credits) || Number.isNaN(grade)) {
            return;
        }

        courses.push({ name, credits, grade, gradeLabel: gradeSelect.options[gradeSelect.selectedIndex].text });
        renderCourseList();
        updateGPADisplay();
        courseForm.reset();
        courseNameInput.focus();
    }

    function renderCourseList() {
        courseList.innerHTML = '';

        if (courses.length === 0) {
            courseList.innerHTML = '<p class="empty">과목을 추가하면 목록이 표시됩니다.</p>';
            return;
        }

        courses.forEach((course, index) => {
            const courseItem = document.createElement('div');
            courseItem.classList.add('course-item');
            courseItem.innerHTML = `
                <span>${course.name} (${course.credits}학점) - ${course.gradeLabel}</span>
                <button type="button" class="ghost" data-index="${index}">삭제</button>
            `;
            courseList.appendChild(courseItem);
        });
    }

    courseList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const index = target.dataset.index;
        if (index === undefined) {
            return;
        }

        courses.splice(Number(index), 1);
        renderCourseList();
        updateGPADisplay();
    });

    function updateGPADisplay() {
        if (courses.length === 0) {
            gpaDisplay.innerHTML = '<p class="empty">GPA가 여기 표시됩니다.</p>';
            return;
        }

        const totalCredits = courses.reduce((sum, course) => sum + course.credits, 0);
        const totalGradePoints = courses.reduce((sum, course) => sum + (course.credits * course.grade), 0);
        const gpa = totalGradePoints / totalCredits;

        gpaDisplay.textContent = `GPA: ${gpa.toFixed(2)}`;
    }

    renderCourseList();
    updateGPADisplay();
}
