import { Router } from 'express';

const controllerPage = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kaseki Task Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap">
    <style>
      /* ====================================================================
         KASEKI TASK CONSOLE — CSS ARCHITECTURE
         ====================================================================
         
         OVERVIEW:
         This stylesheet implements a complete dark-theme design system for the
         Kaseki task console. All styling is done via vanilla CSS with custom
         properties (CSS variables). No preprocessor or framework dependencies.
         
         ORGANIZATION:
         The CSS is organized in the following order:
         1. :root — All design tokens (colors, sizing, typography, effects)
         2. Base styles — Global resets and defaults (* and body)
         3. Header — Main navigation and branding
         4. Status indicators — Running/idle/done/failed states
         5. Main layout — Grid structure and content areas
         6. Typography — Headings, paragraphs, text styling
         7. Panels & cards — Container components
         8. Form fields — Inputs, textareas, selects, buttons
         9. Layout utilities — Grid/flex helper classes
         10. Summary cards — Key metrics display
         11. Run links & actions — Task control buttons
         12. Response panel — Output display area
         13. Tabs — Tab navigation and content switching
         14. Health checks — Health status buttons
         15. Dropdowns — Repo selection and similar
         16. Issues tab — GitHub issues browser
         17. Animations — Keyframe definitions
         18. Responsive — Media query breakpoints (768px desktop, 480px tablet)
         
         KEY DESIGN DECISIONS:
         • No shadows; depth via tonal layering (surface hierarchy)
         • Cyan primary action color for high contrast on dark background
         • 8px spacing base unit for consistent rhythm
         • Material Design focus pattern (underline on inputs)
         • Mobile-first responsive approach
         • All hardcoded values extracted to CSS variables
         
         NAMING CONVENTIONS:
         CSS Variables: --category-subcategory-modifier
           Examples: --color-text, --font-size-md, --space-2
           
         Classes: lowercase-hyphenated (e.g., .response-panel, .health-check-button)
           Modifiers use dot notation (e.g., .button.run, .status-indicator.running)
         
         HOW TO MODIFY:
         1. Change colors: Update --color-* in :root
         2. Adjust spacing: Modify --space-* variables  
         3. Change fonts: Update --font-* variables
         4. Modify components: Find the component section and update its CSS
         5. Never hardcode pixel values; use CSS variables instead
         
         RESPONSIVE STRATEGY:
         • Default (mobile): Single column, compact spacing
         • 480px+ (tablet): Better grids and spacing
         • 768px+ (desktop): 2-column layout with side panel
         • Touch targets: minimum 44px on mobile devices
         
         ==================================================================== */
      :root {
        color-scheme: dark;

        /* ===== DESIGN SYSTEM PHILOSOPHY ===== */
        /* This design system uses CSS custom properties organized by category.
           Naming convention: --category-subcategory-modifier (e.g., --color-text-muted)
           All hardcoded values have been extracted into variables for consistency and
           maintainability. To modify the theme, adjust variables below instead of
           specific CSS rules. */

        /* ===== COLOR SYSTEM ===== */
        /* The color system uses tonal layering (background → surface-low → surface →
           surface-high → surface-highest) creating visual depth without shadows.
           Primary action uses cyan (#00daf3) for high contrast on dark backgrounds.
           Status colors (ok=green, bad=red) are reserved for state indication only. */
        /* Surfaces — tonal layering */
        --color-bg:              #10141a;
        --color-surface-low:     #181c22;
        --color-surface:         #1c2026;
        --color-surface-high:    #262a31;
        --color-surface-highest: #31353c;

        /* Text hierarchy */
        --color-text:            #dfe2eb;
        --color-text-muted:      #bac9cc;

        /* Borders & lines */
        --color-border:        #3b494c;
        --color-border-strong: #849396;

        /* Primary action — Cyan */
        --color-focus:        #00daf3;
        --color-focus-bright: #00e5ff;
        --color-focus-text:   #c3f5ff;

        /* Status — Success */
        --color-ok:      #2ff801;
        --color-ok-text: #d7ffc5;
        --color-success: #2ff801;
        --color-success-bg: color-mix(in srgb, var(--color-ok) 15%, transparent);

        /* Status — Error / Alert */
        --color-bad:    #ffb4ab;
        --color-bad-bg: #93000a;
        --color-alert:    #ffb4ab;
        --color-alert-bg: #93000a;

        /* Color alpha variants for overlays */
        --color-focus-overlay-15: color-mix(in srgb, var(--color-focus) 15%, transparent);
        --color-focus-overlay-20: color-mix(in srgb, var(--color-focus) 20%, transparent);
        --color-ok-overlay-15: color-mix(in srgb, var(--color-ok) 15%, transparent);
        --color-bad-overlay-15: color-mix(in srgb, var(--color-bad) 15%, transparent);
        --color-bad-overlay-20: color-mix(in srgb, var(--color-bad) 20%, transparent);
        --color-text-muted-overlay-15: color-mix(in srgb, var(--color-text-muted) 15%, transparent);

        /* ===== TYPOGRAPHY ===== */
        /* Font families */
        --font-ui:   'Hanken Grotesk', system-ui, sans-serif;
        --font-mono: 'JetBrains Mono', 'Courier New', monospace;

        /* Font sizes — responsive scale */
        --font-size-xs:    11px;
        --font-size-sm:    12px;
        --font-size-base:  13px;
        --font-size-md:    14px;
        --font-size-lg:    16px;
        --font-size-xl:    17px;
        --font-size-2xl:   20px;
        --font-size-3xl:   24px;

        /* Font weights */
        --font-weight-normal:  400;
        --font-weight-medium:  500;
        --font-weight-semibold: 600;
        --font-weight-bold:    700;

        /* Line heights */
        --line-height-tight:  1.3;
        --line-height-snug:   1.35;
        --line-height-normal: 1.4;
        --line-height-relaxed: 1.5;
        --line-height-loose:  1.6;

        /* Letter spacing */
        --letter-spacing-tight: -0.02em;
        --letter-spacing-normal: 0;
        --letter-spacing-wide: 0.05em;

        /* ===== SPACING ===== */
        /* Spacing scale: 8px base unit (--space-1) incremented by 4px each level.
           Used consistently for padding, margins, and gaps throughout the interface. */
        --space-1: 8px;
        --space-2: 12px;
        --space-3: 16px;
        --space-4: 24px;

        /* Component spacing */
        --control-gap: var(--space-2);
        --control-pad: var(--space-2) var(--space-3);
        --control-pad-compact: var(--space-1) var(--space-2);

        /* ===== SIZING ===== */
        /* Control heights: 42px is standard for buttons/inputs; 44px is mobile touch target minimum. */
        --control-min-height: 42px;
        --control-min-height-compact: 24px;
        --icon-size: 20px;
        --icon-size-sm: 6px;
        --touch-target-min: 44px;

        /* ===== EFFECTS ===== */
        /* Border radius */
        --radius-sm: 4px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --radius-full: 9999px;

        /* Shadows */
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
        --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
        --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.3);

        /* Transitions & animations */
        /* Animation strategy: fast transitions (0.15s) for hover/focus states,
           slightly slower (0.2s) for content changes. Easing keeps interactions
           responsive without feeling sluggish. */
        --transition-fast: 0.15s;
        --transition-base: 0.2s;
        --transition-easing: ease;
        --transition-fast-easing: ease;

        --animation-duration-spin: 1s;
        --animation-duration-pulse: 1s;
        --animation-duration-pulse-slow: 1.5s;
        --animation-easing-spin: linear;
        --animation-easing-pulse: ease-in-out;
        --animation-easing-pulse-slow: infinite;

        /* Opacity values */
        --opacity-disabled: 0.5;
        --opacity-pulse-min: 0.4;

        /* ===== LAYOUT ===== */
        /* Responsive strategy: mobile-first (single column), medium screens (768px+) get
           two-column layout with side panel. Desktop (1024px+) preserves 2-column layout
           with adjusted spacing. */
        --max-content-width: 1260px;
        --content-pad-mobile: var(--space-3);
        --content-pad-desktop: clamp(var(--space-3), 4vw, 48px);
        --header-pad-desktop: clamp(var(--space-3), 2vw, 24px);

        /* Dropdowns & modals */
        --dropdown-max-height: 250px;
        --panel-max-height: 500px;
        --mobile-viewport-height: 40vh;

        /* Z-index scale */
        --z-dropdown: 100;
        --z-modal: 200;
        --z-tooltip: 300;

        /* Min/max widths for inputs and containers */
        --input-min-width: 200px;
        --input-max-width: 300px;
        --card-min-width: 140px;

        /* ===== COMPONENT SIZING ===== */
        /* Standard component heights for consistent visual hierarchy */
        --card-min-height: 76px;
        --panel-min-height: 300px;
        --health-check-height: 80px;
        --textarea-min-height: 140px;
        --state-indicator-height: 22px;

        /* Input padding (consistent across text inputs, textareas, buttons) */
        --input-padding: 10px 11px;
      }
      /* ===== BASE STYLES ===== */
      /* Reset and normalize. All elements use border-box sizing for predictable layouts.
         Body inherits typography from font-ui via CSS custom properties. */
      * { box-sizing: border-box; letter-spacing: var(--letter-spacing-normal); }
      body {
        margin: 0;
        background: var(--color-bg);
        color: var(--color-text);
        font: var(--font-size-lg)/var(--line-height-relaxed) var(--font-ui);
      }
      /* ===== HEADER ===== */
      /* Main application header with branding and API token input.
         Uses flexbox for horizontal layout; status indicator positioned on right. */
      .header-bar {
        background: var(--color-surface-low);
        border-bottom: 1px solid var(--color-border);
        padding: var(--space-3) var(--space-3);
        display: flex;
        align-items: center;
        gap: var(--space-3);
        justify-content: space-between;
      }
      .header-bar h1 {
        margin: 0;
        font-size: clamp(18px, 3vw, 24px);
        font-family: var(--font-ui);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-tight);
        line-height: var(--line-height-tight);
        color: var(--color-focus-text);
      }
      .header-bar-title {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .header-token-input {
        min-width: var(--input-min-width);
        max-width: var(--input-max-width);
        width: auto;
        background: var(--color-surface-highest);
        border: none;
        border-bottom: 1px solid var(--color-border-strong);
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        color: var(--color-text);
        font-family: var(--font-ui);
        font-size: var(--font-size-md);
        padding: var(--input-padding);
        min-height: var(--control-min-height);
        transition: border-color var(--transition-fast) var(--transition-easing);
      }
      .header-token-input:focus {
        outline: none;
        border-bottom: 2px solid var(--color-focus);
      }
      .header-token-input::placeholder { color: var(--color-text-muted); }
      @media (max-width: 767px) {
        .header-token-input {
          min-width: 160px;
          max-width: 100%;
        }
      }
      /* ===== STATUS INDICATOR ===== */
      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--control-pad-compact);
        border-radius: var(--radius-full);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        background: var(--color-text-muted-overlay-15);
        color: var(--color-text-muted);
        flex-shrink: 0;
      }
      .status-indicator::before {
        content: '';
        display: inline-block;
        width: var(--icon-size-sm);
        height: var(--icon-size-sm);
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
      }
      .status-indicator::after { content: 'Idle'; }
      .status-indicator.running {
        background: var(--color-focus-overlay-15);
        color: var(--color-focus-bright);
      }
      .status-indicator.running::after { content: 'Running'; }
      .status-indicator.running::before { animation: pulse-indicator var(--animation-duration-pulse) var(--animation-easing-pulse) infinite; }
      .status-indicator.completed {
        background: var(--color-ok-overlay-15);
        color: var(--color-ok);
      }
      .status-indicator.completed::after { content: 'Done'; }
      .status-indicator.failed {
        background: var(--color-bad-overlay-20);
        color: var(--color-bad);
      }
      .status-indicator.failed::after { content: 'Failed'; }
      @keyframes pulse-indicator {
        0%, 100% { opacity: 1; }
        50% { opacity: var(--opacity-pulse-min); }
      }
      /* ===== MAIN LAYOUT ===== */
      main {
        display: grid;
        gap: var(--space-4);
        grid-template-columns: minmax(0, 1fr);
        margin: 0 auto;
        max-width: var(--max-content-width);
        padding: var(--content-pad-mobile);
      }
      h1, h2 { margin: 0; }
      h2 {
        font-family: var(--font-ui);
        font-size: clamp(17px, 2.2vw, 20px);
        font-weight: var(--font-weight-semibold);
        line-height: var(--line-height-normal);
        color: var(--color-text);
      }
      p { 
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-relaxed);
        margin: var(--space-1) 0 0;
      }
      /* ===== PANELS & CARDS ===== */
      .panel {
        background: var(--color-surface-low);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-4);
      }
      header, form, .stack, fieldset { display: grid; gap: var(--space-3); }
      .stack { gap: var(--space-4); }
      section.panel { display: grid; gap: var(--space-3); align-content: start; }
      fieldset {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        margin: 0;
        padding: var(--space-3);
      }
      legend {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        color: var(--color-text-muted);
        padding: 0 var(--space-1);
      }
      /* ===== FORM FIELDS ===== */
      /* Input, textarea, select styling uses Material Design focus pattern:
         - Underline border on default state (--color-border-strong)
         - Focus increases border-bottom to 2px (--color-focus)
         - Padding is consistent (--input-padding) across all input types
         - Placeholder text uses muted color for contrast
         - Textarea has fixed min-height; resize: vertical allows user adjustment */
      .form-fields { display: grid; gap: var(--space-3); }
      .form-field { display: grid; gap: var(--space-1); }
      .form-field > label {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        color: var(--color-text-muted);
        line-height: var(--line-height-snug);
      }
      .field-helper { 
        color: var(--color-text-muted);
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: var(--line-height-relaxed);
      }
      .field-error {
        color: var(--color-bad);
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: var(--line-height-normal);
        min-height: 1em;
      }
      .field-error[hidden] { display: none; }
      input, textarea, select, button {
        box-sizing: border-box;
        color: inherit;
        font: inherit;
      }
      input, textarea, select {
        background: var(--color-surface-highest);
        border: none;
        border-bottom: 1px solid var(--color-border-strong);
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        color: var(--color-text);
        font-family: var(--font-ui);
        font-size: var(--font-size-md);
        min-height: var(--control-min-height);
        padding: var(--input-padding);
        width: 100%;
        transition: border-color var(--transition-fast) var(--transition-easing);
      }
      input::placeholder, textarea::placeholder { color: var(--color-text-muted); }
      textarea { min-height: var(--textarea-min-height); resize: vertical; }
      input:focus, textarea:focus, select:focus {
        outline: none;
        border-bottom: 2px solid var(--color-focus);
      }
      button:focus {
        outline: 2px solid var(--color-focus);
        outline-offset: 2px;
      }
      /* ===== LAYOUT UTILITIES ===== */
      /* Grid utility classes for flexible layouts. Most use CSS Grid with
         auto-fit columns that collapse on mobile. Gap is consistent (--control-gap).
         Check class combines flex + grid for checkbox/label pairs. */
      .grid, .checks, .action-row, .run-status, .summary-grid, .link-grid { display: grid; gap: var(--control-gap); }
      .grid, .checks, .action-row, .run-status, .summary-grid, .link-grid { grid-template-columns: minmax(0, 1fr); }
      .action-row.run-actions { display: flex; gap: var(--control-gap); flex-wrap: wrap; }
      .check {
        align-items: center;
        display: flex;
        gap: var(--space-1);
        font-weight: var(--font-weight-medium);
        min-height: var(--control-min-height);
      }
      .check input { flex: 0 0 var(--icon-size); height: var(--icon-size); margin: 0; width: var(--icon-size); }
      .check-copy { display: grid; gap: var(--space-1); }
      .check-label { color: var(--color-text); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); line-height: var(--line-height-snug); }
      .check-helper { color: var(--color-text-muted); font-size: var(--font-size-md); line-height: var(--line-height-relaxed); }
      .action-row { align-items: end; }
      .action-row:not(.run-actions) > button, .run-status > button { width: 100%; }
      .action-row.run-actions > button { flex: 1; min-width: 120px; }
      .action-row.run-actions #validate { order: 1; }
      .action-row.run-actions #submit { order: 2; }
      .action-row.run-actions #cancel-run { order: 3; }
      .run-status { grid-template-columns: minmax(0, 1fr); }
      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(var(--card-min-width), 1fr));
      }
      .summary-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        display: grid;
        gap: var(--space-1);
        min-height: var(--card-min-height);
        padding: var(--space-2);
      }
      .summary-label {
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
      }
      .summary-value {
        color: var(--color-text);
        font-family: var(--font-mono);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        overflow-wrap: anywhere;
      }
      /* ===== STATE UTILITIES ===== */
      /* Color-coded state classes for status indication:  
         .ok → success (green)
         .bad → failure (red)
         Applied to .summary-value, #state for flexible reuse. */
      .summary-value.ok { color: var(--color-ok); }
      .summary-value.warning { color: var(--color-bad); }
      .summary-value.bad { color: var(--color-bad); }
      .summary-details {
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-normal);
        line-height: var(--line-height-normal);
        margin-top: var(--space-1);
        word-break: break-word;
        overflow-wrap: break-word;
      }
      /* ===== RUN LINKS & CARDS ===== */
      .run-links {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3);
      }
      .run-links[hidden] { display: none; }
      .link-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .link-grid a {
        align-items: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        display: inline-flex;
        font-family: var(--font-ui);
        font-weight: var(--font-weight-semibold);
        justify-content: center;
        min-height: var(--control-min-height);
        padding: var(--control-pad);
        text-decoration: none;
        transition: border-color var(--transition-fast) var(--transition-easing), color var(--transition-fast) var(--transition-easing);
      }
      .link-grid a:hover {
        border-color: var(--color-focus);
        color: var(--color-focus-text);
      }
      .run-button-content {
        display: grid;
        gap: 2px;
        min-width: 0;
        text-align: left;
        width: 100%;
      }
      .run-button-primary,
      .run-button-secondary {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .run-button-secondary {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        line-height: var(--line-height-tight);
      }
      .panel-section-label {
        display: block;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        color: var(--color-text-muted);
      }
      /* ===== BUTTONS ===== */
      /* Button system uses three variants via CSS classes:  
         1. Default (secondary): transparent bg, border-based (uses --color-border)
         2. .secondary: same as default; explicit class for clarity
         3. .run: solid cyan bg for primary actions (submit, execute tasks)
         Hover states maintain affordance; disabled uses opacity. All buttons
         use consistent padding (--control-pad) and min-height. */
      button {
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        min-height: var(--control-min-height);
        padding: var(--control-pad);
        transition: border-color var(--transition-fast) var(--transition-easing), color var(--transition-fast) var(--transition-easing), background var(--transition-fast) var(--transition-easing);
      }
      button:hover:not(:disabled) {
        border-color: var(--color-focus);
        color: var(--color-focus-text);
      }
      button.secondary {
        background: transparent;
        color: var(--color-text);
        border-color: var(--color-border);
      }
      button.secondary:hover:not(:disabled) {
        border-color: var(--color-focus);
        color: var(--color-focus-text);
      }
      button.run {
        background: var(--color-focus-bright);
        border-color: var(--color-focus-bright);
        color: #00363d;
        font-weight: var(--font-weight-bold);
      }
      button.run:hover:not(:disabled) {
        background: var(--color-focus-text);
        border-color: var(--color-focus-text);
        color: #001f24;
      }
      button:disabled { cursor: not-allowed; opacity: var(--opacity-disabled); }
      #submit:disabled { background-color: #666; border-color: #666; color: #aaa; }
      #submit:enabled { cursor: pointer; }
      #cancel-run:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
      #cancel-run:enabled { cursor: pointer; }
      .validation-badge {
        margin-left: 6px;
        color: #00d084;
        font-weight: var(--font-weight-bold);
        font-size: 0.9em;
      }
      .toolbar-button { }
      .toolbar-button-no-wrap { white-space: nowrap; }
      /* ===== RESPONSE PANEL ===== */
      /* Three-tier grid layout for task results:
         1. Meta row: Status label and metadata (auto height)
         2. Summary row: Key metrics in responsive grid (auto height)
         3. Log area: Scrollable monospace output (flexible height)
         Panel uses monospace font for code/structured data. */
      .response-panel {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        min-height: var(--panel-min-height);
        overflow: hidden;
      }
      .response-meta {
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        margin: 0;
        padding: var(--space-2) var(--space-3);
      }
      .response-summary {
        background: var(--color-surface-low);
        border-bottom: 1px solid var(--color-border);
        display: grid;
        gap: var(--space-2);
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        padding: var(--space-2) var(--space-3);
      }
      .response-summary[hidden] { display: none; }
      .response-summary-item {
        display: grid;
        gap: var(--space-1);
        min-width: 0;
      }
      .response-summary-label {
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
      }
      .response-summary-value {
        color: var(--color-text);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-bold);
        overflow-wrap: anywhere;
      }
      .response-summary-item.full-width {
        grid-column: 1 / -1;
      }
      .response-summary-item.warning {
        border: 1px solid var(--color-bad-overlay-20);
        border-radius: var(--radius-sm);
        background: color-mix(in srgb, var(--color-bad) 8%, transparent);
        padding: var(--space-1);
      }
      .response-summary-item.critical {
        border-color: var(--color-bad);
        background: color-mix(in srgb, var(--color-bad) 14%, transparent);
      }
      .response-log {
        align-self: start;
        color: var(--color-text);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
        line-height: var(--line-height-loose);
        margin: 0;
        min-height: 0;
        overflow: auto;
        padding: var(--space-3);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .response-log.empty { color: var(--color-text-muted); }
      #state {
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        min-height: var(--state-indicator-height);
      }
      #state.ok { color: var(--color-ok); }
      #state.bad { color: var(--color-bad); }
      /* ===== RESPONSIVE MEDIA QUERIES ===== */
      @media (min-width: 768px) {
        .header-bar {
          padding: var(--header-pad-desktop) var(--content-pad-desktop);
        }
        main {
          grid-template-columns: minmax(320px, 560px) minmax(320px, 1fr);
          padding: var(--content-pad-desktop);
        }
        .grid, .checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .action-row:not(.run-actions) {
          grid-template-columns: repeat(auto-fit, minmax(160px, max-content));
        }
        .action-row.run-actions { justify-content: flex-start; }
        .run-status { grid-template-columns: minmax(0, 1fr) minmax(160px, max-content); }
      }
      /* ===== TABS ===== */
      /* Tab navigation uses flex layout with bottom-border active indicator.
         Tab content hidden via .hidden class; only active tab displays.
         Buttons in tabs have minimal padding and no min-height (compact style). */
      .tabs-nav {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--color-border);
        margin-bottom: var(--space-3);
      }
      .tabs-nav button {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--color-text-muted);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
        padding: var(--space-2) var(--space-3);
        margin-bottom: -1px;
        min-height: auto;
        transition: color var(--transition-fast) var(--transition-easing), border-color var(--transition-fast) var(--transition-easing);
      }
      .tabs-nav button:hover:not(:disabled) {
        color: var(--color-text);
        border-color: transparent;
      }
      .tabs-nav button.active {
        color: var(--color-focus-text);
        border-bottom-color: var(--color-focus);
      }
      .tabs-nav button:focus {
        outline: 2px solid var(--color-focus);
        outline-offset: 2px;
      }
      .tab-content {
        display: grid;
        gap: var(--space-3);
        height: auto;
      }
      .tab-content.hidden { display: none; }
      /* ===== HEALTH CHECKS ===== */
      /* Health check buttons are larger (--health-check-height) for emphasis.
         Status shown via spinning icon (⟳) for pending, ✓ for ok, ✕ for bad.
         Icons use currentColor to inherit button text color on state change. */
      .health-checks-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(var(--card-min-width), 1fr));
        gap: var(--space-3);
      }
      .health-check-button {
        background: var(--color-surface);
        color: var(--color-text);
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        min-height: var(--health-check-height);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        transition: border-color var(--transition-fast) var(--transition-easing), color var(--transition-fast) var(--transition-easing);
      }
      .health-check-button:hover:not(:disabled) {
        border-color: var(--color-focus);
        color: var(--color-focus-text);
      }
      .health-check-button:disabled { opacity: var(--opacity-disabled); cursor: wait; }
      .health-check-button:focus {
        outline: 2px solid var(--color-focus);
        outline-offset: 1px;
      }
      .hc-label {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        letter-spacing: var(--letter-spacing-wide);
        text-transform: uppercase;
      }
      .health-check-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--icon-size);
        height: var(--icon-size);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
      }
      .health-check-status.spinner::after {
        content: '⟳';
        display: inline-block;
        animation: spin-icon var(--animation-duration-spin) var(--animation-easing-spin) infinite;
        color: var(--color-focus);
      }
      @keyframes spin-icon {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .health-check-status.ok::before { content: '✓'; color: var(--color-ok); }
      .health-check-status.bad::before { content: '✕'; color: var(--color-bad); }
      /* ===== DROPDOWNS ===== */
      /* Recent repos dropdown uses absolute positioning relative to input wrapper.
         Positioned below input (top: 100%), inherits input width.
         Uses box-shadow (--shadow-lg) for elevation. Z-index: 100 ensures
         dropdown appears above page content. Keyboard navigation supported via
         role=option and arrow key handling in JavaScript. */
      .repo-input-wrapper {
        position: relative;
      }
      .recent-repos-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-top: none;
        border-radius: 0 0 var(--radius-sm) var(--radius-sm);
        max-height: var(--dropdown-max-height);
        overflow-y: auto;
        z-index: var(--z-dropdown);
        box-shadow: var(--shadow-lg);
      }
      .recent-repos-dropdown.hidden {
        display: none;
      }
      .recent-repos-dropdown.empty::before {
        content: 'No recent repos';
        display: block;
        padding: var(--space-2) var(--space-3);
        color: var(--color-text-muted);
        font-size: var(--font-size-base);
      }
      .recent-repo-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) var(--space-3);
        border-bottom: 1px solid var(--color-border);
        cursor: pointer;
        transition: background-color var(--transition-fast) var(--transition-easing);
      }
      .recent-repo-item:last-child {
        border-bottom: none;
      }
      .recent-repo-item:hover {
        background-color: var(--color-surface-high);
      }
      .recent-repo-item:focus {
        outline: 2px solid var(--color-focus);
        outline-offset: -2px;
      }
      .recent-repo-item-text {
        flex: 1;
        min-width: 0;
        font-size: var(--font-size-base);
        color: var(--color-text);
        word-break: break-all;
        margin-right: var(--space-2);
      }
      .recent-repo-delete {
        flex: 0 0 auto;
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--transition-fast) var(--transition-easing);
        min-height: auto;
      }
      .recent-repo-delete:hover {
        color: var(--color-bad);
      }
      /* ===== ISSUES TAB ===== */
      /* GitHub issues list uses grid layout for flexible item sizing.
         Items highlight on hover with color shift. Issue number is cyan (--color-focus)
         for visual distinction. Loading state uses pulsing animation (--animation-duration-pulse-slow). */
      .issues-form {
        display: grid;
        gap: var(--space-3);
      }
      .issues-repo-input-wrapper {
        position: relative;
      }
      .issues-input-group {
        display: flex;
        gap: var(--space-2);
      }
      .issues-input-group input {
        flex: 1;
        min-width: 300px;
      }
      .issues-list-container {
        display: grid;
        gap: var(--space-3);
        max-height: var(--panel-max-height);
        overflow-y: auto;
        padding: var(--space-2);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        min-height: 100px;
      }
      .issues-list-empty {
        text-align: center;
        color: var(--color-text-muted);
        padding: var(--space-3);
      }
      .issues-list-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: var(--space-2) var(--space-3);
        background: var(--color-surface-high);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        color: var(--color-text);
        font: inherit;
        transition: all var(--transition-base) var(--transition-easing);
      }
      .issues-list-item:hover {
        background: var(--color-surface-highest);
        border-color: var(--color-focus);
        color: var(--color-focus-text);
      }
      .issues-list-item:focus {
        outline: 2px solid var(--color-focus);
        outline-offset: 1px;
      }
      .issues-list-item-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-focus);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
      }
      .issues-list-item-title {
        margin-top: var(--space-1);
        font-weight: var(--font-weight-medium);
      }
      .issues-list-item-meta {
        margin-top: var(--space-1);
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
      }
      .issues-loading {
        text-align: center;
        color: var(--color-text-muted);
        padding: var(--space-3);
        animation: pulse-loader var(--animation-duration-pulse-slow) var(--animation-easing-pulse-slow);
      }
      @keyframes pulse-loader {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .issues-error {
        color: var(--color-bad);
        background: var(--color-bad-bg);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-bad);
      }
      /* ===== MOBILE RESPONSIVE ===== */
      @media (max-width: 767px) {
        /* Ensure touch targets meet minimum 44px height on mobile */
        button, input, textarea, select { min-height: var(--touch-target-min); }
        .health-check-button { min-height: var(--touch-target-min); }
        
        /* Stack actions vertically on mobile */
        .action-row.run-actions > .run { order: 1; }
        
        /* Responsive panel heights */
        .response-panel { min-height: var(--mobile-viewport-height); }
        
        /* Health checks grid */
        .health-checks-grid { grid-template-columns: repeat(2, 1fr); }
        
        /* Single column main layout */
        main { grid-template-columns: minmax(0, 1fr); }
        
        /* Dropdown viewport constraint */
        .recent-repos-dropdown { max-width: 100vw; }
        
        /* Improve button spacing */
        .action-row { gap: var(--space-2); }
      }
      /* ===== TABLET RESPONSIVE (480px - 767px) ===== */
      @media (min-width: 480px) and (max-width: 767px) {
        /* Optimize spacing for tablet */
        main { padding: var(--space-3); }
        .panel { padding: var(--space-3); }
        
        /* Better grid on tablet */
        .health-checks-grid { grid-template-columns: repeat(3, 1fr); }
        
        /* Tab navigation improvement */
        .tabs-nav button { padding: var(--space-2) var(--space-2); }
      }
      /* ===== ULTRA-MOBILE RESPONSIVE (max 480px) ===== */
      @media (max-width: 480px) {
        /* Compact padding for small screens */
        main { padding: var(--space-2); }
        .panel { padding: var(--space-2); }
        
        /* Single column health checks */
        .health-checks-grid { grid-template-columns: 1fr; }
        
        /* Full width form inputs */
        .issues-input-group input { min-width: auto; }
        
        /* Limit issues list height on mobile */
        .issues-list-container { max-height: var(--panel-max-height); }
        
        /* Stack summary grid */
        .summary-grid { grid-template-columns: 1fr; }
        
        /* Improve button visibility on mobile */
        button { font-size: var(--font-size-md); }
      }
      /* ===== MODAL STYLES ===== */
      .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
        animation: fadeIn var(--transition-fast) var(--transition-easing);
      }
      .modal-backdrop[hidden] { display: none; }
      .modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--color-surface);
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        width: 90vw;
        max-width: 800px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        z-index: 1000;
        animation: slideUp var(--transition-fast) var(--transition-easing);
      }
      .modal[hidden] { display: none; }
      .modal-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-3);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }
      .modal-title {
        margin: 0;
        font-family: var(--font-ui);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-text);
      }
      .modal-close {
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        min-height: auto;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--transition-fast) var(--transition-easing);
      }
      .modal-close:hover {
        color: var(--color-text);
      }
      .modal-body {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        flex: 1;
      }
      .modal-tabs-container {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        flex: 1;
      }
      .modal-tabs-container .tab-content {
        display: none;
        overflow: auto;
        min-height: 0;
      }
      .modal-tabs-container .tab-content.active {
        display: block;
      }
      .modal-output {
        margin: 0;
        padding: var(--space-3);
        color: var(--color-text);
        font-family: var(--font-mono);
        font-size: var(--font-size-base);
        line-height: var(--line-height-loose);
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--color-bg);
        min-height: 200px;
      }
      .artifacts-content {
        padding: var(--space-3);
        background: var(--color-bg);
        min-height: 200px;
        overflow: auto;
      }
      .artifacts-list {
        display: grid;
        gap: var(--space-2);
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      }
      .artifact-item {
        padding: var(--space-2);
        background: var(--color-surface-low);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        text-align: left;
        cursor: pointer;
        transition: all var(--transition-fast) var(--transition-easing);
        display: grid;
        gap: var(--space-1);
      }
      .artifact-item:hover {
        background: var(--color-surface-high);
        border-color: var(--color-border-strong);
      }
      .artifact-item-name {
        color: var(--color-text);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        word-break: break-word;
      }
      .artifact-item-size {
        color: var(--color-text-muted);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
      }
      .artifact-item-description {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        line-height: var(--line-height-normal);
      }
      .artifact-item-badge {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        display: inline-block;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        justify-self: start;
        padding: 1px var(--space-1);
        text-transform: uppercase;
      }
      .artifact-item-badge.recommended {
        border-color: var(--color-accent);
        color: var(--color-accent);
      }
      .artifact-content {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .artifact-content-title {
        font-weight: 600;
        color: var(--color-text);
        font-family: var(--font-mono);
        padding: var(--space-2);
        background: var(--color-surface-low);
        border-radius: var(--radius-sm);
      }
      .artifact-content-pre {
        background: var(--color-surface-low);
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        overflow: auto;
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        white-space: pre-wrap;
        word-wrap: break-word;
        max-height: 600px;
        color: var(--color-text);
      }
      .artifact-content-markdown {
        background: var(--color-surface-low);
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        line-height: 1.6;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .artifact-back-btn {
        align-self: flex-start;
        padding: var(--space-1) var(--space-2);
        background: var(--color-surface-low);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        cursor: pointer;
        font-size: var(--font-size-sm);
        transition: all var(--transition-fast) var(--transition-easing);
      }
      .artifact-back-btn:hover {
        background: var(--color-surface-high);
        border-color: var(--color-border-strong);
      }
      .artifact-loading {
        padding: var(--space-3);
        text-align: center;
        color: var(--color-text-muted);
      }
      .artifact-error {
        padding: var(--space-2);
        background: var(--color-alert-bg);
        border: 1px solid var(--color-alert);
        border-radius: var(--radius-sm);
        color: var(--color-alert);
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .artifact-copy-btn {
        padding: var(--space-1) var(--space-2);
        background: var(--color-surface-low);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        cursor: pointer;
        font-size: var(--font-size-sm);
        transition: all var(--transition-fast) var(--transition-easing);
      }
      .artifact-copy-btn:hover {
        background: var(--color-surface-high);
        border-color: var(--color-border-strong);
      }
      .toast-container {
        position: fixed;
        bottom: var(--space-3);
        right: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        z-index: 10000;
        pointer-events: none;
      }
      .toast {
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-lg);
        font-size: var(--font-size-sm);
        white-space: nowrap;
        animation: fadeInOut 2.6s ease-in-out forwards;
        pointer-events: auto;
      }
      .toast.success {
        background: var(--color-success-bg);
        color: var(--color-success);
        border: 1px solid var(--color-success);
      }
      .toast.error {
        background: var(--color-alert-bg);
        color: var(--color-alert);
        border: 1px solid var(--color-alert);
      }
      .toast.info {
        background: var(--color-surface-low);
        color: var(--color-text);
        border: 1px solid var(--color-border);
      }
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translateY(10px); }
        10% { opacity: 1; transform: translateY(0); }
        90% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(10px); }
      }
      @keyframes slideUp {
        from { transform: translate(-50%, -45%); opacity: 0; }
        to { transform: translate(-50%, -50%); opacity: 1; }
      }
      @media (max-width: 600px) {
        .modal {
          width: 95vw;
          max-height: 90vh;
        }
      }
    </style>
  </head>
  <body>
    <header class="header-bar">
      <div class="header-bar-title">
        <h1>Kaseki Task Console</h1>
        <span class="status-indicator" id="header-status" data-status="idle"></span>
      </div>
      <input id="header-api-token" class="header-token-input" type="password" autocomplete="off" placeholder="API bearer token (required)" aria-label="API bearer token">
    </header>
    <main>
      <section class="panel stack" aria-labelledby="tabs-heading">
        <div class="tabs-nav" role="tablist" aria-label="Console tabs">
          <button class="tab-button active" data-tab="health" role="tab" aria-selected="true" aria-controls="health-tab">Health</button>
          <button class="tab-button" data-tab="issues" role="tab" aria-selected="false" aria-controls="issues-tab">Issues</button>
          <button class="tab-button" data-tab="submit" role="tab" aria-selected="false" aria-controls="submit-tab">Submit Task</button>
        </div>
        <div id="health-tab" class="tab-content" role="tabpanel" aria-labelledby="health-heading">
          <div>
            <h2 id="health-heading">Controller Health Checks</h2>
            <p>Run current diagnostics for the Kaseki API controller. Startup diagnostics shown in preflight responses are cached boot-time history, not live readiness.</p>
          </div>
          <div class="health-checks-grid">
            <button class="health-check-button" data-probe="/health" type="button"><span class="hc-label">Health</span><span class="health-check-status" data-status="health"></span></button>
            <button class="health-check-button" data-probe="/ready" type="button"><span class="hc-label">Readiness</span><span class="health-check-status" data-status="readiness"></span></button>
            <button class="health-check-button" data-probe="/api/gateway-test?stage=1" data-auth="true" type="button" title="Test gateway connectivity. Standard gateways use /models without token consumption; Cloudflare /compat uses a minimal chat-completions probe."><span class="hc-label">Test Gateway</span><span class="health-check-status" data-status="gateway"></span></button>
            <button class="health-check-button" data-probe="/api/gateway-test?stage=2&responseSmoke=true&piProvider=true" data-auth="true" type="button" title="Test authenticated inference through both the gateway protocol and the same Pi provider adapter used by coding runs."><span class="hc-label">Test Inference</span><span class="health-check-status" data-status="llm-test"></span></button>
            <button class="health-check-button" data-probe="/api/preflight" data-auth="true" type="button"><span class="hc-label">Current Preflight</span><span class="health-check-status" data-status="preflight"></span></button>
          </div>
          <div class="summary-grid" id="health-summary" aria-live="polite">
            <div class="summary-card">
              <span class="summary-label">Controller</span>
              <span class="summary-value" data-summary="controller">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Queue</span>
              <span class="summary-value" data-summary="queue">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Preflight</span>
              <span class="summary-value" data-summary="preflight">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Gateway</span>
              <span class="summary-value" data-summary="gateway">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">LLM Test</span>
              <span class="summary-value" data-summary="llm-test">Not checked</span>
            </div>
            <div class="summary-card">
              <span class="summary-label">Run</span>
              <span class="summary-value" data-summary="run">No run selected</span>
              <div class="summary-details" id="run-details"></div>
            </div>
          </div>
          <div class="form-field">
            <label for="run-id">Run ID (for Check Status)</label>
            <input id="run-id" placeholder="Filled after a run is submitted">
          </div>
          <div class="run-links" id="runs-list-panel">
            <strong class="panel-section-label">Recent runs</strong>
            <div class="action-row controller-actions">
              <button class="secondary toolbar-button" id="refresh-runs" type="button">Refresh runs</button>
              <label for="runs-filter">Show</label>
              <select id="runs-filter" aria-label="Filter recent runs">
                <option value="all">All</option>
                <option value="failed">Failed</option>
                <option value="completed">Completed</option>
                <option value="active">Running or queued</option>
              </select>
            </div>
            <div id="runs-summary" aria-live="polite"></div>
            <div class="link-grid" id="runs-list"></div>
          </div>
          <div id="state" role="status" aria-live="polite"></div>
        </div>
        <div id="submit-tab" class="tab-content hidden" role="tabpanel" aria-labelledby="submit-heading" hidden aria-hidden="true">
          <div>
            <h2 id="submit-heading">Submit Repository Task</h2>
            <p>Configure and submit a task for the ephemeral agent to execute.</p>
            <!-- Simplified UI: Git ref, timeout, and publish mode use defaults (main, 3h, auto).
                 For advanced options, use the CLI or API directly with explicit parameters. -->
          </div>
        <form id="run-form">
          <fieldset class="form-fields">
            <legend>Required information</legend>
            <div class="form-field">
              <label for="repo-url">Task repository URL</label>
              <div class="repo-input-wrapper">
                <input id="repo-url" name="repoUrl" type="url" required placeholder="https://github.com/org/repo" data-testid="task-repo-url">
                <div id="recent-repos-dropdown" class="recent-repos-dropdown hidden" role="listbox"></div>
              </div>
              <p class="field-error" data-error-for="repoUrl" aria-live="polite"></p>
            </div>
            <div class="form-field">
              <label for="task-prompt">Task details</label>
              <textarea id="task-prompt" name="taskPrompt" required minlength="10" placeholder="Describe the task for the ephemeral agent."></textarea>
              <p class="field-error" data-error-for="taskPrompt" aria-live="polite"></p>
            </div>
          </fieldset>
          <fieldset>
            <legend>Options</legend>
            <div class="form-field">
              <label for="task-mode">Task mode</label>
              <select id="task-mode" name="taskMode">
                <option value="patch" selected>Patch</option>
                <option value="inspect">Inspect</option>
              </select>
              <p class="field-helper">Patch: require code changes. Inspect: read-only analysis (skips pre-validation for speed).</p>
            </div>
          </fieldset>
          <fieldset>
            <legend>Run actions</legend>
            <div class="action-row run-actions">
            <button class="secondary" id="validate" type="button">Validate task <span id="validation-badge" class="validation-badge" style="display: none;">✓</span></button>
            <button class="run" id="submit" type="submit" disabled title="Please validate task first">Start run</button>
            <button class="secondary" id="cancel-run" type="button">Cancel run</button>
            </div>
          </fieldset>
        </form>
        </div>
        <div id="issues-tab" class="tab-content hidden" role="tabpanel" aria-labelledby="issues-heading" hidden aria-hidden="true">
          <div>
            <h2 id="issues-heading">Load GitHub Issues</h2>
            <p>Fetch recent issues from a GitHub repository and populate the task prompt with an issue's details.</p>
          </div>
          <form class="issues-form" id="issues-form">
            <div class="form-field">
              <label for="issues-repo-url">Issues repository URL</label>
              <div class="issues-repo-input-wrapper">
                <div class="issues-input-group">
                  <input id="issues-repo-url" type="text" placeholder="https://github.com/owner/repo or owner/repo" data-testid="issues-repo-url" />
                  <button class="run" id="load-issues-btn" type="button">Load Issues</button>
                </div>
                <div id="issues-recent-repos-dropdown" class="recent-repos-dropdown hidden" role="listbox"></div>
              </div>
              <p class="field-error" id="issues-error" aria-live="polite" hidden></p>
            </div>
          </form>
          <div id="issues-container">
            <div class="issues-list-container" id="issues-list">
              <div class="issues-list-empty">Enter a repository URL and click "Load Issues" to begin</div>
            </div>
          </div>
        </div>
      </section>
      <section class="panel stack" aria-labelledby="responses-heading">
        <div>
          <h2 id="responses-heading">Responses</h2>
        </div>
        <div class="run-links" id="run-links" hidden>
          <strong class="panel-section-label">Run follow-through</strong>
          <div class="link-grid">
            <button class="secondary toolbar-button-no-wrap" id="full-results-btn" type="button">Full Results</button>
            <button class="secondary toolbar-button-no-wrap" id="copy-diagnostic-bundle-btn" type="button">Copy diagnostic bundle</button>
          </div>
          <div class="recommended-artifacts" id="recommended-artifacts" hidden>
            <span class="summary-label">Recommended artifacts</span>
            <div class="link-grid" id="recommended-artifact-links"></div>
          </div>
        </div>
        <div class="response-panel">
          <p class="response-meta" id="output-meta" aria-live="polite">Status: idle</p>
          <div class="response-summary" id="response-summary" hidden aria-live="polite"></div>
          <pre class="response-log empty" id="output" aria-live="polite">No output yet. Run a health check or submit a task to see responses.</pre>
        </div>
      </section>
    </main>
    <!-- Full Results Modal -->
    <div class="modal-backdrop" id="modal-backdrop" hidden></div>
    <div class="modal" id="full-results-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-heading" hidden>
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-title-heading">Full Results</h3>
          <button class="modal-close" id="modal-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="tabs-nav">
            <button class="tab-btn active" data-tab="status" type="button">Status</button>
            <button class="tab-btn" data-tab="events" type="button">Events</button>
            <button class="tab-btn" data-tab="stdout" type="button">Stdout</button>
            <button class="tab-btn" data-tab="artifacts" type="button">Artifacts</button>
          </div>
          <div class="modal-tabs-container">
            <div class="tab-content active" id="tab-status" data-tab="status">
              <pre class="modal-output" id="status-output"></pre>
            </div>
            <div class="tab-content" id="tab-events" data-tab="events" hidden aria-hidden="true">
              <pre class="modal-output" id="events-output"></pre>
            </div>
            <div class="tab-content" id="tab-stdout" data-tab="stdout" hidden aria-hidden="true">
              <pre class="modal-output" id="stdout-output"></pre>
            </div>
            <div class="tab-content" id="tab-artifacts" data-tab="artifacts" hidden aria-hidden="true">
              <div class="artifacts-content" id="artifacts-output"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const form = document.querySelector('#run-form');
      const output = document.querySelector('#output');
      const outputMeta = document.querySelector('#output-meta');
      const responseSummary = document.querySelector('#response-summary');
      const state = document.querySelector('#state');
      const headerTokenInput = document.querySelector('#header-api-token');
      const runIdInput = document.querySelector('#run-id');
      const runLinks = document.querySelector('#run-links');
      const recommendedArtifacts = document.querySelector('#recommended-artifacts');
      const recommendedArtifactLinks = document.querySelector('#recommended-artifact-links');
      const copyDiagnosticBundleBtn = document.querySelector('#copy-diagnostic-bundle-btn');
      const headerStatus = document.querySelector('#header-status');
      const runsList = document.querySelector('#runs-list');
      
      // Modal elements
      const fullResultsBtn = document.querySelector('#full-results-btn');
      const modalBackdrop = document.querySelector('#modal-backdrop');
      const fullResultsModal = document.querySelector('#full-results-modal');
      const modalCloseBtn = document.querySelector('#modal-close-btn');
      const modalTitleEl = document.querySelector('#modal-title-heading');
      let modalOpener = null;
      const tabButtons = document.querySelectorAll('.tab-btn');
      const modalTabsContainer = document.querySelector('.modal-tabs-container');
      
      // Modal state
      let modalTabCache = {};
      let modalRefreshTimer = null;
      let activeModalTab = 'status';
      
      let pollTimer = null;
      let activeRunView = 'status';
      let runProgressHighWater = {};
      const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
      const LONG_REQUEST_TIMEOUT_MS = 90000;
      const ISSUE_REQUEST_TIMEOUT_MS = 20000;
      
      // Validation state
      let validationState = { isValid: false, lastValidated: null, checks: [] };
      let piAdapterValidationState = 'unknown';
      const validationStateKey = 'kasekiValidationState';

      function getApiToken() {
        return headerTokenInput.value.trim();
      }

      // Restore token from session storage on page load
      headerTokenInput.value = sessionStorage.getItem('kasekiApiToken') || '';

      // Save token to session storage when it changes
      headerTokenInput.addEventListener('change', () => {
        const token = getApiToken();
        if (token) {
          sessionStorage.setItem('kasekiApiToken', token);
        } else {
          sessionStorage.removeItem('kasekiApiToken');
        }
      });

      // Recent repos management
      const recentReposKey = 'kasekiRecentRepos';
      const repoUrlInput = document.querySelector('#repo-url');
      const recentReposDropdown = document.querySelector('#recent-repos-dropdown');
      const issuesRepoUrlInput = document.querySelector('#issues-repo-url');
      const issuesRecentReposDropdown = document.querySelector('#issues-recent-repos-dropdown');

      function loadRecentRepos() {
        try {
          const stored = sessionStorage.getItem(recentReposKey);
          return stored ? JSON.parse(stored) : [];
        } catch {
          return [];
        }
      }

      function saveRecentRepos(repos) {
        sessionStorage.setItem(recentReposKey, JSON.stringify(repos));
      }

      function addRepoToRecent(url) {
        if (!url || typeof url !== 'string') return;
        const trimmed = normalizeRepoUrlForSubmit(url);
        if (!trimmed) return;
        let repos = loadRecentRepos();
        // Remove duplicate if exists
        repos = repos
          .map(normalizeRepoUrlForSubmit)
          .filter(r => r && r !== trimmed);
        // Add to front (most recently used)
        repos.unshift(trimmed);
        // Keep only last 5
        repos = repos.slice(0, 5);
        saveRecentRepos(repos);
        renderRecentReposDropdown();
      }

      function normalizeRepoUrlForSubmit(value) {
        const trimmed = String(value || '').trim();
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
          return 'https://github.com/' + trimmed;
        }
        return trimmed;
      }

      function deleteRepoFromRecent(url) {
        const repos = loadRecentRepos().filter(r => r !== url);
        saveRecentRepos(repos);
        renderRecentReposDropdown();
      }

      function renderDropdownInto(dropdown, targetInput) {
        const repos = loadRecentRepos();
        dropdown.replaceChildren();
        if (repos.length === 0) {
          dropdown.classList.add('empty');
          return;
        }
        dropdown.classList.remove('empty');
        repos.forEach(repo => {
          const item = document.createElement('div');
          item.className = 'recent-repo-item';
          item.role = 'option';

          const textSpan = document.createElement('span');
          textSpan.className = 'recent-repo-item-text';
          textSpan.textContent = repo;
          textSpan.title = repo;

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'recent-repo-delete';
          deleteBtn.type = 'button';
          deleteBtn.innerHTML = '×';
          deleteBtn.title = 'Delete from recent';
          deleteBtn.setAttribute('aria-label', 'Delete ' + repo + ' from recent repos');
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRepoFromRecent(repo);
          });

          item.appendChild(textSpan);
          item.appendChild(deleteBtn);
          item.setAttribute('tabindex', '0');
          item.addEventListener('click', () => {
            targetInput.value = repo;
            hideRecentReposDropdown(dropdown);
            targetInput.focus();
          });
          item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              item.click();
            }
          });

          dropdown.appendChild(item);
        });
      }

      function renderRecentReposDropdown() {
        renderDropdownInto(recentReposDropdown, repoUrlInput);
        renderDropdownInto(issuesRecentReposDropdown, issuesRepoUrlInput);
      }

      function showRecentReposDropdown(dropdown) {
        dropdown.classList.remove('hidden');
      }

      function hideRecentReposDropdown(dropdown) {
        dropdown.classList.add('hidden');
      }

      // Event listeners for Submit Task repo input
      repoUrlInput.addEventListener('focus', () => {
        showRecentReposDropdown(recentReposDropdown);
      });

      repoUrlInput.addEventListener('blur', () => {
        // Delay to allow click on dropdown items
        setTimeout(() => {
          hideRecentReposDropdown(recentReposDropdown);
        }, 150);
      });

      // Event listeners for Issues repo input
      issuesRepoUrlInput.addEventListener('focus', () => {
        showRecentReposDropdown(issuesRecentReposDropdown);
      });

      issuesRepoUrlInput.addEventListener('blur', () => {
        // Delay to allow click on dropdown items
        setTimeout(() => {
          hideRecentReposDropdown(issuesRecentReposDropdown);
        }, 150);
      });

      // Initialize recent repos on page load
      renderRecentReposDropdown();

      function updateHeaderStatus(status) {
        if (!headerStatus) return;
        const statusMap = {
          'idle': 'idle',
          'running': 'running',
          'queued': 'running',
          'completed': 'completed',
          'failed': 'failed',
          'request ok': 'idle',
        };
        const statusClass = statusMap[status] || 'idle';
        headerStatus.className = 'status-indicator ' + statusClass;
        headerStatus.setAttribute('data-status', statusClass);
      }

      function sanitizeOutput(value) {
        if (typeof value === 'string') return stripControlSequences(value);
        try {
          return stripControlSequences(JSON.stringify(value, null, 2));
        } catch {
          return stripControlSequences(String(value));
        }
      }

      function stripControlSequences(value) {
        return String(value || '')
          .replace(/\\u001b\[[0-?]*[ -/]*[@-~]/gi, '')
          .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      }

      function cleanProgressText(value) {
        return stripControlSequences(value)
          .replace(/\s*ℹ?\s*Kaseki startup checks \(mode:[^)]+\)[\s\S]*$/, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function isLikelyBearerToken(token) {
        return /^[A-Za-z0-9._~+\/-]{8,512}$/.test(token);
      }

      function setState(message, kind) {
        state.textContent = message;
        state.className = kind || '';
      }

      function setOutputMetadata(status, runId) {
        outputMeta.textContent = 'Status: ' + status + (runId ? ' | Run ID: ' + runId : '');
        if (runId) {
          headerStatus.textContent = 'Viewing run: ' + status;
          updateHeaderStatus(status);
        } else {
          headerStatus.textContent = 'Controller: ' + status;
          updateHeaderStatus(status);
        }
      }

      function formatElapsedSeconds(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '';
        const seconds = Math.max(0, Math.floor(value));
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return String(remainingSeconds) + 's';
        return String(minutes) + 'm ' + String(remainingSeconds).padStart(2, '0') + 's';
      }

      function compactRunFailure(run) {
        if (!run || typeof run !== 'object') return '';
        if (run.diagnosticSummary && typeof run.diagnosticSummary.primaryReason === 'string') {
          return stripControlSequences(run.diagnosticSummary.primaryReason).slice(0, 180);
        }
        const parts = [
          run.failureClass,
          run.validationFailureReason,
          run.validationAllowlistFailureReason,
          run.qualityFailureReason,
          run.goalCheckFailureReason,
          run.error,
        ].filter((value) => typeof value === 'string' && value.trim());
        return parts.length > 0 ? stripControlSequences(parts[0]).slice(0, 120) : '';
      }

      function preflightStartupSummary(payload) {
        const startup = payload && typeof payload === 'object' ? payload.containerStartup : null;
        if (!startup || typeof startup !== 'object') return '';
        const checks = Array.isArray(startup.checks) ? startup.checks : [];
        const refCheck = checks.find((check) => check && check.name === 'git-freshness' && typeof check.detail === 'string');
        const timestamp = typeof startup.timestamp === 'string' ? startup.timestamp : '';
        return [
          'startup history',
          startup.current === false ? 'not current' : '',
          timestamp ? new Date(timestamp).toLocaleString() : '',
          refCheck ? stripControlSequences(refCheck.detail) : '',
        ].filter(Boolean).join(' | ');
      }

      function appendSummaryItem(label, value, options) {
        if (!responseSummary || !value) return;
        const item = document.createElement('div');
        item.className = 'response-summary-item' + (options && options.warning ? ' warning' : '') + (options && options.critical ? ' critical' : '') + (options && options.fullWidth ? ' full-width' : '');
        const labelEl = document.createElement('span');
        labelEl.className = 'response-summary-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.className = 'response-summary-value';
        valueEl.textContent = value;
        item.append(labelEl, valueEl);
        responseSummary.appendChild(item);
      }

      function setResponseSummary(payload) {
        if (!responseSummary) return;
        responseSummary.replaceChildren();
        if (typeof payload === 'string') {
          responseSummary.hidden = false;
          appendSummaryItem('Gateway test', stripControlSequences(payload), { fullWidth: true });
          return;
        }
        const items = [];
        if (payload && typeof payload === 'object') {
          const providerEmptyTurn = isProviderEmptyAssistantTurn(payload);
          if (providerEmptyTurn) {
            items.push([
              'Provider returned empty coding response',
              'The coding agent produced no assistant text, no tool calls, and no repository diff. Retry the run or switch model/provider before treating this as a task failure.',
              { warning: true, critical: true, fullWidth: true },
            ]);
          }
          if (typeof payload.status === 'string') {
            items.push(['Response status', stripControlSequences(payload.status)]);
          }
          if (typeof payload.lifecyclePhase === 'string') {
            items.push(['Lifecycle', stripControlSequences(payload.lifecyclePhase)]);
          }
          if (payload.attempt && typeof payload.attempt === 'object') {
            const attempt = payload.attempt;
            items.push(['Provider attempt', String(attempt.current || 1) + '/' + String(attempt.maximum || 1) + ' — ' + String(attempt.state || 'running'), { warning: attempt.state === 'retrying' || attempt.state === 'exhausted', fullWidth: true }]);
          }
          if (payload.piProviderSmoke && typeof payload.piProviderSmoke === 'object') {
            const smoke = payload.piProviderSmoke;
            items.push(['Pi adapter', smoke.status === 'ok' ? 'Validated' : 'Failed', { warning: smoke.status !== 'ok', critical: smoke.status === 'error' }]);
            if (typeof smoke.detail === 'string') {
              items.push(['Pi adapter detail', stripControlSequences(smoke.detail).slice(0, 260), { warning: smoke.status !== 'ok', fullWidth: true }]);
            }
            if (typeof smoke.remediation === 'string') {
              items.push(['Pi adapter remediation', stripControlSequences(smoke.remediation).slice(0, 260), { warning: true, fullWidth: true }]);
            }
          }
          if (payload.diagnosis && typeof payload.diagnosis === 'object') {
            const diagnosis = payload.diagnosis;
            if (typeof diagnosis.summary === 'string') {
              items.push(['Diagnosis', stripControlSequences(diagnosis.summary).slice(0, 260), { warning: diagnosis.severity !== 'info', critical: diagnosis.severity === 'error', fullWidth: true }]);
            }
            if (typeof diagnosis.remediation === 'string') {
              items.push(['Recommended action', stripControlSequences(diagnosis.remediation).slice(0, 260), { warning: true, fullWidth: true }]);
            }
          }
          const elapsed = formatElapsedSeconds(payload.elapsedSeconds);
          if (elapsed) {
            items.push(['Response elapsed time', elapsed]);
          }
          if (payload.progress && typeof payload.progress.stage === 'string') {
            const progressStageName = payload.progress.displayName 
              ? cleanProgressText(payload.progress.displayName)
              : cleanProgressText(payload.progress.stage);
            items.push(['Response progress stage', progressStageName]);
          }
          if (typeof payload.taskProgressPercent === 'number') {
            items.push(['Workflow position', payload.taskProgressPercent + '%']);
            if (payload.status === 'failed') {
              items.push(['Progress context', 'The run failed. This percentage only locates the failed phase in the workflow; it is not completion or success.', { warning: true, critical: true, fullWidth: true }]);
            }
          }
          if (typeof payload.timeoutRiskPercent === 'number') {
            items.push(['Timeout risk', payload.timeoutRiskPercent + '%']);
          }
          if (payload.progress && typeof payload.progress.updatedAt === 'string') {
            items.push(['Progress updated', new Date(payload.progress.updatedAt).toLocaleTimeString()]);
            const phaseElapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(payload.progress.updatedAt)) / 1000));
            if (Number.isFinite(phaseElapsedSeconds)) {
              items.push(['Time in current phase', formatElapsedSeconds(phaseElapsedSeconds)]);
            }
          }
          if (payload.failureClass || payload.error) {
            const failure = compactRunFailure(payload);
            if (failure) items.push(['Failure reason', failure, { warning: true, fullWidth: true }]);
          }
          if (payload.diagnosticSummary && typeof payload.diagnosticSummary === 'object') {
            const summary = payload.diagnosticSummary;
            if (typeof summary.primaryReason === 'string' && !payload.failureClass && !payload.error && !providerEmptyTurn) {
              items.push(['Failure reason', stripControlSequences(summary.primaryReason).slice(0, 180), { warning: true, fullWidth: true }]);
            }
            if (typeof summary.recoveryFailure === 'string') {
              items.push(['Recovery failure', stripControlSequences(summary.recoveryFailure).slice(0, 180), { warning: true, fullWidth: true }]);
            }
            if (Array.isArray(summary.phaseDiagnostics) && summary.phaseDiagnostics.length > 0) {
              const phaseText = summary.phaseDiagnostics
                .slice(0, 3)
                .map((item) => [
                  item.phase,
                  item.severity,
                  item.reason,
                  item.field,
                  item.detail,
                ].filter(Boolean).join(': '))
                .filter(Boolean)
                .join(' | ');
              if (phaseText) {
                items.push(['Phase diagnostics', stripControlSequences(phaseText).slice(0, 240), { warning: true, fullWidth: true }]);
              }
            }
            if (summary.dependencyCache && summary.dependencyCache.reinstallTriggered && Array.isArray(summary.dependencyCache.messages)) {
              const cacheText = summary.dependencyCache.messages
                .filter((message) => /failed npm ls validation|cache miss|running install/.test(String(message)))
                .slice(0, 2)
                .join(' | ');
              if (cacheText) {
                items.push(['Dependency cache warning', stripControlSequences(cacheText).slice(0, 220), { warning: true, fullWidth: true }]);
              }
            }
            if (summary.testFailure && typeof summary.testFailure === 'object') {
              const testFailure = summary.testFailure;
              const testParts = [
                testFailure.failedSuite,
                testFailure.failedTest,
                testFailure.assertionSummary,
              ].filter((value) => typeof value === 'string' && value.trim());
              if (testParts.length > 0) {
                items.push(['Failing test', stripControlSequences(testParts.join(' | ')).slice(0, 260), { warning: true, fullWidth: true }]);
              }
              const baseline = testFailure.baselineComparison;
              if (baseline && typeof baseline === 'object') {
                const counts = [
                  typeof baseline.totalNewlyIntroduced === 'number' ? baseline.totalNewlyIntroduced + ' newly introduced' : '',
                  typeof baseline.totalPreExisting === 'number' ? baseline.totalPreExisting + ' pre-existing' : '',
                  typeof baseline.totalFixed === 'number' ? baseline.totalFixed + ' fixed' : '',
                ].filter(Boolean).join(', ');
                if (counts) {
                  items.push(['Baseline comparison', counts, { warning: baseline.baselineComparisonReliable === false, fullWidth: true }]);
                }
                if (typeof baseline.baselineComparisonWarning === 'string') {
                  items.push(['Baseline warning', stripControlSequences(baseline.baselineComparisonWarning).slice(0, 220), { warning: true, fullWidth: true }]);
                }
              }
            }
            if (typeof summary.recommendedEntryPoint === 'string') {
              items.push(['Start debugging with', stripControlSequences(summary.recommendedEntryPoint)]);
            }
          }
          if (payload.containerStartup) {
            const startupSummary = preflightStartupSummary(payload);
            if (startupSummary) items.push(['Startup diagnostics', startupSummary, { warning: true, fullWidth: true }]);
          }
        }
        let progressMessage = null;
        if (payload && typeof payload === 'object' && payload.progress && typeof payload.progress.message === 'string') {
          const msg = cleanProgressText(payload.progress.message);
          if (msg) progressMessage = msg;
        }
        responseSummary.hidden = items.length === 0 && !progressMessage;
        items.forEach(([label, value, options]) => {
          appendSummaryItem(label, value, options);
        });
        if (progressMessage) {
          appendSummaryItem('Progress message', progressMessage, { fullWidth: true });
        }
      }

      function isProviderEmptyAssistantTurn(payload) {
        if (!payload || typeof payload !== 'object') return false;
        const failureJson = payload.failureJsonContent && typeof payload.failureJsonContent === 'object'
          ? payload.failureJsonContent
          : {};
        const fields = [
          payload.goalCheckFailureReason,
          payload.error,
          payload.diagnosticEntryPoint,
          payload.diagnosticSummary && payload.diagnosticSummary.primaryReason,
          failureJson.provider_error_type,
          failureJson.failed_command,
          failureJson.goal_check_failure_reason,
          failureJson.provider_error_message,
        ];
        return fields.some((value) => typeof value === 'string' && value.includes('provider_empty_assistant_turn'));
      }

      function responseStatusLabel(response, payload) {
        if (!response.ok) return 'failed';
        if (payload && typeof payload === 'object' && typeof payload.status === 'string') {
          return payload.status;
        }
        return 'request ok';
      }

      function setOutputBody(text) {
        output.textContent = text;
        output.classList.toggle('empty', !text);
      }

      function requestCompletionMessage(path, method, response, payload) {
        const verb = method || 'GET';
        if (!response.ok) {
          return response.status === 502
            ? 'Request failed at the web gateway. Retry once, then check health/preflight.'
            : verb + ' ' + path + ' failed with HTTP ' + response.status + '.';
        }
        if (path === '/health') return 'Health check completed.';
        if (path === '/ready') return 'Readiness check completed.';
        if (path === '/api/gateway-test') return 'Gateway test completed.';
        if (path === '/api/preflight') return 'Current preflight completed.';
        if (path === '/api/runs') return verb === 'POST' ? 'Run submitted.' : 'Recent runs refreshed.';
        if (path.endsWith('/status')) return 'Run status updated.';
        if (path.endsWith('/cancel')) return 'Cancel request sent.';
        if (path.endsWith('/artifacts')) return 'Artifacts loaded.';
        if (path.startsWith('/api/results/')) return 'Artifact loaded.';
        if (payload && typeof payload === 'object' && typeof payload.id === 'string') return 'Run status updated.';
        return verb + ' ' + path + ' completed.';
      }

      function maybeParseJsonString(value) {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!trimmed || !/^[\\[{]/.test(trimmed)) return value;
        try {
          return JSON.parse(trimmed);
        } catch {
          return value;
        }
      }

      function artifactDisplayText(payload) {
        if (payload && typeof payload === 'object' && payload.response && typeof payload.response === 'object') {
          return artifactDisplayText(payload.response);
        }
        if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'content')) {
          const parsedContent = maybeParseJsonString(payload.content);
          return typeof parsedContent === 'string' ? parsedContent : JSON.stringify(parsedContent, null, 2);
        }
        const parsedPayload = maybeParseJsonString(payload);
        return typeof parsedPayload === 'string' ? parsedPayload : JSON.stringify(parsedPayload, null, 2);
      }

      function summarizedResponseBody(path, method, status, payload) {
        const base = { method, path, status };
        if (status >= 400) {
          return JSON.stringify({
            ...base,
            error: typeof payload === 'string' ? stripControlSequences(payload) : payload,
            guidance: status === 502
              ? 'The web endpoint returned Bad Gateway. The request may have failed before reaching the controller; retry once, then compare against /health and /api/preflight.'
              : 'The request failed. Check the response status, authentication, and controller readiness.',
          }, null, 2);
        }
        if (path === '/api/preflight' && payload && typeof payload === 'object') {
          const checks = Array.isArray(payload.checks) ? payload.checks : [];
          const failed = checks.filter((check) => !check.ok);
          return JSON.stringify({
            ...base,
            response: {
              status: payload.status,
              currentDiagnostics: {
                checkCount: checks.length,
                failedChecks: failed.map((check) => ({
                  name: check.name,
                  detail: check.detail,
                  remediation: check.remediation,
                })),
                templateRef: payload.templateRef,
                imageDigest: payload.imageDigest,
                resultsDir: payload.resultsDir,
              },
              startupDiagnostics: payload.containerStartup ? {
                scope: payload.containerStartup.scope,
                current: payload.containerStartup.current,
                readinessImpact: payload.containerStartup.readinessImpact,
                timestamp: payload.containerStartup.timestamp,
                note: 'Historical startup diagnostics only; use currentDiagnostics/checks for live readiness.',
              } : undefined,
              checkCount: checks.length,
              failedChecks: failed.map((check) => ({
                name: check.name,
                detail: check.detail,
                remediation: check.remediation,
              })),
              image: payload.image,
              imageDigest: payload.imageDigest,
              templateRef: payload.templateRef,
              templateImageDigest: payload.templateImageDigest,
              resultsDir: payload.resultsDir,
              runtime: payload.runtime,
              docker: payload.docker,
              checks: checks.map((check) => ({
                name: check.name,
                ok: check.ok,
                detail: check.detail,
                remediation: check.remediation,
                checkoutRef: check.checkoutRef,
                localRef: check.localRef,
                remoteRef: check.remoteRef,
              })),
            },
            note: 'Current diagnostics and startup diagnostics are separated to avoid treating boot history as live readiness.',
          }, null, 2);
        }
        if (path.startsWith('/api/results/') && payload && typeof payload === 'object') {
          return artifactDisplayText(payload);
        }
        if (path.endsWith('/artifacts') && payload && typeof payload === 'object') {
          const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
          return JSON.stringify({
            ...base,
            response: {
              id: payload.id,
              runStatus: payload.runStatus,
              exitCode: payload.exitCode,
              artifactCount: payload.artifactCount,
              recommended: payload.recommended,
              availableArtifacts: artifacts
                .filter((artifact) => artifact.available)
                .map((artifact) => ({
                  name: artifact.name,
                  size: artifact.size,
                  contentType: artifact.contentType,
                })),
            },
            note: 'Showing a compact summary. Open Full Results for artifact links.',
          }, null, 2);
        }
        if (path.endsWith('/status') && payload && typeof payload === 'object') {
          return JSON.stringify({
            ...base,
            response: {
              id: payload.id,
              status: payload.status,
              lifecyclePhase: payload.lifecyclePhase,
              elapsedSeconds: payload.elapsedSeconds,
              taskProgressPercent: payload.taskProgressPercent,
              progress: payload.progress,
              attempt: payload.attempt,
              diagnosis: payload.diagnosis,
              exitCode: payload.exitCode,
            },
            note: 'Open Full Results for raw status, events, logs, and artifacts.',
          }, null, 2);
        }
        if (path === '/api/runs' && payload && typeof payload === 'object' && Array.isArray(payload.runs)) {
          return JSON.stringify({
            ...base,
            response: {
              total: payload.total,
              returned: payload.runs.length,
              retention: payload.retention,
              runs: payload.runs.slice(0, 12).map((run) => ({
                id: run.id, status: run.status, createdAt: run.createdAt,
                completedAt: run.completedAt, exitCode: run.exitCode,
                failureClass: run.failureClass, error: run.error,
              })),
            },
            note: 'Recent runs are summarized; select a run for status and artifacts.',
          }, null, 2);
        }
        return JSON.stringify({
          ...base,
          response: payload,
        }, null, 2);
      }

      function setSummary(key, value, kind) {
        const element = document.querySelector('[data-summary="' + key + '"]');
        if (!element) return;
        element.textContent = value;
        element.className = 'summary-value' + (kind ? ' ' + kind : '');
      }

      function setRunDetails(payload) {
        const detailsEl = document.getElementById('run-details');
        if (!detailsEl) return;
        if (!payload) {
          detailsEl.innerHTML = '';
          return;
        }
        const progress = payload.progress || {};
        const stage = progress.displayName ? cleanProgressText(progress.displayName) : (progress.stage ? cleanProgressText(progress.stage) : '');
        const percent = typeof progress.percentComplete === 'number' ? progress.percentComplete + '%' : '';
        const phaseElapsed = typeof progress.updatedAt === 'string'
          ? Math.max(0, Math.floor((Date.now() - Date.parse(progress.updatedAt)) / 1000))
          : null;
        const retry = payload.attempt
          ? 'attempt ' + String(payload.attempt.current || 1) + '/' + String(payload.attempt.maximum || 1)
            + ' ' + String(payload.attempt.state || 'running')
            + (typeof payload.attempt.nextRetryInSeconds === 'number' ? ' in ' + payload.attempt.nextRetryInSeconds + 's' : '')
          : '';
        const timeout = typeof payload.timeoutRiskPercent === 'number' ? 'timeout risk ' + payload.timeoutRiskPercent + '%' : '';
        const parts = [stage, percent, phaseElapsed === null ? '' : 'phase ' + formatElapsedSeconds(phaseElapsed), retry, timeout].filter(Boolean);
        detailsEl.textContent = parts.join(' | ');
      }

      function runUrl(runId, suffix) {
        return '/api/runs/' + encodeURIComponent(runId) + suffix;
      }

      function showRunLinks(runId) {
        if (!runId) return;
        runLinks.hidden = false;
      }

      function clearRunFollowThrough() {
        runLinks.hidden = true;
        recommendedArtifacts.hidden = true;
        if (recommendedArtifactLinks) recommendedArtifactLinks.replaceChildren();
        activeRunView = null;
      }

      function artifactUrl(runId, fileName) {
        return '/api/results/' + encodeURIComponent(runId) + '/' + encodeURIComponent(fileName);
      }

      function showRecommendedArtifacts(runId, artifactsResponse) {
        if (!recommendedArtifacts || !recommendedArtifactLinks || !runId) return;
        const recommended = artifactsResponse && Array.isArray(artifactsResponse.recommended)
          ? artifactsResponse.recommended
          : [];
        recommendedArtifactLinks.replaceChildren();
        if (recommended.length === 0) {
          recommendedArtifacts.hidden = true;
          return;
        }
        
        // Build a map of artifact names to content types for quick lookup
        const artifactContentTypes = {};
        if (artifactsResponse && Array.isArray(artifactsResponse.artifacts)) {
          artifactsResponse.artifacts.forEach((artifact) => {
            artifactContentTypes[artifact.name] = artifact.contentType;
          });
        }
        
        recommended.forEach((fileName) => {
          // Only show text artifacts in recommended section
          const contentType = artifactContentTypes[fileName];
          if (!isTextContentType(contentType)) {
            return; // Skip binary artifacts
          }
          
          // Create wrapper container for button and copy button
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.gap = 'var(--space-1)';
          wrapper.style.alignItems = 'center';

          // Main artifact button
          const button = document.createElement('button');
          button.className = 'secondary toolbar-button-no-wrap';
          button.type = 'button';
          button.dataset.artifactFile = fileName;
          button.textContent = fileName;
          button.addEventListener('click', async () => {
            const target = document.querySelector('#artifacts-output');
            if (target) target.textContent = 'Loading ' + fileName + '...';
            try {
              const result = await apiRequest(artifactUrl(runId, fileName), { auth: true, preserveOutput: true });
              if (target) target.textContent = artifactDisplayText(result.payload);
              setModalActiveTab('artifacts');
            } catch (error) {
              if (target) target.textContent = 'Error loading ' + fileName + ': ' + (error instanceof Error ? error.message : String(error));
            }
          });
          wrapper.appendChild(button);

          // Copy button for recommended artifacts
          const copyBtn = document.createElement('button');
          copyBtn.className = 'artifact-copy-btn';
          copyBtn.type = 'button';
          copyBtn.setAttribute('aria-label', 'Copy ' + fileName);
          copyBtn.innerHTML = '📋';
          copyBtn.style.minWidth = '32px';
          copyBtn.style.padding = 'var(--space-1)';
          
          copyBtn.addEventListener('click', async (event) => {
            event.stopPropagation(); // Prevent opening modal
            try {
              const token = sessionStorage.getItem('kasekiApiToken');
              const response = await fetch(artifactUrl(runId, fileName), {
                headers: token ? { 'Authorization': 'Bearer ' + token } : {}
              });
              
              if (!response.ok) {
                let errorMsg = 'Error loading artifact';
                if (response.status === 401) {
                  errorMsg = 'Authentication failed';
                } else if (response.status === 404) {
                  errorMsg = 'Artifact not found';
                }
                setCopyButtonStatus(copyBtn, { ok: false, message: errorMsg });
                showToast(errorMsg, 'error', 2000);
                return;
              }
              
              const contentType = response.headers.get('content-type') || '';
              const isJson = contentType.includes('json');
              const content = isJson ? await response.json() : await response.text();
              const textToCopy = artifactDisplayText(content);
              
              if (textToCopy) {
                setCopyButtonStatus(copyBtn, await copyToClipboard(textToCopy));
              } else {
                setCopyButtonStatus(copyBtn, { ok: false, message: 'No content to copy' });
                showToast('No content to copy', 'error', 2000);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Copy failed';
              const copyMessage = 'Copy failed: ' + message;
              setCopyButtonStatus(copyBtn, { ok: false, message: copyMessage });
              showToast(copyMessage, 'error', 2000);
            }
          });
          wrapper.appendChild(copyBtn);

          recommendedArtifactLinks.appendChild(wrapper);
        });
        recommendedArtifacts.hidden = false;
      }

      async function loadRecommendedArtifacts(runId) {
        if (!runId) return;
        try {
          const result = await apiRequest(runUrl(runId, '/artifacts'), { auth: true, preserveOutput: true });
          if (result.response.ok) {
            showRecommendedArtifacts(runId, result.payload);
          }
        } catch {
          if (recommendedArtifacts) recommendedArtifacts.hidden = true;
        }
      }

      function formatRunButtonLabel(run) {
        const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
        const failure = run.status === 'failed' ? compactRunFailure(run) : '';
        if (!isDesktop) {
          // Mobile: Extract number from 'kaseki-77' and show condensed format
          const runNumber = run.id.split('-')[1] || run.id;
          return 'K-' + runNumber + ' ' + (run.status || '') + (failure ? ' - ' + failure : '');
        }
        // Desktop: Full format with time, allow wrapping
        const created = run.createdAt ? new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return [run.id, run.status, created, failure].filter(Boolean).join(' - ');
      }

      function setRunButtonContent(button, run) {
        const primary = formatRunButtonLabel(run);
        const secondary = [
          run.progress && run.progress.stage ? cleanProgressText(run.progress.stage) : '',
          typeof run.taskProgressPercent === 'number' ? 'workflow ' + run.taskProgressPercent + '%' : '',
        ].filter(Boolean).join(' | ');
        button.replaceChildren();
        const content = document.createElement('span');
        content.className = 'run-button-content';
        const primaryEl = document.createElement('span');
        primaryEl.className = 'run-button-primary';
        primaryEl.textContent = primary;
        content.appendChild(primaryEl);
        if (secondary) {
          const secondaryEl = document.createElement('span');
          secondaryEl.className = 'run-button-secondary';
          secondaryEl.textContent = secondary;
          content.appendChild(secondaryEl);
        }
        button.title = primary + (secondary ? ' | ' + secondary : '');
        button.setAttribute('aria-label', primary + (secondary ? ', ' + secondary : ''));
        button.appendChild(content);
      }

      let recentRuns = [];

      function renderRunsList(payload) {
        if (!runsList || !payload || !Array.isArray(payload.runs)) return;
        recentRuns = payload.runs.slice(0, 12);
        runsList.replaceChildren();
        const filter = document.querySelector('#runs-filter')?.value || 'all';
        const visibleRuns = recentRuns.filter((run) => filter === 'all'
          || run.status === filter
          || (filter === 'active' && (run.status === 'running' || run.status === 'queued')));
        const counts = recentRuns.reduce((result, run) => {
          const key = run.status || 'unknown';
          result[key] = (result[key] || 0) + 1;
          return result;
        }, {});
        const summary = document.querySelector('#runs-summary');
        summary.textContent = recentRuns.length
          ? Object.entries(counts).map(([status, count]) => count + ' ' + status).join(' · ')
          : 'No recent runs.';
        visibleRuns.forEach((run) => {
          const button = document.createElement('button');
          button.className = 'secondary toolbar-button';
          button.type = 'button';
          setRunButtonContent(button, run);
          button.addEventListener('click', () => {
            runIdInput.value = run.id;
            updateCancelRunButtonState();
            showRunLinks(run.id);
            activeRunView = 'status';
            pollRun(run.id);
          });
          runsList.appendChild(button);
        });
        if (!visibleRuns.length && recentRuns.length) runsList.textContent = 'No runs match this filter.';
      }

      document.querySelector('#runs-filter').addEventListener('change', () => {
        renderRunsList({ runs: recentRuns });
      });

      async function loadRunsList(options) {
        try {
          const result = await apiRequest('/api/runs?limit=12', { auth: true, preserveOutput: options && options.preserveOutput });
          if (result.response.ok) {
            renderRunsList(result.payload);
          }
        } catch (error) {
          if (runsList) {
            runsList.textContent = error instanceof Error && error.message.includes('API bearer token')
              ? 'Enter the API bearer token to load recent runs.'
              : 'Runs could not be loaded.';
          }
        }
      }

      function isTerminalStatus(status) {
        return status === 'completed' || status === 'failed';
      }

      function stopPolling() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
      }

      function summarizeHealth(path, payload) {
        if (path === '/health') {
          setSummary('controller', payload.status || 'Healthy', 'ok');
          if (payload.queue) {
            setSummary('queue', String(payload.queue.running || 0) + ' running, ' + String(payload.queue.pending || 0) + ' pending', 'ok');
          }
        }
        if (path === '/ready') {
          setSummary('controller', payload.status || 'Ready', 'ok');
        }
        if (path.startsWith('/api/gateway-test')) {
          // Handle both /api/gateway-test (full test), /api/gateway-test?stage=1 (connectivity), and /api/gateway-test?stage=2 (inference)
          const responseTime = Math.round(payload.responseTime || 0);
          const slow = payload.status === 'ok' && typeof payload.warning === 'string';
          const smoke = payload.responseSmokeValidated === true;
          const summary = payload.status === 'ok'
            ? responseTime + 'ms' + (smoke ? ' smoke ok' : '') + (slow ? ' slow' : '')
            : 'Failed';
          
          // Determine which summary to update based on the path
          if (path.includes('stage=2')) {
            // Stage 2 (LLM inference test)
            const outputTokens = payload.outputTokens || 0;
            const streamOk = payload.streamSmokeValidated === true;
            const largeOk = payload.largePromptSmokeValidated === true;
            const coverage = [
              streamOk ? 'stream ok' : '',
              largeOk ? 'large ok' : '',
            ].filter(Boolean).join(', ');
            const llmSummary = payload.partialSuccess
              ? 'Gateway passed; Pi adapter failed'
              : payload.status === 'ok'
              ? responseTime + 'ms' + (outputTokens ? ' ' + outputTokens + ' tokens' : '') + (coverage ? ' ' + coverage : '')
              : 'Failed';
            setSummary('llm-test', llmSummary, payload.partialSuccess ? 'warning' : payload.status === 'ok' ? 'ok' : 'bad');
            piAdapterValidationState = payload.piProviderSmoke?.status === 'ok'
              ? 'passed'
              : payload.piProviderSmoke?.status === 'error' ? 'failed' : 'unknown';
            updateSubmitButtonState();
            if (!payload.piProviderSmoke) {
              setResponseSummary('Gateway passed. Pi provider adapter smoke was not requested; add piProvider=true to run it.');
            } else if (payload.piProviderSmoke && payload.piProviderSmoke.status === 'skipped') {
              setResponseSummary('Gateway passed. Pi provider adapter smoke was skipped; run production check with piProvider=true.');
            } else if (payload.piProviderSmoke && payload.piProviderSmoke.status === 'ok') {
              setResponseSummary('Gateway and Pi provider adapter passed.');
            } else if (payload.piProviderSmoke && payload.piProviderSmoke.status === 'error') {
              const diag = payload.piProviderSmoke.diagnostics || {};
              const fieldsFound = diag.fieldsFound || [];
              const suggested = diag.suggestedPatterns || [];
              const eventsByType = diag.eventsByType || {};
              
              let diagnosticMsg = payload.partialSuccess
                ? 'Gateway inference passed; Pi provider adapter contract failed. Diagnostics:\n'
                : 'Pi provider adapter test failed. Diagnostics:\n';
              diagnosticMsg += '  Fields found: ' + (fieldsFound.length > 0 ? fieldsFound.join(', ') : '(none)') + '\n';
              const eventTypesList = [];
              for (const [k, v] of Object.entries(eventsByType)) {
                eventTypesList.push(k + '(' + v + ')');
              }
              diagnosticMsg += '  Event types seen: ' + (eventTypesList.join(', ') || '(none)') + '\n';
              if (typeof diag.debugOutputPath === 'string' && diag.debugOutputPath) {
                diagnosticMsg += '  Debug JSONL: ' + stripControlSequences(diag.debugOutputPath).slice(0, 240) + '\n';
              }
              if (typeof diag.rawAssistantPreview === 'string' && diag.rawAssistantPreview) {
                diagnosticMsg += '  Assistant preview: ' + stripControlSequences(diag.rawAssistantPreview).slice(0, 300) + '\n';
              }
              
              if (suggested.length > 0) {
                diagnosticMsg += '  Suggested patterns to try: ' + suggested.slice(0, 3).join(', ') + '\n';
              }
              
              diagnosticMsg += '  Remediation: ' + (payload.piProviderSmoke.remediation || 'Check gateway configuration and Pi provider registration');
              
              setResponseSummary(diagnosticMsg);
            }
          } else {
            // Stage 1 or full test (gateway connectivity)
            setSummary('gateway', summary, payload.status === 'ok' ? (slow ? 'warning' : 'ok') : 'bad');
          }
        }
        if (path === '/api/gateway-test/responses') {
          const responseTime = Math.round(payload.responseTime || 0);
          const outputTokens = payload.outputTokens || 0;
          const summary = payload.status === 'ok'
            ? responseTime + 'ms ' + outputTokens + ' tokens'
            : 'Failed';
          setSummary('llm-test', summary, payload.status === 'ok' ? 'ok' : 'bad');
        }
        if (path === '/api/preflight') {
          const checks = Array.isArray(payload.checks) ? payload.checks : [];
          const failed = checks.filter((check) => !check.ok);
          setSummary('preflight', failed.length === 0 ? String(checks.length) + ' checks passed' : String(failed.length) + ' failed', failed.length === 0 ? 'ok' : 'bad');
        }
      }

      function summarizeRun(payload) {
        if (!payload || !payload.status) return;
        setSummary('run', payload.status, payload.status === 'failed' ? 'bad' : 'ok');
        setRunDetails(payload);
        updateCancelRunButtonState(payload);
        if (payload.correlationId || payload.diagnosticEntryPoint) {
          const details = [];
          if (payload.correlationId) details.push('Correlation: ' + payload.correlationId);
          if (payload.diagnosticEntryPoint) details.push('Start diagnostics: ' + payload.diagnosticEntryPoint);
          setResponseSummary(details.join('\n'));
        }
      }

      function applyProgressHighWater(payload) {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') return payload;
        if (typeof payload.taskProgressPercent !== 'number') return payload;
        const current = payload.taskProgressPercent;
        const previous = runProgressHighWater[payload.id];
        if (typeof previous === 'number' && current < previous) {
          if (isTerminalStatus(payload.status)) {
            delete runProgressHighWater[payload.id];
          }
          return { ...payload, taskProgressPercent: previous };
        }
        runProgressHighWater[payload.id] = Math.max(typeof previous === 'number' ? previous : 0, current);
        if (isTerminalStatus(payload.status)) {
          delete runProgressHighWater[payload.id];
        }
        return payload;
      }

      function createRequestId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
          const value = Math.floor(Math.random() * 16);
          return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
        });
      }

      function requestBody(idempotencyKey) {
        const data = new FormData(form);
        const body = {
          repoUrl: String(data.get('repoUrl') || '').trim(),
          taskPrompt: String(data.get('taskPrompt') || '').trim(),
          taskMode: String(data.get('taskMode') || 'patch'),
        };
        if (idempotencyKey) {
          body.idempotencyKey = idempotencyKey;
        }
        return body;
      }

      class RequestTimeoutError extends Error {
        constructor(path, timeoutMs) {
          super('Request timed out after ' + String(Math.round(timeoutMs / 1000)) + 's: ' + path);
          this.name = 'RequestTimeoutError';
          this.path = path;
          this.timeoutMs = timeoutMs;
        }
      }

      function requestTimeoutFor(path, options) {
        if (options && typeof options.timeoutMs === 'number') return options.timeoutMs;
        if (path === '/api/preflight') return LONG_REQUEST_TIMEOUT_MS;
        // Gateway tests (especially Stage 2 LLM inference) need more time (~15-20s for LLM response)
        if (path.startsWith('/api/gateway-test')) return LONG_REQUEST_TIMEOUT_MS;
        return DEFAULT_REQUEST_TIMEOUT_MS;
      }

      async function fetchWithTimeout(path, fetchOptions, timeoutMs) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(path, { ...fetchOptions, signal: controller.signal });
        } catch (error) {
          if (error && error.name === 'AbortError') {
            throw new RequestTimeoutError(path, timeoutMs);
          }
          throw error;
        } finally {
          window.clearTimeout(timer);
        }
      }

      async function apiRequest(path, options) {
        const token = getApiToken();
        const needsAuth = options && options.auth;
        if (needsAuth && !token) throw new Error('Enter the API bearer token in the header first.');
        if (needsAuth && token && !isLikelyBearerToken(token)) {
          throw new Error('Token format looks invalid. Use a plain bearer token without spaces.');
        }
        let response;
        try {
          response = await fetchWithTimeout(path, {
            method: options && options.method || 'GET',
            headers: {
              ...(needsAuth ? { Authorization: 'Bearer ' + token } : {}),
              ...(options && options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: options && options.body ? JSON.stringify(options.body) : undefined,
          }, requestTimeoutFor(path, options));
        } catch (error) {
          if (error instanceof RequestTimeoutError) {
            throw error;
          }
          throw new Error('Network request failed before the controller responded: ' + (error instanceof Error ? error.message : String(error)));
        }
        const contentType = response.headers.get('content-type') || '';
        let payload = contentType.includes('json') ? await response.json() : await response.text();
        payload = applyProgressHighWater(payload);
        if (needsAuth && response.ok) sessionStorage.setItem('kasekiApiToken', token);
        const runId = payload && typeof payload.id === 'string'
          ? payload.id
          : String(runIdInput.value || '').trim();
        const statusLabel = responseStatusLabel(response, payload);
        if (!(options && options.preserveOutput)) {
          setOutputMetadata(statusLabel, runId || undefined);
          setResponseSummary(payload);
          setOutputBody(summarizedResponseBody(path, options && options.method || 'GET', response.status, payload));
          setState(requestCompletionMessage(path, options && options.method || 'GET', response, payload), response.ok ? 'ok' : 'bad');
        }
        if (response.ok && payload && typeof payload === 'object') {
          summarizeHealth(path, payload);
          summarizeRun(payload);
          if (runId) showRunLinks(runId);
          if (runId && payload.status && isTerminalStatus(payload.status)) {
            loadRecommendedArtifacts(runId);
          }
        }
        return { payload, response };
      }

      async function run(button, path, options) {
        button.disabled = true;
        setOutputMetadata('running', String(runIdInput.value || '').trim() || undefined);
        const actionLabel = button.textContent ? button.textContent.trim() : 'request';
        const startedAt = Date.now();
        setResponseSummary(null);
        setOutputBody(actionLabel === 'Current Preflight'
          ? 'Running current preflight checks... 0s elapsed'
          : 'Contacting the controller...');
        const elapsedTimer = actionLabel === 'Current Preflight'
          ? window.setInterval(() => {
              setOutputBody('Running current preflight checks... ' + String(Math.floor((Date.now() - startedAt) / 1000)) + 's elapsed');
            }, 1000)
          : null;
        setState(actionLabel === 'Current Preflight'
          ? 'Running current preflight checks...'
          : 'Contacting the controller...');
        try {
          return await apiRequest(path, options);
        } catch (error) {
          setOutputMetadata('failed', String(runIdInput.value || '').trim() || undefined);
          setResponseSummary(null);
          setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
          setState('Request could not be sent.', 'bad');
          return { payload: null, response: { ok: false } };
        } finally {
          if (elapsedTimer) window.clearInterval(elapsedTimer);
          button.disabled = false;
        }
      }

      async function pollRun(runId, options) {
        stopPolling();
        if (!runId) return;
        let retryCount = 0;
        let firstPoll = true;
        const maxRetries = 36;
        async function poll() {
          try {
            const preserveOutput = (options && options.preserveFirstOutput && firstPoll) || activeRunView !== 'status';
            firstPoll = false;
            const result = await apiRequest(runUrl(runId, '/status'), { auth: true, preserveOutput });
            summarizeRun(result.payload);
            retryCount = 0;
            if (result.response.ok && result.payload && result.payload.status && !isTerminalStatus(result.payload.status)) {
              pollTimer = setTimeout(poll, 5000);
              loadRunsList({ preserveOutput: true });
            } else {
              loadRunsList({ preserveOutput: true });
            }
          } catch {
            retryCount++;
            if (retryCount < maxRetries) {
              pollTimer = setTimeout(poll, 10000);
            } else {
              setState('Polling stopped after repeated failures.', 'bad');
            }
          }
        }
        poll();
      }

      // Tab switching
      document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
          const tabName = button.dataset.tab;
          document.querySelectorAll('.tab-button').forEach(b => {
            const active = b.dataset.tab === tabName;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          document.querySelectorAll('main .tab-content').forEach(content => {
            const contentTabName = content.id.replace('-tab', '');
            const active = contentTabName === tabName;
            content.classList.toggle('hidden', !active);
            content.hidden = !active;
            content.setAttribute('aria-hidden', active ? 'false' : 'true');
          });
          sessionStorage.setItem('kasekiActiveTab', tabName);
        });
      });
      // Restore active tab on page load
      const savedTab = sessionStorage.getItem('kasekiActiveTab') || 'health';
      const savedTabButton = document.querySelector('[data-tab="' + savedTab + '"]');
      if (savedTabButton) savedTabButton.click();
      
      // Initialize header status
      updateHeaderStatus('idle');

      // Health check button handlers
      document.querySelectorAll('[data-probe]').forEach((button) => {
        button.addEventListener('click', () => {
          const statusEl = button.querySelector('.health-check-status');
          if (statusEl) {
            statusEl.className = 'health-check-status spinner';
          }
          run(button, button.dataset.probe, {
            auth: button.dataset.auth === 'true',
          }).then(({ response }) => {
            loadRunsList({ preserveOutput: true });
            if (statusEl) {
              statusEl.className = response.ok ? 'health-check-status ok' : 'health-check-status bad';
            }
          }).catch(() => {
            if (statusEl) {
              statusEl.className = 'health-check-status bad';
            }
          });
        });
      });

      // Validation state management functions
      function setValidationState(isValid, checks = []) {
        validationState = { isValid, checks, lastValidated: new Date().toISOString() };
        sessionStorage.setItem(validationStateKey, JSON.stringify(validationState));
        updateSubmitButtonState();
        updateValidationBadge();
      }

      function getValidationState() {
        const stored = sessionStorage.getItem(validationStateKey);
        if (stored) {
          try {
            validationState = JSON.parse(stored);
          } catch {
            validationState = { isValid: false, lastValidated: null, checks: [] };
          }
        }
        return validationState;
      }

      function resetValidationState() {
        validationState = { isValid: false, lastValidated: null, checks: [] };
        sessionStorage.removeItem(validationStateKey);
        updateSubmitButtonState();
        updateValidationBadge();
      }

      function updateSubmitButtonState() {
        const submitBtn = document.querySelector('#submit');
        if (validationState.isValid && piAdapterValidationState !== 'failed') {
          submitBtn.disabled = false;
          submitBtn.setAttribute('title', 'Submit the task');
          submitBtn.setAttribute('aria-disabled', 'false');
        } else {
          submitBtn.disabled = true;
          submitBtn.setAttribute('title', piAdapterValidationState === 'failed'
            ? 'Pi adapter inference failed; rerun Test Inference successfully before submitting'
            : 'Please validate task first');
          submitBtn.setAttribute('aria-disabled', 'true');
        }
      }

      function updateValidationBadge() {
        const badge = document.querySelector('#validation-badge');
        if (validationState.isValid) {
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      }

      function attachFormChangeListeners() {
        const repoUrlInput = document.querySelector('#repo-url');
        const taskPromptInput = document.querySelector('#task-prompt');
        const changedFilesAllowlist = document.querySelector('[name="changedFilesAllowlist"]');
        const validationAllowlist = document.querySelector('[name="validationAllowlist"]');

        const formFields = [repoUrlInput, taskPromptInput, changedFilesAllowlist, validationAllowlist].filter(Boolean);
        formFields.forEach((field) => {
          field.addEventListener('input', () => {
            resetValidationState();
          });
        });
      }

      function updateCancelRunButtonState(run) {
        const cancelRunBtn = document.querySelector('#cancel-run');
        const runId = runIdInput.value.trim();
        const canCancel = run && typeof run.cancellable === 'boolean'
          ? run.cancellable
          : run && typeof run.status === 'string'
            ? !isTerminalStatus(run.status)
            : Boolean(runId);
        if (runId && canCancel) {
          cancelRunBtn.disabled = false;
          cancelRunBtn.setAttribute('title', 'Cancel the active run');
          cancelRunBtn.setAttribute('aria-disabled', 'false');
        } else {
          cancelRunBtn.disabled = true;
          cancelRunBtn.setAttribute('title', runId ? 'Run is no longer cancellable' : 'No active run');
          cancelRunBtn.setAttribute('aria-disabled', 'true');
        }
      }

      // Restore validation state on page load
      getValidationState();
      updateSubmitButtonState();
      updateValidationBadge();
      attachFormChangeListeners();
      updateCancelRunButtonState();

      document.querySelector('#validate').addEventListener('click', (event) => {
        if (!form.reportValidity()) return;
        const button = event.currentTarget;
        button.disabled = true;
        setOutputMetadata('running');
        setState('Validating task...');
        apiRequest('/api/validate', { method: 'POST', auth: true, body: requestBody() })
          .then(({ payload, response }) => {
            if (response.ok && payload && payload.isValid === true) {
              setValidationState(true, payload.checks || []);
              setOutputMetadata('ok');
              setState('Validation passed!', 'ok');
              setResponseSummary(payload);
              setOutputBody(JSON.stringify({
                status: 'Validation successful',
                checks: payload.checks,
                estimatedDurationSeconds: payload.estimatedDurationSeconds,
              }, null, 2));
            } else if (response.ok && payload && payload.isValid === false) {
              resetValidationState();
              setOutputMetadata('failed');
              setState('Validation failed', 'bad');
              setResponseSummary(payload);
              const failedChecks = (payload.checks || []).filter((c) => c.status === 'fail');
              setOutputBody(JSON.stringify({
                status: 'Validation failed',
                failedChecks,
                errors: payload.errors || [],
                warnings: payload.warnings || [],
              }, null, 2));
            } else {
              resetValidationState();
              setOutputMetadata('failed');
              setState('Validation error', 'bad');
              setOutputBody(JSON.stringify(payload || { error: 'Unknown error' }, null, 2));
            }
          })
          .catch((error) => {
            resetValidationState();
            setOutputMetadata('failed');
            setState('Validation failed', 'bad');
            setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
          })
          .finally(() => {
            button.disabled = false;
          });
      });

      function closeModal() {
        if (modalRefreshTimer) window.clearInterval(modalRefreshTimer);
        modalRefreshTimer = null;
        fullResultsModal.hidden = true;
        modalBackdrop.hidden = true;
        modalTabCache = {};
        modalTitleEl.textContent = 'Full Results';
        if (modalOpener) { modalOpener.focus(); modalOpener = null; }
      }

      function setModalActiveTab(tabName) {
        activeModalTab = tabName;
        tabButtons.forEach(btn => {
          const active = btn.dataset.tab === tabName;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        document.querySelectorAll('.modal-tabs-container .tab-content').forEach(tab => {
          const active = tab.id === 'tab-' + tabName;
          tab.classList.toggle('active', active);
          tab.hidden = !active;
          tab.setAttribute('aria-hidden', active ? 'false' : 'true');
        });
      }

      function openModal() {
        modalOpener = document.activeElement;
        const runId = runIdInput.value.trim();
        modalTitleEl.textContent = runId ? 'Full Results — ' + runId : 'Full Results';
        fullResultsModal.hidden = false;
        modalBackdrop.hidden = false;
        setModalActiveTab('status');
        modalCloseBtn.focus();
        loadModalTab('status');
        if (modalRefreshTimer) window.clearInterval(modalRefreshTimer);
        modalRefreshTimer = window.setInterval(() => {
          if (fullResultsModal.hidden || activeModalTab === 'artifacts') return;
          loadModalTab(activeModalTab, { background: true });
        }, 5000);
      }

      async function loadModalTab(tabName, options) {
        if (tabName === 'artifacts' && modalTabCache[tabName]) {
          displayModalTab(tabName);
          return;
        }
        
        const runId = runIdInput.value.trim();
        if (!runId) {
          setOutputMetadata('idle');
          setResponseSummary(null);
          setOutputBody('Submit a run or enter a run ID first.');
          setState('Modal needs a run ID.', 'bad');
          return;
        }

        const tabOutputEl = document.querySelector('#' + tabName + '-output');
        if (!tabOutputEl) return;
        
        if (!(options && options.background)) tabOutputEl.textContent = 'Loading...';
        
        try {
          const paths = {
            status: runUrl(runId, '/status'),
            events: runUrl(runId, '/events?tail=50'),
            stdout: runUrl(runId, '/logs/stdout?tail=lines&lines=200'),
            artifacts: runUrl(runId, '/artifacts'),
          };
          
          const result = await apiRequest(paths[tabName], { auth: true, preserveOutput: true });
          
          if (tabName === 'artifacts') {
            // Format artifacts as a grid of links
            const artifactsResponse = result.payload;
            modalTabCache[tabName] = artifactsResponse;
            displayArtifactsTab(runId, artifactsResponse);
          } else {
            // Format as JSON for status, events, and stdout
            const content = tabName === 'stdout' 
              ? (result.payload && typeof result.payload === 'object' && 'content' in result.payload
                ? result.payload.content
                : result.payload)
              : JSON.stringify(result.payload, null, 2);
            modalTabCache[tabName] = tabName === 'status'
              ? result.payload
              : stripControlSequences(content);
            displayModalTab(tabName);
            if (tabName === 'status' && result.payload && isTerminalStatus(result.payload.status) && modalRefreshTimer) {
              modalTabCache.events = null;
              modalTabCache.stdout = null;
              modalTabCache.artifacts = null;
              void Promise.all([
                loadModalTab('events', { background: true }),
                loadModalTab('stdout', { background: true }),
                loadModalTab('artifacts', { background: true }),
              ]);
              window.clearInterval(modalRefreshTimer);
              modalRefreshTimer = null;
            }
          }
        } catch (error) {
          tabOutputEl.textContent = 'Error loading tab: ' + (error instanceof Error ? error.message : String(error));
        }
      }

      function displayModalTab(tabName) {
        const tabOutputEl = document.querySelector('#' + tabName + '-output');
        if (!tabOutputEl) return;
        
        const content = modalTabCache[tabName];
        if (tabName === 'artifacts') {
          // Artifacts are displayed in displayArtifactsTab
          return;
        }
        
        if (tabName === 'status' && content && typeof content === 'object') {
          const diagnosis = content.diagnosis || {};
          const attempt = content.attempt || {};
          const recommended = content.artifacts && Array.isArray(content.artifacts.diagnosticFiles)
            ? content.artifacts.diagnosticFiles.slice(0, 5)
            : [];
          const summary = [
            'RUN SUMMARY',
            'Status: ' + String(content.status || 'unknown'),
            content.exitCode == null ? '' : 'Exit code: ' + String(content.exitCode),
            diagnosis.phase || attempt.phase ? 'Phase: ' + String(diagnosis.phase || attempt.phase) : '',
            attempt.provider ? 'Provider: ' + String(attempt.provider) : '',
            attempt.current && attempt.maximum ? 'Attempts: ' + String(attempt.current) + '/' + String(attempt.maximum) : '',
            diagnosis.summary || content.error ? 'Reason: ' + String(diagnosis.summary || content.error) : '',
            diagnosis.remediation ? 'Next step: ' + String(diagnosis.remediation) : '',
            content.resultSummaryContent && /Failure Detail:|Changed Files:\s*0|Diff Lines:\s*0/i.test(content.resultSummaryContent)
              ? 'Warning: terminal artifacts report fallback/failure signals; review the result summary before accepting this run.'
              : '',
            recommended.length ? 'Diagnostics: ' + recommended.join(', ') : '',
            '',
            'RAW STATUS',
            JSON.stringify(content, null, 2),
          ].filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== '')).join('\n');
          tabOutputEl.textContent = stripControlSequences(summary);
          return;
        }
        tabOutputEl.textContent = content || '';
      }

      /**
       * Display a toast notification to the user.
       * Auto-dismisses after the specified duration.
       */
      function showToast(message, type, durationMs) {
        type = type || 'success';
        durationMs = durationMs || 2000;
        const container = document.querySelector('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);

        // Remove toast after duration (total animation is 2.6s with fadeInOut, but we control removal)
        setTimeout(() => {
          container.removeChild(toast);
        }, durationMs + 300); // Add 300ms for fade-out animation
      }

      function setCopyButtonStatus(button, result) {
        if (!button || !result) return;
        const status = result.ok ? 'success' : 'error';
        button.dataset.copyStatus = status;
        button.dataset.copyMessage = result.message;
        button.setAttribute('title', result.message);
      }

      /**
       * Copy text to clipboard using modern Clipboard API or fallback.
       */
      async function copyToClipboard(text) {
        try {
          // Try modern Clipboard API
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            showToast('Copied!', 'success', 2000);
            return { ok: true, message: 'Copied!' };
          } else {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (success) {
              showToast('Copied!', 'success', 2000);
              return { ok: true, message: 'Copied!' };
            } else {
              showToast('Copy failed - please try again', 'error', 2000);
              return { ok: false, message: 'Copy failed - please try again' };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Copy failed';
          const copyMessage = 'Copy failed: ' + message;
          showToast(copyMessage, 'error', 2000);
          return { ok: false, message: copyMessage };
        }
      }

      /**
       * Extract text content from artifact display element.
       */
      function extractArtifactContent() {
        const preEl = document.querySelector('.artifact-content .artifact-content-pre');
        if (preEl) {
          return preEl.textContent;
        }
        const mdEl = document.querySelector('.artifact-content .artifact-content-markdown');
        if (mdEl) {
          return mdEl.textContent;
        }
        return null;
      }

      /**
       * Determines whether an artifact should be displayed inline based on content type.
       * Binary artifacts (zip, gzip, SBOM, etc.) are excluded from the UI.
       */
      function isTextContentType(contentType) {
        if (!contentType) return true; // Default to true if unknown
        const type = contentType.toLowerCase();
        
        // Binary types to exclude
        const binaryTypes = [
          'application/zip',
          'application/gzip',
          'application/x-gzip',
          'application/x-tar',
          'application/vnd.cyclonedx+json',
          'application/octet-stream',
        ];
        
        if (binaryTypes.includes(type)) return false;
        
        // Text types
        if (type.startsWith('application/json')) return true;
        if (type.startsWith('application/x-jsonl')) return true;
        if (type.startsWith('text/')) return true;
        
        return true; // Default to text if unsure
      }

      /**
       * Fetches an artifact with authentication and displays it inline in the modal.
       * Handles errors gracefully with user-friendly messages.
       */
      const MAX_INLINE_ARTIFACT_BYTES = 512 * 1024;

      async function openArtifact(runId, artifactName, artifactSize) {
        const artifactsOutputEl = document.querySelector('#artifacts-output');
        if (!artifactsOutputEl) return;

        if (Number(artifactSize) > MAX_INLINE_ARTIFACT_BYTES) {
          artifactsOutputEl.innerHTML = '';
          const notice = document.createElement('div');
          notice.className = 'artifact-large-notice';
          notice.textContent = artifactName + ' is ' + formatBytes(artifactSize) +
            '. Inline rendering is limited to ' + formatBytes(MAX_INLINE_ARTIFACT_BYTES) + ' to keep the console responsive.';
          const download = document.createElement('button');
          download.type = 'button';
          download.textContent = 'Download full artifact';
          download.className = 'artifact-download-link';
          download.addEventListener('click', async () => {
            const token = getApiToken();
            const response = await fetch(artifactUrl(runId, artifactName), {
              headers: { 'Authorization': 'Bearer ' + token },
            });
            if (!response.ok) {
              showToast('Could not download artifact (' + response.status + ').', 'error', 2500);
              return;
            }
            const blobUrl = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = artifactName;
            anchor.click();
            URL.revokeObjectURL(blobUrl);
          });
          artifactsOutputEl.append(notice, download);
          return;
        }
        
        // Show loading state
        const originalContent = artifactsOutputEl.innerHTML;
        artifactsOutputEl.innerHTML = '<div class="artifact-loading">Loading ' + artifactName + '...</div>';
        
        try {
          const token = getApiToken();
          if (!token) {
            artifactsOutputEl.innerHTML = originalContent;
            throw new Error('Authentication token required. Enter your API bearer token in the header.');
          }
          
          const response = await fetch(artifactUrl(runId, artifactName), {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + token,
            },
          });
          
          if (!response.ok) {
            artifactsOutputEl.innerHTML = originalContent;
            let errorMsg = 'Error loading artifact';
            if (response.status === 401) {
              errorMsg = 'Authentication failed: Invalid or expired token. Please re-enter your API key.';
            } else if (response.status === 404) {
              errorMsg = 'Artifact not found.';
            } else if (response.status === 400) {
              errorMsg = 'Artifact is not available yet. Please wait for the run to complete.';
            } else if (response.status >= 500) {
              errorMsg = 'Server error: Could not read artifact (' + response.status + ').';
            }
            throw new Error(errorMsg);
          }
          
          const contentType = response.headers.get('content-type') || '';
          const isJson = contentType.includes('json');
          const content = isJson ? await response.json() : await response.text();
          const displayText = artifactDisplayText(content);
          
          // Display the artifact content
          artifactsOutputEl.innerHTML = '';
          const container = document.createElement('div');
          container.className = 'artifact-content';
          
          // Add toolbar row: title on left, copy button on right
          const toolbarRow = document.createElement('div');
          toolbarRow.style.display = 'flex';
          toolbarRow.style.justifyContent = 'space-between';
          toolbarRow.style.alignItems = 'center';
          toolbarRow.style.gap = 'var(--space-2)';

          // Title span
          const titleSpan = document.createElement('span');
          titleSpan.textContent = artifactName;
          toolbarRow.appendChild(titleSpan);

          // Copy button (icon only)
          const copyBtn = document.createElement('button');
          copyBtn.className = 'artifact-copy-btn';
          copyBtn.type = 'button';
          copyBtn.setAttribute('aria-label', 'Copy artifact content');
          copyBtn.innerHTML = '📋';
          copyBtn.addEventListener('click', async () => {
            const content = extractArtifactContent();
            if (content) {
              setCopyButtonStatus(copyBtn, await copyToClipboard(content));
            } else {
              setCopyButtonStatus(copyBtn, { ok: false, message: 'No content to copy' });
              showToast('No content to copy', 'error', 2000);
            }
          });
          toolbarRow.appendChild(copyBtn);

          container.appendChild(toolbarRow);

          // Add back button
          const backBtn = document.createElement('button');
          backBtn.className = 'artifact-back-btn';
          backBtn.type = 'button';
          backBtn.textContent = '← Back to artifacts';
          backBtn.addEventListener('click', () => {
            artifactsOutputEl.innerHTML = originalContent;
            // Re-attach click handlers to artifact list items
            artifactsOutputEl.querySelectorAll('.artifact-item').forEach((item) => {
              item.addEventListener('click', async (event) => {
                event.preventDefault();
                const name = item.querySelector('.artifact-item-name').textContent;
                const itemSize = Number(item.dataset.artifactSize || 0);
                await openArtifact(runId, name, itemSize);
              });
            });
          });
          container.appendChild(backBtn);
          
          // Add content in appropriate format
          if (contentType.includes('json')) {
            const pre = document.createElement('pre');
            pre.className = 'artifact-content-pre';
            pre.textContent = displayText;
            container.appendChild(pre);
          } else if (contentType.includes('markdown')) {
            const mdDiv = document.createElement('div');
            mdDiv.className = 'artifact-content-markdown';
            mdDiv.textContent = displayText; // In production, use a markdown renderer
            container.appendChild(mdDiv);
          } else {
            const pre = document.createElement('pre');
            pre.className = 'artifact-content-pre';
            pre.textContent = displayText;
            container.appendChild(pre);
          }
          
          artifactsOutputEl.appendChild(container);
          
          // Save token if authentication was successful
          if (token) sessionStorage.setItem('kasekiApiToken', token);
        } catch (error) {
          artifactsOutputEl.innerHTML = originalContent;
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorEl = document.createElement('div');
          errorEl.className = 'artifact-error';
          errorEl.textContent = 'Error: ' + errorMsg;
          artifactsOutputEl.appendChild(errorEl);
        }
      }

      function displayArtifactsTab(runId, artifactsResponse) {
        const artifactsOutputEl = document.querySelector('#artifacts-output');
        if (!artifactsOutputEl) return;
        
        artifactsOutputEl.innerHTML = '';
        
        const artifacts = artifactsResponse && Array.isArray(artifactsResponse.artifacts)
          ? artifactsResponse.artifacts
          : [];
        
        // Filter to only text artifacts (exclude binary)
        const textArtifacts = artifacts.filter((artifact) => {
          if (!artifact.available) return false;
          return isTextContentType(artifact.contentType);
        });
        
        if (textArtifacts.length === 0) {
          const status = artifactsResponse && artifactsResponse.runStatus ? String(artifactsResponse.runStatus) : '';
          artifactsOutputEl.textContent = status === 'running'
            ? 'No finalized text artifacts yet. Use the Stdout tab for live logs; artifacts appear here as the run writes them.'
            : 'No text artifacts available.';
          return;
        }
        
        const listDiv = document.createElement('div');
        listDiv.className = 'artifacts-list';
        const recommended = new Set(
          artifactsResponse && Array.isArray(artifactsResponse.recommended)
            ? artifactsResponse.recommended
            : []
        );
        
        textArtifacts.forEach((artifact) => {
          const item = document.createElement('button');
          item.className = 'artifact-item';
          item.type = 'button';
          item.dataset.artifactSize = String(artifact.size || 0);
          
          const nameSpan = document.createElement('div');
          nameSpan.className = 'artifact-item-name';
          nameSpan.textContent = artifact.name;
          
          const sizeSpan = document.createElement('div');
          sizeSpan.className = 'artifact-item-size';
          sizeSpan.textContent = artifact.size ? formatBytes(artifact.size) : '';

          const badge = document.createElement('span');
          badge.className = 'artifact-item-badge' + (recommended.has(artifact.name) ? ' recommended' : '');
          badge.textContent = recommended.has(artifact.name) ? 'Recommended' : artifact.availability || 'Available';

          const description = document.createElement('div');
          description.className = 'artifact-item-description';
          description.textContent = artifact.description
            ? stripControlSequences(String(artifact.description)).slice(0, 150)
            : artifact.contentType || '';
          
          item.append(nameSpan, badge);
          if (artifact.size) item.appendChild(sizeSpan);
          if (description.textContent) item.appendChild(description);
          
          item.addEventListener('click', async () => {
            await openArtifact(runId, artifact.name, artifact.size);
          });
          
          listDiv.appendChild(item);
        });
        
        artifactsOutputEl.appendChild(listDiv);
      }

      function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        if (bytes < 1024) return String(bytes) + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
      }

      fullResultsBtn.addEventListener('click', () => {
        openModal();
      });

      copyDiagnosticBundleBtn.addEventListener('click', async () => {
        const runId = runIdInput.value.trim();
        if (!runId) {
          showToast('Select a run first.', 'error', 2000);
          return;
        }
        copyDiagnosticBundleBtn.disabled = true;
        try {
          const [statusResult, artifactsResult] = await Promise.all([
            apiRequest(runUrl(runId, '/status'), { auth: true, preserveOutput: true }),
            apiRequest(runUrl(runId, '/artifacts'), { auth: true, preserveOutput: true }),
          ]);
          const recommended = Array.isArray(artifactsResult.payload && artifactsResult.payload.recommended)
            ? artifactsResult.payload.recommended.slice(0, 5)
            : [];
          const artifactSections = await Promise.all(recommended.map(async (name) => {
            const result = await apiRequest('/api/results/' + encodeURIComponent(runId) + '/' + encodeURIComponent(name), { auth: true, preserveOutput: true });
            return '## ' + name + '\n' + artifactDisplayText(result.payload);
          }));
          const bundle = '# Kaseki diagnostic bundle: ' + runId + '\n\n## Status\n' +
            JSON.stringify(statusResult.payload, null, 2) + '\n\n' + artifactSections.join('\n\n');
          const copied = await copyToClipboard(bundle);
          showToast(copied.ok ? 'Diagnostic bundle copied.' : copied.message, copied.ok ? 'success' : 'error', 2500);
        } catch (error) {
          showToast('Could not copy diagnostic bundle: ' + (error instanceof Error ? error.message : String(error)), 'error', 3000);
        } finally {
          copyDiagnosticBundleBtn.disabled = false;
        }
      });

      modalCloseBtn.addEventListener('click', () => {
        closeModal();
      });

      modalBackdrop.addEventListener('click', () => {
        closeModal();
      });

      // Prevent closing modal when clicking inside it
      fullResultsModal.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      // Tab switching in modal
      tabButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
          const tabName = event.currentTarget.dataset.tab;
          setModalActiveTab(tabName);
          // Load tab content
          loadModalTab(tabName);
        });
      });

      // Keyboard escape to close modal
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !fullResultsModal.hidden) {
          closeModal();
        }
      });

      document.querySelector('#refresh-runs').addEventListener('click', (event) => {
        run(event.currentTarget, '/api/runs', { auth: true }).then(({ payload, response }) => {
          if (response.ok) renderRunsList(payload);
        });
      });

      document.querySelector('#cancel-run').addEventListener('click', (event) => {
        const runId = runIdInput.value.trim();
        if (!runId) {
          setOutputMetadata('idle');
          setResponseSummary(null);
          setOutputBody('Submit a run or enter a run ID first.');
          setState('Cancel needs a run ID.', 'bad');
          return;
        }
        stopPolling();
        run(event.currentTarget, runUrl(runId, '/cancel'), { method: 'POST', auth: true });
      });

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        
        // Check validation state before allowing submission
        if (!validationState.isValid) {
          setOutputMetadata('failed');
          setResponseSummary(null);
          setOutputBody('Task validation is required before starting a run. Please click "Validate task" first and ensure all checks pass.');
          setState('Validation required', 'bad');
          return;
        }
        if (piAdapterValidationState === 'failed') {
          setOutputMetadata('blocked');
          setOutputBody('Submission blocked because the latest Pi adapter inference check failed. Run Test Inference again after fixing model/provider routing.');
          setState('Pi adapter validation required', 'bad');
          return;
        }
        
        const repoUrl = String(repoUrlInput.value || '').trim();
        if (repoUrl) {
          addRepoToRecent(repoUrl);
        }
        const button = document.querySelector('#submit');
        button.disabled = true;
        stopPolling();
        runIdInput.value = '';
        updateCancelRunButtonState();
        clearRunFollowThrough();
        setOutputMetadata('submitting');
        setResponseSummary(null);
        setOutputBody('Submitting run request...');
        setState('Contacting the controller...');
        const idempotencyKey = createRequestId();
        const submittedBody = requestBody(idempotencyKey);
        apiRequest('/api/runs', { method: 'POST', auth: true, body: submittedBody, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })
          .then(({ payload, response }) => {
            if (response.ok && payload && typeof payload.id === 'string') {
              activateSubmittedRun(payload, response.status, false);
            }
          })
          .catch(async (error) => {
            if (error instanceof RequestTimeoutError) {
              const recovered = await recoverSubmittedRunAfterTimeout(submittedBody);
              if (recovered) return;
            }
            setOutputMetadata('failed');
            setResponseSummary(null);
            setOutputBody(sanitizeOutput(error instanceof Error ? error.message : String(error)));
            setState('Request could not be sent.', 'bad');
          })
          .finally(() => {
            button.disabled = false;
          });
      });

      function activateSubmittedRun(payload, responseStatus, recovered) {
        runIdInput.value = payload.id;
        setOutputMetadata(payload.status || 'queued', payload.id);
        setResponseSummary(payload);
        setOutputBody(summarizedResponseBody('/api/runs', 'POST', responseStatus, payload));
        setState(recovered ? 'Run submitted; recovered run id after request timeout.' : 'Run submitted.', 'ok');
        updateCancelRunButtonState();
        showRunLinks(payload.id);
        activeRunView = 'status';
        loadRunsList({ preserveOutput: true });
        pollRun(payload.id, { preserveFirstOutput: true });
      }

      async function recoverSubmittedRunAfterTimeout(submittedBody) {
        try {
          const result = await apiRequest('/api/runs', {
            method: 'POST',
            auth: true,
            body: submittedBody,
            preserveOutput: true,
            timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          });
          if (result.response.ok && result.payload && typeof result.payload.id === 'string') {
            activateSubmittedRun(result.payload, result.response.status, true);
            return true;
          }
        } catch {
          // Keep the original timeout as the user-visible error.
        }
        return false;
      }
      
      // Issues tab handlers
      const loadIssuesBtn = document.querySelector('#load-issues-btn');
      const issuesList = document.querySelector('#issues-list');
      const issuesError = document.querySelector('#issues-error');
      const taskPrompt = document.querySelector('#task-prompt');
      const submitTab = document.querySelector('[data-tab="submit"]');

      loadIssuesBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        const repoUrl = issuesRepoUrlInput.value.trim();
        
        if (!repoUrl) {
          showIssuesError('Please enter a repository URL');
          return;
        }

        loadIssuesBtn.disabled = true;
        issuesList.innerHTML = '<div class="issues-loading">Loading issues...</div>';
        issuesError.hidden = true;

        try {
          const result = await apiRequest('/api/github-issues', {
            method: 'POST',
            auth: true,
            body: { repoUrl },
            timeoutMs: ISSUE_REQUEST_TIMEOUT_MS,
            preserveOutput: true,
          });
          const response = result.response;
          const payload = result.payload;

          if (!response.ok) {
            let errorMessage = 'Failed to fetch issues';
            if (payload && typeof payload === 'object') {
              errorMessage = payload.detail || payload.error || payload.title || errorMessage;
            } else if (payload) {
              errorMessage = String(payload);
            }
            showIssuesError(errorMessage);
            issuesList.innerHTML = '<div class="issues-list-empty">No issues found</div>';
            setOutputMetadata('failed');
            setResponseSummary(null);
            setOutputBody(JSON.stringify({
              method: 'POST',
              path: '/api/github-issues',
              status: response.status,
              error: stripControlSequences(errorMessage),
            }, null, 2));
            setState('Issue load failed.', 'bad');
            return;
          }

          const issues = payload;
          if (!Array.isArray(issues) || issues.length === 0) {
            issuesList.innerHTML = '<div class="issues-list-empty">No issues found with label "kaseki-agent"</div>';
            setOutputMetadata('ok');
            setResponseSummary({ status: 'ok' });
            setOutputBody(JSON.stringify({
              method: 'POST',
              path: '/api/github-issues',
              status: response.status,
              response: {
                repoUrl,
                issueCount: 0,
                issues: [],
              },
            }, null, 2));
            setState('No matching issues found.', 'ok');
            return;
          }

          issuesList.replaceChildren();
          addRepoToRecent(repoUrl);
          setOutputMetadata('ok');
          setResponseSummary({ status: 'ok' });
          setOutputBody(JSON.stringify({
            method: 'POST',
            path: '/api/github-issues',
            status: response.status,
            response: {
              repoUrl,
              issueCount: issues.length,
              issues: issues.slice(0, 5).map((issue) => ({
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
              })),
            },
          }, null, 2));
          setState('Issues loaded.', 'ok');
          issues.forEach(issue => {
            const item = document.createElement('button');
            item.className = 'issues-list-item';
            item.type = 'button';
            
            const numberEl = document.createElement('div');
            numberEl.className = 'issues-list-item-number';
            numberEl.textContent = '#' + issue.number;
            
            const titleEl = document.createElement('div');
            titleEl.className = 'issues-list-item-title';
            titleEl.textContent = issue.title;
            
            const createdDate = new Date(issue.created_at);
            const daysAgo = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
            const metaEl = document.createElement('div');
            metaEl.className = 'issues-list-item-meta';
            metaEl.textContent = daysAgo === 0 ? 'Today' : daysAgo + ' days ago';
            
            item.append(numberEl, titleEl, metaEl);
            item.addEventListener('click', () => {
              const body = issue.body || '(No description)';
              const submitRepoUrl = normalizeRepoUrlForSubmit(repoUrl);
              const issueUrl = issue.html_url || (submitRepoUrl + '/issues/' + issue.number);
              taskPrompt.value = [
                'GitHub issue #' + issue.number + ': ' + issue.title,
                issueUrl,
                '',
                body,
              ].join('\n');
              repoUrlInput.value = submitRepoUrl;
              repoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
              addRepoToRecent(submitRepoUrl);
              // Switch to Submit Task tab
              submitTab.click();
              // Scroll to task prompt
              taskPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setState('Issue #' + issue.number + ' copied into the task prompt.', 'ok');
            });
            
            issuesList.appendChild(item);
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          showIssuesError('Error: ' + errorMsg);
          issuesList.innerHTML = '<div class="issues-list-empty">Failed to load issues</div>';
          setOutputMetadata('failed');
          setResponseSummary(null);
          setOutputBody(sanitizeOutput('Issue load failed: ' + errorMsg));
          setState('Issue load failed.', 'bad');
        } finally {
          loadIssuesBtn.disabled = false;
        }
      });

      function showIssuesError(message) {
        issuesError.textContent = message;
        issuesError.hidden = false;
      }

      // Pre-fill issues repo URL with current task repo if available
      repoUrlInput.addEventListener('change', () => {
        const repoUrl = repoUrlInput.value.trim();
        if (repoUrl && !issuesRepoUrlInput.value) {
          issuesRepoUrlInput.value = repoUrl;
        }
      });

      loadRunsList({ preserveOutput: true });
    </script>
    <div id="toast-container" class="toast-container" aria-live="polite" aria-atomic="true"></div>
  </body>
</html>
`;

export function createWebRouter(): Router {
  const router = Router();

  // Browsers request this automatically; keep it public and out of auth-failure logs.
  router.get('/favicon.ico', (_req, res) => res.status(204).end());
  router.get(['/', '/ui'], (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'");
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(controllerPage);
  });
  return router;
}
