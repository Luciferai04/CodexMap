---
name: CodexMap
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
  h1:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.1em
  h2:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: normal
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: -0.02em
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.15em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  node-gap: 12px
---

## Brand & Style

This design system establishes a high-stakes, "Mission Control" aesthetic tailored for deep-system monitoring and rapid developer response. The brand personality is clinical, urgent, and hyper-technical, blending the utilitarian density of a NASA flight terminal with the sleek, high-contrast futurism of a cyberpunk HUD.

The visual style utilizes **Glassmorphism** as its structural foundation, employing deep backdrop blurs and micro-borders to maintain clarity amidst dense data. The interface must evoke a sense of "constant state awareness," where every pixel serves a functional purpose and information hierarchy is enforced through luminosity and color-coded urgency.

## Colors

The palette is strictly dark-mode, rooted in a deep "Void Black" (#080C14) to maximize the contrast of luminous accents. 

- **Primary (Cyan):** Used for interactive elements, focus states, and primary data streams. It represents the "active" state of the system.
- **Secondary (Green):** Indicates nominal operations, successful builds, and healthy nodes.
- **Tertiary (Yellow):** Reserved for warnings, throttled processes, and non-critical latency.
- **Error (Red):** Used for critical failures and system alerts. This color is often paired with a pulsing animation to demand immediate attention.

Surface colors are semi-transparent to allow for the dot-grid background to remain subtly visible, creating a sense of depth and layering.

## Typography

The typographic system relies on a dual-pathway approach: **Space Grotesk** for structural UI and headers to provide a sharp, geometric technicality, and **Inter** for sustained reading in logs or documentation. 

For all telemetry, code snippets, and coordinate data, **JetBrains Mono** is utilized to ensure character distinction (e.g., 0 vs O). Headers must always be uppercase with increased tracking to mimic aerospace instrumentation. Small labels should use a heavy weight and wide tracking to remain legible at minute scales.

## Layout & Spacing

This design system employs a **Fluid Grid** model built on a 4px baseline. The layout is designed to be "Information Dense," minimizing whitespace in favor of logical grouping and data proximity.

- **Main Container:** 24px margins on all sides.
- **Modules:** 12-column grid system with 16px gutters.
- **Dot Grid:** A persistent 24px background dot grid serves as the alignment guide for all floating nodes and panels.
- **Density:** Elements are packed tightly; use borders and background blurs rather than large margins to define separation.

## Elevation & Depth

Depth is achieved through **Glassmorphism** and luminosity rather than traditional drop shadows. 

1.  **Base Layer:** The #080C14 background with a subtle SVG dot pattern (#ffffff at 0.05 opacity).
2.  **Mantle Layer:** Standard panels with a 40px backdrop blur and a 1px semi-transparent border.
3.  **Core Layer:** Active nodes or "High-Stakes" modules featuring a 2px outer glow (0 0 12px) using the primary cyan or error red colors.
4.  **Overlay Layer:** Modals and dropdowns use a higher opacity background and a thicker 2px border to visually "lift" off the grid.

## Shapes

The shape language is "Soft-Industrial." Components use a consistent **4px (0.25rem) corner radius** to maintain a precision-engineered look while avoiding the harshness of perfect 90-degree angles. Larger containers or "Nodes" may use an 8px radius to differentiate them from smaller inputs or buttons. Interactive elements should feel like physical terminal keys—contained, structured, and deliberate.

## Components

- **Buttons:** Rectangular with a 1px border. "Primary" buttons feature a subtle inner glow. "Ghost" variants use only the border and text, filling with color on hover.
- **Nodes/Cards:** These are the primary data containers. They feature a title bar with a monospaced ID (e.g., [NODE-04]), a glass background, and a "glowing" status border that pulses if the node requires attention.
- **Inputs:** Darker than the surface background, using JetBrains Mono for text entry. The focus state triggers a full-border glow in primary cyan.
- **Status Chips:** Small, condensed capsules using uppercase Space Grotesk. The background color of the chip should be a 10% opacity version of the status color, with a 100% opacity text and a 1px leading dot.
- **Pulsing Alerts:** Components in a "Critical" state utilize a CSS keyframe animation on the box-shadow, creating a rhythmic red "breathing" effect that bypasses standard visual hierarchy to grab attention.
- **Telemetry Charts:** Simplified line or bar graphs using 1px stroke widths and no fill, emphasizing raw data points over aesthetic flourishes.