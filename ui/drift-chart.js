/**
 * ui/drift-chart.js — High-performance HTML5 Canvas Sparkline
 */
class DriftChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.history = [];
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.draw();
    }

    update(history) {
        if (!Array.isArray(history)) return;
        this.history = history;
        this.draw();
    }

    draw() {
        if (!this.ctx || this.history.length < 2) return;
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.beginPath();
        this.ctx.strokeStyle = '#4ae176'; // secondary color
        this.ctx.lineWidth = 2;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';

        const step = width / (this.history.length - 1);
        
        this.history.forEach((val, i) => {
            const x = i * step;
            const y = height - (val / 100 * height);
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        });

        this.ctx.stroke();

        // Gradient Fill
        this.ctx.lineTo(width, height);
        this.ctx.lineTo(0, height);
        const grad = this.ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, 'rgba(74, 225, 118, 0.2)');
        grad.addColorStop(1, 'rgba(74, 225, 118, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fill();
    }
}
