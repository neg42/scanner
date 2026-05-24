const config = window.SCANNER_CONFIG || {};
const state = {
  data: null,
  tab: "priority",
  filters: new Set(["today"]),
  query: "",
  source: "",
  category: "",
  sortOrder: "desc",
  diagVisible: true,
};

const els = {
  status: document.querySelector("#connectionStatus"),
  statToday: document.querySelector("#statToday"),
  statBreaking: document.querySelector("#statBreaking"),
  statFeeds: document.querySelector("#statFeeds"),
  updatedAt: document.querySelector("#updatedAt"),
  visibleCount: document.querySelector("#visibleCount"),
  cards: document.querySelector("#cards"),
  empty: document.querySelector("#emptyState"),
  template: document.querySelector("#cardTemplate"),
  search: document.querySelector("#searchInput"),
  source: document.querySelector("#sourceFilter"),
  category: document.querySelector("#categoryFilter"),
  sortOrder: document.querySelector("#sortOrder"),
  diagList: document.querySelector("#diagList"),
};

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.tab = button.dataset.tab;
    render();
  });
});

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.filter;
    if (key === "today") state.filters.delete("hours48");
    if (key === "hours48") state.filters.delete("today");
    if (state.filters.has(key)) state.filters.delete(key);
    else state.filters.add(key);
    if (!state.filters.has("today") && !state.filters.has("hours48")) state.filters.add("today");
    document.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", state.filters.has(chip.dataset.filter)));
    render();
  });
});

els.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});

els.source.addEventListener("change", (event) => {
  state.source = event.target.value;
  render();
});

els.category.addEventListener("change", (event) => {
  state.category = event.target.value;
  render();
});

els.sortOrder.addEventListener("change", (event) => {
  state.sortOrder = event.target.value;
  render();
});

document.querySelector("#refreshButton").addEventListener("click", () => loadData(true));
document.querySelector("#toggleDiag").addEventListener("click", () => {
  state.diagVisible = !state.diagVisible;
  els.diagList.classList.toggle("hidden", !state.diagVisible);
});

loadData();

async function loadData(refresh = false) {
  if (!config.API_URL || config.API_URL.includes("YOUR-WORKER")) {
    els.empty.classList.remove("hidden");
    els.status.textContent = "設定待ち";
    return;
  }

  els.status.textContent = "取得中";
  try {
    const apiUrl = new URL(config.API_URL);
    if (refresh) apiUrl.searchParams.set("refresh", "1");
    const response = await fetch(apiUrl.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    els.empty.classList.add("hidden");
    els.status.textContent = state.data.cache?.hit ? "キャッシュ表示" : "最新取得";
    hydrateFilters();
    render();
  } catch (error) {
    els.status.textContent = "取得失敗";
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = `<h2>ニュースを取得できませんでした</h2><p>${escapeHtml(error.message || String(error))}</p>`;
  }
}

function hydrateFilters() {
  const items = state.data?.items || [];
  const sources = [...new Set(items.flatMap((item) => item.sources || [item.source]))].sort();
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort();
  replaceOptions(els.source, sources);
  replaceOptions(els.category, categories);
}

function replaceOptions(select, values) {
  const current = select.value;
  select.innerHTML = `<option value="">すべて</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  select.value = values.includes(current) ? current : "";
}

function render() {
  const data = state.data;
  if (!data) return;
  const allItems = state.tab === "low" ? data.lowPriority || [] : data.items || [];
  const items = sortItems(filterItems(filterByTab(allItems)));

  els.statToday.textContent = data.totals?.today ?? 0;
  els.statBreaking.textContent = data.totals?.breakingRelease ?? 0;
  els.statFeeds.textContent = data.totals?.feeds ?? 0;
  els.updatedAt.textContent = formatDateTime(data.generatedAt);
  els.visibleCount.textContent = items.length;

  els.cards.innerHTML = "";
  for (const item of items) {
    els.cards.appendChild(renderCard(item));
  }
  if (!items.length) {
    els.cards.innerHTML = `<section class="empty"><h2>該当記事はありません</h2><p>フィルターを外すか、48時間表示に切り替えて確認してください。</p></section>`;
  }
  renderDiag(data.diag || []);
}

function filterByTab(items) {
  if (state.tab === "priority") return [...items].filter((item) => !item.isLowPriorityCandidate).sort((a, b) => b.releaseScore - a.releaseScore);
  if (state.tab === "timeline") return items;
  if (state.tab === "drama") return items.filter((item) => ["drama", "tv"].includes(item.category) || hasAny(item, ["TBS", "日テレ", "フジテレビ", "テレ朝", "テレ東", "NHK", "主演", "新ドラマ"]));
  if (state.tab === "movieAnime") return items.filter((item) => ["movie", "anime"].includes(item.category) || hasAny(item, ["映画化", "アニメ化", "実写化", "特報", "予告", "キービジュアル"]));
  return items;
}

function filterItems(items) {
  return items.filter((item) => {
    if (state.filters.has("today") && !item.isToday) return false;
    if (state.filters.has("tvPriority") && !["drama", "tv"].includes(item.category) && !hasAny(item, ["TBS", "日テレ", "フジテレビ", "テレ朝", "テレ東", "NHK", "主演"])) return false;
    if (state.filters.has("releaseOnly") && !item.isBreakingRelease && !(item.matchedKeywords || []).some((keyword) => ["解禁", "発表", "決定", "主演", "キャスト"].includes(keyword))) return false;
    if (state.source && !(item.sources || [item.source]).includes(state.source)) return false;
    if (state.category && item.category !== state.category) return false;
    if (state.query) {
      const haystack = [item.title, item.summary, item.source, ...(item.sources || []), ...(item.matchedKeywords || [])].join(" ").toLowerCase();
      if (!haystack.includes(state.query)) return false;
    }
    return true;
  });
}

function sortItems(items) {
  const sorted = [...items];
  if (state.tab === "priority") {
    return sorted.sort((a, b) => b.releaseScore - a.releaseScore || new Date(b.publishedAt) - new Date(a.publishedAt));
  }
  const direction = state.sortOrder === "asc" ? 1 : -1;
  return sorted.sort((a, b) => direction * (new Date(a.publishedAt) - new Date(b.publishedAt)));
}

function renderCard(item) {
  const node = els.template.content.cloneNode(true);
  const card = node.querySelector(".news-card");
  const category = node.querySelector(".category");
  category.textContent = item.category || "other";
  category.dataset.category = item.category || "other";
  node.querySelector(".published").textContent = item.publishedLabel || formatDateTime(item.publishedAt);
  node.querySelector("h3").textContent = item.title;
  node.querySelector(".summary").textContent = item.summary || "RSS descriptionなし";
  node.querySelector(".score").textContent = `Score ${item.releaseScore}`;
  node.querySelector(".source").textContent = (item.sources || [item.source]).join(" / ");
  const link = node.querySelector(".open-link");
  link.href = item.url;
  const keywords = node.querySelector(".keywords");
  keywords.innerHTML = (item.matchedKeywords || []).slice(0, 10).map((keyword) => `<span class="keyword">${escapeHtml(keyword)}</span>`).join("");
  const list = node.querySelector(".source-details ul");
  const sourceItems = item.sourceItems || [];
  list.innerHTML = sourceItems.map((sourceItem) => `<li><a href="${escapeHtml(sourceItem.url)}" target="_blank" rel="noopener">${escapeHtml(sourceItem.source)}</a></li>`).join("");
  if (sourceItems.length <= 1) node.querySelector(".source-details").classList.add("hidden");
  if (item.isBreakingRelease) card.dataset.breaking = "true";
  return node;
}

function renderDiag(diag) {
  els.diagList.innerHTML = diag.map((item) => `
    <div class="diag-card ${item.ok ? "ok" : "error"}">
      <strong>${escapeHtml(item.source)}</strong>
      <span>${item.ok ? `${item.count}件 / ${item.durationMs}ms` : `失敗: ${escapeHtml(item.error || "unknown")}`}</span>
    </div>
  `).join("");
}

function hasAny(item, keywords) {
  const text = [item.title, item.summary, ...(item.matchedKeywords || [])].join(" ");
  return keywords.some((keyword) => text.includes(keyword));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
