/**
 * ui/ws.js — WebSocket client for CodexMap dashboard
 * Connects to the Broadcaster (port 4242) and updates the UI state.
 *
 * FIX #2: Proper reconnection with exponential backoff + waiting banner
 * FIX #4: Score components updated from node_grade messages (running average)
 * FIX #5: Agent pills light up on relevant message types
 */

(function() {
  let socket;
  let reconnectAttempts = 0;
  let reconnectTimer;
  let initialConnectTimer;
  const WS_URL = `ws://${window.location.hostname || 'localhost'}:4242`;

  // FIX #4: Running averages for score components
  const scoreHistory = { S1: [], S2: [], A: [], T: [], D: [], S_final: [] };

  function connect() {
    // Wait for CodexGraph to be ready before connecting
    if (!window.CodexGraph || !window.CodexGraph.isReady()) {
      setTimeout(connect, 200);
      return;
    }

    console.log('[WS] Connecting to', WS_URL);
    try {
      socket = new WebSocket(WS_URL);
    } catch (e) {
      console.error('[WS] Failed to create WebSocket:', e);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      console.log('[WS] ✅ Connected to CodexMap Orchestrator');
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      clearTimeout(initialConnectTimer);
      
      // FIX #2: Update status indicators
      updateStatusDirect('live', '#00b473', 'Live');
      hideWaitingBanner();
      
      // FIX #5: Broadcaster is always active if WS connects
      updateAgentPill('broadcaster', true);
      
      // FIX #2: Request full state on connect
      socket.send(JSON.stringify({ type: 'request_full_reset' }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[WS] ←', msg.type, msg.type === 'node_grade' ? msg.payload?.id : '');
        handleMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    socket.onclose = () => {
      console.log('[WS] Disconnected');
      updateStatusDirect('idle', '#ffc6c6', 'Disconnected');
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.error('[WS] Error:', err);
      // Don't call socket.close() — onclose will fire automatically
    };
  }

  function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(1000 * reconnectAttempts, 10000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(connect, delay);
  }

  function handleMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'full_reset':
        window.CodexGraph.update(payload);
        updateAgentPill('broadcaster', true);
        updateAgentPill('cartographer', true);
        break;

      case 'graph_update':
        // On incremental graph_update, re-fetch full state for simplicity
        // (the broadcaster batches diffs but our graph.js does full renders)
        if (payload && (payload.nodes?.length > 0 || payload.edges?.length > 0)) {
          // Fetch fresh state from API
          fetch('/api/state')
            .then(r => r.json())
            .then(state => window.CodexGraph.update(state))
            .catch(e => console.warn('[WS] Failed to fetch state:', e));
          updateAgentPill('cartographer', true);
        }
        break;

      case 'node_grade':
        window.CodexGraph.updateGrade(
          payload.id, payload.grade, payload.score, payload.scoring_breakdown
        );
        updateAgentPill('sentinel', true);
        
        // FIX #4: Update running score averages from node_grade messages
        if (payload.scoring_breakdown) {
          const bd = payload.scoring_breakdown;
          const mapping = { S1: 's1', S2: 's2', A: 'a', T: 't', D: 'd' };
          Object.entries(mapping).forEach(([key, bdKey]) => {
            const val = bd[bdKey] ?? bd[key];
            if (val != null) {
              scoreHistory[key].push(val);
              if (scoreHistory[key].length > 50) scoreHistory[key].shift();
            }
          });
          if (payload.score != null) {
            scoreHistory.S_final.push(payload.score);
            if (scoreHistory.S_final.length > 50) scoreHistory.S_final.shift();
          }
          updateScoreTableFromHistory();
        }
        break;

      case 'drift_score':
        updateDriftScore(payload.score);
        if (window.DriftTimeline) window.DriftTimeline.addPoint(payload);
        break;

      case 'full_drift_history':
        if (payload && payload.snapshots && window.DriftTimeline) {
          payload.snapshots.forEach(s => window.DriftTimeline.addPoint(s));
        }
        break;

      case 'collapse_warning':
        toggleCollapseBanner(payload.triggered, payload.signals);
        break;

      case 'generation_done':
        updateStatusDirect('done', '#00b473', 'Done');
        updateAgentPill('generator', false);
        break;

      case 'agent_log':
        if (window.ActivityFeed) {
          window.ActivityFeed.addEntry(payload);
        }
        // Light up the corresponding agent pill
        const agentName = (payload.agent || '').toLowerCase();
        if (agentName) updateAgentPill(agentName, true);
        break;

      case 'agent_logs_full':
        // Bulk replay of historical logs
        if (window.ActivityFeed && Array.isArray(payload)) {
          payload.slice(-8).forEach(log => window.ActivityFeed.addEntry(log));
        }
        break;

      case 'agent_status':
        if (payload && payload.agent) {
          const pill = document.getElementById(`pill-${payload.agent}`);
          if (pill) {
            pill.className = `agent-pill ${payload.status === 'active' ? 'active' : ''}`;
          }
        }
        break;

      case 'heal_status_update':
        console.log('[WS] Heal status:', payload.nodeId, payload.status);
        break;

      default:
        // Ignore unknown message types silently
        break;
    }
  }

  // FIX #2: Direct DOM status update (no class toggling issues)
  function updateStatusDirect(state, color, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');
    if (dot) {
      dot.style.backgroundColor = color;
      dot.style.boxShadow = state === 'live' ? `0 0 8px ${color}` : 'none';
      dot.className = 'status-dot ' + state;
    }
    if (label) label.textContent = text;
  }

  function updateDriftScore(score) {
    const val = document.getElementById('drift-score-value');
    const pill = document.getElementById('drift-pill');
    if (!val || !pill) return;

    val.textContent = Math.round(score) + '%';
    
    pill.className = 'drift-pill roobert';
    if (score >= 80) pill.classList.add('grade-a-chip');
    else if (score >= 50) pill.classList.add('grade-c-chip');
    else pill.classList.add('grade-f-chip');
  }

  function toggleCollapseBanner(show, signals) {
    const banner = document.getElementById('collapse-banner');
    const text = document.getElementById('collapse-banner-text');
    if (!banner || !text) return;

    if (show) {
      banner.hidden = false;
      text.textContent = `⚠ Architectural Collapse Detected — ${Array.isArray(signals) ? signals.join(', ') : signals}`;
      setTimeout(() => banner.hidden = true, 10000);
    } else {
      banner.hidden = true;
    }
  }

  // FIX #5: Agent pill activation with auto-timeout
  function updateAgentPill(agent, active) {
    const pill = document.getElementById(`pill-${agent}`);
    if (!pill) return;
    
    if (active) {
      pill.classList.add('active');
      // Auto-deactivate after 3 seconds (except broadcaster which stays lit while connected)
      if (agent !== 'broadcaster') {
        clearTimeout(pill._timeout);
        pill._timeout = setTimeout(() => pill.classList.remove('active'), 3000);
      }
    } else {
      pill.classList.remove('active');
    }
  }

  // FIX #4: Update the sidebar score table from running averages
  function updateScoreTableFromHistory() {
    const components = [
      { id: 's1', key: 'S1' },
      { id: 's2', key: 'S2' },
      { id: 'a', key: 'A' },
      { id: 't', key: 'T' },
      { id: 'd', key: 'D' }
    ];
    
    components.forEach(c => {
      const arr = scoreHistory[c.key];
      if (arr.length === 0) return;
      
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const percent = Math.round(avg * 100);
      
      const valEl = document.getElementById(`val-${c.id}`);
      const barEl = document.getElementById(`bar-${c.id}`);
      if (valEl) valEl.textContent = percent + '%';
      if (barEl) {
        barEl.style.width = percent + '%';
        barEl.style.backgroundColor = c.id === 'd' 
          ? (avg > 0.3 ? '#600000' : '#d4850a')
          : (avg >= 0.8 ? '#00b473' : avg >= 0.5 ? '#d4850a' : '#600000');
      }
    });
  }

  // FIX #2: Waiting banner — shown if not connected after 3 seconds
  function showWaitingBanner() {
    let banner = document.getElementById('ws-waiting-banner');
    if (banner) return;
    
    banner = document.createElement('div');
    banner.id = 'ws-waiting-banner';
    banner.style.cssText = `
      position: fixed; top: 56px; left: 0; right: 0; z-index: 200;
      background: #ffe6cd; border-bottom: 2px solid #d4850a;
      padding: 10px 20px; display: flex; align-items: center;
      justify-content: space-between; font-family: var(--font-display);
      font-size: 14px; color: #746019;
    `;
    banner.innerHTML = `
      <span>⚡ Waiting for orchestrator on port 4242... Run: <code style="background:#fff;padding:2px 6px;border-radius:4px">node orchestrator.js "your prompt"</code></span>
      <button onclick="this.parentElement.remove()" style="background:#d4850a;color:white;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:600">Retry</button>
    `;
    document.body.appendChild(banner);
  }

  function hideWaitingBanner() {
    document.getElementById('ws-waiting-banner')?.remove();
  }

  // Start connection + show waiting banner after 3s if not connected
  connect();
  initialConnectTimer = setTimeout(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showWaitingBanner();
    }
  }, 3000);
})();

window.triggerFullReanchor = function() {
  fetch('http://localhost:4242/reheal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: true })
  }).then(res => res.json())
    .then(data => console.log('Full sweep triggered:', data))
    .catch(err => console.error('Full sweep failed:', err));
};
