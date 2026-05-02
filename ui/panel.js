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
    const workspace = document.getElementById('workspace');
    workspace.classList.add('panel-open');
    panel.removeAttribute('hidden');
    
    if (data.type === 'directory') {
      panel.innerHTML = renderParentPanel(data);
    } else {
      panel.innerHTML = renderLeafPanel(data);
    }

    // Wire re-anchor button if present
    const btn = panel.querySelector('.btn-reanchor');
    if (btn) btn.onclick = () => reanchorNode(data.id);
  }

  window.closePanel = function() {
    if (!panel) return;
    document.getElementById('workspace').classList.remove('panel-open');
    setTimeout(() => {
      panel.setAttribute('hidden', '');
    }, 300);
  };

  function renderLeafPanel(d) {
    const gradeLabel = { green:'ON SCOPE', yellow:'REVIEW', red:'CRITICAL', pending:'PENDING' };
    const score = d.score != null ? (d.score*100).toFixed(0)+'%' : '--';
    
    return `
      <div class="panel-header">
        <div>
          <div class="panel-title">${d.label}</div>
          <div class="panel-meta mono">${d.path || d.id}</div>
          <div class="panel-meta">${d.type || 'file'} · ${d.lineCount||0} lines</div>
        </div>
        <button class="btn-close" onclick="closePanel()">✕</button>
      </div>
      <div class="grade-chip grade-${d.grade}">
        ● ${gradeLabel[d.grade]||d.grade} — ${score}
      </div>
      <div class="section-header">Score Components</div>
      <table class="score-table">
        ${[
          { label: 'S1', key: 's1', name: 'Semantic' },
          { label: 'S2', key: 's2', name: 'Sparse' },
          { label: 'A',  key: 'a',  name: 'Arch' },
          { label: 'T',  key: 't',  name: 'Temporal' },
          { label: 'D',  key: 'd',  name: 'PageIndex' }
        ].map(m => {
          const val = d.scoring_breakdown ? (d.scoring_breakdown[m.key] || 0) : 0;
          return `
          <tr>
            <td class="score-label" title="${m.name}">${m.label}</td>
            <td class="score-val">${val.toFixed(2)}</td>
            <td><div class="score-bar">
              <div class="score-fill grade-${d.grade}-fill" 
                   style="width:${val * 100}%"></div>
            </div></td>
          </tr>`;
        }).join('')}
        <tr class="score-final-row">
          <td class="score-label">S_final</td>
          <td class="score-final-val">${d.score != null ? (d.score).toFixed(2) : '--'}</td>
        </tr>
      </table>
      <div class="section-header">
        Code Preview 
        <button class="btn-copy" onclick="copyToClipboard(\`${d.code?.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">copy</button>
      </div>
      <pre class="code-preview grade-${d.grade}-bg"><code class="mono">${
        escapeHtml(d.code?.split('\n').slice(0,30).join('\n') || '// No preview available')
      }</code></pre>
      
      ${d.summary ? `
        <div class="section-header">
          Architectural Intelligence
          <span class="badge badge-blue">vectorless RAG</span>
        </div>
        <p class="summary-text italic">${d.summary}</p>
      ` : ''}
        ${d.drift_signals?.length > 0 ? `
          <div class="drift-signals">
            <div class="signals-label">Drift Signals</div>
            ${d.drift_signals.map(s => `
              <div class="signal-chip">⚠ ${s.reason || s}</div>
            `).join('')}
          </div>
        ` : ''}
      ` : ''}

      ${d.summary ? `
        <div class="section-header">AI Summary</div>
        <p class="summary-text">${d.summary}</p>` : ''}
      
      ${d.grade === 'red' ? `
        <button class="btn-reanchor">↺  Re-anchor This Node</button>` : ''}
    `;
  }

  function renderParentPanel(data) {
    return `
      <div class="panel-header">
        <div>
          <div class="panel-title" style="font-size: 24px; letter-spacing: -0.72px;">${data.label}</div>
          <div class="panel-meta">Directory · ${data.path || data.id}</div>
        </div>
        <button class="btn-close" onclick="closePanel()">✕</button>
      </div>

      <div class="panel-body">
        <div class="parent-metrics">
          <div class="section-header">Health Distribution</div>
          <div class="child-bar">
             <div class="bar-segment segment-green" style="width: 60%"></div>
             <div class="bar-segment segment-yellow" style="width: 30%"></div>
             <div class="bar-segment segment-red" style="width: 10%"></div>
          </div>
          <div class="panel-meta">12 green · 4 yellow · 1 red</div>
        </div>

        <div class="section-header">Riskiest Children</div>
        <div class="child-list">
          <div class="child-item">
            <span class="child-name">app.js</span>
            <div class="child-grade" style="background: #600000"></div>
          </div>
          <div class="child-item">
            <span class="child-name">auth-handler.ts</span>
            <div class="child-grade" style="background: #d4850a"></div>
          </div>
        </div>

        <button class="btn-reanchor" style="background: var(--color-coral-dark);">
          ↺ Heal All Red Children
        </button>
      </div>
    `;
  }

  window.reanchorNode = async function(nodeId) {
    const btn = document.querySelector('.btn-reanchor');
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
      if (res.status === 'healing') {
        console.log('[PANEL] Healing request sent for ' + nodeId);
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

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
