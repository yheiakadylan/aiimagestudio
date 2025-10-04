/* ===== WEB SHIM for settings.js: chrome.* -> localStorage + fetch =====
   - Dùng cho bản web (không có MV3). Bỏ qua nếu chạy trong extension thật.
   - Cung cấp: chrome.storage.local.{get,set,remove,clear} + runtime.sendMessage
   - Map "test.gai" -> gọi Google AI Models API để kiểm tra key.
*/

(function attachWebShim(){
  // Nếu trình duyệt đã có chrome.* (đang chạy trong extension) thì bỏ qua.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.runtime?.sendMessage) return;

  // storage shim qua localStorage
  function makeLocalStorageShim() {
    return {
      async get(keys) {
        if (keys == null) return {};
        const arr = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of arr) {
          const raw = localStorage.getItem(k);
          try { out[k] = raw ? JSON.parse(raw) : undefined; }
          catch { out[k] = raw; }
        }
        return out;
      },
      async set(obj) {
        Object.entries(obj || {}).forEach(([k, v]) => {
          localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
        });
        // Phát sự kiện giả nếu ai đó lắng nghe storage.onChanged
        try {
          const changes = {};
          for (const [k, v] of Object.entries(obj || {})) {
            changes[k] = { newValue: v };
          }
          chrome.storage?.onChanged?._emit?.(changes, "local");
        } catch {}
      },
      async remove(keys){
        (Array.isArray(keys)?keys:[keys]).forEach(k=>localStorage.removeItem(k));
      },
      async clear(){ localStorage.clear(); }
    };
  }

  // map message types từng dùng trong options/settings
  async function webSendMessage(msg) {
    try {
      switch (msg?.type) {
        // Test Google AI API key
        case "test.gai": {
          // Lấy key từ localStorage (đã lưu bởi settings UI)
          let key = localStorage.getItem("GOOGLE_API_KEY");
          try { key = JSON.parse(key); } catch {}
          if (!key) return { ok:false, error:"Missing GOOGLE_API_KEY" };

          // Gọi endpoint nhẹ nhất để test: liệt kê models (v1beta)
          const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key);
          const res = await fetch(url, { method: "GET" });
          if (!res.ok) return { ok:false, error:`HTTP ${res.status}` };
          return { ok:true };
        }

        default:
          return { ok:true }; // các message khác không dùng ở settings
      }
    } catch (e) {
      return { ok:false, error:String(e?.message||e) };
    }
  }

  // gắn shim
  window.chrome = window.chrome || {};
  chrome.storage = chrome.storage || {};
  chrome.storage.local = chrome.storage.local || makeLocalStorageShim();

  chrome.runtime = chrome.runtime || {};
  chrome.runtime.sendMessage = chrome.runtime.sendMessage || ((msg, cb) => {
    webSendMessage(msg).then((res)=>cb?.(res));
  });

  chrome.runtime.getURL = chrome.runtime.getURL || ((p) => new URL(p, location.href).href);

  chrome.storage.onChanged = chrome.storage.onChanged || {
    _handlers: [],
    addListener(fn){ this._handlers.push(fn); },
    _emit(changes, area){ this._handlers.forEach(fn=>fn(changes, area)); }
  };
})();

function makeLocalStorageShim() {
  return {
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) {
        const raw = localStorage.getItem(k);
        try { out[k] = raw ? JSON.parse(raw) : undefined; }
        catch { out[k] = raw; }
      }
      return out;
    },
    async set(obj) {
      Object.entries(obj || {}).forEach(([k, v]) => {
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      });
    },
    // nếu code của bạn có dùng .remove / .clear thì bổ sung tiếp:
    async remove(keys){
      (Array.isArray(keys)?keys:[keys]).forEach(k=>localStorage.removeItem(k));
    },
    async clear(){ localStorage.clear(); }
  };
}

// runtime shim: map các message type bạn từng gửi qua background
async function webSendMessage(msg) {
  try {
    switch (msg?.type) {
      case "test.gai": {
        const key = JSON.parse(localStorage.getItem("GOOGLE_API_KEY") || "null");
        if (!key) return { ok:false, error:"Missing GOOGLE_API_KEY" };

        // Trực tiếp gọi Google AI (chú ý: LỘ KEY). An toàn hơn: qua proxy serverless.
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" + encodeURIComponent(key);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }]}] })
        });
        return { ok: res.ok };
      }

      // Ví dụ: nếu trước đây bạn có msg "gen.image"… hãy map ở đây:
      // case "gen.image": { ... direct fetch ... return { ok:true, data } }

      default:
        return { ok:true };
    }
  } catch (e) {
    return { ok:false, error:String(e?.message||e) };
  }
}

// gắn shim nếu thiếu chrome.*
window.chrome = window.chrome || {};
chrome.storage = chrome.storage || {};
chrome.storage.local = chrome.storage.local || makeLocalStorageShim();
chrome.runtime = chrome.runtime || {};
chrome.runtime.sendMessage = chrome.runtime.sendMessage || ((msg, cb) => {
  webSendMessage(msg).then((res)=>cb?.(res));
});

// Nếu bạn dùng chrome.runtime.getURL trong content.js:
chrome.runtime.getURL = chrome.runtime.getURL || ((p) => new URL(p, location.href).href);

// Nếu bạn dùng chrome.storage.onChanged, có thể tự emit event đơn giản:
chrome.storage.onChanged = chrome.storage.onChanged || {
  _handlers: [],
  addListener(fn){ this._handlers.push(fn); },
  _emit(changes, area){ this._handlers.forEach(fn=>fn(changes, area)); }
};
// options.js — full file (Templates • Samples • Artwork References)
// - Giữ nguyên phong cách UI + ripple
// - Sửa lỗi: exportJSON undefined, TDZ (perPage/sPerPage/rPerPage), ResizeObserver
// - Dùng chung tính toán per-page (2–4 items tuỳ chiều cao panel)

document.addEventListener("DOMContentLoaded", init);

async function init() {
  /* ---------------------- Tabs + underline ---------------------- */
  const tabs = document.querySelectorAll(".tab");
  const tabsWrap = document.getElementById("tabs");

  const syncUnderline = () => {
    const act = document.querySelector(".tab.active");
    if (!act) return;
    const r = act.getBoundingClientRect();
    const rw = tabsWrap.getBoundingClientRect();
    const x = r.left - rw.left;
    tabsWrap.style.setProperty("--tab-x", `${x}px`);
    tabsWrap.style.setProperty("--tab-w", `${r.width}px`);
  };

  const show = (id, on = false) =>
    document.getElementById(id)?.classList.toggle("hide", !on);

  const makeActive = (t) => {
    tabs.forEach((x) => x.classList.toggle("active", x === t));
    show("view-keys", t.dataset.v === "keys");
    show("view-tpl", t.dataset.v === "tpl");
    show("view-samples", t.dataset.v === "samples");
    show("view-refs", t.dataset.v === "refs");
    syncUnderline();
    // recompute cho panel hiện tại
    if (t.dataset.v === "tpl") setTimeout(recomputePerPage, 40);
    if (t.dataset.v === "samples") setTimeout(recomputeSamplePerPage, 40);
    if (t.dataset.v === "refs") setTimeout(recomputeRefPerPage, 40);
  };

  tabs.forEach((t) => t.addEventListener("click", () => makeActive(t)));
  makeActive(document.querySelector(".tab.active") || tabs[0]);
  addRipple([...document.querySelectorAll(".btn, .pg, .tab")]);

  /* ------------------------ API Key block ----------------------- */
  const k = await safeGet(["GOOGLE_API_KEY"]);
  document.getElementById("gkey").value = k.GOOGLE_API_KEY || "";

  document.getElementById("saveKeys").addEventListener("click", async () => {
    await chrome.storage.local.set({
      GOOGLE_API_KEY: document.getElementById("gkey").value.trim(),
    });
    setBadge("testRes", "Saved ✔", true);
  });

  document.getElementById("testBtn").addEventListener("click", async () => {
    setBadge("testRes", "Testing…", true);
    const r = await send("test.gai");
    const ok = !!r?.ok;
    const el = document.getElementById("testRes");
    el.textContent = ok ? "Google AI: OK" : "Fail";
    el.style.background = ok ? "#0f3d2a" : "#3a1420";
    el.style.borderColor = ok ? "#1e8f60" : "#7f1d1d";
    el.style.color = "#fff";
  });

  /* ========================= Templates ========================= */
  // State (khai báo SỚM để tránh TDZ)
  let editId = null;
  let page = 1,
    perPage = 3,
    total = 0;

  // Export / Import
  async function exportJSON() {
    const { TEMPLATES = [] } = await safeGet(["TEMPLATES"]);
    const blob = new Blob([JSON.stringify(TEMPLATES, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-image-studio-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImportFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error("Invalid JSON");
      const { TEMPLATES = [] } = await safeGet(["TEMPLATES"]);
      const byKey = new Map();
      const put = (x) =>
        byKey.set(x.id || x.name + "|" + x.prompt, {
          id: x.id || crypto.randomUUID(),
          name: x.name || "Untitled",
          prompt: String(x.prompt || ""),
          createdAt: x.createdAt || Date.now(),
        });
      TEMPLATES.forEach(put);
      arr.forEach(put);
      const merged = [...byKey.values()].sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );
      await chrome.storage.local.set({ TEMPLATES: merged });
      page = 1;
      await renderList();
      flash("msg2", "Imported ✔");
    } catch (err) {
      console.warn(err);
      flash("msg2", "Import failed");
    } finally {
      e.target.value = "";
    }
  }

  // Gắn handler export/import
  const importFile = document.getElementById("importFile");
  document.getElementById("exportJson").onclick = exportJSON;
  document.getElementById("importJson").onclick = () => importFile.click();
  importFile.onchange = onImportFile;

  // Editor -> Add/Update
  document.getElementById("addTpl").addEventListener("click", async () => {
    const name = document.getElementById("tplName").value.trim();
    const prompt = document.getElementById("tplPrompt").value.trim();
    if (!name || !prompt) return;

    const { TEMPLATES = [] } = await safeGet(["TEMPLATES"]);
    const list = TEMPLATES.slice();

    if (editId) {
      const i = list.findIndex((x) => x.id === editId);
      if (i !== -1) list[i] = { ...list[i], name, prompt };
      editId = null;
      document.getElementById("addTplLabel").textContent = "Add Template";
      await chrome.storage.local.set({ TEMPLATES: list });
      flash("msg2", "Updated ✔");
    } else {
      list.unshift({
        id: crypto.randomUUID(),
        name,
        prompt,
        createdAt: Date.now(),
      });
      await chrome.storage.local.set({ TEMPLATES: list });
      flash("msg2", "Added ✔");
    }
    document.getElementById("tplName").value = "";
    document.getElementById("tplPrompt").value = "";
    page = 1;
    await renderList();
  });

  // List + pagination
  document.getElementById("list").addEventListener("click", onListClick);
  document.getElementById("pagi").addEventListener("click", onPagiClick);
  await renderList();

  async function renderList() {
    const { TEMPLATES = [] } = await safeGet(["TEMPLATES"]);
    total = TEMPLATES.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    page = Math.min(Math.max(1, page), pages);
    const start = (page - 1) * perPage;
    const chunk = TEMPLATES.slice(start, start + perPage);

    document.getElementById(
      "metaBadge"
    ).textContent = `${total} total • Page ${page}/${pages}`;

    const listEl = document.getElementById("list");
    listEl.innerHTML = "";
    if (!chunk.length) {
      listEl.innerHTML =
        '<div class="muted" style="align-self:center;margin-top:8px">No templates.</div>';
    } else {
      for (const t of chunk) {
        const div = document.createElement("div");
        div.className = "tpl-card";
        div.innerHTML = `
          <div class="title-line">
            <div class="tname">${esc(t.name)}</div>
            <div class="badge">${new Date(t.createdAt).toLocaleString()}</div>
          </div>
          <div class="snippet">${esc(t.prompt)}</div>
          <div class="btns">
            <button class="btn ghost small" data-action="edit" data-id="${t.id}">Edit</button>
            <button class="btn danger small" data-action="delete" data-id="${t.id}">Delete</button>
          </div>`;
        listEl.appendChild(div);
      }
      addRipple([...listEl.querySelectorAll(".btn")]);
    }

    const pagi = document.getElementById("pagi");
    pagi.innerHTML = "";
    const addBtn = (lbl, action, disabled = false, active = false) => {
      const b = document.createElement("button");
      b.className = "pg" + (active ? " active" : "");
      b.textContent = lbl;
      b.dataset.action = action;
      if (disabled) b.disabled = true;
      pagi.appendChild(b);
    };
    addBtn("« First", "first", page === 1);
    addBtn("‹ Prev", "prev", page === 1);
    const pagesArr = [...Array(pages)].map((_, i) => i + 1);
    pagesArr
      .filter((p) => Math.abs(p - page) <= 2)
      .forEach((p) => addBtn(String(p), "goto:" + p, false, p === page));
    addBtn("Next ›", "next", page === pages);
    addBtn("Last »", "last", page === pages);
    addRipple([...pagi.querySelectorAll(".pg")]);
  }

  async function onListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action,
      id = btn.dataset.id;

    const { TEMPLATES = [] } = await safeGet(["TEMPLATES"]);
    let list = TEMPLATES.slice();

    if (action === "delete") {
      list = list.filter((x) => x.id !== id);
      await chrome.storage.local.set({ TEMPLATES: list });
      if (editId === id) {
        editId = null;
        document.getElementById("tplName").value = "";
        document.getElementById("tplPrompt").value = "";
        document.getElementById("addTplLabel").textContent = "Add Template";
      }
      await renderList();
    }

    if (action === "edit") {
      const item = list.find((x) => x.id === id);
      if (!item) return;
      document.getElementById("tplName").value = item.name;
      document.getElementById("tplPrompt").value = item.prompt;
      editId = id;
      document.getElementById("addTplLabel").textContent = "Update Template";
    }
  }

  function onPagiClick(e) {
    const b = e.target.closest(".pg");
    if (!b) return;
    const act = b.dataset.action;
    if (act === "first") page = 1;
    else if (act === "prev") page = Math.max(1, page - 1);
    else if (act === "next") page = page + 1;
    else if (act === "last") page = 1e9;
    else if (act?.startsWith("goto:")) page = parseInt(act.split(":")[1], 10) || 1;
    renderList();
  }

  function recomputePerPage() {
    const holder = document.getElementById("list");
    if (!holder) return;
    const h = holder.clientHeight || 0;
    const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10))));
    if (per !== perPage) {
      perPage = per;
      renderList();
    }
  }

  /* =========================== Samples ========================== */
  let sPage = 1,
    sPerPage = 3,
    sTotal = 0;

  const sampleImportFile = document.getElementById("sampleImportFile");
  document.getElementById("addSampleBtn").onclick = () => sampleImportFile.click();
  document.getElementById("pasteSampleBtn").onclick = onPasteSample;
  document.getElementById("exportSamples").onclick = exportSamplesJSON;
  document.getElementById("importSamples").onclick = () => sampleImportFile.click();
  sampleImportFile.onchange = onChooseSample;

  function setSampleBadge(msg, ok = true) {
    const el = document.getElementById("sampleMsg");
    el.textContent = msg;
    el.style.background = ok ? "#0f3d2a" : "#3a1420";
    el.style.borderColor = ok ? "#1e8f60" : "#7f1d1d";
    el.style.color = "#fff";
  }

  function recomputeSamplePerPage() {
    const holder = document.getElementById("sampleList");
    if (!holder) return;
    const h = holder.clientHeight || 0;
    const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10))));
    if (per !== sPerPage) {
      sPerPage = per;
      renderSampleList();
    }
  }

async function onChooseSample(e){
  const files = [...(e.target.files || [])];
  if (!files.length) return;

  let added = 0, imported = 0, failed = 0;

  for (const f of files){
    try{
      if (f.type === "application/json"){
        const text = await f.text();
        const list = JSON.parse(text);
        await chrome.storage.local.set({ SAMPLE_TEMPLATES: normalizeItems(list) });
        imported++;
      } else if (f.type.startsWith("image/")){
        const nameBase = document.getElementById("sampleName").value.trim() || f.name;
        const dataUrl = await fileToDataURL(f);
        await upsertSample({ name: nameBase, dataUrl });
        added++;
      }
    }catch{ failed++; }
  }

  await renderSampleList();
  setSampleBadge(`${added} added • ${imported} imported${failed?` • ${failed} failed`:''}`, failed===0);
  e.target.value = "";
}


async function onPasteSample(){
  try{
    const dataUrls = await readImagesFromClipboard();
    if (!dataUrls.length) return setSampleBadge("Clipboard empty", false);

    const base = document.getElementById("sampleName").value.trim() || "sample";
    let i = 1;
    for (const url of dataUrls){
      await upsertSample({ name: `${base} ${i>1?`(${i})`:''}`, dataUrl: url });
      i++;
    }
    setSampleBadge(`Pasted ${dataUrls.length} ✔`);
  }catch(err){ console.warn(err); setSampleBadge("Failed", false); }
}


  async function upsertSample({ id, name, dataUrl }) {
    const { SAMPLE_TEMPLATES = [] } = await safeGet(["SAMPLE_TEMPLATES"]);
    const list = SAMPLE_TEMPLATES.slice();
    const item = {
      id: id || crypto.randomUUID(),
      name,
      dataUrl,
      createdAt: Date.now(),
    };
    if (id) {
      const i = list.findIndex((x) => x.id === id);
      if (i !== -1) list[i] = { ...list[i], ...item };
    } else {
      list.unshift(item);
    }
    await chrome.storage.local.set({ SAMPLE_TEMPLATES: list });
    sPage = 1;
    await renderSampleList();
  }

  function normalizeItems(arr) {
    return (Array.isArray(arr) ? arr : [])
      .map((x) => ({
        id: x.id || crypto.randomUUID(),
        name: String(x.name || "Untitled"),
        dataUrl: String(x.dataUrl || ""),
        createdAt: x.createdAt || Date.now(),
      }))
      .filter((x) => x.dataUrl);
  }

  async function renderSampleList() {
    const { SAMPLE_TEMPLATES = [] } = await safeGet(["SAMPLE_TEMPLATES"]);
    sTotal = SAMPLE_TEMPLATES.length;
    const pages = Math.max(1, Math.ceil(sTotal / sPerPage));
    sPage = Math.min(Math.max(1, sPage), pages);

    const start = (sPage - 1) * sPerPage;
    const chunk = SAMPLE_TEMPLATES.slice(start, start + sPerPage);

    document.getElementById(
      "sampleMeta"
    ).textContent = `${sTotal} total • Page ${sPage}/${pages}`;

    const listEl = document.getElementById("sampleList");
    listEl.innerHTML = "";
    if (!chunk.length) {
      listEl.innerHTML =
        '<div class="muted" style="align-self:center;margin-top:8px">No samples.</div>';
    } else {
      for (const s of chunk) {
        const card = document.createElement("div");
        card.className = "tpl-card";
        card.innerHTML = `
          <div class="title-line">
            <div class="tname">${esc(s.name)}</div>
            <div class="badge">${new Date(s.createdAt).toLocaleString()}</div>
          </div>
          <div class="snippet" style="display:flex;gap:10px;align-items:center">
            <img src="${esc(
              s.dataUrl
            )}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #23335a" />
            <span class="muted">Stored locally</span>
          </div>
          <div class="btns">
            <button class="btn ghost small" data-act="rename" data-id="${s.id}">Rename</button>
            <button class="btn danger small" data-act="delete" data-id="${s.id}">Delete</button>
          </div>`;
        listEl.appendChild(card);
      }
      addRipple([...listEl.querySelectorAll(".btn")]);
    }

    const pg = document.getElementById("samplePagi");
    pg.innerHTML = "";
    const addBtn = (lbl, act, dis = false, active = false) => {
      const b = document.createElement("button");
      b.className = "pg" + (active ? " active" : "");
      b.textContent = lbl;
      b.dataset.action = act;
      if (dis) b.disabled = true;
      pg.appendChild(b);
    };
    addBtn("« First", "first", sPage === 1);
    addBtn("‹ Prev", "prev", sPage === 1);
    const pagesArr = [...Array(pages)].map((_, i) => i + 1);
    pagesArr
      .filter((p) => Math.abs(p - sPage) <= 2)
      .forEach((p) => addBtn(String(p), "goto:" + p, false, p === sPage));
    addBtn("Next ›", "next", sPage === pages);
    addBtn("Last »", "last", sPage === pages);

    pg.onclick = (e) => {
      const b = e.target.closest(".pg");
      if (!b) return;
      const act = b.dataset.action;
      if (act === "first") sPage = 1;
      else if (act === "prev") sPage = Math.max(1, sPage - 1);
      else if (act === "next") sPage = sPage + 1;
      else if (act === "last") sPage = 1e9;
      else if (act?.startsWith("goto:"))
        sPage = parseInt(act.split(":")[1], 10) || 1;
      renderSampleList();
    };

    listEl.onclick = async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { SAMPLE_TEMPLATES = [] } = await safeGet(["SAMPLE_TEMPLATES"]);
      if (btn.dataset.act === "delete") {
        const filtered = SAMPLE_TEMPLATES.filter((x) => x.id !== btn.dataset.id);
        await chrome.storage.local.set({ SAMPLE_TEMPLATES: filtered });
        await renderSampleList();
      }
      if (btn.dataset.act === "rename") {
        const it = SAMPLE_TEMPLATES.find((x) => x.id === btn.dataset.id);
        if (!it) return;
        const name = prompt("New name:", it.name || "Untitled");
        if (!name) return;
        await upsertSample({ ...it, name });
      }
    };
  }

  async function exportSamplesJSON() {
    const { SAMPLE_TEMPLATES = [] } = await safeGet(["SAMPLE_TEMPLATES"]);
    const blob = new Blob([JSON.stringify(SAMPLE_TEMPLATES, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-image-studio-samples-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ======================= Artwork References =================== */
  let rPage = 1,
    rPerPage = 3,
    rTotal = 0;

  const refImportFile = document.getElementById("refImportFile");
  document.getElementById("addRefBtn").onclick = () => refImportFile.click();
  document.getElementById("pasteRefBtn").onclick = onPasteRef;
  document.getElementById("exportRefs").onclick = exportRefsJSON;
  document.getElementById("importRefs").onclick = () => refImportFile.click();
  refImportFile.onchange = onChooseRef;

  function setRefBadge(msg, ok = true) {
    const el = document.getElementById("refMsg");
    el.textContent = msg;
    el.style.background = ok ? "#0f3d2a" : "#3a1420";
    el.style.borderColor = ok ? "#1e8f60" : "#7f1d1d";
    el.style.color = "#fff";
  }

  function recomputeRefPerPage() {
    const holder = document.getElementById("refList");
    if (!holder) return;
    const h = holder.clientHeight || 0;
    const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10))));
    if (per !== rPerPage) {
      rPerPage = per;
      renderRefList();
    }
  }

async function onChooseRef(e){
  const files = [...(e.target.files || [])];
  if (!files.length) return;

  let added = 0, imported = 0, failed = 0;

  for (const f of files){
    try{
      if (f.type === "application/json"){
        const text = await f.text();
        const list = JSON.parse(text);
        await chrome.storage.local.set({ ARTREF_TEMPLATES: normalizeItems(list) });
        imported++;
      } else if (f.type.startsWith("image/")){
        const nameBase = document.getElementById("refName").value.trim() || f.name;
        const dataUrl = await fileToDataURL(f);
        await upsertRef({ name: nameBase, dataUrl });
        added++;
      }
    }catch{ failed++; }
  }

  await renderRefList();
  setRefBadge(`${added} added • ${imported} imported${failed?` • ${failed} failed`:''}`, failed===0);
  e.target.value = "";
}


async function onPasteRef(){
  try{
    const dataUrls = await readImagesFromClipboard();
    if (!dataUrls.length) return setRefBadge("Clipboard empty", false);

    const base = document.getElementById("refName").value.trim() || "ref";
    let i = 1;
    for (const url of dataUrls){
      await upsertRef({ name: `${base} ${i>1?`(${i})`:''}`, dataUrl: url });
      i++;
    }
    setRefBadge(`Pasted ${dataUrls.length} ✔`);
  }catch(err){ console.warn(err); setRefBadge("Failed", false); }
}


  async function upsertRef({ id, name, dataUrl }) {
    const { ARTREF_TEMPLATES = [] } = await safeGet(["ARTREF_TEMPLATES"]);
    const list = ARTREF_TEMPLATES.slice();
    const item = {
      id: id || crypto.randomUUID(),
      name,
      dataUrl,
      createdAt: Date.now(),
    };
    if (id) {
      const i = list.findIndex((x) => x.id === id);
      if (i !== -1) list[i] = { ...list[i], ...item };
    } else {
      list.unshift(item);
    }
    await chrome.storage.local.set({ ARTREF_TEMPLATES: list });
    rPage = 1;
    await renderRefList();
  }

  async function renderRefList() {
    const { ARTREF_TEMPLATES = [] } = await safeGet(["ARTREF_TEMPLATES"]);
    rTotal = ARTREF_TEMPLATES.length;
    const pages = Math.max(1, Math.ceil(rTotal / rPerPage));
    rPage = Math.min(Math.max(1, rPage), pages);

    const start = (rPage - 1) * rPerPage;
    const chunk = ARTREF_TEMPLATES.slice(start, start + rPerPage);

    document.getElementById(
      "refMeta"
    ).textContent = `${rTotal} total • Page ${rPage}/${pages}`;

    const listEl = document.getElementById("refList");
    listEl.innerHTML = "";
    if (!chunk.length) {
      listEl.innerHTML =
        '<div class="muted" style="align-self:center;margin-top:8px">No references.</div>';
    } else {
      for (const s of chunk) {
        const card = document.createElement("div");
        card.className = "tpl-card";
        card.innerHTML = `
          <div class="title-line">
            <div class="tname">${esc(s.name)}</div>
            <div class="badge">${new Date(s.createdAt).toLocaleString()}</div>
          </div>
          <div class="snippet" style="display:flex;gap:10px;align-items:center">
            <img src="${esc(
              s.dataUrl
            )}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #23335a" />
            <span class="muted">Stored locally</span>
          </div>
          <div class="btns">
            <button class="btn ghost small" data-act="rename" data-id="${s.id}">Rename</button>
            <button class="btn danger small" data-act="delete" data-id="${s.id}">Delete</button>
          </div>`;
        listEl.appendChild(card);
      }
      addRipple([...listEl.querySelectorAll(".btn")]);
    }

    const pg = document.getElementById("refPagi");
    pg.innerHTML = "";
    const addBtn = (lbl, act, dis = false, active = false) => {
      const b = document.createElement("button");
      b.className = "pg" + (active ? " active" : "");
      b.textContent = lbl;
      b.dataset.action = act;
      if (dis) b.disabled = true;
      pg.appendChild(b);
    };
    addBtn("« First", "first", rPage === 1);
    addBtn("‹ Prev", "prev", rPage === 1);
    const pagesArr = [...Array(pages)].map((_, i) => i + 1);
    pagesArr
      .filter((p) => Math.abs(p - rPage) <= 2)
      .forEach((p) => addBtn(String(p), "goto:" + p, false, p === rPage));
    addBtn("Next ›", "next", rPage === pages);
    addBtn("Last »", "last", rPage === pages);

    pg.onclick = (e) => {
      const b = e.target.closest(".pg");
      if (!b) return;
      const act = b.dataset.action;
      if (act === "first") rPage = 1;
      else if (act === "prev") rPage = Math.max(1, rPage - 1);
      else if (act === "next") rPage = rPage + 1;
      else if (act === "last") rPage = 1e9;
      else if (act?.startsWith("goto:"))
        rPage = parseInt(act.split(":")[1], 10) || 1;
      renderRefList();
    };

    listEl.onclick = async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { ARTREF_TEMPLATES = [] } = await safeGet(["ARTREF_TEMPLATES"]);
      if (btn.dataset.act === "delete") {
        const filtered = ARTREF_TEMPLATES.filter((x) => x.id !== btn.dataset.id);
        await chrome.storage.local.set({ ARTREF_TEMPLATES: filtered });
        await renderRefList();
      }
      if (btn.dataset.act === "rename") {
        const it = ARTREF_TEMPLATES.find((x) => x.id === btn.dataset.id);
        if (!it) return;
        const name = prompt("New name:", it.name || "Untitled");
        if (!name) return;
        await upsertRef({ ...it, name });
      }
    };
  }

  async function exportRefsJSON() {
    const { ARTREF_TEMPLATES = [] } = await safeGet(["ARTREF_TEMPLATES"]);
    const blob = new Blob([JSON.stringify(ARTREF_TEMPLATES, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-image-studio-artrefs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------ ResizeObserver dùng chung ----------------- */
  const resizeObs = new ResizeObserver(() => {
    syncUnderline();
    recomputePerPage();
    recomputeSamplePerPage();
    recomputeRefPerPage();
  });
  // Quan sát body + các panel nếu tồn tại
  resizeObs.observe(document.body);
  ["rightPanel", "samplesRightPanel", "refsRightPanel"]
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .forEach((el) => resizeObs.observe(el));

  // Khởi tạo list ngay khi mở trang
  renderSampleList();
  renderRefList();
}

/* =========================== Helpers =========================== */
function send(type, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message || String(err) });
        else resolve(res);
      });
    } catch (e) {
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

async function safeGet(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch {
    return Array.isArray(keys)
      ? Object.fromEntries(keys.map((k) => [k, undefined]))
      : { [keys]: undefined };
  }
}

const flash = (id, msg) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 1500);
};

const setBadge = (id, msg, ok) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add("badge");
  el.style.background = ok ? "#0f3d2a" : "#3a1420";
  el.style.borderColor = ok ? "#1e8f60" : "#7f1d1d";
  el.style.color = "#fff";
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );

function addRipple(nodes) {
  nodes.forEach((n) => {
    n.addEventListener(
      "click",
      function (ev) {
        const r = this.getBoundingClientRect();
        const d = Math.max(r.width, r.height);
        const ripple = document.createElement("span");
        ripple.style.cssText = `
          position:absolute; left:${ev.clientX - r.left - d / 2}px; top:${
          ev.clientY - r.top - d / 2
        }px;
          width:${d}px; height:${d}px; border-radius:50%;
          background: radial-gradient(circle, rgba(255,255,255,.35) 0%, rgba(255,255,255,.15) 40%, transparent 60%);
          pointer-events:none; transform: scale(0); opacity:.9; filter: blur(.2px);
          transition: transform .45s ease, opacity .6s ease;
        `;
        this.appendChild(ripple);
        requestAnimationFrame(() => {
          ripple.style.transform = "scale(1)";
          ripple.style.opacity = "0";
        });
        setTimeout(() => ripple.remove(), 620);
      },
      { passive: true }
    );
  });
}

function fileToDataURL(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}
async function readImagesFromClipboard(){
  const urls = [];
  try{
    const items = await navigator.clipboard.read();
    for (const it of items){
      for (const t of it.types){
        if (t.startsWith("image/")){
          const blob = await it.getType(t);
          urls.push(await blobToDataURL(blob));
        }
      }
    }
  }catch{}
  return urls;
}


function blobToDataURL(b) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(b);
  });
}
