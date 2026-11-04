// =========================================================
// ホーム画面：今日の学習の入り口
// =========================================================
import { listDecks, getDeckToday, getSettings } from '../data.js';
import { escapeHtml, formatDateJa, toDateKey } from '../util.js';
import { BACKUP_REMINDER_DAYS } from '../defaults.js';

export const title = 'ホーム';

export async function render(el) {
  const decks = await listDecks();

  // 単語帳がまだ1つもないとき
  if (decks.length === 0) {
    el.innerHTML = `
      <section class="card hero">
        <p class="hero-emoji">📘</p>
        <h2>ようこそ！</h2>
        <p>まずは単語帳を作りましょう。</p>
        <a class="btn primary" href="#/decks">単語帳を作る</a>
      </section>`;
    return;
  }

  const today = toDateKey();
  const [todays, settings] = await Promise.all([
    Promise.all(decks.map((deck) => getDeckToday(deck, today))),
    getSettings(),
  ]);
  const totalCards = todays.reduce((sum, t) => sum + t.cardCount, 0);

  el.innerHTML = `
    <p class="today">${formatDateJa()}</p>
    <section>
      <h2 class="section-title">今日の学習</h2>
      <ul class="deck-list">
        ${decks.map((deck, i) => deckItem(deck, todays[i])).join('')}
      </ul>
    </section>
    ${totalCards > 0 ? backupReminder(settings.lastBackupAt) : ''}`;
}

// しばらくバックアップしていなければ、お知らせを出す
function backupReminder(lastBackupAt) {
  if (lastBackupAt) {
    const days = (Date.now() - Date.parse(lastBackupAt)) / 86400000;
    if (days < BACKUP_REMINDER_DAYS) return '';
  }
  return `
    <a class="card notice-card" href="#/settings">
      <span class="notice-icon" aria-hidden="true">💾</span>
      <span>
        ${lastBackupAt ? 'しばらくバックアップしていません。' : 'まだバックアップしていません。'}
        <span class="muted">設定画面から保存できます</span>
      </span>
    </a>`;
}

function deckItem(deck, today) {
  const answered = today.daily.answered;
  const goal = deck.dailyGoal;
  const done = goal > 0 && answered >= goal;
  const percent = goal > 0 ? Math.min(100, Math.round((answered / goal) * 100)) : 0;

  let stats;
  if (today.cardCount === 0) {
    stats = '<span>単語がまだありません</span>';
  } else {
    stats = `<span>復習 ${today.due}</span><span>新しい単語 ${today.fresh}</span>`;
  }

  return `
    <li class="card deck-item">
      <div class="deck-info">
        <span class="deck-name">${escapeHtml(deck.name)}</span>
        <div class="today-stats">${stats}</div>
        <div class="goal-row">
          <div class="progress"><div class="progress-bar ${done ? 'done' : ''}" style="width:${percent}%"></div></div>
          <span class="goal-text ${done ? 'done' : ''}">${done ? '達成！' : `${answered} / ${goal}問`}</span>
        </div>
      </div>
      <a class="btn primary small" href="#/study/${encodeURIComponent(deck.id)}"
         aria-label="${escapeHtml(deck.name)}を学習する">学習</a>
    </li>`;
}
