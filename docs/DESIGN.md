---
name: Cyber-Industrial Terminal
colors:
  surface: '#10141a'
  surface-dim: '#10141a'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c22'
  surface-container: '#1c2026'
  surface-container-high: '#262a31'
  surface-container-highest: '#31353c'
  on-surface: '#dfe2eb'
  on-surface-variant: '#bac9cc'
  inverse-surface: '#dfe2eb'
  inverse-on-surface: '#2d3137'
  outline: '#849396'
  outline-variant: '#3b494c'
  surface-tint: '#00daf3'
  primary: '#c3f5ff'
  on-primary: '#00363d'
  primary-container: '#00e5ff'
  on-primary-container: '#00626e'
  inverse-primary: '#006875'
  secondary: '#d7ffc5'
  on-secondary: '#053900'
  secondary-container: '#2ff801'
  on-secondary-container: '#0f6d00'
  tertiary: '#ffe7e2'
  on-tertiary: '#621100'
  tertiary-container: '#ffc2b3'
  on-tertiary-container: '#aa2600'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#9cf0ff'
  primary-fixed-dim: '#00daf3'
  on-primary-fixed: '#001f24'
  on-primary-fixed-variant: '#004f58'
  secondary-fixed: '#79ff5b'
  secondary-fixed-dim: '#2ae500'
  on-secondary-fixed: '#022100'
  on-secondary-fixed-variant: '#095300'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a2'
  on-tertiary-fixed: '#3c0700'
  on-tertiary-fixed-variant: '#8a1d00'
  background: '#10141a'
  on-background: '#dfe2eb'
  surface-variant: '#31353c'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin: 24px
---

## Brand & Style

The design system is engineered for the high-performance developer environment, blending **Cyber-Industrial** aesthetics with the efficiency of a **Modern Terminal**. It prioritizes technical precision, information density, and functional clarity over decorative elements.

The visual language draws inspiration from IDEs and command-line interfaces, utilizing a deep, atmospheric dark mode punctuated by high-luminance functional accents. The brand personality is:

* **Precise:** Every pixel serves a structural or informational purpose.
* **Ephemeral:** Reflects the temporary, runner-based nature of the tool through subtle motion and lightweight containers.
* **Industrial:** Robust, reliable, and slightly raw, using "blueprint" lines and monospaced motifs.

The primary style is a hybrid of **Minimalism** and **Modern Corporate**, utilizing ultra-thin borders and tonal layering to create depth without the weight of traditional drop shadows.

## Colors

This design system uses a strict **Dark Mode** foundation. The palette is designed for high contrast in low-light environments, ensuring code legibility and status visibility.

* **Neutral Palette:** Based on deep charcoals and slates. The background is a "void" black-tinted navy, with incrementally lighter grays used for tiered containers and UI borders.
* **Cyan (Action):** Used for primary interactions, active states, and focus indicators. It represents the "energy" of a running agent.
* **Neon Green (Status):** Reserved exclusively for "Live," "Running," or "Success" states. It should be used sparingly but vibrantly.
* **Red/Orange (Urgency):** Used for destructive actions or runner failures.
* **Diff Colors:** Standardized terminal diff greens and reds for code-change previews, desaturated to prevent eye fatigue while maintaining distinctiveness.

## Typography

The typography system relies on a functional split: **Hanken Grotesk** for the UI shell and narrative elements, and **JetBrains Mono** for all technical, data-driven, and code-related content.

* **UI Hierarchy:** Headlines use Hanken Grotesk with tight tracking to maintain a modern, "tech-brand" feel.
* **Technical Data:** Any string representing a variable, ID, IP address, or status label must use JetBrains Mono.
* **Density:** Line heights are kept tight (approx 1.4x - 1.5x) to support the information-dense requirements of developer dashboards.
* **Caps Labels:** Small uppercase monospaced labels are used for table headers and section categorizers to mimic terminal outputs.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model. The sidebar and utility panels occupy fixed widths, while the primary "Work Area" (code editor or logs) is fluid to maximize technical visibility.

* **Grid:** A 12-column grid is used for dashboard layouts, but table-heavy views use a custom flex-basis model to accommodate varying data densities.
* **Density:** This design system adopts a "Compact" density by default. Gutters are kept at 16px to allow more data on-screen.
* **Breakpoints:**
  * **Desktop (1200px+):** Full sidebar, multi-panel view (File tree + Editor + Terminal).
  * **Tablet (768px - 1199px):** Collapsed sidebar (icons only), stacked panels.
  * **Mobile (<768px):** Single panel focus with a bottom navigation drawer for runners.

## Elevation & Depth

This design system avoids traditional drop shadows to maintain a "flat-industrial" feel. Depth is achieved through **Tonal Layering** and **Low-Contrast Outlines**.

* **Base (Level 0):** Background (#0D1117).
* **Surface (Level 1):** Main content cards and sidebars (#161B22). Defined by a 1px solid border (#30363D).
* **Overlay (Level 2):** Modals, tooltips, and floating menus (#21262D). These use a slightly brighter border and a subtle 10% opacity cyan tint in the background to indicate interactivity.
* **Active State:** Elements currently in focus or "Running" use a 1px border of the Primary or Status color (Cyan/Green) to draw the eye without needing elevation.

## Shapes

The shape language is "Soft-Industrial." Corners are not sharp, but they are not playful.

* **Components:** Buttons, inputs, and cards use a **4px (0.25rem)** corner radius. This provides a modern touch while remaining serious and structural.
* **Status Indicators:** Status pips and small tags use a "Pill" radius to distinguish them from structural containers.
* **Selection:** Hover states and list selections use a 2px radius for a sharper, more precise highlight.

## Components

### Buttons

* **Primary:** Solid Cyan (#00E5FF) with black text. No gradient.
* **Secondary:** Ghost style. 1px border (#30363D) with white text. On hover, the border turns Cyan.
* **Actionable Icons:** Square buttons with no background; icon only. High-contrast white icon, turning Cyan on hover.

### Inputs & Terminal

* **Fields:** Dark background (#0D1117) with a 1px bottom border. On focus, the bottom border expands to 2px and turns Cyan.
* **Monospace Input:** Used for command-line inputs. Prefixed with a non-editable `$` prompt character in a muted gray.

### Cards & Containers

* **Runner Cards:** Displays status, CPU/Mem usage, and uptime. Uses a header with a 1px divider.
* **Diff View:** Uses a split-pane or unified view with background tints for additions (low-opacity green) and deletions (low-opacity red). Line numbers are right-aligned in a dedicated gutter.

### Chips & Badges

* **Status Badge:** High-luminance text (e.g., Neon Green) inside a low-opacity version of the same color background. Use JetBrains Mono for the text.
* **Ephemeral Tag:** Used for temporary runners. Includes a "countdown" timer or a "self-destruct" icon.

### Navigation

* **Sidebar:** Vertical icon-and-label navigation. Active states are marked with a 2px Cyan vertical bar on the extreme left edge.
