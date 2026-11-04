// =========================================================
// 一括登録の画面
// 貼り付けると、すぐ下に「何語登録されるか」の確認が出る。
// =========================================================
import { getDeck, listCards, applyImport } from '../data.js';
import { parseImportText, planImport } from '../importer.js';
import { escapeHtml } from '../util.js';
import { showToast } from '../ui.js';

export const title = '一括登録';

// 「見本を入れてみる」で入る文字（列の間はタブ）
const SAMPLE_TEXT = [
  'apple\tりんご\tI ate an apple.\t',
  'library\t図書館\tI study at the library.\t「ライブラリ」とも言う',
  'remember\t覚えている\tI remember his name.\t反対は forget',
].join('\n');

// 確認欄に、中身を見せる行の数
const PREVIEW_ROWS = 5;
// 確認欄に、エラーを見せる行の数
const PREVIEW_ERRORS = 10;

export async function render(el, { params, goBack }) {
  const [deckId] = params;
  const deck = await getDeck(deckId);
  if (!deck) {
    el.innerHTML = `
      <p class="empty">この単語帳は見つかりませんでした。</p>
      <a class="btn block" href="#/decks">単語帳の一覧へ</a>`;
    return;
  }
  const existingCards = await listCards(deck.id);

  el.innerHTML = `
    <p class="muted">単語帳：${escapeHtml(deck.name)}（いま${existingCards.length}語）</p>

    <section class="card">
      <h3>使い方</h3>
      <p>Excel や Google スプレッドシートで、下のように<b>4列</b>に並べます。</p>
      <table class="sample-table">
        <thead><tr><th>A列：表</th><th>B列：裏</th><th>C列：例文</th><th>D列：メモ</th></tr></thead>
        <tbody>
          <tr><td>apple</td><td>りんご</td><td>I ate an apple.</td><td></td></tr>
          <tr><td>library</td><td>図書館</td><td>I study at the library.</td><td>「ライブラリ」とも言う</td></tr>
        </tbody>
      </table>
      <p>単語の部分（見出しの行はあってもなくてもOK）を選んでコピーし、下の欄に貼り付けてください。<b>例文とメモは空でもOK</b>です。</p>
      <div class="button-row" style="margin-top:12px">
        <button class="btn small" type="button" id="sample-btn">見本を入れてみる</button>
        <button class="btn small" type="button" id="clear-btn">欄を空にする</button>
      </div>
    </section>

    <div>
      <label class="field-label" for="import-text">ここに貼り付け</label>
      <textarea id="import-text" class="paste-area" rows="8" autocomplete="off" spellcheck="false"
                placeholder="apple	りんご	I ate an apple.	メモ"></textarea>
    </div>

    <section class="card">
      <h3>同じ「表」の単語がすでにあるとき</h3>
      <div class="radio-list">
        <label><input type="radio" name="mode" value="skip" checked> 登録しない</label>
        <label><input type="radio" name="mode" value="overwrite"> 新しい内容で上書きする</label>
        <label><input type="radio" name="mode" value="add"> 別の単語として追加する</label>
      </div>
    </section>

    <section class="card" id="preview" aria-live="polite"></section>

    <button class="btn primary block" type="button" id="import-btn" disabled>登録する</button>`;

  const textEl = el.querySelector('#import-text');
  const previewEl = el.querySelector('#preview');
  const importBtn = el.querySelector('#import-btn');
  let plan = null;

  // 貼り付けた内容を読み取って、確認欄を書き直す
  function updatePreview() {
    const mode = el.querySelector('input[name="mode"]:checked').value;
    const { rows, errors, headerSkipped } = parseImportText(textEl.value);
    plan = planImport(rows, existingCards, mode);
    const total = plan.toAdd.length + plan.toUpdate.length;

    if (!textEl.value.trim()) {
      previewEl.innerHTML = '<p class="muted">貼り付けると、ここに確認が出ます。</p>';
    } else {
      const shown = [...plan.toUpdate, ...plan.toAdd].slice(0, PREVIEW_ROWS);
      previewEl.innerHTML = `
        <h3>確認</h3>
        <ul class="summary">
          <li>新しく登録：<b>${plan.toAdd.length}語</b></li>
          ${plan.toUpdate.length ? `<li>上書き：<b>${plan.toUpdate.length}語</b></li>` : ''}
          ${plan.skipped ? `<li>同じ「表」があるので登録しない：<b>${plan.skipped}語</b></li>` : ''}
          ${errors.length ? `<li class="text-danger">読み取れなかった行：<b>${errors.length}行</b></li>` : ''}
        </ul>
        ${headerSkipped ? '<p class="muted">1行目は見出しとして読み飛ばしました。</p>' : ''}
        ${shown.length ? `
          <p class="muted" style="margin-top:12px">登録される単語（最初の${shown.length}語）</p>
          <ul class="preview-list">
            ${shown.map((c) => `
              <li>
                <span class="word-front">${escapeHtml(c.front)}</span>
                <span class="word-back">${escapeHtml(c.back)}</span>
                ${c.example ? `<span class="preview-extra">例文：${escapeHtml(c.example)}</span>` : ''}
                ${c.note ? `<span class="preview-extra">メモ：${escapeHtml(c.note)}</span>` : ''}
              </li>`).join('')}
          </ul>` : ''}
        ${errors.length ? `
          <p class="muted" style="margin-top:12px">読み取れなかった行</p>
          <ul class="error-list">
            ${errors.slice(0, PREVIEW_ERRORS).map((e) => `
              <li>${e.line}行目：${escapeHtml(e.reason)}${e.text ? `（${escapeHtml(e.text)}）` : ''}</li>`).join('')}
            ${errors.length > PREVIEW_ERRORS ? `<li>ほか ${errors.length - PREVIEW_ERRORS}行</li>` : ''}
          </ul>
          ${errors.some((e) => e.reason.startsWith('タブ'))
            ? '<p class="muted">※ 列の区切りはタブです。スプレッドシートからコピーすると自動でタブになります。</p>'
            : ''}` : ''}`;
    }

    importBtn.disabled = total === 0;
    importBtn.textContent = total > 0 ? `${total}語を登録する` : '登録する';
  }

  textEl.addEventListener('input', updatePreview);
  el.querySelectorAll('input[name="mode"]').forEach((radio) => radio.addEventListener('change', updatePreview));

  el.querySelector('#sample-btn').addEventListener('click', () => {
    textEl.value = SAMPLE_TEXT;
    updatePreview();
  });
  el.querySelector('#clear-btn').addEventListener('click', () => {
    textEl.value = '';
    updatePreview();
    textEl.focus();
  });

  // 「登録する」
  importBtn.addEventListener('click', async () => {
    if (!plan) return;
    importBtn.disabled = true;
    const { added, updated } = await applyImport(deck.id, plan);
    const parts = [];
    if (added) parts.push(`${added}語を登録`);
    if (updated) parts.push(`${updated}語を上書き`);
    showToast(`${parts.join('・')}しました`);
    goBack();
  });

  updatePreview();
}
