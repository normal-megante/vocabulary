// =========================================================
// トロフィー画面：いまの称号と、トロフィーの一覧（取ったもの・まだのもの）
//   （スタンプ画面の「🏆 トロフィー」から開く。くわしいしくみは trophies.js）
// =========================================================
import { claimTrophies, getTrophyState } from '../data.js';
import {
  TROPHIES, TROPHY_GROUPS, TITLES, STAT_UNITS, titleOf, trophyMessages,
} from '../trophies.js';
import { showToast } from '../ui.js';

export const title = 'トロフィー';

export async function render(el) {
  // 条件を満たしていたら、先に受け取っておく
  const claimed = await claimTrophies();
  for (const message of trophyMessages(claimed.found, claimed.ownedBefore)) showToast(message);

  const { stats, owned } = await getTrophyState();
  el.innerHTML = `
    ${titleCard(owned.size)}
    ${TROPHY_GROUPS.map((group) => groupCard(group, stats, owned)).join('')}`;
}

// いまの称号・次の称号まで
function titleCard(count) {
  const current = titleOf(count);
  let nextHtml;
  if (current.next) {
    const percent = Math.round(((count - current.count) / (current.next.count - current.count)) * 100);
    nextHtml = `
      <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
      <p class="muted">あと <b>${current.next.count - count}個</b> で「${current.next.name}」</p>`;
  } else {
    nextHtml = '<p><b>いちばん上の称号です。おめでとう！</b></p>';
  }
  return `
    <section class="card title-card">
      <p class="muted">いまの称号</p>
      <p class="title-name">🎖 ${current.name}</p>
      <p>トロフィー <b>${count}</b> / ${TROPHIES.length}個</p>
      ${nextHtml}
      <ol class="title-ladder" aria-label="称号の一覧">
        ${TITLES.map((t) => `
          <li class="${count >= t.count ? 'done' : ''}${t.name === current.name ? ' current' : ''}">
            ${t.name}<small>${t.count}個</small>
          </li>`).join('')}
      </ol>
    </section>`;
}

// 種類ごとのトロフィー
function groupCard(group, stats, owned) {
  const items = TROPHIES.filter((trophy) => trophy.group === group.key);
  const got = items.filter((trophy) => owned.has(trophy.key)).length;
  return `
    <section class="card">
      <h3>${group.icon} ${group.name} <span class="muted">${got} / ${items.length}</span></h3>
      <ul class="trophy-list">${items.map((trophy) => trophyItem(trophy, stats, owned)).join('')}</ul>
    </section>`;
}

// トロフィー1つ分
function trophyItem(trophy, stats, owned) {
  const got = owned.has(trophy.key);
  const hidden = trophy.secret && !got; // ひみつのトロフィーは、取るまで見せない
  const name = hidden ? '？？？' : trophy.name;
  const about = hidden ? 'ひみつのトロフィー。取ると条件がわかります' : trophy.about;

  let detail = '';
  if (got) {
    detail = `<span class="trophy-got">${gotDate(owned.get(trophy.key))}</span>`;
  } else if (!hidden && trophy.target > 1) {
    const value = Math.min(stats[trophy.stat] ?? 0, trophy.target);
    const unit = STAT_UNITS[trophy.stat];
    const percent = Math.round((value / trophy.target) * 100);
    const text = trophy.stat === 'longestStreak'
      ? `いままでの最高 ${value}${unit} / ${trophy.target}${unit}`
      : `${value.toLocaleString()} / ${trophy.target.toLocaleString()}${unit}（あと ${(trophy.target - value).toLocaleString()}${unit}）`;
    detail = `
      <span class="progress thin"><span class="progress-bar" style="width:${percent}%"></span></span>
      <span class="muted fine-print">${text}</span>`;
  }

  return `
    <li class="trophy-item${got ? ' got' : ''}">
      <span class="trophy-medal" aria-hidden="true">${got ? '🏆' : hidden ? '❔' : '🔒'}</span>
      <span class="trophy-text">
        <b>${name}</b>
        <span class="muted">${about}</span>
        ${detail}
      </span>
      <span class="trophy-coins" aria-label="コイン ${trophy.coins}枚">🪙${trophy.coins}</span>
    </li>`;
}

// 取った日（例：2026/11/4 にゲット）
function gotDate(at) {
  if (!at) return 'ゲットずみ';
  const date = new Date(at);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} にゲット`;
}
