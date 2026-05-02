---
name: Mission Control Cyberpunk
colors:
  surface: '#0f1418'
  surface-dim: '#0f1418'
  surface-bright: '#343a3e'
  surface-container-lowest: '#0a0f12'
  surface-container-low: '#171c20'
  surface-container: '#1b2024'
  surface-container-high: '#252b2e'
  surface-container-highest: '#303539'
  on-surface: '#dee3e8'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dee3e8'
  inverse-on-surface: '#2c3135'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#4ae176'
  on-secondary: '#003915'
  secondary-container: '#00b954'
  on-secondary-container: '#004119'
  tertiary: '#fdc425'
  on-tertiary: '#3f2e00'
  tertiary-container: '#dea900'
  on-tertiary-container: '#574000'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#6bff8f'
  secondary-fixed-dim: '#4ae176'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005321'
  tertiary-fixed: '#ffdf9a'
  tertiary-fixed-dim: '#f7be1d'
  on-tertiary-fixed: '#251a00'
  on-tertiary-fixed-variant: '#5a4300'
  background: '#0f1418'
  on-background: '#dee3e8'
  surface-variant: '#303539'
typography:
  display-mono:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.1em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  code-sm:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  density-high: 4px
  density-md: 8px
---

## Brand & Style
The design system is engineered for high-stakes technical environments where precision and rapid data processing are paramount. It evokes the atmosphere of a NASA mission control center blended with the aesthetic of a high-end cyberpunk terminal. The emotional response is one of authority, focus, and "power-user" capability. 

The style utilizes **Glassmorphism** as its primary structural layer, using translucency to suggest depth without losing the sense of a unified, high-density dashboard. Visual interest is driven by technical artifacts: dot grids, dash-bordered containers, and glowing status indicators that simulate hardware LEDs.

## Colors
The palette is rooted in a deep, void-like background (#080C14) to maximize the contrast of functional accents. 
- **Primary (Cyan):** Used for interactive elements, primary data threads, and active states.
- **Success (Green):** Indicates healthy nodes, completed builds, and stable systems.
- **Warning (Yellow):** Reserved for non-critical telemetry alerts and latency warnings.
- **Critical (Red):** Used for failing nodes and system breaches; often accompanied by a subtle glow or pulsing animation.
- **Surface:** Glassmorphic panels use a semi-transparent slate tint with a 12px backdrop blur to maintain legibility over the underlying dot grid.

## Typography
This design system employs a dual-typeface strategy to balance readability with a technical aesthetic. **Space Grotesk** is used for all "machine-readable" content—labels, headers, data points, and code—leveraging its monospaced-adjacent geometric feel. **Inter** handles body text and general UI instructions to ensure long-form legibility. All labels and data headers should be rendered in uppercase with slight letter spacing to mimic instrumentation panels.

## Layout & Spacing
The layout follows a **fluid grid** model designed for ultra-wide monitoring setups. It utilizes a 12-column structure with tight gutters (16px) to maximize screen real estate. The background features a persistent 24px dot grid used as an alignment guide for glass panels. Containers utilize a high-density spacing rhythm (4px increments) to allow for the simultaneous display of multiple data streams without requiring excessive scrolling.

## Elevation & Depth
Depth is achieved through **Glassmorphic layering** rather than traditional shadows.
- **Level 0 (Floor):** The #080C14 background with a subtle `#1E293B` dot grid.
- **Level 1 (Panels):** 60% opacity surfaces with 12px backdrop blur and a 1px border at 10% white opacity.
- **Level 2 (Modals/Popovers):** 80% opacity surfaces with a subtle `#38BDF8` (Cyan) outer glow (0px 0px 15px) to indicate focus.
- **Connectors:** Cytoscape-style node edges sit between Level 0 and Level 1, using thin 1px lines that glow when data packets are "flowing."

## Shapes
The shape language is strictly **Sharp (0px)** or **Hexagonal**. All primary panels and buttons have 90-degree corners to reinforce the precision-tooling aesthetic. The logo and specific "node" elements in the graph view use a hexagonal silhouette. Directory containers and grouping areas are defined by `1px dashed` borders rather than solid fills, mimicking architectural blueprints.

## Components
- **Buttons:** Sharp corners, 1px solid borders. Primary buttons use a "ghost" style that fills with Cyan on hover. Active states feature a subtle flickering scanline effect.
- **High-Density Data Tables:** No horizontal borders; use subtle zebra striping with 5% white opacity. Text is aligned to a strict grid; monospaced numbers for all values.
- **Status Pills:** Small, rectangular indicators. "Live" statuses feature a 4px circular "LED" that pulses.
- **Code Blocks:** Syntax highlighting follows a "Neon-on-Dark" scheme. The container uses a dashed border with a top-right label indicating the file extension.
- **Mini Bar Charts:** Use solid blocks of color (no gradients) to represent data volume.
- **Node Graph:** Cytoscape elements should use hexagonal nodes. Red nodes (critical) must have a CSS animation pulse effect (`box-shadow` expansion) to draw immediate attention.
- **Input Fields:** Bottom-border only (2px solid) until focused, at which point a full 1px Cyan border appears with a faint glow.