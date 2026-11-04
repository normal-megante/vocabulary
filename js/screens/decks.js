// =========================================================
// 単語帳の一覧画面：単語帳を作る・選ぶ
// =========================================================
import { listDecksWithCounts, createDeck } from '../data.js';
import { escapeHtml } from '../util.js';
import { showToast } from '../ui.js';

export const title = '単語帳';

export async function render(el, { refresh }) {
  const decks = await listDecksWithCounts();

  el.innerHTML = `
    <form class="card" id="create-form">
      <label class="field-label" for="deck-name">新しい単語帳</label>
      <div class="row">
        <input id="deck-name" type="text" maxlength="40" autocomplete="off"
               placeholder="例：英単語、漢字検定2級">
        <button class="btn primary" type="submit">作成</button>
      </div>
    </form>

    ${decks.length === 0
      ? '<p class="empty">まだ単語帳がありません。</p>'
      : `<ul class="deck-list">
          ${decks.map((deck) => `
            <li>
              <a class="card deck-item" href="#/decks/${encodeURIComponent(deck.id)}">
                <div class="deck-info">
                  <span class="deck-name">${escapeHtml(deck.name)}</span>
                  <span class="muted">${deck.cardCount}語</span>
                </div>
                <span class="chevron" aria-hidden="true">›</span>
              </a>
            </li>`).join('')}
        </ul>`}`;

  // 「作成」が押されたとき
  el.querySelector('#create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = el.querySelector('#deck-name');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    await createDeck(name);
    showToast(`「${name}」を作りました`);
    refresh();
  });
}
