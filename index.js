(() => {
  /* -------- Storage helpers -------- */
  const ls = {
    get: async (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        return { [key]: raw ? JSON.parse(raw) : fallback };
      } catch {
        return { [key]: fallback };
      }
    },
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    }
  };
  async function safeGet(key, fallback) { return await ls.get(key, fallback); }
  function getFromLS(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  /* -------- Save base64 to file -------- */
  function downloadBase64(name, base64) {
    const a = document.createElement("a");
    a.href = base64;
    a.download = name || `image_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* -------- Direct Gemini call (image) --------
     - Không set generationConfig.response_mime_type
     - Trả về base64 từ parts[].inline_data
  ------------------------------------------------ */
  async function directGeminiGenerateImage({ model, prompt, aspectRatio, images }) {
    const API_KEY = getFromLS("GOOGLE_API_KEY");
    if (!API_KEY) throw new Error("Missing GOOGLE_API_KEY in localStorage.");

    const parts = [];
    if (prompt) parts.push({ text: prompt });
    if (aspectRatio && aspectRatio !== "1:1") parts.push({ text: `(target aspect ratio: ${aspectRatio})` });
    if (images && images.length) {
      for (const dataUrl of images) {
        const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!m) continue;
        parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;
    const body = { contents: [{ role:"user", parts }] };
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`; try{ msg += ` — ${JSON.stringify(await r.json())}` }catch{}
      throw new Error(msg);
    }
    const data = await r.json();
    const cand = data?.candidates?.[0];
    const partsOut = cand?.content?.parts || [];
    const inline = partsOut.find(p => p.inline_data)?.inline_data;
    if (!inline?.data) throw new Error("No image in response.");
    const mime = inline.mime_type || "image/png";
    return `data:${mime};base64,${inline.data}`;
  }

  /* -------- Message shim -------- */
  async function safeSend(type, payload = {}) {
    try {
      switch (type) {
        case "downloads.saveBase64": {
          const { base64, filename } = payload;
          downloadBase64(filename || `image_${Date.now()}.png`, base64);
          return { ok: true };
        }
        case "gemini.generateImage": {
          const { model = "gemini-2.5-flash-image", prompt, aspectRatio = "1:1", images } = payload;
          const base64 = await directGeminiGenerateImage({ model, prompt, aspectRatio, images });
          return { ok: true, data: { base64 } };
        }
        default:
          return { ok:false, error:`Unknown action: ${type}` };
      }
    } catch (e) {
      return { ok:false, error: e?.message || String(e) };
    }
  }

  /* ======================= UI (như bản trước) ======================= */
  const STATUS_HIDE_MS = 2400;

  let host, shadow, statusEl;
  let sampleTplSel, artRefTplSel;

  // artwork controls
  let genArtBtn, cancelArtBtn, applyArtBtn, artPromptEl;
  let artPrevImg, artSlidePrevBtn, artSlideNextBtn, artSlideInfo;
  let artCountSel, artRatioSel, artWInp, artHInp;

  // artwork references
  let addArtRefBtn, pasteArtRefBtn, artRefWrap;

  // samples (product)
  let addSampleBtn, pasteSampleBtn, sampleWrap;

  // mockup
  let genMockBtn, cancelMockBtn, saveAllBtn, skuInput, countSel, modelSel, mockTplSel, outGrid;

  // progress & misc
  let prInner, prRow, prTimerEl, pStateEl, viewer, corsDlg, up2xChk;
  let fx;

  const state = {
    artwork: null, previews: [], curIdx: 0, cancelArt: false, artRefs: [],
    samples: [], cancelMock: false, t0: 0, timer: 0,
  };

  function createPanel() {
    host = document.createElement("div");
    host.style.cssText = `position:fixed; left:2vw; right:2vw; top:4vh; bottom:4vh; z-index:2147483647; display:none;`;
    const sr = host.attachShadow({ mode:"open" });
    shadow = sr;

    /* ----------------- TEMPLATE (UI) ----------------- */
    sr.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
        :host, :root { --primary-color:#6a11cb; --secondary-color:#2575fc; --accent-color:#ffd700; --background-dark:#0d0c1c; --panel-bg:rgba(255,255,255,0.1); --border-color:rgba(255,255,255,0.2); --text-light:#e5e7eb; --text-muted:#9ca3af; }
        :host { all: initial; font-family:'Inter', system-ui,-apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:14px; }
        .wrap{ width:100%; height:100%; background:var(--background-dark); color:var(--text-light); border-radius:20px; box-shadow:0 20px 50px rgba(0,0,0,.4); display:flex; flex-direction:column; position:relative; overflow:hidden; backdrop-filter: blur(15px); border:1px solid rgba(255,255,255,.15); animation: fadeIn .5s ease-out; }
        .wrap::before{ content:""; position:absolute; inset:-30%; background: conic-gradient(from 0deg, #ff3eec, #ffd23f, #00d4ff, #7cffcb, #ff3eec); filter: blur(72px) saturate(140%); animation: swirl 18s linear infinite; opacity:.12; pointer-events:none; }
        @keyframes swirl { to { transform: rotate(1turn); } }
        @keyframes fadeIn { from { opacity:0; transform: scale(.95); } to { opacity:1; transform: scale(1); } }
        header{ padding:14px 20px; border-bottom:1px solid #1f2a44; display:flex; justify-content:space-between; align-items:center; flex:0 0 auto; }
        .title{ font-weight:900; font-size:1.5em; background: linear-gradient(90deg,#ff3eec,#ffd23f,#00d4ff,#7cffcb,#f5576c); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-size:300% 100%; animation:hue 14s linear infinite; }
        @keyframes hue { to { background-position:300% 0; } }
        .btn{ padding:10px 16px; border-radius:12px; cursor:pointer; font-weight:700; font-size:.95em; transition: all .3s cubic-bezier(.25,.8,.25,1); border:none; position:relative; overflow:hidden; }
        .btn:before{ content:''; position:absolute; top:50%; left:50%; width:300%; height:300%; background:rgba(255,255,255,.15); transition:all .4s; border-radius:50%; transform: translate(-50%,-50%) scale(0); z-index:0; }
        .btn:hover:before{ transform: translate(-50%,-50%) scale(1); }
        .btn span{ position:relative; z-index:1; }
        .btn-primary{ background: linear-gradient(45deg, var(--primary-color), var(--secondary-color)); color:#fff; box-shadow:0 4px 15px rgba(106,17,203,.3); background-size:200% 100%; animation: btnflow 6s linear infinite; }
        @keyframes btnflow{ 0%{background-position:0 0} 100%{background-position:200% 0} }
        .btn-primary:hover{ box-shadow:0 6px 20px rgba(106,17,203,.5); transform: translateY(-2px); }
        .btn.ghost{ background:var(--panel-bg); color:var(--text-light); border:1px solid var(--border-color); backdrop-filter: blur(10px); }
        .btn.ghost:hover{ background: rgba(255,255,255,.2); box-shadow:0 0 0 3px rgba(255,255,255,.08), 0 10px 24px rgba(0,0,0,.35); }
        .btn.warn{ background:#ef4444; color:#fff; }
        .btn[disabled]{ opacity:.4; pointer-events:none; transform:none; }
        .body{ flex:1; display:grid; grid-template-columns: .6fr 1.4fr; gap:16px; padding:16px; overflow:hidden; }
        .col{ background:var(--panel-bg); border:1px solid var(--border-color); border-radius:16px; padding:16px; display:flex; flex-direction:column; min-height:0; backdrop-filter: blur(10px); }
        .muted{ color:var(--text-muted); font-size:.85em; }
        .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        .row.compact{ display:grid; grid-template-columns: 1fr max-content; gap:10px; align-items:center; }
        .row.compact .grow{ min-width:0; }
        select,input,textarea{ width:98%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.2); background: rgba(0,0,0,.2); color:var(--text-light); transition: border-color .3s, box-shadow .3s; }
        select:focus,input:focus,textarea:focus{ outline:none; border-color:var(--secondary-color); box-shadow:0 0 0 3px rgba(37,117,252,.3); }
        textarea{ resize:none; height:90px; }
        .section{ flex:0 0 auto; }
        .split{ display:grid; grid-template-columns: minmax(380px,1fr) minmax(220px,.62fr); gap:16px; align-items:stretch; }
        .cap{ font-weight:800; margin:8px 0 6px; font-size:1.1em; }
        .preview{ position:relative; height:38vh; min-height:280px; display:flex; align-items:center; justify-content:center; border-radius:12px; background: repeating-conic-gradient(#1a1a2e 0% 25%, #2a2a44 0% 50%) 0 / 20px 20px; border:1px solid #33334d; overflow:hidden; animation: glow 3.6s ease-in-out infinite; }
        .preview img{ max-width:100%; max-height:100%; object-fit:contain; border-radius:10px; display:block; box-shadow:0 5px 20px rgba(0,0,0,.3); transition:opacity .5s; }
        @keyframes glow{ 0%,100%{ box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 8px 24px rgba(0,0,0,.35); } 50%{ box-shadow: 0 0 0 1px rgba(255,255,255,.18) inset, 0 18px 36px rgba(0,0,0,.45); } }
        .navBtn{ position:absolute; top:50%; transform:translateY(-50%); background:rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.2); border-radius:10px; padding:8px 12px; color:#fff; cursor:pointer; transition: background .3s, transform .3s; }
        .navBtn:hover{ background:rgba(0,0,0,.7); transform:translateY(-50%) scale(1.1); }
        #artPrevBtn{ left:10px; } #artNextBtn{ right:10px; }
        #artSlideInfo{ position:absolute; right:12px; bottom:10px; background:rgba(0,0,0,.4); border-radius:8px; padding:5px 10px; font-size:.8em; }
        .samples{ display:grid; grid-template-columns: repeat(2,1fr); gap:10px; }
        .sItem{ position:relative; cursor:pointer; transition: transform .2s; }
        .sItem:hover{ transform: scale(1.05); }
        .sq{ width:100%; aspect-ratio:1/1; border:2px solid var(--border-color); border-radius:10px; background: repeating-conic-gradient(#1a1a2e 0% 25%, #2a2a44 0% 50%) 0 / 20px 20px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .sq>img{ width:100%; height:100%; object-fit:contain; display:block; }
        .sDel{ position:absolute; top:6px; right:6px; background:#ef4444; color:#fff; border:none; border-radius:8px; font-size:.7em; padding:4px 8px; cursor:pointer; }
        .status{ position:absolute; left:50%; top:20px; transform: translateX(-50%) scale(.9); height:40px; display:flex; gap:10px; align-items:center; justify-content:center; color:#fff; font-weight:800; background: var(--panel-bg); border:1px solid var(--border-color); border-radius:12px; padding:0 20px; opacity:0; pointer-events:none; transition: opacity .3s, transform .3s; box-shadow:0 4px 15px rgba(0,0,0,.2); backdrop-filter: blur(10px); }
        .status.show{ opacity:1; transform: translateX(-50%) scale(1); }
        .status.ok{ background:#065f46; border-color:#10b981; box-shadow:0 0 0 2px rgba(16,185,129,.45), 0 0 18px rgba(16,185,129,.35); }
        .status.err{ background:#7f1d1d; border-color:#ef4444; box-shadow:0 0 0 2px rgba(239,68,68,.45), 0 0 18px rgba(239,68,68,.35); }
        .spinner{ width:18px; height:18px; border-radius:999px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; animation: sp 1s cubic-bezier(.5,0,.5,1) infinite; }
        @keyframes sp{ to { transform: rotate(360deg); } }
        .progress{ height:12px; border-radius:999px; background:rgba(255,255,255,.1); overflow:hidden; margin-top:10px; border:1px solid rgba(255,255,255,.2); }
        .progress>div{ height:100%; width:0%; background-image: linear-gradient(90deg, rgba(255,255,255,.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.25) 50%, rgba(255,255,255,.25) 75%, transparent 75%, transparent), linear-gradient(90deg, #f093fb, #f5576c); background-size: 28px 12px, 100% 100%; animation: barber 1s linear infinite; transition: width .3s; }
        @keyframes barber{ to{ background-position: 28px 0, 0 0; } }
        .pmeta{ display:flex; gap:10px; align-items:center; justify-content:space-between; color:var(--text-muted); font-size:.8em; margin-top:8px; }
        .outWrap{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
        .outGrid{ flex:1 1 auto; min-height:0; overflow-y:auto; display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:14px; grid-auto-rows: minmax(220px, auto); padding-right:10px; }
        .thumb{ width:100%; height:100%; object-fit:cover; background:repeating-conic-gradient(#1a1a2e 0% 25%, #2a2a44 0% 50%) 0 / 20px 20px; border:1px solid rgba(255,255,255,.2); border-radius:12px; display:block; box-shadow:0 4px 15px rgba(0,0,0,.2); transition: transform .3s, box-shadow .3s; }
        .thumb:hover{ transform: translateY(-4px) scale(1.02); box-shadow:0 10px 28px rgba(0,0,0,.32); }
        .viewer{ position:fixed; inset:0; background:rgba(0,0,0,.85); display:none; align-items:center; justify-content:center; z-index:2147483647; backdrop-filter: blur(10px); }
        .viewer img{ max-width:94vw; max-height:94vh; border-radius:16px; box-shadow: 0 15px 40px rgba(0,0,0,.6); }
        .dlg{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:2147483647; background:rgba(0,0,0,.6); backdrop-filter: blur(5px); }
        .dlg .box{ width:520px; max-width:90vw; background: var(--background-dark); border:1px solid var(--border-color); border-radius:16px; padding:20px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
        .toggle-wrap{ display:flex; align-items:center; gap:8px; user-select:none; margin-right:10px }
        .toggle{ width:46px; height:26px; border-radius:999px; background: rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.25); position:relative; cursor:pointer; transition: all .2s; box-shadow: inset 0 0 0 0 rgba(0,0,0,0); }
        .toggle::after{ content:""; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:left .2s; }
        .toggle.on{ background: linear-gradient(45deg, var(--primary-color), var(--secondary-color)); border-color: transparent; box-shadow: 0 0 12px rgba(99,102,241,.8), 0 0 24px rgba(59,130,246,.6) inset; }
        .toggle.on::after{ left:23px; }
        .evenStack{ display:flex; flex-direction:column; min-height:0; }
        .evenStack>.section{ flex:1 1 0; min-height:0; display:flex; flex-direction:column; }
        .evenStack .row{ flex:0 0 auto; }
        .evenStack .samples{ flex:1 1 auto; min-height:100px; overflow:auto; }
        #fx{ position:fixed; inset:0; pointer-events:none; z-index:2147483648; }
        .sparkle{ position:absolute; width:8px; height:8px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #fff, rgba(255,255,255,.2) 60%, transparent 70%); box-shadow: 0 0 10px currentColor, 0 0 18px currentColor; animation: pop .9s ease-out forwards; }
        @keyframes pop{ 0%{ transform: translate(0,0) scale(.6); opacity:1; } 80%{ opacity:1; } 100%{ transform: translate(var(--dx), var(--dy)) scale(0); opacity:0; } }
        :host, .wrap, .col, .outGrid, .samples, .preview, textarea, #artRefList, #sampleList { scrollbar-gutter: stable both-edges; }
        *::-webkit-scrollbar{ width:10px; height:10px; }
        *::-webkit-scrollbar-track{ background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); border-radius:999px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
        *::-webkit-scrollbar-thumb{ border-radius:999px; background: linear-gradient(180deg, #6a11cb, #2575fc); box-shadow:0 0 0 1px rgba(255,255,255,.18) inset, 0 2px 8px rgba(37,117,252,.35); border:2px solid rgba(0,0,0,.25); }
        *::-webkit-scrollbar-thumb:hover{ background: linear-gradient(180deg, #7a2cf0, #2f89ff); box-shadow:0 0 0 1px rgba(255,255,255,.22) inset, 0 3px 10px rgba(122,44,240,.45); }
        *::-webkit-scrollbar-thumb:active{ background: linear-gradient(180deg, #f093fb, #f5576c); box-shadow:0 0 0 1px rgba(255,255,255,.28) inset, 0 4px 14px rgba(245,87,108,.5); }
        *::-webkit-scrollbar-corner{ background:transparent; }
        :host, .wrap, .col, .outGrid, .samples, .preview, textarea, #artRefList, #sampleList { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, #2575fc 60%, #6a11cb) rgba(255,255,255,.08); }
        .outGrid:hover,.samples:hover,textarea:hover{ scrollbar-color: color-mix(in srgb, #f093fb 55%, #f5576c) rgba(255,255,255,.12); }
      </style>

      <div class="wrap">
        <div id="status" class="status"><span id="spin" class="spinner" style="display:none"></span><span id="statMsg">Ready</span></div>
        <div id="fx"></div>

        <header>
          <div class="title">AI Image Studio</div>
          <div class="row">
            <!-- Nút Options đã ẩn trong bản web thuần -->
            <a class="btn ghost" id="openOptions" href="./settings.html" target="_blank" rel="noopener">
              <span>Options</span>
            </a>
          </div>
        </header>

        <div class="body">
          <div class="col">
            <div class="split" style="flex:1 1 auto;min-height:0">
              <div style="display:flex;flex-direction:column;min-height:0">
                <div class="cap">Artwork (Current / Preview)</div>
                <div class="preview" style="flex:1 1 auto;">
                  <img id="prevArt" />
                  <button id="artPrevBtn" class="navBtn" title="Previous" style="display:none">◀</button>
                  <button id="artNextBtn" class="navBtn" title="Next" style="display:none">▶</button>
                  <div id="artSlideInfo" style="display:none">0/0</div>
                </div>
                <div class="row" style="margin-top:8px">
                  <button class="btn ghost" id="chooseArt"><span>Choose</span></button>
                  <button class="btn ghost" id="pasteArt"><span>Paste</span></button>
                </div>
              </div>

              <div class="evenStack" style="display:flex;flex-direction:column;min-height:0">
                <div class="section" style="margin-bottom:10px">
                  <div class="cap" style="font-weight:700">Artwork References</div>
                  <div class="row" style="margin-bottom:6px">
                    <button class="btn ghost" id="addArtRef"><span>Add</span></button>
                    <button class="btn ghost" id="pasteArtRef"><span>Paste</span></button>
                    <select id="artRefTpl" style="margin-left:auto;min-width:220px"></select>
                  </div>
                  <div id="artRefList" class="samples"></div>
                  <div class="muted" style="margin-top:6px"></div>
                </div>

                <div class="section" style="display:flex; flex-direction:column;">
                  <div class="cap" style="font-weight:700">Product Sample</div>
                  <div class="row" style="margin-bottom:6px">
                    <button class="btn ghost" id="addSample"><span>Add</span></button>
                    <button class="btn ghost" id="pasteSample"><span>Paste</span></button>
                    <select id="sampleTpl" style="margin-left:auto;min-width:220px"></select>
                  </div>
                  <div id="sampleList" class="samples"></div>
                </div>
              </div>

              <div class="row" style="margin-top:6px">
                <button class="btn btn-primary" id="artGen"><span>Generate Preview</span></button>
                <button class="btn ghost" id="artApply" disabled><span>Apply</span></button>
                <button class="btn warn" id="cancelArt" title="Cancel Artwork job" style="margin-left:auto"><span>Cancel</span></button>
              </div>
            </div>

            <div class="section">
              <div class="row" style="margin-top:6px">
                <div style="display:flex;gap:8px;align-items:center">
                  <label class="muted" style="min-width:74px">Ratio</label>
                  <select id="artRatio" style="width:160px">
                    <option value="1:1" selected>1:1 (1024×1024)</option>
                    <option value="2:3">2:3 (832×1248)</option>
                    <option value="3:2">3:2 (1248×832)</option>
                    <option value="3:4">3:4 (864×1184)</option>
                    <option value="4:3">4:3 (1184×864)</option>
                    <option value="4:5">4:5 (896×1152)</option>
                    <option value="5:4">5:4 (1152×896)</option>
                    <option value="9:16">9:16 (768×1344)</option>
                    <option value="16:9">16:9 (1344×768)</option>
                    <option value="21:9">21:9 (1536×672)</option>
                  </select>
                  <input id="artW" type="number" min="64" max="2048" step="1" placeholder="W" style="width:90px;display:none">
                  <span id="artX" style="display:none">×</span>
                  <input id="artH" type="number" min="64" max="2048" step="1" placeholder="H" style="width:90px;display:none">
                </div>

                <div style="display:flex;gap:8px;align-items:center">
                  <label class="muted" style="min-width:74px">Images</label>
                  <select id="artCount" style="width:120px">
                    <option>1</option><option selected>2</option><option>4</option><option>8</option>
                  </select>
                </div>
              </div>
              <div class="cap">Generate Artwork (Preview)</div>
              <textarea id="artPrompt" placeholder="Describe the artwork you want to create… (no borders, print-ready)"></textarea>
            </div>
          </div>

          <div class="col">
            <div class="section">
              <div class="cap">Model</div>
              <select id="model">
                <option value="gemini-2.5-flash-image" selected>Gemini 2.5 Flash Image (Direct)</option>
              </select>
            </div>

            <div class="section">
              <div class="cap">Template & Images</div>
              <div class="row compact" style="margin-bottom:6px">
                <select id="mockTpl" class="grow"></select>
                <select id="count" style="width:120px">
                  <option>1</option><option selected>2</option><option>4</option><option>8</option>
                </select>
              </div>
              <div class="muted" style="margin-top:0"></div>
              <textarea id="prompt" placeholder="Describe background/placement. Keep product shape; apply artwork; natural lighting…(1 row = 1 prompt)"></textarea>
            </div>

            <div class="section">
              <div class="cap">SKU</div>
              <input id="sku" type="text" placeholder="ABC-001" />
            </div>

            <div class="pmeta" id="prow" style="visibility:hidden">
              <div><strong id="pstate">Idle</strong></div>
              <div id="ptime">00:00</div>
            </div>
            <div class="progress"><div id="progInner"></div></div>

            <div class="row" style="margin-top:6px">
              <button class="btn btn-primary" id="genMock"><span>Generate Mockups</span></button>
              <button class="btn warn" id="cancelMock" title="Cancel Mockup job"><span>Cancel</span></button>
              <div style="margin-left:auto; display:flex; align-items:center;">
                <div class="toggle-wrap" title="Scale ×2 when saving">
                  <div id="up2x" class="toggle" role="switch" aria-checked="false" aria-label="Scale times two"></div>
                  <span class="muted">Scale ×2</span>
                </div>
                <button class="btn ghost" id="saveAll"><span>Save All</span></button>
              </div>
            </div>

            <div class="outWrap" style="margin-top:8px">
              <div id="out" class="outGrid"></div>
            </div>
          </div>
        </div>

        <div id="viewer" class="viewer"><img id="viewerImg" /></div>

        <div id="corsDlg" class="dlg">
          <div class="box">
            <h3>Không lấy được ảnh từ URL (CORS)</h3>
            <p>Hãy Copy image rồi Paste, hoặc Choose file từ máy.</p>
            <div class="row" style="margin-top:10px">
              <button class="btn ghost" id="dlgPaste"><span>Paste</span></button>
              <button class="btn ghost" id="dlgChoose"><span>Choose</span></button>
              <button class="btn warn" id="dlgClose"><span>Close</span></button>
            </div>
            <p class="muted" style="margin-top:8px" id="dlgUrl"></p>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);

    /* ------------- bind refs + events ------------- */
    statusEl = shadow.getElementById("status");
    fx = shadow.getElementById("fx");
    sampleTplSel = shadow.getElementById("sampleTpl");
    artRefTplSel = shadow.getElementById("artRefTpl");
    sampleTplSel?.addEventListener("change", onPickSampleName);
    artRefTplSel?.addEventListener("change", onPickArtRefName);

    artPromptEl = shadow.getElementById("artPrompt");
    artCountSel = shadow.getElementById("artCount");
    artRatioSel = shadow.getElementById("artRatio");
    artWInp = shadow.getElementById("artW");
    artHInp = shadow.getElementById("artH");
    genArtBtn = shadow.getElementById("artGen");
    applyArtBtn = shadow.getElementById("artApply");
    cancelArtBtn = shadow.getElementById("cancelArt");
    artPrevImg = shadow.getElementById("prevArt");
    artSlidePrevBtn = shadow.getElementById("artPrevBtn");
    artSlideNextBtn = shadow.getElementById("artNextBtn");
    artSlideInfo = shadow.getElementById("artSlideInfo");

    addArtRefBtn = shadow.getElementById("addArtRef");
    pasteArtRefBtn = shadow.getElementById("pasteArtRef");
    artRefWrap = shadow.getElementById("artRefList");

    addSampleBtn = shadow.getElementById("addSample");
    pasteSampleBtn = shadow.getElementById("pasteSample");
    sampleWrap = shadow.getElementById("sampleList");

    genMockBtn = shadow.getElementById("genMock");
    cancelMockBtn = shadow.getElementById("cancelMock");
    saveAllBtn = shadow.getElementById("saveAll");
    skuInput = shadow.getElementById("sku");
    countSel = shadow.getElementById("count");
    modelSel = shadow.getElementById("model");
    mockTplSel = shadow.getElementById("mockTpl");
    outGrid = shadow.getElementById("out");
    up2xChk = shadow.getElementById("up2x");
    up2xChk && (up2xChk.onclick = () => {
      up2xChk.classList.toggle("on");
      const on = up2xChk.classList.contains("on");
      up2xChk.setAttribute("aria-checked", String(on));
    });

    prInner = shadow.getElementById("progInner");
    prRow = shadow.getElementById("prow");
    prTimerEl = shadow.getElementById("ptime");
    pStateEl = shadow.querySelector("#pstate");
    viewer = shadow.getElementById("viewer");
    corsDlg = shadow.getElementById("corsDlg");

    shadow.getElementById("close")?.addEventListener("click", () => (host.style.display = "none"));

    genArtBtn?.addEventListener("click", doGenerateArtworkPreview);
    applyArtBtn?.addEventListener("click", () => applyCurrentArtwork());
    cancelArtBtn?.addEventListener("click", () => { state.cancelArt = true; showStatus("", "Cancel Artwork requested…", true); });

    artRatioSel && (artRatioSel.onchange = () => {
      const custom = artRatioSel.value === "custom";
      artWInp.style.display = custom ? "inline-block" : "none";
      artHInp.style.display = custom ? "inline-block" : "none";
      shadow.getElementById("artX").style.display = custom ? "inline-block" : "none";
    });

    artSlidePrevBtn?.addEventListener("click", () => slideArtwork(-1));
    artSlideNextBtn?.addEventListener("click", () => slideArtwork(1));
    document.addEventListener("keydown", (e) => {
      if (host.style.display !== "block") return;
      if (e.key === "ArrowLeft") slideArtwork(-1);
      if (e.key === "ArrowRight") slideArtwork(1);
    });

    shadow.getElementById("chooseArt")?.addEventListener("click", () =>
      chooseFileTo((b64) => { setArtwork([b64]); applyCurrentArtwork; })
    );
    shadow.getElementById("pasteArt")?.addEventListener("click", () =>
      pasteClipboardTo((b64) => { setArtwork([b64]); applyCurrentArtwork; })
    );

    addArtRefBtn?.addEventListener("click", () => chooseFileTo(addArtRef));
    pasteArtRefBtn?.addEventListener("click", () => pasteClipboardTo(addArtRef));
    addSampleBtn?.addEventListener("click", () => chooseFileTo(addSample));
    pasteSampleBtn?.addEventListener("click", () => pasteClipboardTo(addSample));

    genMockBtn?.addEventListener("click", doGenerateMockups);
    cancelMockBtn?.addEventListener("click", () => { state.cancelMock = true; showStatus("", "Cancel Mockup requested…", true); });
    saveAllBtn?.addEventListener("click", saveAllGenerated);

    shadow.getElementById("dlgPaste")?.addEventListener("click", () => {
      corsDlg.style.display = "none";
      pasteClipboardTo((b64) => { setArtwork([b64]); applyCurrentArtwork(true); });
    });
    shadow.getElementById("dlgChoose")?.addEventListener("click", () => {
      corsDlg.style.display = "none";
      chooseFileTo((b64) => { setArtwork([b64]); applyCurrentArtwork(true); });
    });
    shadow.getElementById("dlgClose")?.addEventListener("click", () => { corsDlg.style.display = "none"; });

    viewer?.addEventListener("click", () => (viewer.style.display = "none"));

    loadMockupTemplates(mockTplSel, (tpl) => {
      if (!tpl) return;
      shadow.getElementById("prompt").value = tpl;
    });
    loadSampleTemplates(sampleTplSel);
    loadArtRefTemplates(artRefTplSel);
    resetProgress();
  }

  /* ---------- Mockup templates ---------- */
  async function loadMockupTemplates(selectEl, onPick) {
    const got = await safeGet("TEMPLATES", []);
    const list = got.TEMPLATES || [];
    if (!selectEl) return;
    selectEl.innerHTML = `<option value="__none__">— Use Template —</option>`;
    list.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.prompt;
      o.textContent = t.name;
      selectEl.appendChild(o);
    });
    selectEl.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v && v !== "__none__") onPick?.(v);
    });
  }

  /* ---------- Artwork Ref templates ---------- */
  let __artRefIndex = [];
  async function loadArtRefTemplates(selectEl){
    if (!selectEl) return;
    const got = await safeGet("ARTREF_TEMPLATES", []);
    const raw = Array.isArray(got.ARTREF_TEMPLATES) ? got.ARTREF_TEMPLATES : [];
    const byName = new Map();
    for (const it of raw){
      const name = String(it?.name || "Untitled");
      const url  = String(it?.dataUrl || "");
      if (!/^data:image\//i.test(url)) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(url);
    }
    __artRefIndex = [...byName.entries()].map(([name, items]) => ({ name, items }));

    selectEl.innerHTML = "";
    if (!__artRefIndex.length){
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No saved refs";
      selectEl.appendChild(opt);
      return;
    }
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "— Choose Ref —";
    selectEl.appendChild(ph);

    for (const g of __artRefIndex){
      const opt = document.createElement("option");
      opt.value = g.name;
      opt.textContent = `${g.name} (${g.items.length})`;
      selectEl.appendChild(opt);
    }
  }
  async function onPickArtRefName(){
    const name = (shadow.getElementById("artRefTpl")?.value || "");
    if (!name) return;
    const group = __artRefIndex.find(g => g.name === name);
    if (!group || !group.items?.length) return toast("Ref empty.", true);

    state.artRefs = [];
    for (const url of group.items){
      await addArtRef(url);
    }
    toast(`Loaded refs: ${name}`);
  }

  /* ---------- Sample templates (Product Sample) ---------- */
  let __sampleIndex = [];
  async function loadSampleTemplates(selectEl){
    if (!selectEl) return;
    const got = await safeGet("SAMPLE_TEMPLATES", []);
    const raw = Array.isArray(got.SAMPLE_TEMPLATES) ? got.SAMPLE_TEMPLATES : [];

    const byName = new Map();
    for (const it of raw){
      const name = String(it?.name || "Untitled");
      const url  = String(it?.dataUrl || "");
      if (!/^data:image\//i.test(url)) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(url);
    }
    __sampleIndex = [...byName.entries()].map(([name, items]) => ({ name, items }));

    selectEl.innerHTML = "";
    if (!__sampleIndex.length){
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No saved samples";
      selectEl.appendChild(opt);
      return;
    }
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "— Choose Sample —";
    selectEl.appendChild(ph);

    for (const g of __sampleIndex){
      const opt = document.createElement("option");
      opt.value = g.name;
      opt.textContent = `${g.name} (${g.items.length})`;
      selectEl.appendChild(opt);
    }
  }
  async function onPickSampleName(){
    const name = sampleTplSel.value || "";
    if (!name) return;
    const group = __sampleIndex.find(g => g.name === name);
    if (!group || !group.items?.length) return toast("Sample empty.", true);

    state.samples = [];
    for (const url of group.items) {
      await addSample(url);
    }
    toast(`Loaded sample: ${name}`);
  }

  /* ---------- UI helpers ---------- */
  function sparkleBurst(x, y, n = 18) {
    if (!fx) return;
    const colors = ['#60a5fa','#a78bfa','#f472b6','#fbbf24','#34d399','#22d3ee','#f87171'];
    for (let i=0;i<n;i++){
      const s = document.createElement('div');
      s.className = 'sparkle';
      s.style.left = `${x}px`;
      s.style.top  = `${y}px`;
      const ang = (Math.PI*2) * (i/n) + Math.random()*0.6;
      const dist = 60 + Math.random()*80;
      const dx = Math.cos(ang)*dist, dy = Math.sin(ang)*dist;
      s.style.setProperty('--dx', dx+'px');
      s.style.setProperty('--dy', dy+'px');
      s.style.color = colors[(Math.random()*colors.length)|0];
      fx.appendChild(s);
      setTimeout(()=> s.remove(), 1000);
    }
  }
  function showStatus(kind, msg, spin = false) {
    const s = statusEl.querySelector("#spin");
    statusEl.querySelector("#statMsg").textContent = msg;
    s.style.display = spin ? "inline-block" : "none";
    statusEl.className = `status show ${ kind === "err" ? "err" : kind === "ok" ? "ok" : "" }`;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => (statusEl.className = "status"), STATUS_HIDE_MS);
    if (kind === "ok") {
      const rect = statusEl.getBoundingClientRect();
      sparkleBurst(rect.left + rect.width/2, rect.top + rect.height/2, 18);
    }
  }
  function setBusyArt(flag) { genArtBtn.disabled = flag; cancelArtBtn.disabled = !flag; }
  function setBusyMock(flag) { genMockBtn.disabled = flag; cancelMockBtn.disabled = !flag; saveAllBtn.disabled = flag; }
  const loadPreview = (el, src) => { el.src = src; };

  function startProgress(total, label) {
    prRow.style.visibility = "visible"; setProgress(0, total, label);
    state.t0 = Date.now(); clearInterval(state.timer);
    state.timer = setInterval(() => {
      const s = Math.floor((Date.now() - state.t0) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      prTimerEl.textContent = `${mm}:${ss}`;
    }, 500);
  }
  function setProgress(done, total, label) {
    const pct = total > 0 ? Math.round((done * 100) / total) : 0;
    prInner.style.width = `${pct}%`; pStateEl.textContent = label || "Working…";
  }
  function stopProgress() { clearInterval(state.timer); }
  function resetProgress() { prInner.style.width = "0%"; prRow.style.visibility = "hidden"; prTimerEl.textContent = "00:00"; pStateEl.textContent = "Idle"; }

  function renderSamples() {
    sampleWrap.innerHTML = "";
    state.samples.forEach((b64, idx) => {
      const it = document.createElement("div");
      it.className = "sItem";
      it.innerHTML = `<div class="sq"><img/></div><button class="sDel">✕</button>`;
      it.querySelector("img").src = b64;
      it.querySelector(".sDel").onclick = () => { state.samples.splice(idx, 1); renderSamples(); };
      sampleWrap.appendChild(it);
    });
  }
  function renderArtRefs() {
    artRefWrap.innerHTML = "";
    state.artRefs.forEach((b64, idx) => {
      const it = document.createElement("div");
      it.className = "sItem";
      it.innerHTML = `<div class="sq"><img/></div><button class="sDel">✕</button>`;
      it.querySelector("img").src = b64;
      it.querySelector(".sDel").onclick = () => { state.artRefs.splice(idx, 1); renderArtRefs(); };
      artRefWrap.appendChild(it);
    });
  }

  function setArtwork(list) { state.previews = list || []; state.curIdx = 0; updateArtworkView(); }
  function updateArtworkView() {
    const n = state.previews.length;
    if (n > 0) {
      artPrevImg.src = state.previews[state.curIdx];
      artSlideInfo.style.display = "block";
      artSlidePrevBtn.style.display = "block";
      artSlideNextBtn.style.display = "block";
      artSlideInfo.textContent = `${state.curIdx + 1}/${n}`;
      applyArtBtn.disabled = false;
    } else {
      artSlideInfo.style.display = "none";
      artSlidePrevBtn.style.display = "none";
      artSlideNextBtn.style.display = "none";
      applyArtBtn.disabled = true;
      if (state.artwork) artPrevImg.src = state.artwork; else artPrevImg.removeAttribute("src");
    }
  }
  function slideArtwork(step) {
    const n = state.previews.length; if (n < 2) return;
    state.curIdx = (state.curIdx + step + n) % n; updateArtworkView();
  }
  function applyCurrentArtwork(force = false) {
    // Ưu tiên lấy ảnh hiện đang xem trong previews
    const candidate = state.previews?.[state.curIdx] || state.artwork || null;
    if (!candidate) return; // không set src=null nữa
  
    state.artwork = candidate;
    loadPreview(artPrevImg, state.artwork);
    showStatus("ok", "Applied to Artwork.");
  }


  /* ---------- Artwork generation ---------- */
  async function doGenerateArtworkPreview() {
    const prompt = artPromptEl.value.trim();
    if (!prompt) return toast("Enter artwork prompt first.", true);
    const count = parseInt(artCountSel.value, 10) || 1;
    const aspectRatio = artRatioSel.value;

    state.cancelArt = false; setBusyArt(true);
    startProgress(count, "Generating artwork…"); showStatus("", "Generating artwork…", true);

    try {
      const results = [];
      for (let i = 0; i < count; i++) {
        if (state.cancelArt) break;
        const r = await safeSend("gemini.generateImage", {
          model: "gemini-2.5-flash-image",
          prompt,
          aspectRatio,
          images: state.artRefs?.length ? state.artRefs : undefined,
        });
        if (!r?.ok) throw new Error(r?.error || "Generate preview failed");
        if (state.cancelArt) break;
        results.push(r.data.base64);
        setProgress(i + 1, count, i + 1 === count ? "Done" : "Generating…");
      }
      setArtwork(results);
      showStatus(state.cancelArt ? "err" : "ok",
        state.cancelArt ? `Canceled at ${results.length}/${count}.` : `Generated ${results.length} preview(s).`);
    } catch (e) {
      showStatus("err", "Artwork preview error: " + (e?.message || e));
    } finally {
      stopProgress(); setBusyArt(false); setTimeout(resetProgress, 600);
    }
  }

  /* ---------- Mockups (always 1:1) ---------- */
  async function doGenerateMockups() {
    const model = modelSel.value;
    const count = parseInt(countSel.value, 10) || 1;
    const raw = shadow.getElementById("prompt").value.trim();
    if (!raw) return toast("Enter a mockup prompt.", true);
    const prompts = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!state.artwork) return toast("No artwork selected/applied.", true);

    const total = Math.max(1, count) * Math.max(1, prompts.length);
    outGrid.innerHTML = "";

    state.cancelMock = false; setBusyMock(true);
    startProgress(total, "Queueing…"); showStatus("", `Preparing images…`, true);

    try {
      const samplesReady = [];
      for (const s of state.samples) samplesReady.push(isDataURL(s) ? await downscaleDataUrl(s, 1536) : s);
      const artReady = isDataURL(state.artwork) ? await downscaleDataUrl(state.artwork, 1536) : state.artwork;

      let made = 0;
      outer: for (const p of prompts) {
        for (let i = 0; i < count; i++) {
          if (state.cancelMock) break outer;
          setProgress(made, total, "Waiting for Gemini…");
          try {
            const r = await safeSend("gemini.generateImage", {
              model,
              images: [...samplesReady, artReady],
              prompt: p,
              aspectRatio: "1:1",
            });

            if (state.cancelMock) break outer;
            if (!r?.ok) throw new Error(r?.error || "Unknown error");

            const im = new Image();
            im.src = r.data.base64; im.className = "thumb";
            let clickTimer = null;
            im.addEventListener("click", async () => {
              if (clickTimer) return;
              clickTimer = setTimeout(async () => {
                clickTimer = null;
                try {
                  const toSave = isUp2x() ? await upscale2xDataURL(r.data.base64) : r.data.base64;
                  await safeSend("downloads.saveBase64", { base64: toSave, filename: `mockup_${Date.now()}.png` });
                  showStatus("ok", isUp2x() ? "Saved (upscaled ×2)." : "Saved.");
                  const rct = im.getBoundingClientRect();
                  sparkleBurst(rct.left + rct.width/2, rct.top + rct.height/2, 14);
                } catch (e) {
                  showStatus("err", "Save failed: " + (e?.message || e));
                }
              }, 220);
            });
            im.addEventListener("dblclick", () => {
              if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
              openViewer(r.data.base64);
            });
            im.title = "Click: Save • Double-click: Zoom"; im.style.cursor = "zoom-in";
            outGrid.appendChild(im);
          } catch (e) {
            const errBox = document.createElement("div");
            errBox.className = "thumb";
            errBox.style.display = "flex";
            errBox.style.alignItems = "center";
            errBox.style.justifyContent = "center";
            errBox.style.padding = "8px";
            errBox.style.color = "#f87171";
            errBox.style.fontSize = "12px";
            errBox.textContent = String(e.message || e);
            outGrid.appendChild(errBox);
          }
          made++; setProgress(made, total, state.cancelMock ? "Canceled" : "Sending…");
        }
      }
      showStatus(state.cancelMock ? "err" : "ok",
        state.cancelMock ? `Canceled at ${made}/${total}.` : `Done! ${total} request(s) finished.`);
    } catch (e) {
      showStatus("err", "Generate error: " + (e?.message || e));
    } finally {
      stopProgress(); setBusyMock(false); setTimeout(resetProgress, 600);
    }
  }

  function openViewer(b64) { shadow.getElementById("viewerImg").src = b64; viewer.style.display = "flex"; viewer.onclick = () => (viewer.style.display = "none"); }

  async function saveAllGenerated() {
    const sku = (skuInput.value || "").trim();
    if (!sku) return toast("Enter SKU first.", true);
    const imgs = Array.from(outGrid.querySelectorAll("img"));
    if (!state.artwork && imgs.length === 0) return toast("Nothing to save.", true);
    const dir = sanitizePath(sku);

    if (state.artwork) {
      await safeSend("downloads.saveBase64", { base64: state.artwork, filename: `${dir}/${dir}.png` });
    }
    let i = 1;
    for (const im of imgs) {
      const src = im.src;
      const data = isUp2x() ? await upscale2xDataURL(src) : src;
      await safeSend("downloads.saveBase64", { base64: data, filename: `${dir}/${dir}-${i++}.png` });
    }
    showStatus("ok", `Saved ${imgs.length + (state.artwork ? 1 : 0)} file(s) under "${dir}/".`);
  }
  function isUp2x() {
    try { return !!shadow?.getElementById("up2x")?.classList.contains("on"); } catch { return false; }
  }

  /* ---------- utils ---------- */
  function sanitizePath(s) { return String(s).replace(/[\\:?*"<>|]+/g, "-").trim() || "SKU"; }
  function toast(msg, err) {
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = `position:fixed;right:22px;bottom:22px;z-index:2147483647;background:${ err ? "#ef4444" : "#16a34a" };color:#fff;padding:8px 12px;border-radius:10px;font:12px/1.3 system-ui`;
    document.documentElement.appendChild(d); setTimeout(() => d.remove(), 2200);
  }
  const isDataURL = (s) => typeof s === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(s);
  async function downscaleDataUrl(dataUrl, maxDim = 1536) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          let { width: w, height: h } = img;
          if (Math.max(w, h) > maxDim) {
            const r = w >= h ? maxDim / w : maxDim / h;
            w = Math.max(1, Math.round(w * r));
            h = Math.max(1, Math.round(h * r));
          }
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const ctx = c.getContext("2d", { alpha: true });
          if (!ctx) return reject(new Error("Canvas 2D context not available."));
          ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
          c.toBlob((blob) => {
            if (!blob) return reject(new Error("Failed to encode blob."));
            const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob);
          }, "image/png");
        };
        img.onerror = () => reject(new Error("Cannot load image."));
        img.src = dataUrl;
      } catch (e) { reject(e); }
    });
  }
  async function padToSquareDataUrl(dataUrl, maxDim = 1536, bg = null) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w0 = img.naturalWidth || img.width;
        const h0 = img.naturalHeight || img.height;
        const longEdge = Math.max(w0, h0);
        const scale = longEdge > maxDim ? maxDim / longEdge : 1;
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const S = Math.max(w, h);
        const c = document.createElement("canvas"); c.width = S; c.height = S;
        const ctx = c.getContext("2d", { alpha: true });
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S); }
        const x = Math.floor((S - w) / 2); const y = Math.floor((S - h) / 2);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w0, h0, x, y, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Pad square failed.")); img.src = dataUrl;
    });
  }
  async function upscale2xDataURL(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const c = document.createElement("canvas");
        c.width = Math.max(1, w * 2); c.height = Math.max(1, h * 2);
        const ctx = c.getContext("2d", { alpha: true });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Upscale load failed.")); img.src = dataUrl;
    });
  }

  async function addSample(b64) {
    const sq = await padToSquareDataUrl(b64, 1536, null);
    state.samples.push(sq);
    if (state.samples.length > 2) state.samples = state.samples.slice(-2);
    renderSamples();
  }
  async function addArtRef(b64) {
    const sq = await padToSquareDataUrl(b64, 1536, null);
    state.artRefs.push(sq);
    if (state.artRefs.length > 2) state.artRefs = state.artRefs.slice(-2);
    renderArtRefs();
  }
  function chooseFileTo(cb) {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*";
    i.onchange = async () => {
      const f = i.files?.[0]; if (!f) return;
      const fr = new FileReader(); fr.onload = () => void cb(fr.result); fr.readAsDataURL(f);
    };
    i.click();
  }
  async function pasteClipboardTo(cb) {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) for (const t of it.types) if (t.startsWith("image/")) {
        const b = await it.getType(t); const fr = new FileReader();
        fr.onload = () => void cb(fr.result); fr.readAsDataURL(b); return;
      }
      toast("Clipboard has no image.", true);
    } catch { toast("Clipboard blocked.", true); }
  }
  function openCorsHelp(url) { if (!host) createPanel(); shadow.getElementById("dlgUrl").textContent = url; shadow.getElementById("corsDlg").style.display = "flex"; }

  /* ===== Auto open panel on load ===== */
  window.__AI_IMAGE_STUDIO__ = { open: () => { if (!host) createPanel(); host.style.display = "block"; } };
  const open = () => window.__AI_IMAGE_STUDIO__?.open?.();
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", open, { once:true }); else open();

})();
