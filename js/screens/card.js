// =========================================================
// 単語の追加・編集の画面
//   #/decks/(単語帳ID)/cards/new        → 新しく追加
//   #/decks/(単語帳ID)/cards/(単語ID)   → 編集
// =========================================================
import { getDeck, getCard, listCards, createCard, updateCard, deleteCard, listProgressForCard } from '../data.js';
import { escapeHtml, normalizeKey, toDateKey } from '../util.js';
import { isNew as isNewProgress, MAX_LEVEL } from '../srs.js';
import { confirmDialog, showToast } from '../ui.js';

export const title = '単語';

export async function render(el, { params, setTitle, goBack }) {
  const [deckId, cardId] = params;
  const isNew = cardId === 'new';
  const deck = await getDeck(deckId);
  const card = isNew ? null : await getCard(cardId);

  if (!deck || (!isNew && (!card || card.deckId !== deckId))) {
    el.innerHTML = `
      <p class="empty">この単語は見つかりませんでした。</p>
      <a class="btn block" href="#/decks">単語帳の一覧へ</a>`;
    return;
  }

  setTitle(isNew ? '単語を追加' : '単語を編集');

  el.innerHTML = `
    <p class="muted">単語帳：${escapeHtml(deck.name)}</p>
    <form class="card form" id="card-form" novalidate>
      ${field('front', '表', card?.front, { required: true, rows: 2 })}
      ${field('back', '裏', card?.back, { required: true, rows: 2 })}
      ${field('example', '例文', card?.example, { rows: 3 })}
      ${field('note', 'メモ', card?.note, { rows: 3 })}
      <button class="btn primary block" type="submit">${isNew ? '追加する' : '保存する'}</button>
    </form>
    ${isNew
      ? '<p class="muted">追加したあとも、この画面のまま続けて入力できます。</p>'
      : `${await progressSection(card)}
         <button class="btn danger" type="button" id="delete-btn">この単語を削除</button>`}`;

  const form = el.querySelector('#card-form');
  const input = (name) => form.querySelector(`[name="${name}"]`);
  const readFields = () => ({
    front: input('front').value,
    back: input('back').value,
    example: input('example').value,
    note: input('note').value,
  });

  // 「追加する」「保存する」が押されたとき
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = readFields();

    // 表と裏は必須
    for (const name of ['front', 'back']) {
      if (!fields[name].trim()) {
        showToast(`「${name === 'front' ? '表' : '裏'}」を入力してください`);
        input(name).focus();
        return;
      }
    }

    // 同じ「表」の単語がすでにあれば確認する
    const key = normalizeKey(fields.front);
    const others = (await listCards(deck.id)).filter((c) => c.id !== card?.id);
    const same = others.find((c) => normalizeKey(c.front) === key);
    if (same) {
      const ok = await confirmDialog(
        `「${same.front}」（${same.back}）はすでに登録されています。\nこのまま${isNew ? '追加' : '保存'}しますか？`,
        { okLabel: isNew ? '追加する' : '保存する' },
      );
      if (!ok) return;
    }

    if (isNew) {
      await createCard(deck.id, fields);
      showToast(`「${fields.front.trim()}」を追加しました`);
      form.reset(); // 続けて入力できるように空にする
      input('front').focus();
    } else {
      await updateCard(card.id, fields);
      showToast('保存しました');
      goBack();
    }
  });

  // 削除
  el.querySelector('#delete-btn')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `「${card.front}」を削除しますか？\nこの単語の学習の記録も消え、元に戻せません。`,
      { okLabel: '削除する', danger: true },
    );
    if (!ok) return;
    await deleteCard(card.id);
    showToast(`「${card.front}」を削除しました`);
    goBack();
  });
}

// 「覚え具合」の欄（表→裏・裏→表それぞれ）
async function progressSection(card) {
  const list = await listProgressForCard(card.id);
  const rows = ['f', 'b'].map((dir) => {
    const p = list.find((x) => x.dir === dir);
    const label = dir === 'f' ? '表 → 裏' : '裏 → 表';
    if (isNewProgress(p)) {
      return `<dt>${label}</dt><dd>まだ出ていません</dd>`;
    }
    // ◐ は「4択の正解が半分たまっている」しるし
    const half = p.halfStep && p.level < MAX_LEVEL;
    const dots = '●'.repeat(p.level) + (half ? '◐' : '') + '○'.repeat(MAX_LEVEL - p.level - (half ? 1 : 0));
    return `
      <dt>${label}</dt>
      <dd><span class="level-dots" title="段階 ${p.level}${half ? '（4択の正解が半分）' : ''}">${dots}</span><br>
        <span class="muted">次は ${formatDue(p.due)}・${p.reps}回答えた</span></dd>`;
  });
  return `
    <section class="card">
      <h3>覚え具合</h3>
      <dl class="info-list">${rows.join('')}</dl>
    </section>`;
}

function formatDue(dateKey) {
  const today = toDateKey();
  if (dateKey <= today) return '今日';
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}月${d}日`;
}

// 入力欄1つぶんの HTML
function field(name, label, value = '', { required = false, rows = 2 } = {}) {
  return `
    <div>
      <label class="field-label" for="f-${name}">
        ${label}<span class="${required ? 'tag-required' : 'tag-optional'}">${required ? '必須' : '空でもOK'}</span>
      </label>
      <textarea id="f-${name}" name="${name}" rows="${rows}" autocomplete="off">${escapeHtml(value)}</textarea>
    </div>`;
}
