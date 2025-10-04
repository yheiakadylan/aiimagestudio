<script>
/* ========== Global App Config (host chung) ========== */
/* Lưu ý: KEY sẽ public khi host web tĩnh. Khi cần đổi, chỉ sửa ở đây và redeploy. */
window.APP_CONFIG = {
  GOOGLE_API_KEY: "AIzaSyBGBD1q-coZHLCfB0b3uGjJT3Yv8p0n_BQ",  // <-- đổi tại đây

  /* Prompt templates (mặc định lưu sẵn trong source) */
  TEMPLATES: [
    {
      id: "tpl-tee-front",
      name: "T-shirt front on wooden desk",
      prompt: "Front view t-shirt mockup on rustic wooden desk, natural soft shadows, top-down angle, no border, print centered, photoreal, 1:1",
      createdAt: 1728000000000
    },
    {
      id: "tpl-tote",
      name: "Tote bag lifestyle",
      prompt: "Canvas tote bag in minimal studio scene, soft daylight, subtle shadow on backdrop, keep product shape, apply artwork, 1:1",
      createdAt: 1728100000000
    }
  ],

  /* Product sample images mặc định: có thể để trống hoặc nhúng sẵn dataURL */
  SAMPLE_TEMPLATES: [
    // { id:"s1", name:"kitchen towel base", dataUrl:"data:image/png;base64,....", createdAt: 1728... }
  ],

  /* Artwork reference images mặc định */
  ARTREF_TEMPLATES: [
    // { id:"r1", name:"floral A", dataUrl:"data:image/png;base64,....", createdAt: 1728... }
  ]
};

/* --- Bootstrap: đẩy config mặc định vào localStorage nếu chưa có --- */
(function seedConfigToLocalStorage(){
  try{
    const mustInit = (k, v) => {
      const x = localStorage.getItem(k);
      if (x === null || x === undefined) localStorage.setItem(k, JSON.stringify(v));
    };
    mustInit("GOOGLE_API_KEY", window.APP_CONFIG.GOOGLE_API_KEY || "");
    mustInit("TEMPLATES", window.APP_CONFIG.TEMPLATES || []);
    mustInit("SAMPLE_TEMPLATES", window.APP_CONFIG.SAMPLE_TEMPLATES || []);
    mustInit("ARTREF_TEMPLATES", window.APP_CONFIG.ARTREF_TEMPLATES || []);
  }catch(e){ console.warn("Config bootstrap failed:", e); }
})();
</script>
