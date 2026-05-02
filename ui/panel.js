/**
 * ui/panel.js — Node detail panel rendering and healing logic
 */

(function() {
  const panel = document.getElementById('panel-right');

  window.addEventListener('node-selected', (e) => {
    openPanel(e.detail);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  function openPanel(data) {
    if (!panel) return;
    panel.hidden = false;
    
    // Set grid columns to open panel (248px left, 1fr center, 320px right)
    const workspace = document.getElementById('workspace');
    if (workspace) workspace.style.gridTemplateColumns = '248px 1fr 320px';

    if (data.type === 'directory') {
      renderParentPanel(data);
    } else {
      renderLeafPanel(data);
    }
  }

  window.closePanel = function() {
    if (!panel) return;
    panel.hidden = true;
    const workspace = document.getElementById('workspace');
    if (workspace) workspace.style.gridTemplateColumns = '248px 1fr 0px';
  };

  function renderLeafPanel(data) {
    const score = Math.round((data.score || 0) * 100);
    const grade = data.grade || 'pending';
    
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title roobert">${data.label}</div>
          <div class="panel-meta ibm-mono">${data.path}</div>
          <div class="panel-meta noto">${data.type} · ${data.lineCount || 0} lines</div>
        </div>
        <button class="btn-close" onclick="closePanel()">✕</button>
      </div>
      
      <div class="panel-body">
        <div class="grade-chip grade-${grade} roobert">
          ● ${grade.toUpperCase()} — ${score}%
        </div>

        ${data.drift_signals && data.drift_signals.length > 0 ? `
          <div class="drift-signals">
            ${data.drift_signals.map(s => `<span class="signal-chip ibm-mono">${s}</span>`).join('')}
          </div>
        ` : ''}

        <div class="score-breakdown">
          <div class="section-header roobert">Score Breakdown</div>
          <table class="score-table" style="width: 100%; border-collapse: collapse;">
            ${renderScoreRow('S_final', data.score || 0, grade, true)}
            ${renderScoreRow('S1 Cosine', data.S1 || 0, grade)}
            ${renderScoreRow('S2 Cross-Encoder', data.S2 || 0, grade)}
            ${renderScoreRow('A Arch Fit', data.A || 0, grade)}
            ${renderScoreRow('T Type Fit', data.T || 0, grade)}
            ${renderScoreRow('D Drift Pen', data.D || 0, 'red', false, true)}
          </table>
        </div>

        <div class="code-section">
          <div class="section-header roobert">
            Code Preview 
            <button class="btn-copy" onclick="copyToClipboard(\`${data.code?.replace(/`/g, '\\`')}\`)">copy</button>
          </div>
          <pre class="code-preview grade-${grade}-bg"><code>${escapeHtml(data.code?.split('\n').slice(0, 30).join('\n') || '// No preview available')}</code></pre>
        </div>

        <div class="summary-section">
          <div class="section-header roobert">PageIndex Analysis</div>
          <p class="summary-text noto">${data.pageindex_summary || 'No PageIndex data available for this node.'}</p>
        </div>

        <div class="summary-section">
          <div class="section-header roobert">AI Summary</div>
          <p class="summary-text noto">${data.summary || 'Summary pending analysis...'}</p>
        </div>

        ${grade === 'red' ? `
          <button id="btn-reanchor" class="btn-reanchor roobert" onclick="reanchorNode('${data.id}')">
            ↺ Re-anchor This Node
          </button>
        ` : ''}
      </div>
    `;
  }

  function renderScoreRow(label, val, grade, isFinal = false, isPenalty = false) {
    const percent = Math.round(val * 100);
    const color = isPenalty ? (val > 0.3 ? '#600000' : '#d4850a') : getGradeColor(val);
    
    return `
      <tr style="${isFinal ? 'border-bottom: 1px solid #f0f0f0; margin-bottom: 8px;' : ''}">
        <td class="noto" style="padding: 4px 0; font-size: 13px; color: var(--color-slate);">${label}</td>
        <td class="ibm-mono" style="padding: 4px 12px; font-size: 13px; font-weight: 700; text-align: right;">${percent}%</td>
        <td style="width: 100px; padding: 4px 0;">
          <div class="progress-track">
            <div class="progress-fill" style="width: ${percent}%; background-color: ${color}"></div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderParentPanel(data) {
    // Directories have aggregated stats
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title roobert" style="font-size: 24px; letter-spacing: -0.72px;">${data.label}</div>
          <div class="panel-meta noto">Directory · ${data.path}</div>
        </div>
        <button class="btn-close" onclick="closePanel()">✕</button>
      </div>

      <div class="panel-body">
        <div class="parent-metrics">
          <div class="section-header roobert">Health Distribution</div>
          <div class="child-bar">
             <div class="bar-segment segment-green" style="width: 60%"></div>
             <div class="bar-segment segment-yellow" style="width: 30%"></div>
             <div class="bar-segment segment-red" style="width: 10%"></div>
          </div>
          <div class="panel-meta noto">12 green · 4 yellow · 1 red</div>
        </div>

        <div class="section-header roobert">Riskiest Children</div>
        <div class="child-list">
          <div class="child-item">
            <span class="child-name noto">app.js</span>
            <div class="child-grade" style="background: #600000"></div>
          </div>
          <div class="child-item">
            <span class="child-name noto">auth-handler.ts</span>
            <div class="child-grade" style="background: #d4850a"></div>
          </div>
        </div>

        <button class="btn-reanchor roobert" style="background: var(--color-coral-dark);">
          ↺ Heal All Red Children
        </button>
      </div>
    `;
  }

  window.reanchorNode = async function(nodeId) {
    const btn = document.getElementById('btn-reanchor');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<span class="pulse">⟳</span> Healing...';

    try {
      const response = await fetch('/reheal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId })
      });
      
      const res = await response.json();
      if (res.status === 'queued') {
        // We wait for the node_grade ws message to update the panel automatically
        console.log('[PANEL] Healing request queued for ' + nodeId);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry Healing';
      console.error('[PANEL] Re-anchor request failed:', err);
    }
  };

  window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.btn-copy');
      const old = btn.textContent;
      btn.textContent = 'copied!';
      setTimeout(() => btn.textContent = old, 2000);
    });
  };

  function getGradeColor(val) {
    if (val >= 0.8) return '#00b473';
    if (val >= 0.5) return '#d4850a';
    return '#600000';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
