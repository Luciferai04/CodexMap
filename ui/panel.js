/**
 * ui/panel.js — Coinbase Styled Panel
 */
const CodexPanel = (() => {
  let panelEl = null;

  function init() {
    panelEl = document.getElementById('panel-right');
  }

  function showNode(data) {
    if (!data) return;
    document.getElementById('app').classList.add('panel-open');

    const grade = (data.grade || 'pending').toLowerCase();
    const scoreText = data.score != null ? Number(data.score).toFixed(3) : 'PENDING';
    const codePreview = data.code ? data.code.trim().slice(0, 500) + (data.code.length > 500 ? '...' : '') : 'No source available';

    const scoreBreakdown = data.scoring_breakdown ? `
      <div class="panel-section">
        <h3 class="panel-h3">Scoring Breakdown</h3>
        <table class="breakdown-table">
          <thead>
            <tr><th>Metric</th><th>Weight</th><th>Value</th></tr>
          </thead>
          <tbody>
            <tr><td>S1 (Embedding)</td><td>20%</td><td>${data.scoring_breakdown.s1.toFixed(2)}</td></tr>
            <tr><td>S2 (Reasoning)</td><td>40%</td><td>${data.scoring_breakdown.s2.toFixed(2)}</td></tr>
            <tr><td>A (Arch Consistency)</td><td>20%</td><td>${data.scoring_breakdown.a.toFixed(2)}</td></tr>
            <tr><td>T (Type Consistency)</td><td>20%</td><td>${data.scoring_breakdown.t.toFixed(2)}</td></tr>
            <tr class="penalty-row"><td>D (Drift Penalty)</td><td>-30%</td><td>${data.scoring_breakdown.d.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>` : '';

    const dirStats = data.type === 'directory' && data.child_stats ? `
      <div class="panel-section">
        <h3 class="panel-h3">Directory Statistics</h3>
        <div class="cb-card" style="padding:12px; background:rgba(0,82,255,0.05)">
          <div style="font-size:12px; color:rgba(255,255,255,0.6); margin-bottom:8px;">
            Mean Child Score: <b>${data.child_stats.mean.toFixed(2)}</b><br/>
            Red Node Density: <b>${(data.child_stats.redRatio * 100).toFixed(0)}%</b><br/>
            Score Variance: <b>${data.child_stats.variance.toFixed(4)}</b>
          </div>
          ${(data.risk_flags || []).map(f => `<span class="risk-badge">${f}</span>`).join('')}
        </div>
        <button class="cb-btn-secondary" style="margin-top:12px;" onclick="CodexPanel.reanchor('${escapeAttr(data.id)}')">
          Heal All Red Children
        </button>
      </div>` : '';

    const reanchorHtml = (data.type === 'file' && grade === 'red') ? `
      <div class="panel-section" style="margin-top: 32px">
        <button class="cb-btn-primary" id="reanchor-btn" onclick="CodexPanel.reanchor('${escapeAttr(data.id)}')">
          Re-anchor Component
        </button>
      </div>` : '';

    panelEl.innerHTML = `
      <div style="padding: 24px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
          <div>
            <h2 class="panel-title">${escapeHtml(data.path || data.id)}</h2>
            <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:4px;">ID: ${escapeHtml(data.id)}</div>
          </div>
          <button class="cb-close" onclick="CodexPanel.hide()">✕</button>
        </div>

        <div class="cb-card">
          <div class="stat-grid">
            <div>
              <span class="stat-label">TYPE</span>
              <span class="stat-val-bold">${escapeHtml(data.type || 'file')}</span>
            </div>
            <div>
              <span class="stat-label">GRADE</span>
              <span class="stat-val-bold" style="color:var(--${grade})">${grade.toUpperCase()}</span>
            </div>
            <div>
              <span class="stat-label">SCORE</span>
              <span class="stat-val-bold">${scoreText}</span>
            </div>
            ${data.cyclomaticComplexity ? `
            <div>
              <span class="stat-label">COMPLEXITY</span>
              <span class="stat-val-bold">${data.cyclomaticComplexity}</span>
            </div>` : ''}
          </div>
        </div>

        ${dirStats}
        ${scoreBreakdown}

        ${data.summary ? `
        <div class="panel-section">
          <h3 class="panel-h3">AI Summary</h3>
          <p class="panel-body">${escapeHtml(data.summary)}</p>
        </div>` : ''}

        ${data.code ? `
        <div class="panel-section">
          <h3 class="panel-h3">Source Preview</h3>
          <pre class="panel-code">${escapeHtml(codePreview)}</pre>
        </div>` : ''}

        ${reanchorHtml}
      </div>

      <style>
        .panel-title {
          font-family: var(--font-display);
          font-size: 24px;
          margin: 0;
          line-height: 1.1;
          word-break: break-all;
        }
        .cb-close {
          background: transparent;
          border: none;
          color: rgba(255,255,255,0.5);
          font-size: 20px;
          cursor: pointer;
          transition: var(--transition);
        }
        .cb-close:hover { color: var(--cb-white); }
        
        .cb-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--cb-border);
          border-radius: var(--radius-card);
          padding: 16px;
          margin-bottom: 24px;
        }
        .stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .stat-label {
          display: block;
          font-family: var(--font-sans);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          margin-bottom: 4px;
          letter-spacing: 0.5px;
        }
        .stat-val-bold {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 600;
        }
        
        .panel-section { margin-bottom: 24px; }
        .panel-h3 {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 600;
          color: rgba(255,255,255,0.8);
          margin-bottom: 8px;
        }
        .panel-body {
          font-size: 14px;
          color: rgba(255,255,255,0.7);
        }
        .panel-code {
          background: var(--cb-black);
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--cb-border);
          font-family: var(--font-mono);
          font-size: 12px;
          color: rgba(255,255,255,0.8);
          overflow-x: auto;
        }

        .cb-btn-primary {
          width: 100%;
          background: var(--cb-gray-surface);
          color: var(--cb-black);
          font-family: var(--font-sans);
          font-size: 16px;
          font-weight: 600;
          padding: 16px 24px;
          border: none;
          border-radius: var(--radius-pill);
          cursor: pointer;
          transition: var(--transition);
        }
        .cb-btn-primary:hover {
          background: var(--cb-blue);
          color: var(--cb-white);
        }
        .cb-btn-secondary {
          width: 100%;
          background: transparent;
          color: var(--cb-white);
          border: 1px solid var(--cb-border);
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 500;
          padding: 12px 20px;
          border-radius: var(--radius-pill);
          cursor: pointer;
          transition: var(--transition);
        }
        .cb-btn-secondary:hover { background: rgba(255,255,255,0.05); }

        .breakdown-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-top: 8px;
        }
        .breakdown-table th { text-align: left; color: rgba(255,255,255,0.4); padding: 4px; font-weight: 500; }
        .breakdown-table td { padding: 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .penalty-row { color: #ff8080; }
        
        .risk-badge {
          display: inline-block;
          background: rgba(207, 42, 42, 0.2);
          color: #ff8080;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          font-family: var(--font-mono);
          margin-right: 8px;
          border: 1px solid rgba(207, 42, 42, 0.3);
        }
      </style>
    `;
  }

  function hide() {
    document.getElementById('app').classList.remove('panel-open');
  }

  async function reanchor(nodeId) {
    const btn = document.getElementById('reanchor-btn') || { textContent: '' };
    btn.textContent = 'Queuing...';

    try {
      const resp = await fetch('/reheal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId })
      });
      if (resp.ok) {
        btn.textContent = 'Heal Queued';
        setTimeout(() => { if(btn.textContent === 'Heal Queued') btn.textContent = 'Heal Component'; }, 3000);
      }
    } catch(e) {
      btn.textContent = 'Failed';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(str) { return str.replace(/'/g, "\\'"); }

  return { init, showNode, hide, reanchor };
})();

