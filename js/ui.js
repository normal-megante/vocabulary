// =========================================================
// 画面の部品：確認ダイアログ・入力ダイアログ・お知らせ
// （ブラウザ標準の確認画面より、アプリらしい見た目にするため自作）
// =========================================================
import { escapeHtml } from './util.js';

// 「はい／いいえ」を聞く。OK なら true、やめたら false が返る。
// （cancelLabel を null にすると、OK ボタンだけのお知らせになる）
export function confirmDialog(message, { okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <p class="dialog-message">${escapeHtml(message)}</p>
      <div class="dialog-buttons">
        ${cancelLabel ? `<button type="button" class="btn" data-value="cancel">${escapeHtml(cancelLabel)}</button>` : ''}
        <button type="button" class="btn ${danger ? 'danger filled' : 'primary'}" data-value="ok">${escapeHtml(okLabel)}</button>
      </div>`;
    const finish = closeOnce(dialog, (value) => resolve(value === 'ok'));
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (button) finish(button.dataset.value);
    });
    // スマホの「戻る」や Esc キーで閉じられたとき
    dialog.addEventListener('close', () => finish(dialog.returnValue));
    document.body.append(dialog);
    dialog.showModal();
  });
}

// ダイアログを閉じて片付け、結果を1回だけ知らせるしくみ
// （ボタンが押されたらすぐ閉じる。ブラウザの「閉じた」の合図だけに頼ると、
//   状況によっては合図が遅れて、画面にダイアログが残ることがあるため）
function closeOnce(dialog, onDone) {
  let done = false;
  return (value) => {
    if (done) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onDone(value);
  };
}

// OK ボタンだけのお知らせ
export function alertDialog(message) {
  return confirmDialog(message, { cancelLabel: null });
}

// 文字をファイルとして保存する（スマホでは「ダウンロード」フォルダに入る）
export function downloadFile(fileName, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 文字を入力してもらう。入力された文字が返る（やめたら null）。
export function promptDialog(message, { value = '', placeholder = '', okLabel = 'OK', maxLength = 40 } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <form>
        <label class="dialog-message" for="dialog-input">${escapeHtml(message)}</label>
        <input id="dialog-input" type="text" autocomplete="off"
               maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">
        <div class="dialog-buttons">
          <button type="button" class="btn" data-cancel>キャンセル</button>
          <button type="submit" class="btn primary">${escapeHtml(okLabel)}</button>
        </div>
      </form>`;
    const input = dialog.querySelector('input');
    const finish = closeOnce(dialog, (result) => {
      const text = input.value.trim();
      resolve(result === 'ok' && text ? text : null);
    });
    // 「OK」ボタン、または入力欄で Enter
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      finish('ok');
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish('cancel'));
    // スマホの「戻る」や Esc キーで閉じられたとき
    dialog.addEventListener('close', () => finish('cancel'));
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}

// 画面の下に、短いお知らせを2秒ほど出す。
export function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
