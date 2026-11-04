// =========================================================
// スタンプカード画面（中身はステップ7で作る）
// =========================================================

export const title = 'スタンプ';

export async function render(el) {
  el.innerHTML = `
    <section class="card hero">
      <p class="hero-emoji">🏅</p>
      <h2>スタンプカード</h2>
      <p>全体のスタンプと、単語帳ごとのスタンプを<br>ここに表示します（ステップ7で作ります）。</p>
    </section>`;
}
