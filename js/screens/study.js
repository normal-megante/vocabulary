// =========================================================
// 学習画面：めくる・4択・入力
//
// 流れ：出し方を選ぶ → 問題 → 答える → 次の問題 … → 結果
//   めくる … タップで答えを見て「忘れてた／あやしい／覚えてた」
//   4択   … 4つから選ぶ → 正解を見せて「次へ」（正解は半分の重さ：srs.js）
//   入力   … 答えを打ち込む → 答え合わせ →「次へ」（打ち間違いは「合ってたことにする」）
// 1問ごとに保存するので、途中でやめても、それまでの分は記録されます。
// （4択・入力は「次へ」を押したときに保存）
// =========================================================
import { getDeck, updateDeck, listCards, listProgress, getDaily, recordAnswer } from '../data.js';
import { buildQueue, schedule, nextLabel, isNew } from '../srs.js';
import {
  FORMATS, buildChoices, canUseChoice, checkTyped, compareKey, pickFormat, questionOf, answerOf,
} from '../quiz.js';
import { escapeHtml, toDateKey } from '../util.js';
import { showToast } from '../ui.js';
import { GOAL_LABEL, EXTRA_SESSION_SIZE, REASK_GAP } from '../defaults.js';

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

  // 今回の学習のようす
  const session = {
    format: deck.studyFormat, // 選んだ出し方（flip / choice / type / auto）
    queue: [],                // 出す問題の列
    index: 0,                 // いま何問目か
    answered: 0,              // 今回答えた数
    results: { right: 0, hard: 0, wrong: 0 },
  };
  let mode = 'picker'; // いまの画面：picker（出し方選び）/ question（問題）/ other
  let current = null;  // いま出している問題のようす
  let busy = false;    // 保存中（ボタンの連打よけ）

  // ---- 出す問題の列を作る ----
  async function makeQueue() {
    const today = toDateKey();
    const [progressList, daily] = await Promise.all([listProgress(deck.id), getDaily(deck.id, today)]);
    const remaining = deck.dailyGoal - daily.answered;
    const queue = buildQueue({
      cards,
      progressList,
      directions: deck.directions,
      today,
      newLimit: deck.newPerDay - daily.newCount,
      size: remaining > 0 ? remaining : EXTRA_SESSION_SIZE,
    });
    return { queue, daily, remaining };
  }

  // ---- 出し方を選ぶ画面 ----
  async function showPicker() {
    const { queue, daily, remaining } = await makeQueue();
    if (queue.length === 0) {
      showNothing();
      return;
    }
    mode = 'picker';
    current = null;
    const goalText = remaining > 0
      ? `今日は ${daily.answered}問・あと${remaining}問で${GOAL_LABEL}達成`
      : `今日は ${daily.answered}問・${GOAL_LABEL}達成ずみ！`;
    el.innerHTML = `
      <section class="card">
        <h2>出し方を選ぶ</h2>
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
    const { queue } = await makeQueue();
    session.queue = queue;
    session.index = 0;
    session.answered = 0;
    session.results = { right: 0, hard: 0, wrong: 0 };
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
    current = { item, format, choices, revealed: false, answered: false, pending: null };

    const question = questionOf(item.card, item.dir);
    const answer = answerOf(item.card, item.dir);
    const percent = Math.round((session.index / session.queue.length) * 100);

    let badge = '';
    if (isNew(item.progress)) badge = '<span class="tag new">NEW</span>';
    else if (item.kind === 'reask') badge = '<span class="tag again">もう一度</span>';
    const formatTag = session.format === 'auto'
      ? `<span class="tag">${FORMATS.find((f) => f.id === format).label}</span>` : '';

    // 答えのあとに見せる例文・メモ（4択では答えの文字は選択肢にあるので出さない）
    const details = `
      ${item.card.example ? `<div class="card-example">${escapeHtml(item.card.example)}</div>` : ''}
      ${item.card.note ? `<div class="card-note">📝 ${escapeHtml(item.card.note)}</div>` : ''}`;
    const answerBlock = format === 'choice' && !details.trim() ? '' : `
      <div class="card-answer" hidden>
        ${format === 'choice' ? '' : `<div class="card-answer-text ${sizeClass(answer)}">${escapeHtml(answer)}</div>`}
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
          <div class="card-question ${sizeClass(question)}">${escapeHtml(question)}</div>
          ${answerBlock}
          ${format === 'flip' ? '<p class="tap-hint">タップして答えを見る</p>' : ''}
        </section>

        ${format === 'flip' ? flipActions(item) : ''}
        ${format === 'choice' ? choiceActions(choices) : ''}
        ${format === 'type' ? typeActions() : ''}
      </div>`;

    if (format === 'flip') setupFlip();
    if (format === 'choice') setupChoice();
    if (format === 'type') setupType();

    animate(el.querySelector('#flashcard'), [
      { opacity: 0, transform: 'translateX(24px)' },
      { opacity: 1, transform: 'none' },
    ], 180);
  }

  // =======================================================
  // めくる
  // =======================================================
  function flipActions(item) {
    const today = toDateKey();
    return `
      <div class="study-actions">
        <button class="btn primary block big" type="button" id="reveal-btn">答えを見る</button>
        <div class="grade-buttons" hidden>
          ${GRADES.map((g) => `
            <button class="btn grade-btn ${g.grade}" type="button" data-grade="${g.grade}">
              <span class="grade-emoji" aria-hidden="true">${g.emoji}</span>
              <span class="grade-label">${g.label}</span>
              <span class="grade-next">${escapeHtml(nextLabel(item.progress, g.grade, today))}</span>
            </button>`).join('')}
        </div>
      </div>`;
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
    if (!current || current.revealed) return;
    current.revealed = true;
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
    if (!current || current.answered) return;
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
    showFeedback(right, right ? '' : `<p>正解は「<b>${escapeHtml(answer)}</b>」</p>`);
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
    if (!current || current.answered) return;
    const { item } = current;
    const right = text !== null && checkTyped(text, answerOf(item.card, item.dir));
    current.answered = true;
    current.pending = right ? 'good' : 'again';

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
  }

  // =======================================================
  // 4択・入力の共通：答えたあとの表示
  // =======================================================
  function showFeedback(right, extraHtml, titleText = null) {
    const { item } = current;
    const today = toDateKey();
    const after = schedule(item.progress, current.pending, today);
    const label = nextLabel(item.progress, current.pending, today);
    let message;
    if (!right) message = '少しあとに、もう一度出ます。';
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
    if (!current || busy || !grade) return;
    busy = true;
    const { item, format } = current;
    const today = toDateKey();
    const updated = { ...schedule(item.progress, grade, today), lastFormat: format };
    try {
      await recordAnswer({
        progress: updated,
        grade,
        day: today,
        countsAsNew: item.kind === 'new' && isNew(item.progress),
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
    const daily = await getDaily(deck.id, toDateKey());
    const remaining = deck.dailyGoal - daily.answered;
    const done = remaining <= 0;
    const labels = RESULT_LABELS[session.format] ?? RESULT_LABELS.auto;
    const cellClass = { right: 'good', hard: 'hard', wrong: 'again' };

    el.innerHTML = `
      <section class="card hero result">
        <p class="hero-emoji">${done ? '🎉' : '👏'}</p>
        <h2>おつかれさま！</h2>
        <p>今回は <b>${session.answered}問</b> 解きました。</p>
        <div class="result-grid${labels.length === 2 ? ' two' : ''}">
          ${labels.map(([key, label]) => `
            <div class="result-cell ${cellClass[key]}">${label}<b>${session.results[key]}</b></div>`).join('')}
        </div>
        <p>今日の合計：<b>${daily.answered}問</b>
          <span class="muted">（${GOAL_LABEL} ${deck.dailyGoal}問${done ? '・達成！' : ''}）</span></p>
        <div class="stack">
          <button class="btn primary block" type="button" id="more-btn">
            ${done ? `もう${EXTRA_SESSION_SIZE}問やる` : `続ける（あと${remaining}問で達成）`}
          </button>
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
