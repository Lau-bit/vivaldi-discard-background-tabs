// Static carbon hexagon field for the parked-tab placeholder page. Adapted
// from vivaldi-extensions/nanosuit-curtain's drawHexField, but with the
// glow-color energy seams and breathing/sweep animation stripped out: every
// seam and panel here is a shade of the same carbon color, drawn once (and
// redrawn only on resize), no requestAnimationFrame/Web Animations loop.
(() => {
  const CARBON = "#0b0c0f";
  const HEX_SIZE = 46; // px, center-to-corner

  function shade(hex, amt) {
    // amt in [-1,1]; lighten/darken a #rrggbb color
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    r = f(r); g = f(g); b = f(b);
    return `rgb(${r},${g},${b})`;
  }

  function hexPath(ctx, cx, cy, s) {
    // flat-top hexagon
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawHexField(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const s = HEX_SIZE;
    const seam = Math.max(1.5, s * 0.06);

    ctx.fillStyle = shade(CARBON, -0.03);
    ctx.fillRect(0, 0, W, H);

    const horiz = 1.5 * s;
    const vert = Math.sqrt(3) * s;
    const cols = Math.ceil(W / horiz) + 2;
    const rows = Math.ceil(H / vert) + 2;

    // pass 1: seams, a lighter carbon grey (no glow/blur, no color accent)
    ctx.lineJoin = "round";
    for (let c = -1; c < cols; c++) {
      const offY = (c & 1) ? vert / 2 : 0;
      for (let r = -1; r < rows; r++) {
        const cx = c * horiz;
        const cy = r * vert + offY;
        ctx.beginPath();
        hexPath(ctx, cx, cy, s);
        ctx.strokeStyle = shade(CARBON, 0.22);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = seam;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // pass 2: carbon panels inset over the seams, leaving seams visible.
    // Per-panel variation + random breaks give it texture without motion.
    for (let c = -1; c < cols; c++) {
      const offY = (c & 1) ? vert / 2 : 0;
      for (let r = -1; r < rows; r++) {
        const cx = c * horiz;
        const cy = r * vert + offY;

        // ~5% of panels are "broken" / missing -> seam shows through
        if (Math.random() < 0.05) continue;

        const v = (Math.random() - 0.5) * 0.05; // brightness jitter
        const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
        g.addColorStop(0, shade(CARBON, 0.04 + v));
        g.addColorStop(0.5, shade(CARBON, 0.0 + v));
        g.addColorStop(1, shade(CARBON, -0.05 + v));

        ctx.beginPath();
        hexPath(ctx, cx, cy, s - seam);
        ctx.fillStyle = g;
        ctx.fill();

        // faint carbon-twill texture: a couple of diagonal hairlines
        ctx.save();
        ctx.beginPath();
        hexPath(ctx, cx, cy, s - seam);
        ctx.clip();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = shade(CARBON, 0.12);
        ctx.lineWidth = 1;
        for (let k = -s; k < s; k += 5) {
          ctx.beginPath();
          ctx.moveTo(cx + k, cy - s);
          ctx.lineTo(cx + k + s, cy + s);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;

        // subtle inner edge highlight on a few panels for depth
        if (Math.random() > 0.85) {
          ctx.beginPath();
          hexPath(ctx, cx, cy, s - seam * 1.5);
          ctx.strokeStyle = shade(CARBON, 0.3);
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // a soft vignette so it reads as a panel, not a flat fill
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  const canvas = document.getElementById("hexfield");
  let resizeRAF = 0;
  function redraw() { drawHexField(canvas); }
  redraw();
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(redraw);
  }, { passive: true });
})();
