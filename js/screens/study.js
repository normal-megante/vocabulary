// =========================================================
// 学習画面：めくる・4択・入力
//
// 流れ：出し方を選ぶ → 問題 → 答える → 次の問題 … → 結果
//   めくる … タップで答えを見て「忘れてた／あやしい／覚えてた」
//   4択   … 4つから選ぶ → 正解を見せて「次へ」（正解は半分の重さ：srs.js）
//   入力   … 答えを打ち込む → 答え合わせ →「次へ」（打ち間違いは「合ってたことにする」）
// 1問ごとに保存するので、途中でやめても、それまでの分は記録されます。
// （4択・入力は「次へ」を押したときに保存）
// 夜中の猶予の時間に、前の日のきょうのぶんがまだなら、前の日の分として数えます（stamps.js）。
// めくる・入力の問題では、アイテム（💡 ヒント・🔢 選択肢表示）を使えます。
//   使って答えた単語は、正解でも段階を上げずに明日もう一度出します（srs.js の assisted）。
// 問題・答え・例文の 🔊 で読み上げ。単語帳の「自動で読む」がオンなら、問題が出たときと答えが出たときに読みます（speech.js）。
// =========================================================
import {
  getDeck, updateDeck, listCards, listProgress, getDaily, recordAnswer, getSettings, getStudyDay, claimTrophies,
  getWallet, useItem,
} from '../data.js';
import { isAchieved } from '../stamps.js';
import { bingoMessage } from '../bingo.js';
import { achievementEvents, trophyMessages } from '../trophies.js';
import { buildQueue, schedule, nextLabel, isNew } from '../srs.js';
import {
  FORMATS, buildChoices, canUseChoice, checkTyped, compareKey, pickFormat, questionOf, answerOf, hintOf,
} from '../quiz.js';
import { escapeHtml } from '../util.js';
import { showToast } from '../ui.js';
import { GOAL_LABEL, EXTRA_SESSION_SIZE, REASK_GAP, ITEMS, ASSIST_INTERVAL } from '../defaults.js';
import { canSpeak, deckLang, speak, stopSpeaking } from '../speech.js';

export const title = '学習';

const DIR_LABELS = { f: '表 → 裏', b: '裏 → 表' };

// 自己採点のボタン（key は PC のキーボードで押すときの数字）
const GRADES = [
  { grade: 'again', emoji: '😣', label: '忘れてた', key: '1' },
  { grade: 'hard', emoji: '🤔', label: 'あやしい', key: '2' },
  { grade: 'good', emoji: '😊', label: '覚えてた', key: '3' },
];

// 結果画面の言葉（出し方ごと）
const RESULT_LABELS = {
  flip: [['right', '😊 覚えてた'], ['hard', '🤔 あやしい'], ['wrong', '😣 忘れてた']],
  choice: [['right', '⭕ 正解'], ['wrong', '❌ 不正解']],
  type: [['right', '⭕ 正解'], ['wrong', '❌ 不正解']],
  auto: [['right', '😊 できた'], ['hard', '🤔 あやしい'], ['wrong', '😣 できなかった']],
};

export async function render(el, { params, setTitle, signal }) {
  const [deckId] = params;
  const deck = await getDeck(deckId);
  if (!deck) {
    el.innerHTML = `
      <p class="empty">この単語帳は見つかりませんでした。</p>
      <a class="btn block" href="#/home">ホームへ</a>`;
    return;
  }
  setTitle(deck.name);

  const cards = await listCards(deck.id);
  if (cards.length === 0) {
    el.innerHTML = `
      <section class="card hero">
        <p class="hero-emoji">📭</p>
        <h2>単語がありません</h2>
        <p>まずは単語を登録しましょう。</p>
        <a class="btn primary" href="#/decks/${encodeURIComponent(deck.id)}/import">一括登録へ</a>
      </section>`;
    return;
  }
  const choiceOk = canUseChoice(cards, deck.directions);
  const { graceHour, speechRate } = await getSettings();
  const speakable = canSpeak();
  signal.addEventListener('abort', stopSpeaking); // 画面を離れたら、読み上げを止める

  // 今回の学習のようす
  const session = {
    format: deck.studyFormat, // 選んだ出し方（flip / choice / type / auto）
    day: null,                // 数える日（'2026-11-04' の形。夜中は前の日のこともある）
    late: false,              // 前の日の分として数えているか
    queue: [],                // 出す問題の列
    index: 0,                 // いま何問目か
    answered: 0,              // 今回答えた数
    results: { right: 0, hard: 0, wrong: 0, assisted: 0 }, // assisted：アイテムを使って答えた数
    stamp: null,              // 今回スタンプをもらったら { gold }
    items: { hint: 0, choices: 0 }, // 持っているアイテムの数（使ったら減らす）
  };
  let mode = 'picker'; // いまの画面：picker（出し方選び）/ question（問題）/ other
  let current = null;  // いま出している問題のようす
  let busy = false;    // 保存中（ボタンの連打よけ）
  let assisting = false; // アイテムを使っている途中

  // ---- 出す問題の列を作る ----
  async function makeQueue() {
    const { day, late } = await getStudyDay(deck, graceHour);
    const [progressList, daily] = await Promise.all([listProgress(deck.id), getDaily(deck.id, day)]);
    const remaining = remainingOf(daily);
    const queue = buildQueue({
      cards,
      progressList,
      directions: deck.directions,
      today: day,
      newLimit: deck.newPerDay - daily.newCount,
      size: remaining > 0 ? remaining : EXTRA_SESSION_SIZE,
    });
    return { queue, daily, remaining, day, late };
  }

  // きょうのぶんの残りの問題数（達成ずみ・設定なしなら 0）
  function remainingOf(daily) {
    if (deck.dailyGoal <= 0 || isAchieved(daily)) return 0;
    return Math.max(0, deck.dailyGoal - daily.answered);
  }

  // 「今日」か「昨日」か
  const dayWord = (late) => (late ? '昨日' : '今日');

  // ---- 出し方を選ぶ画面 ----
  async function showPicker() {
    const { queue, daily, remaining, late } = await makeQueue();
    if (queue.length === 0) {
      showNothing();
      return;
    }
    mode = 'picker';
    current = null;
    let goalText;
    if (deck.dailyGoal <= 0) goalText = `${dayWord(late)}は ${daily.answered}問（「${GOAL_LABEL}」の設定なし）`;
    else if (remaining > 0) goalText = `${dayWord(late)}は ${daily.answered}問・あと${remaining}問で「${GOAL_LABEL}」達成`;
    else goalText = `${dayWord(late)}の「${GOAL_LABEL}」は達成ずみ！（${daily.answered}問）`;
    el.innerHTML = `
      <section class="card">
        <h2>出し方を選ぶ</h2>
        ${late ? `<p class="late-note">🌙 いまは昨日の分として数えています（午前${graceHour}時まで）</p>` : ''}
        <p class="muted">${escapeHtml(goalText)}</p>
        <div class="format-list">
          ${FORMATS.map((f, i) => {
            const disabled = f.id === 'choice' && !choiceOk;
            const last = f.id === session.format;
            return `
              <button class="format-btn${last ? ' last' : ''}" type="button" data-format="${f.id}" ${disabled ? 'disabled' : ''}
                      aria-keyshortcuts="${i + 1}">
                <span class="format-emoji" aria-hidden="true">${f.emoji}</span>
                <span class="format-text">
                  <b>${f.label}</b>
                  <span class="muted">${disabled ? '答えのちがう単語が4語以上あると使えます' : f.note}</span>
                </span>
                ${last ? '<span class="tag">前回</span>' : ''}
              </button>`;
          }).join('')}
        </div>
      </section>`;
    el.querySelectorAll('[data-format]').forEach((button) => {
      button.addEventListener('click', () => pick(button.dataset.format));
    });
  }

  function pick(format) {
    if (mode !== 'picker' || (format === 'choice' && !choiceOk)) return;
    mode = 'starting'; // 2回押しても1回だけ始まるように
    session.format = format;
    // 次に開いたとき「前回」として目印を付けるため、単語帳に覚えておく
    if (deck.studyFormat !== format) {
      deck.studyFormat = format;
      updateDeck(deck.id, { studyFormat: format }).catch((error) => console.error(error));
    }
    startSession();
  }

  // ---- 学習を始める（「続ける」でもここから） ----
  async function startSession() {
    const [{ queue, day, late }, wallet] = await Promise.all([makeQueue(), getWallet()]);
    session.queue = queue;
    session.day = day;
    session.late = late;
    session.index = 0;
    session.answered = 0;
    session.results = { right: 0, hard: 0, wrong: 0, assisted: 0 };
    session.stamp = null;
    session.items = { hint: wallet.items.hint ?? 0, choices: wallet.items.choices ?? 0 };
    if (queue.length === 0) {
      showNothing();
    } else {
      showQuestion();
    }
  }

  // ---- 問題を表示する ----
  function showQuestion() {
    mode = 'question';
    const item = session.queue[session.index];
    const wantsChoices = session.format === 'choice' || session.format === 'auto';
    const choices = wantsChoices ? buildChoices(item.card, item.dir, cards) : null;
    const format = pickFormat(session.format, Boolean(choices));
    current = {
      item, format, choices, revealed: false, answered: false, pending: null,
      assist: { hint: false, choices: false }, // この問題で使ったアイテム
      // 選択肢表示（4択にする）を使えるか：めくる・入力で、4択を作れる単語のとき
      canChoices: format !== 'choice' && Boolean(choices || buildChoices(item.card, item.dir, cards)),
    };
    drawQuestion(true);
  }

  // アイテムを使ったか
  const isAssisted = () => Boolean(current && (current.assist.hint || current.assist.choices));

  // いまの問題を画面に書く（animateIn：横から出てくる動きをつけるか）
  function drawQuestion(animateIn) {
    const { item, format } = current;
    const question = questionOf(item.card, item.dir);
    const answer = answerOf(item.card, item.dir);
    const percent = Math.round((session.index / session.queue.length) * 100);

    let badge = '';
    if (isNew(item.progress)) badge = '<span class="tag new">NEW</span>';
    else if (item.kind === 'reask') badge = '<span class="tag again">もう一度</span>';
    let formatTag = '';
    if (current.assist.choices) formatTag = `<span class="tag assist">${ITEMS.choices.icon} 4択にした</span>`;
    else if (session.format === 'auto') formatTag = `<span class="tag">${FORMATS.find((f) => f.id === format).label}</span>`;

    // 読み上げる文字と言語（読まない・読めないときは lang が null）
    const example = item.card.example;
    current.speech = speakable ? {
      question: { text: question, lang: deckLang(deck, item.dir === 'f' ? 'front' : 'back', question) },
      answer: { text: answer, lang: deckLang(deck, item.dir === 'f' ? 'back' : 'front', answer) },
      example: { text: example, lang: deckLang(deck, 'example', example) },
    } : null;

    // 答えのあとに見せる例文・メモ（4択では答えの文字は選択肢にあるので出さない）
    const details = `
      ${example ? `<div class="card-example">${escapeHtml(example)}${speakButton('example', '例文を読み上げる')}</div>` : ''}
      ${item.card.note ? `<div class="card-note">📝 ${escapeHtml(item.card.note)}</div>` : ''}`;
    const answerBlock = format === 'choice' && !details.trim() ? '' : `
      <div class="card-answer" hidden>
        ${format === 'choice' ? '' : `
          <div class="speak-line">
            <div class="card-answer-text ${sizeClass(answer)}">${escapeHtml(answer)}</div>
            ${speakButton('answer', '答えを読み上げる')}
          </div>`}
        ${details}
      </div>`;

    const cardAttrs = format === 'flip'
      ? 'class="card flashcard" id="flashcard" role="button" tabindex="0" aria-label="答えを見る"'
      : 'class="card flashcard quiz" id="flashcard"';

    el.innerHTML = `
      <div class="study">
        <div class="study-top">
          <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
          <span class="study-count">${session.index + 1} / ${session.queue.length}</span>
        </div>

        <section ${cardAttrs}>
          <div class="card-tags"><span class="tag">${DIR_LABELS[item.dir]}</span>${formatTag}${badge}</div>
          <div class="speak-line">
            <div class="card-question ${sizeClass(question)}">${escapeHtml(question)}</div>
            ${speakButton('question', '問題を読み上げる')}
          </div>
          <div class="hint-slot">${current.assist.hint ? hintHtml(answer) : ''}</div>
          ${answerBlock}
          ${format === 'flip' ? '<p class="tap-hint">タップして答えを見る</p>' : ''}
        </section>

        <div class="assist-row" id="assist-row" hidden></div>
        ${format === 'flip' ? flipActions(item) : ''}
        ${format === 'choice' ? choiceActions(current.choices) : ''}
        ${format === 'type' ? typeActions() : ''}
      </div>`;

    if (format === 'flip') setupFlip();
    if (format === 'choice') setupChoice();
    if (format === 'type') setupType();
    updateAssistRow();

    if (animateIn) {
      animate(el.querySelector('#flashcard'), [
        { opacity: 0, transform: 'translateX(24px)' },
        { opacity: 1, transform: 'none' },
      ], 180);
      // 新しい問題：前の読み上げを止めて、「自動で読む」なら問題を読む
      stopSpeaking();
      if (deck.autoSpeak) speakPart('question');
    }
  }

  // =======================================================
  // 読み上げ（🔊）
  // =======================================================
  function speakButton(part, label) {
    if (!current?.speech?.[part]?.lang) return '';
    return `<button class="speak-btn" type="button" data-speak="${part}" aria-label="${label}">🔊</button>`;
  }

  // part：'question' / 'answer' / 'example'
  function speakPart(part) {
    const target = current?.speech?.[part];
    if (target?.lang) speak(target.text, target.lang, { rate: speechRate });
  }

  // 答えが出たとき（めくった・答えた）：「自動で読む」なら答えを読む
  function autoSpeakAnswer() {
    if (deck.autoSpeak) speakPart('answer');
  }

  // 🔊 を押したとき（カードをタップしたことにならないように、先に受け取って止める）
  el.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-speak]');
    if (!button || !el.contains(button)) return;
    event.stopPropagation();
    speakPart(button.dataset.speak);
  }, { capture: true, signal });

  // =======================================================
  // アイテム（💡 ヒント・🔢 選択肢表示）
  // =======================================================

  // アイテムのボタンの列（めくる：めくる前／入力：答える前だけ。どちらも持っていなければ出さない）
  function updateAssistRow() {
    const row = el.querySelector('#assist-row');
    if (!row || !current) return;
    const open = (current.format === 'flip' && !current.revealed) || (current.format === 'type' && !current.answered);
    const owns = session.items.hint > 0 || session.items.choices > 0;
    row.hidden = !open || !(owns || isAssisted());
    if (row.hidden) {
      row.innerHTML = '';
      return;
    }
    row.innerHTML = assistButton('hint', 'ヒント') + (current.canChoices ? assistButton('choices', '4択にする') : '');
    row.querySelectorAll('[data-assist]').forEach((button) => {
      button.addEventListener('click', () => useAssist(button.dataset.assist));
    });
  }

  function assistButton(kind, label) {
    const used = current.assist[kind];
    const count = session.items[kind];
    const note = used ? '使用中' : `×${count}`;
    return `
      <button class="btn small assist-btn" type="button" data-assist="${kind}" ${used || count <= 0 ? 'disabled' : ''}
              aria-label="${ITEMS[kind].name}を使う（のこり${count}${ITEMS[kind].unit}）">
        <span aria-hidden="true">${ITEMS[kind].icon}</span>${label}<span class="assist-count">${note}</span>
      </button>`;
  }

  // アイテムを1つ使う
  async function useAssist(kind) {
    if (!current || busy || assisting || current.assist[kind]) return;
    if (current.format === 'flip' ? current.revealed : current.answered) return;
    const { item } = current;
    const built = kind === 'choices' ? (current.choices ?? buildChoices(item.card, item.dir, cards)) : null;
    if (kind === 'choices' && !built) return;

    assisting = true;
    let result;
    try {
      result = await useItem(kind, { cardId: item.card.id, date: session.day });
    } catch (error) {
      console.error(error);
      showToast('使えませんでした。もう一度押してください。');
      return;
    } finally {
      assisting = false;
    }
    session.items[kind] = result.left;
    if (!result.ok) {
      showToast(`${ITEMS[kind].name}を持っていません（スタンプ画面の交換所でコインと交換できます）`);
      updateAssistRow();
      return;
    }
    current.assist[kind] = true;

    if (kind === 'choices') {
      // その場で4択にする
      current.format = 'choice';
      current.choices = built;
      drawQuestion(false);
      return;
    }
    // ヒントをカードに出す
    el.querySelector('.hint-slot').innerHTML = hintHtml(answerOf(item.card, item.dir));
    updateGradeLabels();
    updateAssistRow();
    el.querySelector('#type-input')?.focus();
  }

  // ヒントの表示（最初の1文字と、伏せた文字のマス）
  function hintHtml(answer) {
    const { cells, letters } = hintOf(answer);
    const first = cells.find((cell) => cell.type === 'open')?.ch ?? '';
    const title = `<span class="hint-title">${ITEMS.hint.icon} ヒント：「${escapeHtml(first)}」から始まる ${letters}文字</span>`;
    // 長すぎる答えは、マスを出さずに文字だけ
    if (letters > 30) return `<div class="hint-box">${title}</div>`;
    const cellHtml = cells.map((cell) => {
      if (cell.type === 'space') return '<span class="hint-space"></span>';
      if (cell.type === 'mark') return `<span class="hint-mark">${escapeHtml(cell.ch)}</span>`;
      if (cell.type === 'open') return `<span class="hint-cell open">${escapeHtml(cell.ch)}</span>`;
      return '<span class="hint-cell"></span>';
    }).join('');
    return `<div class="hint-box">${title}<span class="hint-cells" aria-hidden="true">${cellHtml}</span></div>`;
  }

  // =======================================================
  // めくる
  // =======================================================
  function flipActions(item) {
    const today = session.day;
    return `
      <div class="study-actions">
        <button class="btn primary block big" type="button" id="reveal-btn">答えを見る</button>
        <div class="grade-buttons" hidden>
          ${GRADES.map((g) => `
            <button class="btn grade-btn ${g.grade}" type="button" data-grade="${g.grade}">
              <span class="grade-emoji" aria-hidden="true">${g.emoji}</span>
              <span class="grade-label">${g.label}</span>
              <span class="grade-next">${escapeHtml(nextLabel(item.progress, g.grade, today, { assisted: isAssisted() }))}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  // ヒントを使ったら、採点ボタンの「次はいつ出るか」を書き直す
  function updateGradeLabels() {
    el.querySelectorAll('[data-grade]').forEach((button) => {
      const label = nextLabel(current.item.progress, button.dataset.grade, session.day, { assisted: isAssisted() });
      button.querySelector('.grade-next').textContent = label;
    });
  }

  function setupFlip() {
    el.querySelector('#flashcard').addEventListener('click', reveal);
    el.querySelector('#reveal-btn').addEventListener('click', reveal);
    el.querySelectorAll('[data-grade]').forEach((button) => {
      button.addEventListener('click', () => {
        if (current.revealed) finish(button.dataset.grade);
      });
    });
  }

  // 答えを見せる（カードをめくる）
  function reveal() {
    if (!current || current.revealed || assisting) return;
    current.revealed = true;
    updateAssistRow();
    const cardEl = el.querySelector('#flashcard');
    const showAnswer = () => {
      cardEl.querySelector('.card-answer').hidden = false;
      cardEl.querySelector('.tap-hint').hidden = true;
    };
    // 横につぶれて → 答えが出て → 元に戻る（めくったように見える）
    if (animate(cardEl, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 240)) {
      setTimeout(showAnswer, 120);
    } else {
      showAnswer();
    }
    el.querySelector('#reveal-btn').hidden = true;
    el.querySelector('.grade-buttons').hidden = false;
    autoSpeakAnswer();
  }

  // =======================================================
  // 4択
  // =======================================================
  function choiceActions(choices) {
    return `
      <div class="choice-list">
        ${choices.options.map((text, i) => `
          <button class="btn choice-btn" type="button" data-index="${i}">
            <span class="choice-num" aria-hidden="true">${i + 1}</span>
            <span class="choice-text">${escapeHtml(text)}</span>
          </button>`).join('')}
      </div>
      <div class="study-actions">
        <div class="feedback" id="feedback" hidden></div>
        <button class="btn primary block big" type="button" id="next-btn" hidden>次へ</button>
      </div>`;
  }

  function setupChoice() {
    el.querySelectorAll('[data-index]').forEach((button) => {
      button.addEventListener('click', () => choose(Number(button.dataset.index)));
    });
    el.querySelector('#next-btn').addEventListener('click', () => finish(current.pending));
  }

  function choose(index) {
    if (!current || current.answered || assisting) return;
    const { choices } = current;
    const right = index === choices.correctIndex;
    current.answered = true;
    current.pending = right ? 'choice' : 'again';

    el.querySelectorAll('[data-index]').forEach((button) => {
      const i = Number(button.dataset.index);
      button.disabled = true;
      if (i === choices.correctIndex) button.classList.add('right');
      else if (i === index) button.classList.add('wrong');
    });
    const answer = choices.options[choices.correctIndex];
    const listen = current.speech?.answer.lang
      ? '<button class="btn small speak-answer" type="button" data-speak="answer">🔊 正解を聞く</button>' : '';
    showFeedback(right, (right ? '' : `<p>正解は「<b>${escapeHtml(answer)}</b>」</p>`) + listen);
    autoSpeakAnswer();
  }

  // =======================================================
  // 入力
  // =======================================================
  function typeActions() {
    return `
      <form class="type-form" id="type-form" autocomplete="off">
        <input type="text" id="type-input" class="type-input" placeholder="答えを入力"
               autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="答え">
        <div class="type-buttons">
          <button class="btn" type="button" id="giveup-btn">わからない</button>
          <button class="btn primary" type="submit">答え合わせ</button>
        </div>
      </form>
      <div class="study-actions">
        <div class="feedback" id="feedback" hidden></div>
        <div class="next-row" id="next-row" hidden>
          <button class="btn" type="button" id="override-btn" hidden>合ってたことにする</button>
          <button class="btn primary big" type="button" id="next-btn">次へ</button>
        </div>
      </div>`;
  }

  function setupType() {
    const form = el.querySelector('#type-form');
    const input = el.querySelector('#type-input');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (current.answered) {
        finish(current.pending);
      } else if (!compareKey(input.value)) {
        showToast('答えを入力してください（わからないときは「わからない」）');
        input.focus();
      } else {
        typed(input.value);
      }
    });
    el.querySelector('#giveup-btn').addEventListener('click', () => typed(null));
    el.querySelector('#next-btn').addEventListener('click', () => finish(current.pending));
    el.querySelector('#override-btn').addEventListener('click', () => {
      showToast('正解にしました');
      finish('good');
    });
    input.focus();
  }

  // 答え合わせ（text が null なら「わからない」）
  function typed(text) {
    if (!current || current.answered || assisting) return;
    const { item } = current;
    const right = text !== null && checkTyped(text, answerOf(item.card, item.dir));
    current.answered = true;
    current.pending = right ? 'good' : 'again';
    updateAssistRow();

    const input = el.querySelector('#type-input');
    input.readOnly = true;
    input.classList.add(right ? 'right' : 'wrong');
    input.blur(); // スマホのキーボードを閉じて、答えが見えるようにする
    el.querySelector('.type-buttons').hidden = true;
    el.querySelector('.card-answer').hidden = false;
    el.querySelector('#next-row').hidden = false;
    el.querySelector('#override-btn').hidden = right || text === null;

    let extra = '';
    if (text === null) extra = '<p>答えを見て、覚えておきましょう。</p>';
    else if (!right) extra = `<p class="muted">あなたの答え：${escapeHtml(text)}</p>`;
    showFeedback(right, extra, text === null ? '😣 答えはこちら' : null);
    autoSpeakAnswer();
  }

  // =======================================================
  // 4択・入力の共通：答えたあとの表示
  // =======================================================
  function showFeedback(right, extraHtml, titleText = null) {
    const { item } = current;
    const today = session.day;
    const assisted = isAssisted();
    const after = schedule(item.progress, current.pending, today, { assisted });
    const label = nextLabel(item.progress, current.pending, today, { assisted });
    let message;
    if (!right) message = '少しあとに、もう一度出ます。';
    else if (assisted) message = `アイテムを使ったので、レベルはそのまま。${ASSIST_INTERVAL === 1 ? '明日' : `${ASSIST_INTERVAL}日後に`}もう一度出ます。`;
    else if (label === 'そのまま') message = '予定より前の復習なので、次に出る日はそのままです。';
    else if (after.level > item.progress.level) message = `レベルアップ！ 次は${label}に出ます。`;
    else if (current.pending === 'choice' && after.halfStep) message = `4択の正解は半分ぶん。もう1回正解でレベルアップ！（次は${label}）`;
    else message = `次は${label}に出ます。`;

    const feedback = el.querySelector('#feedback');
    feedback.className = `feedback ${right ? 'right' : 'wrong'}`;
    feedback.innerHTML = `
      <p class="feedback-title">${titleText ?? (right ? '⭕ 正解！' : '❌ ざんねん…')}</p>
      ${extraHtml}
      <p class="muted">${escapeHtml(message)}</p>`;
    feedback.hidden = false;
    const answerEl = el.querySelector('.card-answer');
    if (answerEl) answerEl.hidden = false;
    const nextBtn = el.querySelector('#next-btn');
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    nextBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // =======================================================
  // 答えを保存して、次の問題へ
  // =======================================================
  async function finish(grade) {
    if (!current || busy || assisting || !grade) return;
    busy = true;
    const { item, format } = current;
    const today = session.day;
    const assisted = isAssisted();
    let lastAssist = null;
    if (current.assist.choices) lastAssist = 'choices';
    else if (current.assist.hint) lastAssist = 'hint';
    const updated = { ...schedule(item.progress, grade, today, { assisted }), lastFormat: format, lastAssist };
    let saved;
    try {
      saved = await recordAnswer({
        progress: updated,
        grade,
        day: today,
        countsAsNew: item.kind === 'new' && isNew(item.progress),
        goal: deck.dailyGoal,
        assisted,
      });
    } catch (error) {
      console.error(error);
      showToast('保存できませんでした。もう一度押してください。');
      busy = false;
      return;
    }
    item.progress = updated;
    session.answered += 1;
    if (grade === 'again') session.results.wrong += 1;
    else if (grade === 'hard') session.results.hard += 1;
    else session.results.right += 1;
    if (assisted) session.results.assisted += 1;

    // この1問できょうのぶんを達成したら、スタンプ！
    if (saved.achievedNow) {
      const bingoCoins = saved.bingos.reduce((sum, bingo) => sum + bingo.coins, 0);
      session.stamp = { gold: saved.goldNow, coins: saved.coins + bingoCoins, bingo: saved.bingos.length > 0 };
      showToast(saved.goldNow
        ? `👑 全部の単語帳を達成！ 金色のスタンプと 🪙${saved.coins} ゲット！`
        : `🎉 「${GOAL_LABEL}」達成！ スタンプと 🪙${saved.coins} ゲット！`);
      // スタンプカードのビンゴがそろったら、もう1つお知らせ
      if (saved.bingos.length > 0) showToast(bingoMessage(saved.bingos));
      // トロフィー（夜ふかし・早起きは、達成したこの瞬間に判定）
      await announceTrophies(achievementEvents({ late: session.late }));
    }

    // まちがえたら、少しあとにもう一度出す
    if (grade === 'again') {
      const position = Math.min(session.queue.length, session.index + 1 + REASK_GAP);
      session.queue.splice(position, 0, { ...item, kind: 'reask' });
    }

    session.index += 1;
    busy = false;
    if (session.index >= session.queue.length) {
      showResult();
    } else {
      showQuestion();
    }
  }

  // ---- 結果を表示する ----
  async function showResult() {
    mode = 'other';
    current = null;
    // 「合計100問」などのトロフィーは、1回の学習が終わったときに判定する
    await announceTrophies();
    const [daily, next] = await Promise.all([getDaily(deck.id, session.day), getStudyDay(deck, graceHour)]);
    const remaining = remainingOf(daily);
    const hasGoal = deck.dailyGoal > 0;
    const done = hasGoal && isAchieved(daily);
    const labels = RESULT_LABELS[session.format] ?? RESULT_LABELS.auto;
    const cellClass = { right: 'good', hard: 'hard', wrong: 'again' };

    // 次のボタン：昨日の分が終わって今日の分に切りかわるとき・続き・もう少し
    let moreLabel;
    if (next.day !== session.day) moreLabel = '今日の分をはじめる';
    else if (remaining > 0) moreLabel = `続ける（あと${remaining}問で達成）`;
    else moreLabel = `もう${EXTRA_SESSION_SIZE}問やる`;

    const stamp = session.stamp;
    const stampHtml = stamp ? `
      <div class="stamp-get">
        <span class="stamp big${stamp.gold ? ' gold' : ' deck'}" aria-hidden="true">★</span>
        <p><b>${stamp.gold ? '金色のスタンプ！' : 'スタンプゲット！'}</b><br>
          <span class="muted">${stamp.gold ? '全部の単語帳の「' + GOAL_LABEL + '」を達成しました' : `「${GOAL_LABEL}」を達成しました`}${session.late ? '（昨日の分）' : ''}</span></p>
        ${stamp.coins > 0 ? `<a class="coin-get" href="#/stamps">${stamp.bingo ? '🎯 ビンゴ！ ' : ''}🪙 +${stamp.coins}</a>` : ''}
      </div>` : '';

    el.innerHTML = `
      <section class="card hero result">
        ${stampHtml || `<p class="hero-emoji">${done ? '🎉' : '👏'}</p>`}
        <h2>おつかれさま！</h2>
        <p>今回は <b>${session.answered}問</b> 解きました。</p>
        <div class="result-grid${labels.length === 2 ? ' two' : ''}">
          ${labels.map(([key, label]) => `
            <div class="result-cell ${cellClass[key]}">${label}<b>${session.results[key]}</b></div>`).join('')}
        </div>
        ${session.results.assisted > 0 ? `
          <p class="muted fine-print">${ITEMS.hint.icon}${ITEMS.choices.icon} アイテムを使った問題：${session.results.assisted}問（正解でも明日もう一度出ます）</p>` : ''}
        <p>${dayWord(session.late)}の合計：<b>${daily.answered}問</b>
          ${hasGoal ? `<span class="muted">（「${GOAL_LABEL}」${daily.goal ?? deck.dailyGoal}問${done ? '・達成！' : ''}）</span>` : ''}</p>
        <div class="stack">
          <button class="btn primary block" type="button" id="more-btn">${moreLabel}</button>
          <button class="btn block" type="button" id="change-btn">出し方を変える</button>
          <a class="btn block" href="#/home">ホームへ</a>
        </div>
      </section>`;
    el.querySelector('#more-btn').addEventListener('click', startSession);
    el.querySelector('#change-btn').addEventListener('click', showPicker);
  }

  // ---- 出せる問題がないとき ----
  function showNothing() {
    mode = 'other';
    current = null;
    el.innerHTML = `
      <section class="card hero">
        <p class="hero-emoji">🌙</p>
        <h2>いま出せる問題がありません</h2>
        <p>新しい単語は1日${deck.newPerDay}語までです。<br>また明日やりましょう！</p>
        <a class="btn" href="#/home">ホームへ</a>
      </section>`;
  }

  // ---- PC のキーボード操作 ----
  //   出し方選び：1〜4
  //   めくる：スペース／Enter でめくる、1・2・3 で採点
  //   4択：1〜4 で選ぶ、Enter で次へ
  //   入力：Enter で答え合わせ → もう一度 Enter で次へ
  document.addEventListener('keydown', (event) => {
    if (!el.isConnected || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const onButton = event.target instanceof HTMLButtonElement;
    const go = event.key === 'Enter' || event.key === ' ';

    if (mode === 'picker') {
      const format = FORMATS[Number(event.key) - 1];
      if (format) pick(format.id);
      return;
    }
    if (mode !== 'question' || !current) return;

    if (current.format === 'flip') {
      if (!current.revealed && go && !onButton) {
        event.preventDefault();
        reveal();
      } else if (current.revealed) {
        const g = GRADES.find((x) => x.key === event.key);
        if (g) finish(g.grade);
      }
    } else if (current.format === 'choice') {
      const n = Number(event.key);
      if (!current.answered && n >= 1 && n <= current.choices.options.length) {
        choose(n - 1);
      } else if (current.answered && go && !onButton) {
        event.preventDefault();
        finish(current.pending);
      }
    } else if (current.format === 'type') {
      const inInput = event.target instanceof HTMLInputElement;
      if (current.answered && go && !onButton && !inInput) {
        event.preventDefault();
        finish(current.pending);
      }
    }
  }, { signal });

  await showPicker();
}

// 条件を満たしたトロフィーを受け取って、お知らせを出す
// （判定に失敗しても学習は続けられるように、エラーは記録だけ）
async function announceTrophies(events = []) {
  try {
    const claimed = await claimTrophies(events);
    for (const message of trophyMessages(claimed.found, claimed.ownedBefore)) showToast(message);
  } catch (error) {
    console.error(error);
  }
}

// 文字の長さに合わせて、問題の文字の大きさを変える
// （漢字・かなは英字の約2文字分の幅として数える）
function sizeClass(text) {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0x2000 ? 2 : 1;
  if (width > 50) return 'very-long';
  if (width > 16) return 'long';
  return '';
}

// 動きをつける（「動きを減らす」設定のスマホでは動かさない）
function animate(element, keyframes, duration) {
  if (!element.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  element.animate(keyframes, { duration, easing: 'ease-in-out' });
  return true;
}
