<!-- config.js -->
<script>
/* ========== Global App Config (host chung) ========== */
window.APP_CONFIG = {
  GOOGLE_API_KEY: "AIzaSyBGBD1q-coZHLCfB0b3uGjJT3Yv8p0n_BQ",   // <-- đổi ở đây khi cần

  /* Prompt templates (mockup) — ví dụ mẫu */
  TEMPLATES: [
    {
      id: "tpl-tee-front",
      name: "T-shirt front on wooden desk",
      prompt: "Front view t-shirt mockup on rustic wooden desk, natural soft shadows, top-down angle, no border, print centered…",
      createdAt: 1728000000000
    },
    {
      id: "tpl-tote",
      name: "Tote bag lifestyle",
      prompt: "Canvas tote bag on minimal studio scene, soft daylight, subtle shadow on backdrop, keep product shape…",
      createdAt: 1728100000000
    }
  ],

  /* Product sample images mặc định (dataURL rỗng = không có sẵn) */
  SAMPLE_TEMPLATES: [
    // { id:"s1", name:"kitchen towel base", dataUrl:"data:image/png;base64,....", createdAt: 1728... }
  ],

  /* Artwork reference images mặc định */
  ARTREF_TEMPLATES: [
    // { id:"r1", name:"floral A", dataUrl:"data:image/png;base64,....", createdAt: 1728... }
  ]
};
</script>
