// =========================================================
// スタンプカード画面：コインとアイテムの交換所と、全体と単語帳ごとの月のカレンダー
//   全体     … どれか1冊でも「きょうのぶん」を達成した日に ★（全部達成した日は金色）
//              お休みチケットを使った日は 💤
//   単語帳ごと … その単語帳の「きょうのぶん」を達成した日に ★
// =========================================================
import {
  listDecks, listOverallStamps, listAchievedDays, getSettings, getWallet, buyItem, useRestTickets,
} from '../data.js';
import { escapeHtml, toDateKey } from '../util.js';
import { streakOf, inGrace, monthWeeks, GOLD_MIN_DECKS } from '../stamps.js';
import { canBuy } from '../wallet.js';
import { GOAL_LABEL, COIN_REWARDS, ITEMS } from '../defaults.js';
import { confirmDialog, alertDialog, showToast } from '../ui.js';

export const title = 'スタンプ';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const VIEW_KEY = 'vocabulary.stampView'; // 最後に見ていたタブ（このブラウザの中だけで覚える）

export async function render(el, { signal, refresh }) {
  const settings = await getSettings();
  // 連続が切れそうなら、先にお休みチケットを使っておく
  const restUsed = await useRestTickets(settings.graceHour);
  if (restUsed.length > 0) showToast(restMessage(restUsed));

  const [decks, overall, wallet] = await Promise.all([listDecks(), listOverallStamps(), getWallet()]);
  const now = new Date();
  const today = toDateKey(now);
  const graceActive = inGrace(now, settings.graceHour);
  const shopHtml = shopCard(wallet);

  // 見ているタブ（'all' か 単語帳の ID）と月
  let view = loadView();
  if (view !== 'all' && !decks.some((deck) => deck.id === view)) view = 'all';
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  // スタンプの日付 → { gold } の表（タブごとに作って取っておく）
  const cache = new Map();
  async function stampsOf(target) {
    if (!cache.has(target)) {
      const map = new Map();
      if (target === 'all') {
        for (const stamp of overall) map.set(stamp.date, { gold: stamp.gold });
      } else {
        for (const daily of await listAchievedDays(target)) map.set(daily.date, { gold: false });
      }
      cache.set(target, map);
    }
    return cache.get(target);
  }

  async function draw() {
    const map = await stampsOf(view);
    const deck = decks.find((d) => d.id === view);
    const dates = new Set(map.keys());
    // お休みチケットは全体の連続日数だけを守る
    const restDates = view === 'all' ? wallet.restDates : new Set();
    const streak = streakOf(new Set([...dates, ...restDates]), today, { graceActive });
    const goldCount = [...map.values()].filter((s) => s.gold).length;

    // いちばん古いスタンプの月より前には戻れない（今月より先にも進めない）
    const firstDate = [...dates].sort()[0] ?? today;
    const firstMonth = firstDate.slice(0, 7);
    const shownMonth = `${year}-${String(month).padStart(2, '0')}`;
    const canPrev = shownMonth > firstMonth;
    const canNext = shownMonth < today.slice(0, 7);

    el.innerHTML = `
      ${shopHtml}

      <div class="chip-row" role="tablist" aria-label="スタンプカードの種類">
        <button class="chip${view === 'all' ? ' active' : ''}" type="button" data-view="all" role="tab"
                aria-selected="${view === 'all'}">全体</button>
        ${decks.map((d) => `
          <button class="chip${view === d.id ? ' active' : ''}" type="button" data-view="${escapeHtml(d.id)}" role="tab"
                  aria-selected="${view === d.id}">${escapeHtml(d.name)}</button>`).join('')}
      </div>

      <section class="card">
        <div class="stat-row">
          <div class="stat">連続<b>🔥 ${streak}<small>日</small></b></div>
          <div class="stat">スタンプ<b>${dates.size}<small>個</small></b></div>
          ${view === 'all' ? `<div class="stat">金色<b>${goldCount}<small>個</small></b></div>` : ''}
        </div>

        <div class="cal-nav">
          <button class="btn small" type="button" id="prev-month" ${canPrev ? '' : 'disabled'} aria-label="前の月">‹</button>
          <b>${year}年${month}月</b>
          <button class="btn small" type="button" id="next-month" ${canNext ? '' : 'disabled'} aria-label="次の月">›</button>
        </div>

        <div class="calendar" role="grid" aria-label="${year}年${month}月のスタンプ">
          ${WEEKDAYS.map((w, i) => `<div class="cal-head${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}
          ${monthWeeks(year, month).flat().map((date) => dayCell(date, map, restDates, today, view)).join('')}
        </div>

        ${graceActive ? `<p class="late-note" style="margin-top:12px">🌙 午前${settings.graceHour}時までは、昨日の「${GOAL_LABEL}」がまだなら昨日の分として数えます</p>` : ''}
        <p class="muted" style="margin-top:12px">${explain(view, deck)}</p>
      </section>`;

    // 単語帳が多くてタブが横にはみ出すとき、選んだタブが見えるところまで横にずらす
    // （最初の表示では、画面に置かれてから測れるように1コマ待つ）
    requestAnimationFrame(() => {
      const row = el.querySelector('.chip-row');
      const active = row?.querySelector('.chip.active');
      const overflow = active ? active.getBoundingClientRect().right - row.getBoundingClientRect().right : 0;
      if (overflow > 0) row.scrollLeft += overflow + 16;
    });

    el.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        view = button.dataset.view;
        saveView(view);
        draw();
      }, { signal });
    });
    el.querySelector('#prev-month').addEventListener('click', () => moveMonth(-1), { signal });
    el.querySelector('#next-month').addEventListener('click', () => moveMonth(1), { signal });
    el.querySelectorAll('[data-buy]').forEach((button) => {
      button.addEventListener('click', () => buy(button.dataset.buy), { signal });
    });
  }

  // コインでアイテムと交換する
  async function buy(itemKey) {
    const item = ITEMS[itemKey];
    const ok = await confirmDialog(
      `🪙${item.price} で「${item.name}」と交換しますか？\n（コイン 🪙${wallet.coins} → 🪙${wallet.coins - item.price}）`,
      { okLabel: '交換する' },
    );
    if (!ok) return;
    const result = await buyItem(itemKey);
    if (!result.ok) {
      await alertDialog(`交換できませんでした。\n${result.reason}`);
    } else {
      showToast(`${item.icon} ${item.name}を手に入れました！`);
    }
    refresh();
  }

  function moveMonth(delta) {
    const d = new Date(year, month - 1 + delta, 1);
    year = d.getFullYear();
    month = d.getMonth() + 1;
    draw();
  }

  await draw();
}

// コインとアイテムの交換所
function shopCard(wallet) {
  const items = Object.entries(ITEMS).map(([key, item]) => {
    const check = canBuy(wallet, key);
    return `
      <li class="shop-item">
        <span class="shop-icon" aria-hidden="true">${item.icon}</span>
        <span class="shop-text">
          <b>${item.name}</b>
          <span class="muted">持っている：${wallet.items[key] ?? 0} / ${item.max}${item.unit}</span>
          <span class="muted fine-print">${item.about}</span>
          ${check.ok ? '' : `<span class="shop-reason">${check.reason}</span>`}
        </span>
        <button class="btn small primary" type="button" data-buy="${key}" ${check.ok ? '' : 'disabled'}>
          🪙${item.price}<br>交換
        </button>
      </li>`;
  }).join('');

  return `
    <section class="card shop-card">
      <div class="coin-row">
        <span class="coin-count" aria-label="コイン ${wallet.coins}枚">🪙 <b>${wallet.coins}</b><small>枚</small></span>
        <span class="muted fine-print">「${GOAL_LABEL}」達成で 🪙${COIN_REWARDS.goal}<br>金色の日は さらに 🪙${COIN_REWARDS.goldBonus}</span>
      </div>
      <ul class="shop-list">${items}</ul>
    </section>`;
}

// お休みチケットを使ったときのお知らせ
function restMessage(dates) {
  const days = dates.map((date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`).join('・');
  return `💤 お休みチケットを${dates.length}枚使って、${days} をお休みにしました（連続はつながっています）`;
}

// カレンダーの1日分
function dayCell(date, map, restDates, today, view) {
  if (!date) return '<div class="cal-day blank"></div>';
  const stamp = map.get(date);
  const rest = !stamp && restDates.has(date);
  const classes = ['cal-day'];
  if (date === today) classes.push('today');
  if (date > today) classes.push('future');
  const kind = stamp?.gold ? ' gold' : view === 'all' ? '' : ' deck';
  let mark = '';
  if (stamp) mark = stamp.gold ? '・金色のスタンプ' : '・スタンプ';
  else if (rest) mark = '・お休み';
  return `
    <div class="${classes.join(' ')}" role="gridcell" aria-label="${Number(date.slice(8))}日${mark}">
      <span class="cal-num">${Number(date.slice(8))}</span>
      ${stamp ? `<span class="stamp${kind}" aria-hidden="true">★</span>` : ''}
      ${rest ? '<span class="rest-mark" aria-hidden="true">💤</span>' : ''}
    </div>`;
}

// カードの下の説明
function explain(view, deck) {
  if (view === 'all') {
    return `どれか1冊でも「${GOAL_LABEL}」を達成した日にスタンプ。`
      + `単語帳が${GOLD_MIN_DECKS}冊以上あって、全部を達成した日は金色になります。`
      + `💤 はお休みチケットを使った日です。`;
  }
  if (deck.dailyGoal <= 0) {
    return `この単語帳は「${GOAL_LABEL}」が 0問 なので、スタンプは押されません（単語帳の画面で変えられます）。`;
  }
  return `「${escapeHtml(deck.name)}」の「${GOAL_LABEL}」（いまは${deck.dailyGoal}問）を達成した日にスタンプ。`;
}

function loadView() {
  try {
    return sessionStorage.getItem(VIEW_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function saveView(view) {
  try {
    sessionStorage.setItem(VIEW_KEY, view);
  } catch {
    // 覚えられなくても困らない
  }
}
