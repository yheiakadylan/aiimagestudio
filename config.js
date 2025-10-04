/* ========== Global App Config (host chung) ========== */
/* Cảnh báo: Host web tĩnh sẽ lộ KEY. Đổi key: sửa file này rồi redeploy. */
window.APP_CONFIG = {
  GOOGLE_API_KEY: "AIzaSyBGBD1q-coZHLCfB0b3uGjJT3Yv8p0n_BQ",  // <-- đổi tại đây

  /* Prompt templates mặc định */
  TEMPLATES: [
    {
      id: "tpl-tee-front",
      name: "T-shirt front on wooden desk",
      prompt:
        "Front view t-shirt mockup on rustic wooden desk, natural soft shadows, top-down angle, keep product shape, apply artwork, no border, photoreal, 1:1",
      createdAt: 1728000000000
    },
    {
      id: "tpl-tote",
      name: "Tote bag lifestyle",
      prompt:
        "Canvas tote bag in a minimal studio scene, soft daylight, subtle backdrop shadow, keep product shape, apply artwork, photoreal, 1:1",
      createdAt: 1728100000000
    }
  ],

  /* Có thể để trống, hoặc bỏ sẵn dataURL */
  SAMPLE_TEMPLATES: [
    // { id:"s1", name:"kitchen towel base", dataUrl:"data:image/png;base64,...", createdAt: 1728... }
  ],

  ARTREF_TEMPLATES: [
    // { id:"r1", name:"floral A", dataUrl:"data:image/png;base64,...", createdAt: 1728... }
  ]
};

/* --- Bootstrap: đẩy config mặc định vào localStorage nếu chưa có --- */
(function seedConfigToLocalStorage(){
  try{
    const mustInit = (k, v) => {
      if (localStorage.getItem(k) === null) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    };
    mustInit("GOOGLE_API_KEY", window.APP_CONFIG.GOOGLE_API_KEY || "");
    mustInit("TEMPLATES", window.APP_CONFIG.TEMPLATES || []);
    mustInit("SAMPLE_TEMPLATES", window.APP_CONFIG.SAMPLE_TEMPLATES || []);
    mustInit("ARTREF_TEMPLATES", window.APP_CONFIG.ARTREF_TEMPLATES || []);
  }catch(e){ console.warn("Config bootstrap failed:", e); }
})();
