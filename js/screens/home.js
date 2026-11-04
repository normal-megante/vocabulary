// =========================================================
// ホーム画面：今日の学習の入り口と、スタンプの連続記録
// =========================================================
import {
  listDecks, getDeckToday, getSettings, listOverallStamps, getWallet, useRestTickets,
} from '../data.js';
import { escapeHtml, formatDateJa, toDateKey } from '../util.js';
import { streakOf, inGrace, isAchieved } from '../stamps.js';
import { BACKUP_REMINDER_DAYS, GOAL_LABEL, ITEMS } from '../defaults.js';
import { showToast } from '../ui.js';
import { addDays } from '../srs.js';

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

  const settings = await getSettings();
  // 連続が切れそうなら、先にお休みチケットを使っておく
  const restUsed = await useRestTickets(settings.graceHour);
  if (restUsed.length > 0) {
    showToast(`💤 お休みチケットを${restUsed.length}枚使って、連続日数をつなぎました`);
  }

  const [todays, stamps, wallet] = await Promise.all([
    Promise.all(decks.map((deck) => getDeckToday(deck, settings.graceHour))),
    listOverallStamps(),
    getWallet(),
  ]);
  const totalCards = todays.reduce((sum, t) => sum + t.cardCount, 0);

  el.innerHTML = `
    <p class="today">${formatDateJa()}</p>
    ${streakCard(stamps, wallet, settings.graceHour)}
    <section>
      <h2 class="section-title">今日の学習</h2>
      <ul class="deck-list">
        ${decks.map((deck, i) => deckItem(deck, todays[i], settings.graceHour)).join('')}
      </ul>
    </section>
    ${totalCards > 0 ? backupReminder(settings.lastBackupAt) : ''}`;
}

// 連続記録・今日のスタンプ・コイン（タップでスタンプカードへ）
function streakCard(stamps, wallet, graceHour) {
  const now = new Date();
  const today = toDateKey(now);
  // お休みチケットを使った日も、連続に数える
  const streakDates = new Set([...stamps.map((s) => s.date), ...wallet.restDates]);
  const streak = streakOf(streakDates, today, { graceActive: inGrace(now, graceHour) });
  const todayStamp = stamps.find((s) => s.date === today);

  let sub;
  if (todayStamp?.gold) sub = '今日は金色のスタンプ！';
  else if (todayStamp) sub = '今日のスタンプ、ゲットずみ！';
  else if (wallet.restDates.has(addDays(today, -1))) sub = '昨日はお休みチケットでお休み。今日はがんばろう';
  else sub = `どれか1冊の「${GOAL_LABEL}」を達成するとスタンプ`;

  const tickets = wallet.items.rest ?? 0;
  return `
    <a class="card streak-card" href="#/stamps">
      <span class="stamp${todayStamp ? (todayStamp.gold ? ' gold' : '') : ' empty'}" aria-hidden="true">★</span>
      <span class="streak-text">
        <b>${streak > 0 ? `🔥 ${streak}日連続！` : 'スタンプを集めよう'}</b>
        <span class="muted">${escapeHtml(sub)}</span>
      </span>
      <span class="wallet-pills">
        <span class="pill" aria-label="コイン ${wallet.coins}枚">🪙 ${wallet.coins}</span>
        ${tickets > 0 ? `<span class="pill" aria-label="${ITEMS.rest.name} ${tickets}枚">${ITEMS.rest.icon} ${tickets}</span>` : ''}
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>`;
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

function deckItem(deck, info, graceHour) {
  const { daily, late } = info;
  const answered = daily.answered;
  const goal = deck.dailyGoal;
  const done = isAchieved(daily);

  let stats;
  if (info.cardCount === 0) {
    stats = '<span>単語がまだありません</span>';
  } else {
    stats = `<span>復習 ${info.due}</span><span>新しい単語 ${info.fresh}</span>`;
  }

  let goalRow;
  if (goal <= 0) {
    goalRow = `<div class="goal-row"><span class="goal-text">「${GOAL_LABEL}」なし・今日 ${answered}問</span></div>`;
  } else {
    const percent = done ? 100 : Math.min(100, Math.round((answered / goal) * 100));
    goalRow = `
      <div class="goal-row">
        <div class="progress"><div class="progress-bar ${done ? 'done' : ''}" style="width:${percent}%"></div></div>
        <span class="goal-text ${done ? 'done' : ''}">
          ${done ? '<span class="stamp tiny deck" aria-hidden="true">★</span>達成！' : `${answered} / ${goal}問`}
        </span>
      </div>`;
  }

  return `
    <li class="card deck-item">
      <div class="deck-info">
        <span class="deck-name">${escapeHtml(deck.name)}</span>
        ${late ? `<span class="late-note">🌙 午前${graceHour}時までは、昨日の分として数えます</span>` : ''}
        <div class="today-stats">${stats}</div>
        ${goalRow}
      </div>
      <a class="btn primary small" href="#/study/${encodeURIComponent(deck.id)}"
         aria-label="${escapeHtml(deck.name)}を学習する">学習</a>
    </li>`;
}
