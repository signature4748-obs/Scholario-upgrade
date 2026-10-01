(() => {
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length === 0 && el.textContent.trim() && out.length < 40) {
      const st = getComputedStyle(el);
      const fs = parseFloat(st.fontSize) || 16;
      const m = (st.color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m) {
        const a = m[4] === undefined ? 1 : +m[4];
        if (a > 0.25) {
          const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          const L = 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
          const cr = (1.0 + 0.05) / (L + 0.05);
          if (cr < 4.5) out.push({ t: el.textContent.trim().slice(0, 36), c: st.color, fs: fs, cr: Math.round(cr * 100) / 100 });
        }
      }
    }
  });
  return JSON.stringify(out.slice(0, 10));
})()
