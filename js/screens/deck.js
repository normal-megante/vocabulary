// =========================================================
// 単語帳の中身の画面：単語の一覧・この単語帳の設定
// =========================================================
import {
  getDeck, listCards, updateDeck, deleteDeck, getSettings, recheckDeckToday, refreshOverallStamp,
} from '../data.js';
import { escapeHtml, normalizeKey, toDateKey } from '../util.js';
import { confirmDialog, promptDialog, showToast, alertDialog } from '../ui.js';
import { replaceLocation } from '../nav.js';
import { GOAL_LABEL } from '../defaults.js';

export const title = '単語帳';

const DIRECTION_LABELS = {
  both: '両方（表→裏 と 裏→表）',
  forward: '表→裏だけ',
  backward: '裏→表だけ',
};

// 設定できる数の範囲
const LIMITS = {
  dailyGoal: { min: 0, max: 500 },
  newPerDay: { min: 0, max: 200 },
};

// 単語の一覧は、一度にこの数まで表示する（多すぎると重くなるため）
const PAGE_SIZE = 100;

export async function render(el, { params, setTitle, refresh }) {
  const [deckId] = params;
  const deck = await getDeck(deckId);

  if (!deck) {
    el.innerHTML = `
      <p class="empty">この単語帳は見つかりませんでした。</p>
      <a class="btn block" href="#/decks">単語帳の一覧へ</a>`;
    return;
  }

  setTitle(deck.name);
  const cards = await listCards(deck.id);
  const deckUrl = `#/decks/${encodeURIComponent(deck.id)}`;

  el.innerHTML = `
    <section class="card">
      <h2>${escapeHtml(deck.name)}</h2>
      <p class="muted">${cards.length}語</p>
    </section>

    <a class="btn primary block" href="#/study/${encodeURIComponent(deck.id)}">学習する</a>

    <section>
      <div class="section-head">
        <h2 class="section-title">単語</h2>
        <div class="button-row">
          <a class="btn small" href="${deckUrl}/import">📋 一括登録</a>
          <a class="btn small primary" href="${deckUrl}/cards/new">＋ 追加</a>
        </div>
      </div>
      ${cards.length === 0
        ? `<div class="card placeholder">
             <p>まだ単語がありません。</p>
             <p class="muted">「一括登録」で、スプレッドシートからまとめて貼り付けられます。</p>
           </div>`
        : `<div class="search-row">
             <input id="search" type="search" placeholder="単語をさがす" autocomplete="off">
             <span id="search-count" class="muted"></span>
           </div>
           <ul class="word-list" id="word-list"></ul>
           <button class="btn block" type="button" id="more-btn" hidden>さらに表示</button>`}
    </section>

    <section class="card">
      <h3>この単語帳の設定</h3>
      <form id="settings-form" class="form-stack" novalidate>
        <label class="field-label" for="goal-input">「${GOAL_LABEL}」（1日に解く問題数）</label>
        <div class="number-row">
          <input id="goal-input" type="number" inputmode="numeric" min="${LIMITS.dailyGoal.min}" max="${LIMITS.dailyGoal.max}"
                 step="1" value="${deck.dailyGoal}"> 問
        </div>
        <p class="muted hint">達成するとスタンプがもらえます。0 にすると、この単語帳は「${GOAL_LABEL}」とスタンプの対象外になります。</p>

        <label class="field-label" for="new-input">1日に出す新しい単語</label>
        <div class="number-row">
          <input id="new-input" type="number" inputmode="numeric" min="${LIMITS.newPerDay.min}" max="${LIMITS.newPerDay.max}"
                 step="1" value="${deck.newPerDay}"> 語
        </div>

        <span class="field-label">出題の向き</span>
        <div class="radio-list">
          ${Object.entries(DIRECTION_LABELS).map(([value, label]) => `
            <label><input type="radio" name="directions" value="${value}" ${deck.directions === value ? 'checked' : ''}> ${label}</label>`).join('')}
        </div>

        <button class="btn primary block" type="submit" style="margin-top:8px">設定を保存</button>
      </form>
    </section>

    <div class="button-row">
      <button class="btn" type="button" id="rename-btn">名前を変える</button>
      <button class="btn danger" type="button" id="delete-btn">この単語帳を削除</button>
    </div>`;

  if (cards.length > 0) setupWordList(el, deckUrl, cards);

  // この単語帳の設定を保存
  el.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const dailyGoal = readNumber(el.querySelector('#goal-input'), LIMITS.dailyGoal);
    const newPerDay = readNumber(el.querySelector('#new-input'), LIMITS.newPerDay);
    if (dailyGoal === null || newPerDay === null) {
      await alertDialog(`数は ${LIMITS.dailyGoal.min}〜${LIMITS.dailyGoal.max} の整数で入れてください（新しい単語は ${LIMITS.newPerDay.max} まで）。`);
      return;
    }
    const directions = el.querySelector('input[name="directions"]:checked').value;
    const updated = await updateDeck(deck.id, { dailyGoal, newPerDay, directions });
    // 問題数を下げて、もう届いていたら達成にする（スタンプも見直す）
    const { graceHour } = await getSettings();
    const recheck = await recheckDeckToday(updated, graceHour);
    showToast(recheck.achievedNow
      ? `設定を保存しました。「${GOAL_LABEL}」達成！ ${recheck.goldNow ? '金色の' : ''}スタンプと 🪙${recheck.coins} ゲット！`
      : '設定を保存しました');
    refresh();
  });

  // 名前を変える
  el.querySelector('#rename-btn').addEventListener('click', async () => {
    const name = await promptDialog('新しい名前', { value: deck.name, okLabel: '変更' });
    if (!name || name === deck.name) return;
    await updateDeck(deck.id, { name });
    showToast('名前を変えました');
    refresh();
  });

  // 削除する
  el.querySelector('#delete-btn').addEventListener('click', async () => {
    const ok = await confirmDialog(
      `「${deck.name}」を削除しますか？\n中の単語（${cards.length}語）や学習の記録もすべて消え、元に戻せません。`,
      { okLabel: '削除する', danger: true },
    );
    if (!ok) return;
    await deleteDeck(deck.id);
    // 残りの単語帳が全部達成ずみなら、今日の全体のスタンプが金色になることもある
    await refreshOverallStamp(toDateKey());
    showToast(`「${deck.name}」を削除しました`);
    replaceLocation('#/decks');
  });
}

// 数の入力欄を読む（範囲外・整数でなければ null）
function readNumber(input, { min, max }) {
  const text = input.value.trim().normalize('NFKC');
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

// 単語の一覧（検索と「さらに表示」つき）
function setupWordList(el, deckUrl, cards) {
  const listEl = el.querySelector('#word-list');
  const moreBtn = el.querySelector('#more-btn');
  const searchEl = el.querySelector('#search');
  const countEl = el.querySelector('#search-count');

  // 検索しやすいように、4つの欄をまとめた文字を用意しておく
  const searchable = cards.map((card) => ({
    card,
    text: normalizeKey([card.front, card.back, card.example, card.note].join(' ')),
  }));
  let limit = PAGE_SIZE;

  function draw() {
    const query = normalizeKey(searchEl.value);
    const matched = query
      ? searchable.filter((item) => item.text.includes(query)).map((item) => item.card)
      : cards;

    listEl.innerHTML = matched.length === 0
      ? '<li class="empty">見つかりませんでした</li>'
      : matched.slice(0, limit).map((card) => `
          <li>
            <a class="word-item" href="${deckUrl}/cards/${encodeURIComponent(card.id)}">
              <span class="word-front">${escapeHtml(card.front)}</span>
              <span class="word-back">${escapeHtml(card.back)}</span>
            </a>
          </li>`).join('');
    moreBtn.hidden = matched.length <= limit;
    countEl.textContent = query ? `${matched.length}件` : '';
  }

  searchEl.addEventListener('input', () => {
    limit = PAGE_SIZE;
    draw();
  });
  moreBtn.addEventListener('click', () => {
    limit += PAGE_SIZE;
    draw();
  });
  draw();
}
