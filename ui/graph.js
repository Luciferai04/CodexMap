/**
 * ui/graph.js — Cytoscape.js implementation for CodexMap
 * Implements Miro design system nodes, edges, and interactions.
 * 
 * FIX #3: Uses cy.ready() + node:childless / node:parent selectors
 *         to ensure compound nodes work correctly with click handlers.
 */

window.CodexGraph = (function() {
  let cy;
  let tooltip;

  const MIRO_STYLE = [
    {
      selector: 'node',
      style: {
        'shape': 'round-rectangle',
        'background-color': '#ffffff',
        'border-color': '#c7cad5',
        'border-width': '1px',
        'color': 'var(--color-near-black)',
        'font-family': 'var(--font-display)',
        'font-size': '14px',
        'text-valign': 'center',
        'text-halign': 'center',
        'padding': '12px',
        'width': 'label',
        'height': 'label',
        'min-width': '100px',
        'min-height': '45px',
        // 4px Left Accent Border via linear-gradient
        'background-image': 'linear-gradient(to right, #a5a8b5 4px, #ffffff 4px)',
        'background-repeat': 'no-repeat',
        'background-size': '100% 100%'
      }
    },
    {
      selector: 'node[grade="green"]',
      style: {
        'background-color': 'var(--color-teal-light)',
        'background-image': 'linear-gradient(to right, var(--color-teal-dark) 4px, var(--color-teal-light) 4px)',
        'border-color': 'var(--color-teal-dark)',
      }
    },
    {
      selector: 'node[grade="yellow"]',
      style: {
        'background-color': 'var(--color-orange-light)',
        'background-image': 'linear-gradient(to right, var(--color-orange-dark) 4px, var(--color-orange-light) 4px)',
        'border-color': 'var(--color-orange-dark)',
      }
    },
    {
      selector: 'node[grade="red"]',
      style: {
        'background-color': 'var(--color-coral-light)',
        'background-image': 'linear-gradient(to right, var(--color-coral-dark) 4px, var(--color-coral-light) 4px)',
        'border-color': 'var(--color-coral-dark)',
      }
    },
    {
      selector: 'node:parent',
      style: {
        'background-color': '#fde0f0',
        'background-opacity': 0.5,
        'border-style': 'dashed',
        'border-color': '#c7cad5',
        'border-width': '1.5px',
        'font-family': 'IBM Plex Mono, monospace',
        'font-size': '10px',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-transform': 'uppercase',
        'color': '#555a6a',
        'padding': '20px',
        'border-radius': '20px',
      }
    },
    {
      selector: 'edge',
      style: {
        'line-color': '#c7cad5',
        'target-arrow-color': '#c7cad5',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'width': 1.5,
        'opacity': 0.6,
        'arrow-scale': 1.2,
      }
    },
    {
      selector: 'edge[danger="true"], edge[targetGrade="red"]',
      style: {
        'line-style': 'dashed',
        'line-color': '#600000',
        'target-arrow-color': '#600000',
        'opacity': 0.7,
        'label': '⚠ drift',
        'font-size': '9px',
        'color': '#600000',
      }
    },
    {
      selector: 'node.selected',
      style: {
        'border-color': '#5b76fe',
        'border-width': '2.5px',
        'overlay-color': '#5b76fe',
        'overlay-opacity': 0.06,
      }
    },
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.2,
        'text-opacity': 0.3
      }
    }
  ];

  function init() {
    const container = document.getElementById('canvas-container');
    showSkeletons();

    cy = cytoscape({
      container: container,
      layout: { name: 'cose-bilkent' },
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      style: MIRO_STYLE,
      // These ensure the canvas bg is transparent:
      styleEnabled: true,
      textureOnViewport: false,
      pixelRatio: 'auto',
    });

    // Cytoscape's own background must be transparent:
    cy.style().selector('core').style({
      'active-bg-color': '#5b76fe',
      'active-bg-opacity': 0.1,
      'outside-texture-bg-color': '#ffffff',
      'outside-texture-bg-opacity': 0,
    }).update();

    // FIX #3: Wait for cy.ready() before registering interactions
    cy.ready(() => {
      console.log('[Graph] Cytoscape ready, registering interactions');
      setupInteractions();
      setupToolbars();
    });
    
    // Create tooltip element
    tooltip = document.createElement('div');
    tooltip.className = 'codex-tooltip';
    document.body.appendChild(tooltip);
  }

  function setupInteractions() {
    // FIX #3: Handle LEAF node click (non-parent / childless nodes)
    cy.on('dblclick', 'node[type="block"]', (evt) => {
      cy.animate({ fit: { eles: evt.target, padding: 50 } }, { duration: 300 });
    });

    cy.on('tap', 'node:childless', (evt) => {
      const node = evt.target;
      console.log('[Graph] leaf node tapped:', node.id());
      
      // Visual feedback
      cy.elements().removeClass('selected');
      node.addClass('selected');
      
      // Ensure panel expansion is triggered
      document.getElementById('workspace').classList.add('panel-open');
      
      window.dispatchEvent(new CustomEvent('node-selected', { detail: node.data() }));
    });

    // FIX #3: Handle COMPOUND (directory) node click — toggle collapse
    cy.on('tap', 'node:parent', (evt) => {
      const node = evt.target;
      console.log('[Graph] parent node tapped:', node.id());
      
      // Also dispatch selection for parent panel
      window.dispatchEvent(new CustomEvent('node-selected', { detail: node.data() }));
    });

    // Hover tooltip — only on leaf nodes
    cy.on('mouseover', 'node:childless', (evt) => {
      showTooltip(evt.target, evt.originalEvent || evt.renderedPosition);
    });
    cy.on('mouseout', 'node', () => hideTooltip());

    // FIX #3: Tap on canvas background closes the panel
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass('selected');
        document.getElementById('workspace').classList.remove('panel-open');
        if (window.closePanel) window.closePanel();
      }
    });

    cy.on('zoom', () => {
      const zoomEl = document.getElementById('zoom-level');
      if (zoomEl) zoomEl.textContent = Math.round(cy.zoom() * 100) + '%';
    });
  }

  function setupToolbars() {
    document.getElementById('btn-fit')?.addEventListener('click', () => cy.fit(undefined, 40));
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      cy.zoom({ level: cy.zoom() * 1.2, position: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      cy.zoom({ level: cy.zoom() * 0.8, position: { x: cy.width() / 2, y: cy.height() / 2 } });
    });
    
    // Node search
    const searchInput = document.getElementById('node-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          cy.elements().removeClass('dimmed');
          return;
        }
        cy.nodes().forEach(n => {
          const label = (n.data('label') || '').toLowerCase();
          const id = (n.data('id') || '').toLowerCase();
          if (label.includes(query) || id.includes(query)) {
            n.removeClass('dimmed');
          } else {
            n.addClass('dimmed');
          }
        });
      });
    }
  }

  function showTooltip(node, eventOrPos) {
    const data = node.data();
    const grade = data.grade || 'pending';
    const score = data.score != null ? Math.round(data.score * 100) : '--';
    
    tooltip.innerHTML = `
      <div class="tooltip-title">${data.label || data.id}</div>
      <div class="tooltip-meta">${data.path || data.id}</div>
      <div class="tooltip-meta">${data.type || 'file'} · ${data.lineCount || 0} lines</div>
      <div class="tooltip-grade">
        <div class="grade-dot" style="background: ${getGradeColor(grade)}"></div>
        ${grade.toUpperCase()} — ${score}%
      </div>
    `;
    
    // Position tooltip
    if (eventOrPos && eventOrPos.clientX != null) {
      tooltip.style.left = eventOrPos.clientX + 15 + 'px';
      tooltip.style.top = eventOrPos.clientY - 40 + 'px';
    } else if (eventOrPos && eventOrPos.x != null) {
      tooltip.style.left = eventOrPos.x + 15 + 'px';
      tooltip.style.top = eventOrPos.y - 40 + 'px';
    }
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  function getGradeColor(grade) {
    if (grade === 'green') return '#00b473';
    if (grade === 'yellow') return '#d4850a';
    if (grade === 'red') return '#600000';
    return '#a5a8b5';
  }

  function pulseRedNode(node) {
    if (node.data('grade') !== 'red') return;
    
    node.animate({
      style: { 'opacity': 0.65 }
    }, {
      duration: 1000,
      complete: () => {
        node.animate({
          style: { 'opacity': 1.0 }
        }, {
          duration: 1000,
          complete: () => {
            // Only continue pulsing if still red
            if (node.data('grade') === 'red') pulseRedNode(node);
          }
        });
      }
    });
  }

  function showSkeletons() {
    const container = document.getElementById('canvas-container');
    const skeleton = document.createElement('div');
    skeleton.id = 'loading-skeletons';
    skeleton.className = 'skeleton-container';
    for (let i = 0; i < 12; i++) {
      const rect = document.createElement('div');
      rect.className = 'skeleton-rect';
      skeleton.appendChild(rect);
    }
    container.appendChild(skeleton);
  }

  function hideSkeletons() {
    document.getElementById('loading-skeletons')?.remove();
  }

  function showEmptyState() {
    hideSkeletons();
    // Don't wipe the canvas container — Cytoscape owns it.
    // Instead, add an overlay.
    let overlay = document.getElementById('empty-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'empty-overlay';
      overlay.className = 'empty-state';
      overlay.innerHTML = `
        <div class="empty-title roobert">No nodes yet</div>
        <div class="empty-desc noto">Run orchestrator.js to begin mapping your codebase.</div>
        <div class="empty-code">node orchestrator.js "your prompt"</div>
      `;
      document.getElementById('canvas-container').appendChild(overlay);
    }
  }

  function hideEmptyState() {
    document.getElementById('empty-overlay')?.remove();
  }

  function update(state) {
    hideSkeletons();
    
    if (!state.nodes || state.nodes.length === 0) {
      showEmptyState();
      return;
    }
    
    hideEmptyState();
    cy.elements().remove();
    
    // Separate directory nodes from leaf nodes
    const parents = state.nodes.filter(n => n.type === 'directory');
    const children = state.nodes.filter(n => n.type !== 'directory');

    // Add parent (directory) nodes first — Cytoscape requires parents before children
    parents.forEach(node => {
      // Skip root if it's the only parent and has no meaningful label
      const parentRef = node.parent || node.parentId;
      cy.add({
        group: 'nodes',
        data: {
          id: node.id,
          parent: (parentRef && parentRef !== 'null') ? parentRef : undefined,
          label: node.label || node.id,
          type: 'directory',
          grade: node.grade || 'pending',
          score: node.score,
          path: node.path || node.id
        }
      });
    });

    // Add child (file/function) nodes
    children.forEach(node => {
      const parentRef = node.parent || node.parentId;
      // Verify parent exists in cy
      const parentExists = parentRef && cy.getElementById(parentRef).length > 0;
      
      cy.add({
        group: 'nodes',
        data: {
          id: node.id,
          parent: parentExists ? parentRef : undefined,
          label: node.label || node.id,
          type: node.type || 'file',
          grade: node.grade || 'pending',
          score: node.score,
          code: node.code,
          summary: node.summary,
          lineCount: node.lineCount || (node.code ? node.code.split('\n').length : 0),
          path: node.path || node.id,
          S1: node.S1 || node.scoring_breakdown?.s1,
          S2: node.S2 || node.scoring_breakdown?.s2,
          A: node.A || node.scoring_breakdown?.a,
          T: node.T || node.scoring_breakdown?.t,
          D: node.D || node.scoring_breakdown?.d
        }
      });
    });

    // Add edges — only if both source and target exist
    (state.edges || []).forEach(edge => {
      const srcNode = cy.getElementById(edge.source);
      const tgtNode = cy.getElementById(edge.target);
      
      if (srcNode.length === 0 || tgtNode.length === 0) return;
      
      const edgeId = `e-${edge.source}-${edge.target}`;
      if (cy.getElementById(edgeId).length > 0) return; // dedupe

      const srcGrade = srcNode.data('grade');
      const tgtGrade = tgtNode.data('grade');
      
      // Contamination warning: Green flows into Red
      const isDanger = srcGrade === 'green' && tgtGrade === 'red';

      cy.add({
        group: 'edges',
        data: {
          id: edgeId,
          source: edge.source,
          target: edge.target,
          danger: isDanger || undefined,
          sourceGrade: srcGrade,
          targetGrade: tgtGrade
        }
      });
    });

    // Run layout
    try {
      if (typeof cytoscape !== 'undefined' && cy.nodes().length > 0) {
        const layoutName = cy.nodes(':parent').length > 0 ? 'cose-bilkent' : 'cose';
        cy.layout({
          name: layoutName,
          animate: false,
          nodeDimensionsIncludeLabels: true,
          idealEdgeLength: 100,
          nodeRepulsion: 8000
        }).run();
      }
    } catch (e) {
      console.warn('[Graph] Layout error, falling back to grid:', e.message);
      cy.layout({ name: 'grid' }).run();
    }
    
    // Pulse red nodes
    cy.nodes('[grade="red"]').forEach(n => pulseRedNode(n));
    
    console.log(`[Graph] Rendered ${cy.nodes().length} nodes, ${cy.edges().length} edges`);
  }

  function updateGrade(nodeId, grade, score, breakdown) {
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (node.length) {
      node.data({ grade, score });
      if (breakdown) {
        node.data({
          S1: breakdown.s1 ?? breakdown.S1,
          S2: breakdown.s2 ?? breakdown.S2,
          A: breakdown.a ?? breakdown.A,
          T: breakdown.t ?? breakdown.T,
          D: breakdown.d ?? breakdown.D
        });
      }
      if (grade === 'red') pulseRedNode(node);
      
      // Update connected edges for contamination warnings
      node.connectedEdges().forEach(edge => {
        const sourceId = edge.data('source');
        const targetId = edge.data('target');
        const srcGrade = cy.getElementById(sourceId).data('grade');
        const tgtGrade = cy.getElementById(targetId).data('grade');
        
        const isDanger = srcGrade === 'green' && tgtGrade === 'red';
        edge.data('danger', isDanger || undefined);
        edge.data('sourceGrade', srcGrade);
        edge.data('targetGrade', tgtGrade);
      });

      // If this node is currently selected, re-dispatch to update panel
      if (node.hasClass('selected')) {
        window.dispatchEvent(new CustomEvent('node-selected', { detail: node.data() }));
      }
    }
  }

  // Expose a test helper for debugging
  window.testPanelOpen = function() {
    const testData = {
      id: 'test-node', label: 'test.js', path: 'src/test.js',
      type: 'file', grade: 'red', score: 0.28,
      code: 'function test() {\n  return 42;\n}',
      summary: 'Test node for debugging panel interactions',
      lineCount: 3,
      S1: 0.45, S2: 0.30, A: 0.20, T: 0.15, D: 0.60
    };
    window.dispatchEvent(new CustomEvent('node-selected', { detail: testData }));
  };

  return {
    init,
    update,
    updateGrade,
    isReady: () => !!cy,
    getCy: () => cy
  };
})();

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  window.CodexGraph.init();
});
