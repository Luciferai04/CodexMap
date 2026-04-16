/**
 * ui/graph.js — Cytoscape.js renderer (Coinbase Theme)
 */
const CodexGraph = (() => {
  let cy = null;
  let currentState = { nodes: [], edges: [] };

  function init() {
    cy = cytoscape({
      container: document.getElementById('cy'),
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'background-color': '#5b616e',
            'color': '#ffffff',
            'font-size': '11px',
            'font-family': '-apple-system, sans-serif',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            'width': 36,
            'height': 36,
            'border-width': 2,
            'border-color': 'rgba(255,255,255,0.15)',
            'text-outline-width': 2,
            'text-outline-color': '#0a0b0d',
            'transition-property': 'background-color, border-color',
            'transition-duration': '0.3s',
          },
        },
        {
          selector: 'node[type="file"]',
          style: { 'shape': 'ellipse', 'width': 44, 'height': 44 }
        },
        {
          selector: 'node[type="function"]',
          style: { 'shape': 'diamond', 'width': 28, 'height': 28, 'font-size': '9px' }
        },
        {
          selector: 'node[type="directory"]',
          style: {
            'shape': 'round-rectangle',
            'background-color': 'rgba(255,255,255,0.03)',
            'border-color': 'rgba(255,255,255,0.1)',
            'border-style': 'dashed',
            'border-width': 1,
            'padding': 40,
            'z-index': -1,
            'color': 'rgba(255,255,255,0.4)',
            'font-size': '12px',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -10,
          },
        },
        { selector: 'node[grade="green"]',   style: { 'background-color': '#098551', 'border-color': '#0bb06e' } },
        { selector: 'node[grade="yellow"]',  style: { 'background-color': '#f5b000', 'border-color': '#ffd54f' } },
        { selector: 'node[grade="red"]',     style: { 'background-color': '#cf2a2a', 'border-color': '#ff5252' } },
        {
          selector: 'node[risk_flags]',
          style: {
            'border-width': 4,
            'border-color': '#ff4d4d',
            'border-style': 'double'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': 'rgba(255,255,255,0.12)',
            'target-arrow-color': 'rgba(255,255,255,0.12)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#0052ff' },
        },
      ],
      layout: { name: 'preset' },
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 5,
    });

    // Click handler
    cy.on('tap', 'node', function(evt) {
      const node = evt.target;
      CodexPanel.showNode(node.data());
      cy.elements().removeClass('selected');
      node.addClass('selected');
      
      // Premium Polish: Smooth Zoom to Node
      cy.animate({
        center: { ele: node },
        zoom: 1.2,
        duration: 400,
        easing: 'ease-in-out-cubic'
      });
    });
    cy.on('tap', function(evt) {
      if (evt.target === cy) {
        CodexPanel.hide();
        cy.elements().removeClass('selected');
      }
    });

    // Tooltip
    const tooltip = document.getElementById('tooltip');
    cy.on('mouseover', 'node', function(evt) {
      const d = evt.target.data();
      const pos = evt.renderedPosition || { x: 0, y: 0 };
      document.getElementById('tt-id').textContent = d.id || '';
      document.getElementById('tt-grade').textContent = (d.grade || 'pending').toUpperCase();
      document.getElementById('tt-grade').style.color =
        d.grade === 'green' ? '#098551' : d.grade === 'yellow' ? '#f5b000' : d.grade === 'red' ? '#cf2a2a' : '#5b616e';
      
      const riskText = (d.risk_flags && d.risk_flags.length > 0) ? ' | Risk: ' + d.risk_flags.join(', ') : '';
      document.getElementById('tt-score').textContent = (d.score != null ? 'Score: ' + Number(d.score).toFixed(2) : '') + riskText;
      
      tooltip.style.left = (pos.x + 15) + 'px';
      tooltip.style.top = (pos.y + 15) + 'px';
      tooltip.classList.add('visible');
    });
    cy.on('mouseout', 'node', () => tooltip.classList.remove('visible'));

    console.log('[CodexGraph] Initialized');
  }

  function fullReset(state) {
    console.log('[CodexGraph] fullReset:', state.nodes?.length, 'nodes');
    currentState = state;
    cy.elements().remove();

    if (!state.nodes || state.nodes.length === 0) {
      console.log('[CodexGraph] No nodes to render');
      return;
    }

    // Add nodes with PARENT support for compound layout
    const nodeDefs = [];
    for (const node of state.nodes) {
      nodeDefs.push({
        group: 'nodes',
        data: {
          id: node.id,
          parent: node.parent, // ENABLED
          label: node.label || node.id,
          type: node.type || 'file',
          path: node.path,
          language: node.language,
          summary: node.summary,
          code: node.code,
          score: node.score,
          grade: node.grade || 'pending',
          contentHash: node.contentHash,
          cyclomaticComplexity: node.cyclomaticComplexity,
          risk_flags: node.risk_flags, // PASS RISK FLAGS
        }
      });
    }

    console.log('[CodexGraph] Adding', nodeDefs.length, 'nodes');
    cy.add(nodeDefs);

    // Add edges
    const edgeDefs = [];
    for (const edge of (state.edges || [])) {
      if (cy.getElementById(edge.source).length > 0 && cy.getElementById(edge.target).length > 0) {
        edgeDefs.push({
          group: 'edges',
          data: {
            id: 'e-' + edge.source + '->' + edge.target,
            source: edge.source,
            target: edge.target,
          }
        });
      }
    }
    console.log('[CodexGraph] Adding', edgeDefs.length, 'edges');
    cy.add(edgeDefs);

    runLayout();
  }

  function applyDiff(payload) {
    // Update existing nodes
    for (const node of (payload.nodes || [])) {
      const el = cy.getElementById(node.id);
      if (el.length > 0) {
        el.data({
          label: node.label || node.id,
          grade: node.grade || 'pending',
          score: node.score,
          code: node.code,
          summary: node.summary,
          risk_flags: node.risk_flags, // SYNC
          scoring_breakdown: node.scoring_breakdown, // SYNC
        });
      } else {
        // New node
        cy.add({
          group: 'nodes',
          data: {
            id: node.id,
            parent: node.parent, // SYNC
            label: node.label || node.id,
            type: node.type || 'file',
            path: node.path,
            language: node.language,
            summary: node.summary,
            code: node.code,
            score: node.score,
            grade: node.grade || 'pending',
            risk_flags: node.risk_flags, // SYNC
            scoring_breakdown: node.scoring_breakdown, // SYNC
          }
        });
      }
    }

    // Add new edges
    for (const edge of (payload.edges || [])) {
      const eid = 'e-' + edge.source + '->' + edge.target;
      if (cy.getElementById(eid).length === 0 &&
          cy.getElementById(edge.source).length > 0 &&
          cy.getElementById(edge.target).length > 0) {
        cy.add({
          group: 'edges',
          data: { id: eid, source: edge.source, target: edge.target }
        });
      }
    }

    runLayout();
  }

  function updateGrade(payload) {
    const el = cy.getElementById(payload.id);
    if (el.length > 0) {
      el.data('grade', payload.grade);
      el.data('score', payload.score);
    }
  }

  function runLayout() {
    if (cy.nodes().length === 0) return;
    console.log('[CodexGraph] Running layout on', cy.nodes().length, 'nodes');
    cy.layout({
      name: 'cose',
      animate: true,
      animationDuration: 400,
      nodeRepulsion: function() { return 8000; },
      idealEdgeLength: function() { return 80; },
      padding: 50,
      fit: true,
    }).run();
  }

  return { init, fullReset, applyDiff, updateGrade };
})();
