/**
 * ui/drift-timeline.js — Coinbase-themed clean analytical chart
 */
const DriftTimeline = (() => {
  let canvas = null, ctx = null;
  let dataPoints = [];

  function init() {
    canvas = document.getElementById('drift-chart');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    render();
  }

  function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = parent.clientWidth * dpr;
    canvas.height = parent.clientHeight * dpr;
    canvas.style.width = parent.clientWidth + 'px';
    canvas.style.height = parent.clientHeight + 'px';
    ctx.scale(dpr, dpr);
    render();
  }

  function addDataPoint(payload) {
    dataPoints.push({
      t: payload.timestamp || new Date().toISOString(),
      s: payload.score,
      a: payload.annotation
    });
    const scores = dataPoints.map(d=>d.s);
    document.getElementById('stat-peak').textContent = Math.max(...scores);
    render();
  }

  function render() {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0,0,w,h);

    if (dataPoints.length === 0) return;

    // Draw clean coinbase blue line
    ctx.strokeStyle = '#0052ff'; // Coinbase blue
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Padding
    const padX = 10, padY = 20;
    const chartW = w - padX*2, chartH = h - padY*2;
    
    const pts = dataPoints.map((d, i) => ({
      x: padX + (chartW / Math.max(1, dataPoints.length - 1)) * i,
      y: padY + chartH * (1 - d.s / 100),
      a: d.a
    }));

    if (pts.length === 1) pts[0].x = w/2;

    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // Subtle blue gradient fill
    if (pts.length > 1) {
      const grad = ctx.createLinearGradient(0, padY, 0, padY+chartH);
      grad.addColorStop(0, 'rgba(0, 82, 255, 0.15)');
      grad.addColorStop(1, 'rgba(0, 82, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padY+chartH);
      for(const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length-1].x, padY+chartH);
      ctx.closePath();
      ctx.fill();
    }

    // Points
    for (const p of pts) {
      if (p.a) {
        ctx.fillStyle = '#cf2a2a'; // Coinbase Red
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2); ctx.fill();
      }
    }
  }

  return { init, addDataPoint };
})();
