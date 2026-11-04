// =========================================================
// 単語帳の中身の画面：単語の一覧・この単語帳の設定
// =========================================================
import { getDeck, listCards, updateDeck, deleteDeck } from '../data.js';
import { escapeHtml, normalizeKey } from '../util.js';
import { confirmDialog, promptDialog, showToast } from '../ui.js';
import { replaceLocation } from '../nav.js';
import { GOAL_LABEL } from '../defaults.js';

export const title = '単語帳';

const DIRECTION_LABELS = {
  both: '両方',
  forward: '表→裏だけ',
  backward: '裏→表だけ',
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
      <dl class="info-list">
        <dt>1日の${GOAL_LABEL}</dt><dd>${deck.dailyGoal}問</dd>
        <dt>1日の新しい単語</dt><dd>${deck.newPerDay}語</dd>
        <dt>出題の向き</dt><dd>${DIRECTION_LABELS[deck.directions] ?? deck.directions}</dd>
      </dl>
      <p class="muted" style="margin-top:8px">※ 変更できるようになるのはステップ7です。</p>
    </section>

    <div class="button-row">
      <button class="btn" type="button" id="rename-btn">名前を変える</button>
      <button class="btn danger" type="button" id="delete-btn">この単語帳を削除</button>
    </div>`;

  if (cards.length > 0) setupWordList(el, deckUrl, cards);

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
    showToast(`「${deck.name}」を削除しました`);
    replaceLocation('#/decks');
  });
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
