/**
 * ui/drift-timeline.js - compact drift sparkline for the intelligence drawer.
 */

const DriftTimeline = (() => {
  let points = [];
  const maxPoints = 72;

  function init() {
    draw();
    loadInitialData();
  }

  async function loadInitialData() {
    try {
      const response = await fetch('/api/drift-log');
      const raw = await response.text();
      const parsed = parseDriftLogText(raw);
      points = parsed
        .map((item) => ({
          score: normalizeScore(item.score),
          timestamp: item.timestamp ? Date.parse(item.timestamp) : Date.now(),
        }))
        .filter((item) => item.score != null)
        .slice(-maxPoints);
      draw();
      if (points.length) window.updateDriftScoreBadge?.(points[points.length - 1].score);
    } catch (error) {
      console.warn('[Timeline] Failed to preload drift history:', error.message);
    }
  }

  function addDataPoint(payloadOrScore, timestamp) {
    const score = typeof payloadOrScore === 'object' && payloadOrScore !== null
      ? normalizeScore(payloadOrScore.score)
      : normalizeScore(payloadOrScore);
    if (score == null) return;

    points.push({
      score,
      timestamp: timestamp ? Date.parse(timestamp) || Date.now() : Date.now(),
    });
    if (points.length > maxPoints) points.shift();
    draw();
    window.updateDriftScoreBadge?.(score);
  }

  function draw() {
    const canvas = document.getElementById('drift-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    drawBackground(ctx, width, height);

    if (!points.length) {
      drawEmpty(ctx, width, height);
      updateInsights(null);
      return;
    }

    const lineColor = colorFor(points[points.length - 1].score);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, hexToRgba(lineColor, 0.22));
    gradient.addColorStop(1, hexToRgba(lineColor, 0.02));

    const coords = points.map((point, index) => ({
      x: points.length === 1 ? width - 24 : 16 + (index / (points.length - 1)) * (width - 32),
      y: height - 16 - (point.score / 100) * (height - 32),
      point,
    }));

    ctx.beginPath();
    coords.forEach((coord, index) => {
      if (index === 0) ctx.moveTo(coord.x, coord.y);
      else ctx.lineTo(coord.x, coord.y);
    });
    ctx.lineTo(coords[coords.length - 1].x, height - 14);
    ctx.lineTo(coords[0].x, height - 14);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    coords.forEach((coord, index) => {
      if (index === 0) ctx.moveTo(coord.x, coord.y);
      else ctx.lineTo(coord.x, coord.y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    findInflections().forEach((index) => {
      const coord = coords[index];
      if (!coord) return;
      ctx.beginPath();
      ctx.arc(coord.x, coord.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    const last = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    updateInsights(points[points.length - 1]);
  }

  function drawBackground(ctx, width, height) {
    const bands = [
      { min: 70, max: 100, color: 'rgba(34,197,94,0.08)' },
      { min: 40, max: 70, color: 'rgba(245,158,11,0.08)' },
      { min: 0, max: 40, color: 'rgba(239,68,68,0.08)' },
    ];
    bands.forEach((band) => {
      const yTop = height - (band.max / 100) * height;
      const yBottom = height - (band.min / 100) * height;
      ctx.fillStyle = band.color;
      ctx.fillRect(0, yTop, width, yBottom - yTop);
    });

    [40, 70].forEach((mark) => {
      const y = height - (mark / 100) * height;
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = 'rgba(102,112,133,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px IBM Plex Mono, monospace';
    ctx.fillText('waiting for drift scores', 18, height / 2);
  }

  function updateInsights(latest) {
    const trend = document.getElementById('drift-trend-label');
    const insights = document.getElementById('drift-insights');
    if (!trend || !insights) return;

    if (!latest) {
      trend.textContent = 'waiting';
      insights.textContent = 'No drift points yet. Scores will appear as Sentinel grades nodes.';
      return;
    }

    const previous = points.length > 1 ? points[points.length - 2] : null;
    const delta = previous ? latest.score - previous.score : 0;
    const inflections = findInflections();

    trend.textContent = Math.abs(delta) < 2 ? 'stable' : delta > 0 ? 'improving' : 'dropping';
    insights.textContent = inflections.length
      ? `${inflections.length} sharp drop${inflections.length === 1 ? '' : 's'} marked where score fell more than 10 points.`
      : `Latest score ${Math.round(latest.score)}. No sharp two-point drop detected.`;
  }

  function findInflections() {
    const indexes = [];
    for (let index = 2; index < points.length; index += 1) {
      const drop = points[index - 2].score - points[index].score;
      if (drop > 10) indexes.push(index);
    }
    return indexes;
  }

  function parseDriftLogText(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return (text.match(/\{[^{}]*\}/g) || [])
        .map((chunk) => {
          try { return JSON.parse(chunk); } catch (_) { return null; }
        })
        .filter(Boolean);
    }
  }

  function normalizeScore(score) {
    if (typeof score !== 'number' || Number.isNaN(score)) return null;
    return score <= 1 ? score * 100 : score;
  }

  function colorFor(score) {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#f59e0b';
    return '#ef4444';
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return {
    init,
    addPoint: addDataPoint,
  };
})();

window.DriftTimeline = DriftTimeline;
window.addEventListener('DOMContentLoaded', () => window.DriftTimeline.init());
