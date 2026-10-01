(() => {
  const vw = window.innerWidth;
  const dsw = document.documentElement.scrollWidth;
  const els = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1)) {
      let p = el.parentElement, s = false;
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') { s = true; break; }
        p = p.parentElement;
      }
      if (!s && els.length < 8) els.push(el.tagName + '.' + String(el.className).slice(0, 40) + '|R' + Math.round(r.right) + '|L' + Math.round(r.left));
    }
  });
  return 'W' + vw + ' SW' + dsw + ' ' + (dsw > vw + 1 ? 'H-OVERFLOW' : 'ok') + (els.length ? ' ' + JSON.stringify(els) : '');
})()
