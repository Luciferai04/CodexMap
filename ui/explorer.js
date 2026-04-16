/**
 * ui/explorer.js — Project Navigator UI
 */
const CodexExplorer = (() => {
  let modalEl = null;
  let currentPath = '';

  function init() {
    createModal();
  }

  function createModal() {
    modalEl = document.createElement('div');
    modalEl.id = 'explorer-modal';
    modalEl.innerHTML = `
      <div class="explorer-overlay">
        <div class="explorer-content">
          <div class="explorer-header">
            <h3>Project Navigator</h3>
            <button class="cb-close" onclick="CodexExplorer.hide()">✕</button>
          </div>
          <div id="explorer-path">/</div>
          <div id="explorer-list"></div>
          <div class="explorer-footer">
            <button class="cb-btn-secondary" onclick="CodexExplorer.goUp()">↑ Up</button>
            <button class="cb-btn-primary" onclick="CodexExplorer.selectCurrent()">Select This Folder</button>
          </div>
        </div>
      </div>
      <style>
        .explorer-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6);
          display: none; align-items: center; justify-content: center; z-index: 1000;
          backdrop-filter: blur(12px);
        }
        .explorer-content {
          background: rgba(16, 17, 19, 0.95); width: 660px; height: 550px;
          border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 32px 64px rgba(0,0,0,0.5), 0 0 40px rgba(0, 82, 255, 0.1);
        }
        .explorer-header { 
          padding: 24px; display: flex; justify-content: space-between; align-items: center;
          background: rgba(255,255,255,0.02);
        }
        #explorer-path {
          padding: 12px 24px; font-family: var(--font-mono); font-size: 11px;
          color: var(--cb-blue); background: rgba(0,82,255,0.05);
          letter-spacing: 0.5px;
        }
        #explorer-list {
          flex: 1; overflow-y: auto; padding: 16px;
        }
        .explorer-item {
          padding: 10px 16px; border-radius: 10px; cursor: pointer;
          display: flex; align-items: center; gap: 14px;
          transition: all 0.2s ease;
          border: 1px solid transparent;
        }
        .explorer-item:hover { 
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.06);
          transform: translateX(4px);
        }
        .explorer-item.is-dir { color: var(--cb-white); font-weight: 600; }
        
        .explorer-footer {
          padding: 24px; display: flex; gap: 16px;
          background: rgba(255,255,255,0.02);
        }
      </style>
    `;
    document.body.appendChild(modalEl);
  }

  async function show(startPath = '') {
    modalEl.querySelector('.explorer-overlay').style.display = 'flex';
    await browse(startPath);
  }

  function hide() {
    modalEl.querySelector('.explorer-overlay').style.display = 'none';
  }

  async function browse(targetPath) {
    const listEl = document.getElementById('explorer-list');
    const pathEl = document.getElementById('explorer-path');
    listEl.innerHTML = 'Loading...';

    try {
      const resp = await fetch(`/ls?path=${encodeURIComponent(targetPath)}`);
      const data = await resp.json();
      currentPath = data.current;
      pathEl.textContent = currentPath;

      listEl.innerHTML = data.items.map(item => `
        <div class="explorer-item ${item.isDir ? 'is-dir' : ''}" 
             onclick="${item.isDir ? `CodexExplorer.browse('${item.path.replace(/\\/g, '/')}')` : ''}">
          ${item.isDir ? '📁' : '📄'} ${item.name}
        </div>
      `).join('');
    } catch(e) {
      listEl.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
    }
  }

  function goUp() {
    const parts = currentPath.split(/[\\\/]/);
    parts.pop();
    browse(parts.join('/') || '/');
  }

  async function selectCurrent() {
    try {
      const resp = await fetch('/set-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath })
      });
      if (resp.ok) {
        hide();
        // Signal refresh
        location.reload();
      }
    } catch(e) { alert('Failed to set path'); }
  }

  return { init, show, hide, browse, goUp, selectCurrent };
})();
