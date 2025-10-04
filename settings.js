/* settings.js — Web Settings
   - Seed dữ liệu mặc định từ window.APP_CONFIG vào storage (lần đầu)
   - Khóa/ẩn tab API Keys (key nằm trong config.js)
   - Templates / Samples / Artwork Refs: import/export, add/paste, phân trang
   - Hỗ trợ add MULTI FILES cho Samples & Refs
*/

(() => {
  // -------------------- Storage shim --------------------
  const storage = {
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) {
        const raw = localStorage.getItem(k);
        try { out[k] = raw ? JSON.parse(raw) : undefined; }
        catch { out[k] = undefined; }
      }
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    }
  };

  // -------------------- Config helpers --------------------
  function getApiKey() {
    return (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_API_KEY) || "";
  }
  async function seedDefaultsIfEmpty() {
    const got = await storage.get(["TEMPLATES","SAMPLE_TEMPLATES","ARTREF_TEMPLATES"]);
    const sets = {};
    if (!Array.isArray(got.TEMPLATES) || got.TEMPLATES.length === 0) {
      sets.TEMPLATES = (window.APP_CONFIG?.TEMPLATES || []).slice();
    }
    if (!Array.isArray(got.SAMPLE_TEMPLATES) || got.SAMPLE_TEMPLATES.length === 0) {
      sets.SAMPLE_TEMPLATES = (window.APP_CONFIG?.SAMPLE_TEMPLATES || []).slice();
    }
    if (!Array.isArray(got.ARTREF_TEMPLATES) || got.ARTREF_TEMPLATES.length === 0) {
      sets.ARTREF_TEMPLATES = (window.APP_CONFIG?.ARTREF_TEMPLATES || []).slice();
    }
    if (Object.keys(sets).length) await storage.set(sets);
  }

  // -------------------- Helpers --------------------
  const $ = (sel, rt=document)=> rt.querySelector(sel);
  const esc = (s)=> String(s??"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const setBadge = (el,msg,ok=true)=>{ el.textContent=msg; el.classList.add("badge"); el.style.background= ok?"#0f3d2a":"#3a1420"; el.style.borderColor= ok?"#1e8f60":"#7f1d1d"; el.style.color="#fff"; };

  function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }
  async function readImageFromClipboard(){
    try{
      const items = await navigator.clipboard.read();
      for (const it of items){
        for (const t of it.types){
          if (t.startsWith("image/")){
            const blob = await it.getType(t);
            return await fileToDataURL(blob);
          }
        }
      }
    }catch{}
    return null;
  }
  function normalizeItems(arr){
    return (Array.isArray(arr) ? arr : []).map(x => ({
      id: x.id || crypto.randomUUID(),
      name: String(x.name || "Untitled"),
      dataUrl: String(x.dataUrl || ""),
      createdAt: x.createdAt || Date.now()
    })).filter(x => x.dataUrl);
  }

  // -------------------- UI & logic --------------------
  document.addEventListener("DOMContentLoaded", async () => {
    await seedDefaultsIfEmpty();

    // Ẩn tab “API Keys” vì key nằm trong code
    const tabKeys = document.querySelector('.tab[data-v="keys"]');
    const keysView = document.getElementById("view-keys");
    if (tabKeys) tabKeys.remove();
    if (keysView) keysView.remove();

    // Tabs underline / switching
    const tabs = document.querySelectorAll(".tab");
    const tabsWrap = document.getElementById("tabs");
    const syncUnderline = () => {
      const act = document.querySelector(".tab.active"); if (!act) return;
      const r = act.getBoundingClientRect(), rw = tabsWrap.getBoundingClientRect();
      const x = r.left - rw.left;
      tabsWrap.style.setProperty("--tab-x", `${x}px`);
      tabsWrap.style.setProperty("--tab-w", `${r.width}px`);
    };
    const show = (id, on=false)=> document.getElementById(id).classList.toggle("hide", !on);
    const makeActive = (t) => {
      tabs.forEach(x => x.classList.toggle("active", x === t));
      show("view-tpl", t.dataset.v === "tpl");
      show("view-samples", t.dataset.v === "samples");
      show("view-refs", t.dataset.v === "refs");
      syncUnderline();
      if (t.dataset.v === "tpl") setTimeout(() => recomputePerPage(), 60);
      if (t.dataset.v === "samples") setTimeout(() => recomputeSamplePerPage(), 60);
      if (t.dataset.v === "refs") setTimeout(() => recomputeRefPerPage(), 60);
    };
    tabs.forEach(t => t.addEventListener("click", () => makeActive(t)));
    makeActive(document.querySelector('.tab[data-v="tpl"]') || tabs[0]);
    window.addEventListener("resize", syncUnderline);

    // ========= Templates =========
    let page = 1, perPage = 3, total = 0, editId = null;

    function recomputePerPage(){
      const holder = document.getElementById("list");
      const h = holder.clientHeight || 0;
      const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10))));
      if (per !== perPage){ perPage = per; renderList(); }
    }

    document.getElementById("addTpl").addEventListener("click", async () => {
      const name = document.getElementById("tplName").value.trim();
      const prompt = document.getElementById("tplPrompt").value.trim();
      if (!name || !prompt) return;
      const { TEMPLATES = [] } = await storage.get("TEMPLATES");
      const list = Array.isArray(TEMPLATES) ? TEMPLATES.slice() : [];
      if (editId) {
        const i = list.findIndex(x => x.id === editId);
        if (i !== -1) list[i] = { ...list[i], name, prompt };
        editId = null; document.getElementById("addTplLabel").textContent = "Add Template";
        await storage.set({ TEMPLATES: list });
        setBadge(document.getElementById("msg2"), "Updated ✔", true);
      } else {
        list.unshift({ id: crypto.randomUUID(), name, prompt, createdAt: Date.now() });
        await storage.set({ TEMPLATES: list });
        setBadge(document.getElementById("msg2"), "Added ✔", true);
      }
      document.getElementById("tplName").value = "";
      document.getElementById("tplPrompt").value = "";
      page = 1;
      await renderList();
    });

    document.getElementById("exportJson").onclick = async ()=>{
      const { TEMPLATES = [] } = await storage.get("TEMPLATES");
      const blob = new Blob([JSON.stringify(TEMPLATES, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ai-image-studio-templates-${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(url);
    };
    const importFile = document.getElementById("importFile");
    document.getElementById("importJson").onclick = ()=> importFile.click();
    importFile.onchange = async (e)=>{
      const f = e.target.files?.[0]; if (!f) return;
      try{
        const text = await f.text();
        const list = JSON.parse(text);
        await storage.set({ TEMPLATES: Array.isArray(list) ? list : [] });
        page = 1; await renderList();
        setBadge(document.getElementById("msg2"), "Imported ✔", true);
      }catch{ setBadge(document.getElementById("msg2"), "Failed", false); }
      finally{ e.target.value = ""; }
    };

    document.getElementById("list").addEventListener("click", onListClick);
    document.getElementById("pagi").addEventListener("click", onPagiClick);
    await renderList();

    async function renderList(){
      const { TEMPLATES = [] } = await storage.get("TEMPLATES");
      total = TEMPLATES.length;
      const pages = Math.max(1, Math.ceil(total / perPage));
      page = Math.min(Math.max(1, page), pages);
      const start = (page - 1) * perPage;
      const chunk = TEMPLATES.slice(start, start + perPage);

      document.getElementById("metaBadge").textContent = `${total} total • Page ${page}/${pages}`;
      const listEl = document.getElementById("list");
      listEl.innerHTML = "";
      if (!chunk.length) {
        listEl.innerHTML = `<div class="muted" style="align-self:center;margin-top:8px">No templates.</div>`;
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
      }
      const pg = document.getElementById("pagi");
      pg.innerHTML = "";
      const addBtn = (lbl, action, disabled=false, active=false) => {
        const b = document.createElement("button");
        b.className = "pg" + (active ? " active":"");
        b.textContent = lbl;
        if (disabled) b.disabled = true;
        b.dataset.action = action;
        pg.appendChild(b);
      };
      addBtn("« First","first", page===1);
      addBtn("‹ Prev","prev", page===1);
      const pagesArr = [...Array(pages)].map((_,i)=>i+1);
      const win = pagesArr.filter(p => Math.abs(p - page) <= 2);
      win.forEach(p => addBtn(String(p), "goto:"+p, false, p===page));
      addBtn("Next ›","next", page===pages);
      addBtn("Last »","last", page===pages);
    }
    async function onListClick(e){
      const btn = e.target.closest("button[data-action]"); if (!btn) return;
      const action = btn.dataset.action, id = btn.dataset.id;
      const { TEMPLATES = [] } = await storage.get("TEMPLATES");
      let list = TEMPLATES.slice();
      if (action === "delete") {
        list = list.filter(x => x.id !== id);
        await storage.set({ TEMPLATES: list });
        if (editId === id) {
          editId = null;
          document.getElementById("tplName").value="";
          document.getElementById("tplPrompt").value="";
          document.getElementById("addTplLabel").textContent="Add Template";
        }
        await renderList();
      }
      if (action === "edit") {
        const item = list.find(x => x.id === id); if (!item) return;
        document.getElementById("tplName").value = item.name;
        document.getElementById("tplPrompt").value = item.prompt;
        editId = id; document.getElementById("addTplLabel").textContent = "Update Template";
      }
    }
    function onPagiClick(e){
      const b = e.target.closest(".pg"); if (!b) return;
      const act = b.dataset.action;
      if (act === "first") page = 1;
      else if (act === "prev") page = Math.max(1, page-1);
      else if (act === "next") page = page+1;
      else if (act === "last") page = 1e9;
      else if (act?.startsWith("goto:")) page = parseInt(act.split(":")[1],10) || 1;
      renderList();
    }

    // ========= Samples =========
    let sPage = 1, sPerPage = 3, sTotal = 0;

    function recomputeSamplePerPage(){
      const holder = document.getElementById("sampleList");
      const h = holder.clientHeight || 0;
      const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10)))); // 2..4
      if (per !== sPerPage){ sPerPage = per; renderSampleList(); }
    }

    const sampleImportFile = document.getElementById("sampleImportFile");
    sampleImportFile.multiple = true;
    document.getElementById("addSampleBtn").onclick = ()=> sampleImportFile.click();
    document.getElementById("pasteSampleBtn").onclick = onPasteSample;
    document.getElementById("exportSamples").onclick = exportSamplesJSON;
    document.getElementById("importSamples").onclick = ()=> sampleImportFile.click();
    sampleImportFile.onchange = onChooseSample;

    async function onChooseSample(e){
      const files = Array.from(e.target.files||[]);
      if (!files.length) return;
      try{
        if (files.length===1 && files[0].type === "application/json") {
          const text = await files[0].text();
          const list = JSON.parse(text);
          await storage.set({ SAMPLE_TEMPLATES: normalizeItems(list) });
          sPage = 1; await renderSampleList();
          setBadge(document.getElementById("sampleMsg"), "Imported ✔");
        } else {
          const name = document.getElementById("sampleName").value.trim();
          const { SAMPLE_TEMPLATES = [] } = await storage.get("SAMPLE_TEMPLATES");
          const list = Array.isArray(SAMPLE_TEMPLATES) ? SAMPLE_TEMPLATES.slice() : [];
          for (const f of files){
            if (!f.type.startsWith("image/")) continue;
            const dataUrl = await fileToDataURL(f);
            list.unshift({ id:crypto.randomUUID(), name: name || f.name, dataUrl, createdAt: Date.now() });
          }
          await storage.set({ SAMPLE_TEMPLATES: list });
          sPage = 1; await renderSampleList();
          setBadge(document.getElementById("sampleMsg"), "Added ✔");
        }
      }catch{ setBadge(document.getElementById("sampleMsg"), "Failed", false); }
      finally{ e.target.value = ""; }
    }
    async function onPasteSample(){
      try{
        const name = document.getElementById("sampleName").value.trim() || ("sample-"+Date.now());
        const dataUrl = await readImageFromClipboard();
        if (!dataUrl) return setBadge(document.getElementById("sampleMsg"), "Clipboard empty", false);
        const { SAMPLE_TEMPLATES = [] } = await storage.get("SAMPLE_TEMPLATES");
        const list = Array.isArray(SAMPLE_TEMPLATES) ? SAMPLE_TEMPLATES.slice() : [];
        list.unshift({ id:crypto.randomUUID(), name, dataUrl, createdAt: Date.now() });
        await storage.set({ SAMPLE_TEMPLATES: list });
        sPage = 1; await renderSampleList();
        setBadge(document.getElementById("sampleMsg"), "Pasted ✔");
      }catch{ setBadge(document.getElementById("sampleMsg"), "Failed", false); }
    }
    async function renderSampleList(){
      const { SAMPLE_TEMPLATES = [] } = await storage.get("SAMPLE_TEMPLATES");
      sTotal = SAMPLE_TEMPLATES.length;
      const pages = Math.max(1, Math.ceil(sTotal / sPerPage));
      sPage = Math.min(Math.max(1, sPage), pages);
      const start = (sPage - 1) * sPerPage;
      const chunk = SAMPLE_TEMPLATES.slice(start, start + sPerPage);
      document.getElementById("sampleMeta").textContent = `${sTotal} total • Page ${sPage}/${pages}`;
      const listEl = document.getElementById("sampleList");
      listEl.innerHTML = "";
      if (!chunk.length){
        listEl.innerHTML = `<div class="muted" style="align-self:center;margin-top:8px">No samples.</div>`;
      } else {
        for (const s of chunk){
          const card = document.createElement("div");
          card.className = "tpl-card";
          card.innerHTML = `
            <div class="title-line">
              <div class="tname">${esc(s.name)}</div>
              <div class="badge">${new Date(s.createdAt).toLocaleString()}</div>
            </div>
            <div class="snippet" style="display:flex;gap:10px;align-items:center">
              <img src="${esc(s.dataUrl)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #23335a" />
              <span class="muted">Stored locally</span>
            </div>
            <div class="btns">
              <button class="btn ghost small" data-act="rename" data-id="${s.id}">Rename</button>
              <button class="btn danger small" data-act="delete" data-id="${s.id}">Delete</button>
            </div>`;
          listEl.appendChild(card);
        }
      }
      const pg = document.getElementById("samplePagi");
      pg.innerHTML = "";
      const addBtn = (lbl, act, dis=false, active=false) => {
        const b = document.createElement("button");
        b.className = "pg" + (active ? " active" : "");
        b.textContent = lbl; b.dataset.action = act; if (dis) b.disabled = true;
        pg.appendChild(b);
      };
      addBtn("« First","first", sPage===1);
      addBtn("‹ Prev","prev", sPage===1);
      const pagesArr = [...Array(pages)].map((_,i)=>i+1);
      const win = pagesArr.filter(p => Math.abs(p - sPage) <= 2);
      win.forEach(p => addBtn(String(p), "goto:"+p, false, p===sPage));
      addBtn("Next ›","next", sPage===pages);
      addBtn("Last »","last", sPage===pages);

      pg.onclick = (e)=>{
        const b = e.target.closest(".pg"); if (!b) return;
        const act = b.dataset.action;
        if (act === "first") sPage = 1;
        else if (act === "prev") sPage = Math.max(1, sPage-1);
        else if (act === "next") sPage = sPage + 1;
        else if (act === "last") sPage = 1e9;
        else if (act?.startsWith("goto:")) sPage = parseInt(act.split(":")[1],10) || 1;
        renderSampleList();
      };

      listEl.onclick = async (e)=>{
        const btn = e.target.closest("button[data-act]"); if (!btn) return;
        const { SAMPLE_TEMPLATES = [] } = await storage.get("SAMPLE_TEMPLATES");
        if (btn.dataset.act === "delete"){
          const filtered = SAMPLE_TEMPLATES.filter(x => x.id !== btn.dataset.id);
          await storage.set({ SAMPLE_TEMPLATES: filtered });
          await renderSampleList();
        }
        if (btn.dataset.act === "rename"){
          const it = SAMPLE_TEMPLATES.find(x => x.id === btn.dataset.id); if (!it) return;
          const name = prompt("New name:", it.name || "Untitled"); if (!name) return;
          const list = SAMPLE_TEMPLATES.slice();
          const i = list.findIndex(x => x.id === it.id);
          if (i !== -1) list[i] = { ...it, name };
          await storage.set({ SAMPLE_TEMPLATES: list });
          await renderSampleList();
        }
      };
    }
    async function exportSamplesJSON(){
      const { SAMPLE_TEMPLATES = [] } = await storage.get("SAMPLE_TEMPLATES");
      const blob = new Blob([JSON.stringify(SAMPLE_TEMPLATES, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ai-image-studio-samples-${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(url);
    }

    // ========= Artwork References =========
    let rPage = 1, rPerPage = 3, rTotal = 0;

    function recomputeRefPerPage(){
      const holder = document.getElementById("refList");
      const h = holder.clientHeight || 0;
      const per = Math.max(2, Math.min(4, Math.floor((h + 10) / (110 + 10))));
      if (per !== rPerPage){ rPerPage = per; renderRefList(); }
    }

    const refImportFile = document.getElementById("refImportFile");
    refImportFile.multiple = true;
    document.getElementById("addRefBtn").onclick = ()=> refImportFile.click();
    document.getElementById("pasteRefBtn").onclick = onPasteRef;
    document.getElementById("exportRefs").onclick = exportRefsJSON;
    document.getElementById("importRefs").onclick = ()=> refImportFile.click();
    refImportFile.onchange = onChooseRef;

    async function onChooseRef(e){
      const files = Array.from(e.target.files||[]);
      if (!files.length) return;
      try{
        if (files.length===1 && files[0].type === "application/json") {
          const text = await files[0].text();
          const list = JSON.parse(text);
          await storage.set({ ARTREF_TEMPLATES: normalizeItems(list) });
          rPage = 1; await renderRefList();
          setBadge(document.getElementById("refMsg"), "Imported ✔");
        } else {
          const name = document.getElementById("refName").value.trim();
          const { ARTREF_TEMPLATES = [] } = await storage.get("ARTREF_TEMPLATES");
          const list = Array.isArray(ARTREF_TEMPLATES) ? ARTREF_TEMPLATES.slice() : [];
          for (const f of files){
            if (!f.type.startsWith("image/")) continue;
            const dataUrl = await fileToDataURL(f);
            list.unshift({ id:crypto.randomUUID(), name: name || f.name, dataUrl, createdAt: Date.now() });
          }
          await storage.set({ ARTREF_TEMPLATES: list });
          rPage = 1; await renderRefList();
          setBadge(document.getElementById("refMsg"), "Added ✔");
        }
      }catch{ setBadge(document.getElementById("refMsg"), "Failed", false); }
      finally{ e.target.value = ""; }
    }
    async function onPasteRef(){
      try{
        const name = document.getElementById("refName").value.trim() || ("ref-"+Date.now());
        const dataUrl = await readImageFromClipboard();
        if (!dataUrl) return setBadge(document.getElementById("refMsg"), "Clipboard empty", false);
        const { ARTREF_TEMPLATES = [] } = await storage.get("ARTREF_TEMPLATES");
        const list = Array.isArray(ARTREF_TEMPLATES) ? ARTREF_TEMPLATES.slice() : [];
        list.unshift({ id:crypto.randomUUID(), name, dataUrl, createdAt: Date.now() });
        await storage.set({ ARTREF_TEMPLATES: list });
        rPage = 1; await renderRefList();
        setBadge(document.getElementById("refMsg"), "Pasted ✔");
      }catch{ setBadge(document.getElementById("refMsg"), "Failed", false); }
    }
    async function renderRefList(){
      const { ARTREF_TEMPLATES = [] } = await storage.get("ARTREF_TEMPLATES");
      rTotal = ARTREF_TEMPLATES.length;
      const pages = Math.max(1, Math.ceil(rTotal / rPerPage));
      rPage = Math.min(Math.max(1, rPage), pages);
      const start = (rPage - 1) * rPerPage;
      const chunk = ARTREF_TEMPLATES.slice(start, start + rPerPage);
      document.getElementById("refMeta").textContent = `${rTotal} total • Page ${rPage}/${pages}`;
      const listEl = document.getElementById("refList");
      listEl.innerHTML = "";
      if (!chunk.length){
        listEl.innerHTML = `<div class="muted" style="align-self:center;margin-top:8px">No references.</div>`;
      } else {
        for (const s of chunk){
          const card = document.createElement("div");
          card.className = "tpl-card";
          card.innerHTML = `
            <div class="title-line">
              <div class="tname">${esc(s.name)}</div>
              <div class="badge">${new Date(s.createdAt).toLocaleString()}</div>
            </div>
            <div class="snippet" style="display:flex;gap:10px;align-items:center">
              <img src="${esc(s.dataUrl)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #23335a" />
              <span class="muted">Stored locally</span>
            </div>
            <div class="btns">
              <button class="btn ghost small" data-act="rename" data-id="${s.id}">Rename</button>
              <button class="btn danger small" data-act="delete" data-id="${s.id}">Delete</button>
            </div>`;
          listEl.appendChild(card);
        }
      }
      const pg = document.getElementById("refPagi");
      pg.innerHTML = "";
      const addBtn = (lbl, act, dis=false, active=false) => {
        const b = document.createElement("button");
        b.className = "pg" + (active ? " active" : "");
        b.textContent = lbl; b.dataset.action = act; if (dis) b.disabled = true;
        pg.appendChild(b);
      };
      addBtn("« First","first", rPage===1);
      addBtn("‹ Prev","prev", rPage===1);
      const pagesArr = [...Array(pages)].map((_,i)=>i+1);
      const win = pagesArr.filter(p => Math.abs(p - rPage) <= 2);
      win.forEach(p => addBtn(String(p), "goto:"+p, false, p===rPage));
      addBtn("Next ›","next", rPage===pages);
      addBtn("Last »","last", rPage===pages);

      pg.onclick = (e)=>{
        const b = e.target.closest(".pg"); if (!b) return;
        const act = b.dataset.action;
        if (act === "first") rPage = 1;
        else if (act === "prev") rPage = Math.max(1, rPage-1);
        else if (act === "next") rPage = rPage + 1;
        else if (act === "last") rPage = 1e9;
        else if (act?.startsWith("goto:")) rPage = parseInt(act.split(":")[1],10) || 1;
        renderRefList();
      };

      listEl.onclick = async (e)=>{
        const btn = e.target.closest("button[data-act]"); if (!btn) return;
        const { ARTREF_TEMPLATES = [] } = await storage.get("ARTREF_TEMPLATES");
        if (btn.dataset.act === "delete"){
          const filtered = ARTREF_TEMPLATES.filter(x => x.id !== btn.dataset.id);
          await storage.set({ ARTREF_TEMPLATES: filtered });
          await renderRefList();
        }
        if (btn.dataset.act === "rename"){
          const it = ARTREF_TEMPLATES.find(x => x.id === btn.dataset.id); if (!it) return;
          const name = prompt("New name:", it.name || "Untitled"); if (!name) return;
          const list = ARTREF_TEMPLATES.slice();
          const i = list.findIndex(x => x.id === it.id);
          if (i !== -1) list[i] = { ...it, name };
          await storage.set({ ARTREF_TEMPLATES: list });
          await renderRefList();
        }
      };
    }
    async function exportRefsJSON(){
      const { ARTREF_TEMPLATES = [] } = await storage.get("ARTREF_TEMPLATES");
      const blob = new Blob([JSON.stringify(ARTREF_TEMPLATES, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ai-image-studio-artrefs-${Date.now()}.json`;
      a.click(); URL.revokeObjectURL(url);
    }

    // init lists
    renderSampleList();
    renderRefList();
  });
})();
