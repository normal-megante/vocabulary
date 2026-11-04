// =========================================================
// 学習画面：めくって自己採点
//
// 流れ：問題を表示 →（タップ）→ 答えを表示 →「忘れてた／あやしい／覚えてた」
//       → 次の問題 … → 全部終わったら結果を表示
// 1問答えるごとに保存するので、途中でやめても、それまでの分は記録されます。
// =========================================================
import { getDeck, listCards, listProgress, getDaily, recordAnswer } from '../data.js';
import { buildQueue, schedule, nextLabel, isNew } from '../srs.js';
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

  // 今回の学習のようす
  const session = {
    queue: [],    // 出す問題の列
    index: 0,     // いま何問目か
    answered: 0,  // 今回答えた数
    results: { good: 0, hard: 0, again: 0 },
  };
  let revealed = false; // 答えを見せたか
  let busy = false;     // 保存中（ボタンの連打よけ）

  // ---- 学習を始める（「続ける」でもここから） ----
  async function startSession() {
    const today = toDateKey();
    const [progressList, daily] = await Promise.all([listProgress(deck.id), getDaily(deck.id, today)]);
    const remaining = deck.dailyGoal - daily.answered;
    session.queue = buildQueue({
      cards,
      progressList,
      directions: deck.directions,
      today,
      newLimit: deck.newPerDay - daily.newCount,
      size: remaining > 0 ? remaining : EXTRA_SESSION_SIZE,
    });
    session.index = 0;
    session.answered = 0;
    session.results = { good: 0, hard: 0, again: 0 };

    if (session.queue.length === 0) {
      showNothing();
    } else {
      showQuestion();
    }
  }

  // ---- 問題を表示する ----
  function showQuestion() {
    const item = session.queue[session.index];
    const today = toDateKey();
    const question = item.dir === 'f' ? item.card.front : item.card.back;
    const answer = item.dir === 'f' ? item.card.back : item.card.front;
    const percent = Math.round((session.index / session.queue.length) * 100);
    revealed = false;

    let badge = '';
    if (isNew(item.progress)) badge = '<span class="tag new">NEW</span>';
    else if (item.kind === 'reask') badge = '<span class="tag again">もう一度</span>';

    el.innerHTML = `
      <div class="study">
        <div class="study-top">
          <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
          <span class="study-count">${session.index + 1} / ${session.queue.length}</span>
        </div>

        <section class="card flashcard" id="flashcard" role="button" tabindex="0" aria-label="答えを見る">
          <div class="card-tags"><span class="tag">${DIR_LABELS[item.dir]}</span>${badge}</div>
          <div class="card-question ${sizeClass(question)}">${escapeHtml(question)}</div>
          <div class="card-answer" hidden>
            <div class="card-answer-text ${sizeClass(answer)}">${escapeHtml(answer)}</div>
            ${item.card.example ? `<div class="card-example">${escapeHtml(item.card.example)}</div>` : ''}
            ${item.card.note ? `<div class="card-note">📝 ${escapeHtml(item.card.note)}</div>` : ''}
          </div>
          <p class="tap-hint">タップして答えを見る</p>
        </section>

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
        </div>
      </div>`;

    el.querySelector('#flashcard').addEventListener('click', reveal);
    el.querySelector('#reveal-btn').addEventListener('click', reveal);
    el.querySelectorAll('[data-grade]').forEach((button) => {
      button.addEventListener('click', () => answerWith(button.dataset.grade));
    });
    animate(el.querySelector('#flashcard'), [
      { opacity: 0, transform: 'translateX(24px)' },
      { opacity: 1, transform: 'none' },
    ], 180);
  }

  // ---- 答えを見せる（カードをめくる） ----
  function reveal() {
    if (revealed) return;
    revealed = true;
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

  // ---- 自己採点のボタンが押されたとき ----
  async function answerWith(grade) {
    if (!revealed || busy) return;
    busy = true;
    const item = session.queue[session.index];
    const today = toDateKey();
    const updated = schedule(item.progress, grade, today);
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
    session.results[grade] += 1;

    // 忘れてたら、少しあとにもう一度出す
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
    const daily = await getDaily(deck.id, toDateKey());
    const remaining = deck.dailyGoal - daily.answered;
    const done = remaining <= 0;
    const r = session.results;

    el.innerHTML = `
      <section class="card hero result">
        <p class="hero-emoji">${done ? '🎉' : '👏'}</p>
        <h2>おつかれさま！</h2>
        <p>今回は <b>${session.answered}問</b> 解きました。</p>
        <div class="result-grid">
          <div class="result-cell good">😊 覚えてた<b>${r.good}</b></div>
          <div class="result-cell hard">🤔 あやしい<b>${r.hard}</b></div>
          <div class="result-cell again">😣 忘れてた<b>${r.again}</b></div>
        </div>
        <p>今日の合計：<b>${daily.answered}問</b>
          <span class="muted">（${GOAL_LABEL} ${deck.dailyGoal}問${done ? '・達成！' : ''}）</span></p>
        <div class="stack">
          <button class="btn primary block" type="button" id="more-btn">
            ${done ? `もう${EXTRA_SESSION_SIZE}問やる` : `続ける（あと${remaining}問で達成）`}
          </button>
          <a class="btn block" href="#/home">ホームへ</a>
        </div>
      </section>`;
    el.querySelector('#more-btn').addEventListener('click', startSession);
  }

  // ---- 出せる問題がないとき ----
  function showNothing() {
    el.innerHTML = `
      <section class="card hero">
        <p class="hero-emoji">🌙</p>
        <h2>いま出せる問題がありません</h2>
        <p>新しい単語は1日${deck.newPerDay}語までです。<br>また明日やりましょう！</p>
        <a class="btn" href="#/home">ホームへ</a>
      </section>`;
  }

  // ---- PC のキーボード操作：スペースでめくる、1・2・3 で採点 ----
  document.addEventListener('keydown', (event) => {
    if (!el.isConnected || !el.querySelector('#flashcard')) return;
    if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      reveal();
    } else if (revealed) {
      const g = GRADES.find((x) => x.key === event.key);
      if (g) answerWith(g.grade);
    }
  }, { signal });

  await startSession();
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
