/**
 * ui/panel.js - slide-out node inspector.
 */

(function() {
  const panel = document.getElementById('panel-right');
  let currentSelectedId = null;
  let currentTab = 'summary';
  let showFullCode = false;
  const CRITICAL_YELLOW_SCORE = 0.45;
  const SESSION_ID = new URLSearchParams(window.location.search).get('session') || null;

  window.addEventListener('node-selected', (event) => {
    currentSelectedId = event.detail.id;
    currentTab = 'summary';
    showFullCode = false;
    window.openPanelNodeId = currentSelectedId;
    openPanel(event.detail);
  });

  window.addEventListener('node-data-updated', (event) => {
    if (currentSelectedId === event.detail.id) openPanel(event.detail);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  function hydrateData(data) {
    const cy = window.CodexGraph?.getCy?.();
    if (!cy || !data?.id) return data || {};
    const node = cy.getElementById(data.id);
    return node.length ? { ...node.data(), ...data } : data;
  }

  function openPanel(rawData) {
    if (!panel) return;
    const data = hydrateData(rawData);
    const workspace = document.getElementById('workspace');
    workspace?.classList.add('panel-open');
    panel.removeAttribute('hidden');
    panel.innerHTML = data.type === 'directory' || isParentNode(data.id)
      ? renderParentPanel(data)
      : renderLeafPanel(data);
    wirePanel(data);
  }

  window.closePanel = function closePanel() {
    if (!panel) return;
    document.getElementById('workspace')?.classList.remove('panel-open');
    currentSelectedId = null;
    window.openPanelNodeId = null;
    window.CodexUI?.setSelectedBreadcrumb(null);
    setTimeout(() => panel.setAttribute('hidden', ''), 220);
  };

  window.updatePanelScores = function updatePanelScores(payload) {
    const id = payload.nodeId || payload.id;
    if (currentSelectedId !== id) return;
    openPanel({ ...payload, id });
  };

  function isParentNode(nodeId) {
    const cy = window.CodexGraph?.getCy?.();
    if (!cy || !nodeId) return false;
    return cy.nodes().filter((node) => node.data('parentRef') === nodeId).length > 0;
  }

  function wirePanel(data) {
    panel.querySelectorAll('[data-panel-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        currentTab = button.dataset.panelTab;
        openPanel(data);
      });
    });

    panel.querySelector('[data-panel-close]')?.addEventListener('click', closePanel);
    panel.querySelector('[data-copy-code]')?.addEventListener('click', () => copyToClipboard(data.code || data.fullCode || ''));
    panel.querySelector('[data-toggle-code]')?.addEventListener('click', () => toggleFullCode(data.id));
    panel.querySelector('[data-reanchor]')?.addEventListener('click', () => reanchorNode(data.id));
    panel.querySelector('[data-reanchor-risky-children]')?.addEventListener('click', () => reanchorRiskyChildren(data.id));
    panel.querySelector('[data-open-incident]')?.addEventListener('click', () => window.CodexIncident?.open?.('risky'));
    panel.querySelector('[data-focus-node]')?.addEventListener('click', () => focusNode(data.id));
    panel.querySelector('[data-expand-node]')?.addEventListener('click', () => {
      window.CodexGraph?.setViewMode('functions');
      focusNode(data.id);
    });
  }

  function renderLeafPanel(data) {
    const grade = data.grade || 'pending';
    const score = normalizeScore(data.S_final ?? data.score);
    const title = escapeHtml(data.label || String(data.id || '').split('/').pop());
    const path = escapeHtml(data.path || data.id || '');

    return `
      <div class="inspector">
        ${renderHeader(title, path, data.type || 'node', grade, score)}
        ${renderTabs()}
        <div class="inspector-body">
          ${renderActiveTab(data, grade, score)}
        </div>
      </div>
    `;
  }

  function renderParentPanel(data) {
    const cy = window.CodexGraph?.getCy?.();
    const children = cy
      ? cy.nodes().filter((node) => node.data('parentRef') === data.id)
      : [];
    const counts = { green: 0, yellow: 0, red: 0, pending: 0 };
    const risky = [];
    const riskyTargets = window.CodexGraph?.getRiskyRepairTargetsForNode?.(data.id) || [];

    children.forEach((child) => {
      const grade = child.data('grade') || 'pending';
      counts[grade] = (counts[grade] || 0) + 1;
      if (isRepairEligibleData(child.data())) risky.push(child);
    });

    const total = Math.max(1, children.length);
    const title = escapeHtml(data.label || data.id || 'Directory');
    const path = escapeHtml(data.path || data.id || '');

    return `
      <div class="inspector">
        ${renderHeader(title, path, 'group', data.grade || 'pending', normalizeScore(data.score))}
        <div class="inspector-body">
          <section class="panel-card">
            <p class="panel-kicker">Group health</p>
            <h3>${children.length} direct children</h3>
            <div class="health-bar">
              <span class="health-green" style="width:${counts.green / total * 100}%"></span>
              <span class="health-yellow" style="width:${counts.yellow / total * 100}%"></span>
              <span class="health-red" style="width:${counts.red / total * 100}%"></span>
              <span class="health-pending" style="width:${counts.pending / total * 100}%"></span>
            </div>
            <p class="panel-muted">${counts.green} green, ${counts.yellow} yellow, ${counts.red} red, ${counts.pending} pending</p>
          </section>

          <section class="panel-card">
            <p class="panel-kicker">Next action</p>
            <h3>${riskyTargets.length ? 'Repair risky child files' : risky.length ? 'Review risky children' : 'No repair-eligible children'}</h3>
            <p class="panel-muted">${riskyTargets.length ? `${riskyTargets.length} owning file${riskyTargets.length === 1 ? '' : 's'} contain red or critical-yellow children below 45% alignment.` : 'Ordinary yellow children remain review-only until their score drops below 45%.'}</p>
            <button class="panel-action" data-expand-node>Open in Functions view</button>
            ${riskyTargets.length ? `<button class="btn-reanchor" data-reanchor-risky-children>Re-anchor risky children (${riskyTargets.length})</button>` : '<button class="panel-action" data-open-incident>Open Incident Drawer</button>'}
          </section>
        </div>
      </div>
    `;
  }

  function renderHeader(title, path, type, grade, score) {
    const label = gradeLabel(grade);
    return `
      <div class="inspector-header">
        <div>
          <p class="panel-kicker">${escapeHtml(type)}</p>
          <h2>${title}</h2>
          <p class="panel-path mono">${path}</p>
        </div>
        <button class="btn-close" data-panel-close aria-label="Close panel">x</button>
      </div>
      <div class="inspector-summary-row">
        <span class="grade-chip grade-${grade}">${label}</span>
        <strong>${score == null ? '--' : `${Math.round(score * 100)}%`}</strong>
      </div>
    `;
  }

  function renderTabs() {
    const tabs = [
      ['summary', 'Summary'],
      ['code', 'Code'],
      ['drift', 'Drift'],
      ['actions', 'Actions'],
    ];
    return `
      <div class="panel-tabs">
        ${tabs.map(([id, label]) => `
          <button class="${currentTab === id ? 'active' : ''}" data-panel-tab="${id}">${label}</button>
        `).join('')}
      </div>
    `;
  }

  function renderActiveTab(data, grade, score) {
    if (currentTab === 'code') return renderCodeTab(data, grade);
    if (currentTab === 'drift') return renderDriftTab(data, score);
    if (currentTab === 'actions') return renderActionsTab(data, grade);
    return renderSummaryTab(data, score);
  }

  function renderSummaryTab(data, score) {
    const summary = data.summary || data.pageindex_summary || 'No AI summary has been attached to this node yet. The map can still use grade, score, imports, and code preview to guide review.';
    return `
      <section class="panel-card">
        <p class="panel-kicker">What this node is doing</p>
        <p class="summary-text">${escapeHtml(summary)}</p>
      </section>
      <section class="panel-card">
        <p class="panel-kicker">At a glance</p>
        <div class="fact-grid">
          <span>Score</span><strong>${score == null ? '--' : score.toFixed(2)}</strong>
          <span>Complexity</span><strong>${escapeHtml(data.cyclomaticComplexity ?? data.complexity ?? '--')}</strong>
          <span>Lines</span><strong>${escapeHtml(data.lineCount ?? '--')}</strong>
          <span>Hash</span><strong>${escapeHtml(String(data.contentHash || '--').slice(0, 10))}</strong>
        </div>
      </section>
    `;
  }

  function renderCodeTab(data, grade) {
    const code = showFullCode && data.fullCode ? data.fullCode : data.code;
    const preview = code
      ? String(code).split('\n').slice(0, showFullCode ? 240 : 28).join('\n')
      : '// No code preview available for this node.';
    return `
      <section class="panel-card code-card">
        <div class="panel-card-header">
          <p class="panel-kicker">Code preview</p>
          <div>
            <button class="mini-action" data-toggle-code>${showFullCode ? 'Collapse' : 'Expand'}</button>
            <button class="mini-action" data-copy-code>Copy</button>
          </div>
        </div>
        <pre class="code-preview grade-${grade}-bg ${showFullCode ? 'full-view' : ''}"><code>${escapeHtml(preview)}</code></pre>
      </section>
    `;
  }

  function renderDriftTab(data, score) {
    const rows = [
      ['S1', 'Semantic alignment', data.S1],
      ['S2', 'Sparse/PageIndex match', data.S2],
      ['A', 'Architecture consistency', data.A],
      ['T', 'Type/code quality', data.T],
      ['D', 'Drift penalty', data.D],
    ];

    return `
      <section class="panel-card">
        <p class="panel-kicker">Drift evidence</p>
        <h3>${score == null ? 'Awaiting score' : score >= 0.7 ? 'Aligned with the prompt' : score >= 0.4 ? 'Needs human review' : 'Likely off-prompt'}</h3>
        <div class="score-stack">
          ${rows.map(([key, label, value]) => scoreRow(key, label, value)).join('')}
        </div>
      </section>
      ${renderSignals(data)}
    `;
  }

  function renderActionsTab(data, grade) {
    const repairEligible = isRepairEligibleData(data);
    const target = window.CodexGraph?.getRepairTargetForNode?.(data.id) || data.id;
    const isChildTarget = target && target !== data.id;
    return `
      <section class="panel-card">
        <p class="panel-kicker">Canvas actions</p>
        <button class="panel-action" data-focus-node>Focus this node</button>
        <button class="panel-action" data-expand-node>Show surrounding functions</button>
      </section>
      <section class="panel-card ${repairEligible ? 'danger-card' : ''}">
        <p class="panel-kicker">Re-anchor</p>
        <h3>${repairEligible ? 'This node is repair-eligible' : 'Re-anchor is hidden for this node'}</h3>
        <p class="panel-muted">${repairEligible ? `${grade === 'red' ? 'Red drift' : 'Critical-yellow drift below 45%'} can be sent to Codex for scoped re-anchoring.${isChildTarget ? ` The owning file will be repaired: ${escapeHtml(target)}.` : ''}` : 'Green, pending, and ordinary yellow nodes stay review-only to avoid unnecessary rewrites.'}</p>
        ${repairEligible ? '<button class="btn-reanchor" data-reanchor>Re-anchor this node</button>' : '<button class="panel-action" data-open-incident>Open Incident Drawer</button>'}
      </section>
    `;
  }

  function scoreRow(key, label, value) {
    const numeric = typeof value === 'number' && !Number.isNaN(value) ? value : null;
    const pct = numeric == null ? 0 : Math.max(0, Math.min(100, Math.abs(numeric) * 100));
    return `
      <div class="score-line">
        <div>
          <strong>${key}</strong>
          <span>${label}</span>
        </div>
        <b>${numeric == null ? '--' : numeric.toFixed(2)}</b>
        <i><em style="width:${pct}%"></em></i>
      </div>
    `;
  }

  function renderSignals(data) {
    const signals = Array.isArray(data.drift_signals) ? data.drift_signals : [];
    if (!signals.length) {
      return `
        <section class="panel-card">
          <p class="panel-kicker">Signals</p>
          <p class="panel-muted">No explicit drift signals were attached to this node.</p>
        </section>
      `;
    }
    return `
      <section class="panel-card">
        <p class="panel-kicker">Signals</p>
        <div class="drift-signals">
          ${signals.map((signal) => `<span class="signal-chip">${escapeHtml(signal.reason || signal)}</span>`).join('')}
        </div>
      </section>
    `;
  }

  async function reanchorNode(nodeId) {
    const button = panel.querySelector('[data-reanchor]');
    if (!button) return;
    const targetId = window.CodexGraph?.getRepairTargetForNode?.(nodeId) || nodeId;
    button.disabled = true;
    button.textContent = 'Requesting repair...';

    try {
      if (window.CodexIncident?.queueNodes) {
        const result = await window.CodexIncident.queueNodes([targetId], 'panel-single', { confirm: true });
        if (!result) throw new Error('cancelled');
      } else {
        const response = await fetch(window.CODEXMAP_REANCHOR_URL || '/api/reheal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: targetId, sessionId: SESSION_ID }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      button.textContent = 'Repair queued';
      window.CodexUI?.showToast('Re-anchor request queued');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Re-anchor this node';
      if (error.message !== 'cancelled') {
        window.CodexUI?.showToast(`Re-anchor failed: ${error.message}`, 3600);
      }
    }
  }

  async function reanchorRiskyChildren(nodeId) {
    const targets = window.CodexGraph?.getRiskyRepairTargetsForNode?.(nodeId) || [];
    const button = panel.querySelector('[data-reanchor-risky-children]');
    if (!targets.length) {
      window.CodexUI?.showToast('No repair-eligible children in this group');
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Queueing repairs...';
    }
    const result = await window.CodexIncident?.queueNodes?.(targets, 'panel-children', { confirm: true });
    if (button) {
      button.disabled = !result;
      button.textContent = result ? 'Repairs queued' : `Re-anchor risky children (${targets.length})`;
    }
  }

  function focusNode(nodeId) {
    const cy = window.CodexGraph?.getCy?.();
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (!node.length) return;
    cy.animate({ center: { eles: node }, zoom: 1.15 }, { duration: 260 });
  }

  async function toggleFullCode(nodeId) {
    showFullCode = !showFullCode;
    const cy = window.CodexGraph?.getCy?.();
    const node = cy?.getElementById(nodeId);
    if (!node?.length) return;

    if (showFullCode && !node.data('fullCode') && node.data('type') === 'file') {
      try {
        const response = await fetch('/project-code/' + node.data('path'));
        if (response.ok) node.data('fullCode', await response.text());
      } catch (error) {
        console.warn('[PANEL] Full code fetch failed:', error.message);
      }
    }
    openPanel(node.data());
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(String(text || '')).then(() => {
      window.CodexUI?.showToast('Code copied');
    });
  }

  function normalizeScore(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return value > 1 ? value / 100 : value;
  }

  function isRepairEligibleData(data) {
    if (window.CodexGraph?.isRepairEligibleData) {
      return window.CodexGraph.isRepairEligibleData(data);
    }
    const grade = data?.grade || 'pending';
    const score = normalizeScore(data?.S_final ?? data?.score);
    return grade === 'red' || (grade === 'yellow' && score != null && score < CRITICAL_YELLOW_SCORE);
  }

  function gradeLabel(grade) {
    return {
      green: 'Green / aligned',
      yellow: 'Yellow / review',
      red: 'Red / drift',
      pending: 'Pending',
    }[grade] || grade;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }
})();
