/**
 * ui/drift-timeline.js — Session drift chart and score breakdown
 *
 * Draws a live drift score timeline with zones (Aligned/Review/Critical).
 * Polls /api/drift-log every 10s as fallback when WS isn't delivering.
 */

window.DriftTimeline = (function() {
  let canvas, ctx;
  let points = [];
  const MAX_POINTS = 50;
  const PADDING = { top: 16, bottom: 12, left: 28, right: 8 };
  let pollInterval;

  function init() {
    canvas = document.getElementById('drift-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    // Fetch initial history via API
    fetch('/api/drift-log')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          data.slice(-MAX_POINTS).forEach(p => {
            if (p.score != null) {
              points.push({ score: p.score, timestamp: p.timestamp || new Date().toISOString() });
            }
          });
          if (points.length > 0) {
            draw();
          } else {
            drawEmptyGrid();
          }
        } else {
          drawEmptyGrid();
        }
      })
      .catch(() => drawEmptyGrid());
      
    setupScoreTable();
    pollInterval = setInterval(pollDriftLog, 10000);
  }

  function pollDriftLog() {
    fetch('/api/drift-log')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        let added = false;
        data.forEach(p => {
          if (p.score != null && !points.find(x => x.timestamp === p.timestamp)) {
            points.push({ score: p.score, timestamp: p.timestamp });
            added = true;
          }
        });
        if (points.length > MAX_POINTS) points = points.slice(-MAX_POINTS);
        if (added) draw();
      })
      .catch(() => {});
  }

  function addPoint(payload) {
    const score = payload.score ?? payload.driftScore;
    if (score == null) return;
    const timestamp = payload.timestamp || new Date().toISOString();
    if (points.find(p => p.timestamp === timestamp)) return;
    points.push({ score, timestamp });
    if (points.length > MAX_POINTS) points.shift();
    draw();
  }

  // Convert score (0-100) to canvas Y with padding
  function scoreToY(score) {
    const plotH = canvas.height - PADDING.top - PADDING.bottom;
    return PADDING.top + plotH - (score / 100 * plotH);
  }

  function drawEmptyGrid() {
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    drawZones(w, h);
    drawGridLines(w, h);
    
    // "Awaiting" text
    ctx.fillStyle = '#a5a8b5';
    ctx.font = '12px "Noto Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting drift data...', w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  function drawZones(w, h) {
    const zones = [
      { min: 0, max: 40, color: 'rgba(255,198,198,0.12)', label: 'Critical' },
      { min: 40, max: 70, color: 'rgba(255,230,205,0.10)', label: 'Review' },
      { min: 70, max: 100, color: 'rgba(195,250,245,0.12)', label: 'Aligned' }
    ];

    zones.forEach(z => {
      const yTop = scoreToY(z.max);
      const yBot = scoreToY(z.min);
      ctx.fillStyle = z.color;
      ctx.fillRect(PADDING.left, yTop, w - PADDING.left - PADDING.right, yBot - yTop);

      // Zone label
      ctx.fillStyle = '#c7cad5';
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillText(z.label, PADDING.left + 3, yTop + 11);
    });
  }

  function drawGridLines(w, h) {
    ctx.strokeStyle = 'rgba(199,202,213,0.3)';
    ctx.lineWidth = 0.5;
    [0, 40, 70, 100].forEach(level => {
      const y = scoreToY(level);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(w - PADDING.right, y);
      ctx.stroke();

      // Y-axis label
      ctx.fillStyle = '#a5a8b5';
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(level.toString(), PADDING.left - 4, y + 3);
      ctx.textAlign = 'left';
    });
    ctx.setLineDash([]);
  }

  function draw() {
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const plotW = w - PADDING.left - PADDING.right;
    ctx.clearRect(0, 0, w, h);

    drawZones(w, h);
    drawGridLines(w, h);

    if (points.length < 1) return;

    // Helper to get X position for point i
    const getX = (i) => PADDING.left + (i / Math.max(points.length - 1, 1)) * plotW;

    // Single point — draw a dot
    if (points.length === 1) {
      const x = PADDING.left + plotW / 2;
      const y = scoreToY(points[0].score);
      ctx.fillStyle = getScoreColor(points[0].score);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Area fill under the line
    const lastScore = points[points.length - 1].score;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = getX(i);
      const y = scoreToY(p.score);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(getX(points.length - 1), scoreToY(0));
    ctx.lineTo(getX(0), scoreToY(0));
    ctx.closePath();

    const gradColor = lastScore >= 70 ? '0,180,115' : lastScore >= 40 ? '212,133,10' : '96,0,0';
    const grad = ctx.createLinearGradient(0, PADDING.top, 0, h - PADDING.bottom);
    grad.addColorStop(0, `rgba(${gradColor},0.20)`);
    grad.addColorStop(1, `rgba(${gradColor},0.02)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Data line
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    points.forEach((p, i) => {
      const x = getX(i);
      const y = scoreToY(p.score);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = getScoreColor(lastScore);
    ctx.stroke();

    // Data point markers
    points.forEach((p, i) => {
      const x = getX(i);
      const y = scoreToY(p.score);
      ctx.fillStyle = getScoreColor(p.score);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Inflection markers (delta > 10)
      if (i > 0) {
        const delta = Math.abs(p.score - points[i-1].score);
        if (delta > 10) {
          ctx.strokeStyle = '#5b76fe';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
          
          // Time label
          ctx.font = '8px "IBM Plex Mono", monospace';
          ctx.fillStyle = '#5b76fe';
          const t = new Date(p.timestamp).toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'});
          ctx.fillText(t, x - 14, y - 10);
        }
      }
    });

    // Current score label at the end of the line
    const lastX = getX(points.length - 1);
    const lastY = scoreToY(lastScore);
    ctx.fillStyle = getScoreColor(lastScore);
    ctx.font = 'bold 11px "IBM Plex Mono", monospace';
    ctx.fillText(Math.round(lastScore) + '%', lastX + 4, lastY - 4);
  }

  function getScoreColor(score) {
    if (score >= 70) return '#00b473';
    if (score >= 40) return '#d4850a';
    return '#600000';
  }

  function setupScoreTable() {
    const container = document.getElementById('score-table-container');
    if (!container) return;

    const components = [
      { id: 's1', label: 'S1 Cosine', key: 'S1' },
      { id: 's2', label: 'S2 Cross-Enc', key: 'S2' },
      { id: 'a', label: 'A Arch Fit', key: 'A' },
      { id: 't', label: 'T Type Fit', key: 'T' },
      { id: 'd', label: 'D Drift Pen', key: 'D' }
    ];

    container.innerHTML = components.map(c => `
      <div class="score-row">
        <div class="score-label-group">
          <span class="score-label roobert">${c.label}</span>
          <span id="val-${c.id}" class="score-value roobert">--</span>
        </div>
        <div class="progress-track">
          <div id="bar-${c.id}" class="progress-fill" style="width: 0%"></div>
        </div>
      </div>
    `).join('');

    // Update score bars when a node is selected
    window.addEventListener('node-selected', (e) => {
      const data = e.detail;
      components.forEach(c => {
        const valEl = document.getElementById(`val-${c.id}`);
        const barEl = document.getElementById(`bar-${c.id}`);
        const val = data[c.key];
        
        if (val != null) {
          const percent = Math.round(val * 100);
          valEl.textContent = percent + '%';
          barEl.style.width = percent + '%';
          barEl.style.backgroundColor = getGradeColor(val, c.id === 'd');
        }
      });
    });
  }

  function getGradeColor(val, isPenalty) {
    if (isPenalty) return val > 0.3 ? '#600000' : '#d4850a';
    if (val >= 0.8) return '#187574';
    if (val >= 0.5) return '#d4850a';
    return '#600000';
  }

  return { init, addPoint };
})();

/**
 * window.ActivityFeed — Real-time agent log visualization
 */
window.ActivityFeed = (function() {
  function addEntry(log) {
    const container = document.getElementById('agent-logs-container');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'feed-entry';
    
    const agentName = log.agent || log.AGENT || 'System';
    const message = log.msg || log.message || log.action || '';
    const time = log.time || new Date().toLocaleTimeString('en-GB', { hour12: false });
    const color = getAgentColor(agentName);

    entry.innerHTML = `
      <div class="feed-dot" style="background: ${color}"></div>
      <div class="feed-content">
        <span class="feed-agent roobert">${agentName}</span>
        <span class="feed-action noto">${message}</span>
        <span class="feed-time ibm-mono">${time}</span>
      </div>
    `;

    container.prepend(entry);
    while (container.children.length > 8) {
      container.removeChild(container.lastChild);
    }
  }

  function getAgentColor(agent) {
    const a = (agent || '').toLowerCase();
    if (a === 'cartographer') return '#5b76fe';
    if (a === 'sentinel') return '#00b473';
    if (a === 'generator') return '#746019';
    if (a === 'broadcaster') return '#5b76fe';
    if (a === 'healer') return '#d4850a';
    if (a === 'architect') return '#187574';
    return '#a5a8b5';
  }

  return { addEntry };
})();

// Initialize on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.DriftTimeline.init();
});
