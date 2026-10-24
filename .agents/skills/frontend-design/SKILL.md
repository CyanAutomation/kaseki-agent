---
name: frontend-design
activation: explicit
description: Opt-in guidance for creating focused, interactive HTML prototypes, UI mockups, and visual demos.
tags: [design, prototypes, frontend, accessibility, html]
relatedSkills: []
---

# Frontend Design Prototypes

Use this skill only when the user asks for a prototype, mockup, visual demo, or
design exploration. It is a lightweight guide for work in the current project;
it does not prescribe a separate design system or require unavailable assets.

## Scope

- Build a prototype that makes the requested flow or visual idea understandable.
- Reuse the project's framework, design tokens, components, and conventions when
  they exist.
- Keep prototype work separate from production application changes unless the
  user asks for production implementation.
- Ask a focused question only when a missing choice would materially change the
  result. Otherwise, make a reasonable assumption and mention it in the handoff.

## Workflow

1. Inspect the relevant app entry point, existing styles, and any references the
   user supplied.
2. Identify the primary screen, content hierarchy, and interactions the user
   needs to evaluate.
3. Build the smallest complete prototype that demonstrates those decisions.
   Use realistic sample content and make placeholders visibly identifiable.
4. Make the layout usable at the target viewport sizes. Use semantic HTML,
   keyboard-operable controls, visible focus, labels, and sufficient contrast.
5. Respect reduced-motion preferences when adding animation. Keep animation
   purposeful and avoid making it necessary to understand the interface.
6. Run the relevant project checks. If a browser preview is available, inspect
   the main viewport and exercise the primary interactions; otherwise state
   which checks were run.
7. Summarize the changed files, the interactions demonstrated, and any
   remaining assumptions.

## Assets and factual content

- Prefer assets and brand material provided by the user or already present in
  the project.
- Do not invent official logos, product screenshots, specifications, or claims.
  Label placeholder content clearly.
- Use remote images or research only when the user requests them or they are
  needed for the requested result. Identify externally sourced material in the
  handoff.
- Do not upload project files or private assets to third-party services.

## Design review

Before delivery, check that:

- The main action and page purpose are clear at a glance.
- Text and controls remain readable at the target viewport.
- Interactive elements have visible states and work with a keyboard.
- The result follows the existing project style unless a different direction
  was requested.
- Any known limitations are stated without overstating what was verified.
