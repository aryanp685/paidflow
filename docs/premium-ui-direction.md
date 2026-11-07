# Paidflow visual direction — “Calm control”

**Status: design proposal, not an implemented redesign.** Paidflow's current marketing page is illustrative; its workspace and product features must not be represented as shipped. This brief sets a direction for a later, separately scoped implementation.

## Positioning

A confident, precise workspace for Indian businesses managing receivables. Feel like a well-designed financial tool, not a crypto dashboard: editorial clarity, restrained depth, useful information, generous space. Avoid stock finance imagery, neon gradients, exaggerated glass effects and claims of guaranteed payment or security.

## Colour and type

| Role | Colour | Usage |
| --- | --- | --- |
| Ink | `#101827` | Main text, dark hero |
| Deep navy | `#11192C` | Hero surface |
| Charcoal | `#252D3B` | Secondary dark surfaces |
| Warm paper | `#F8F6F1` | Main page background |
| Card | `#FFFFFF` | Content surfaces |
| Indigo | `#4E49A8` | Primary actions, links on light backgrounds |
| Pale violet | `#C9C3F4` | Dark-background accents, ornament |
| Slate | `#4B5563` | Supporting text on paper |
| Fine border | `#DADDE4` | Card borders and separators |

Use Plus Jakarta Sans for headings and interface, already present in the project; JetBrains Mono sparingly for rupee amounts, short metadata and data labels. Long-form text should remain highly readable. Target WCAG AA contrast (4.5:1 normal text, 3:1 large text and important UI boundaries); validate actual colour pairs and states during implementation, not just these swatches. Never communicate status by colour alone.

## Composition

- **Hero:** dark navy, one specific benefit-led headline on the left, short supporting copy and one primary action; secondary text link. On the right, a Three.js scene inspired by the movement of an invoice through a payment workflow: a softly lit dimensional ledger plane, restrained orbiting lines and a few abstract receipt tiles. It is an accent, not the interface, and must not imply that unbuilt features exist. Provide a static poster fallback.
- **Product narrative:** light paper background, clear section rhythm, editorial headings. Use realistic but explicitly illustrative UI examples with Indian rupee formatting and no invented customer data. Explain benefits without presenting proposed capabilities as available.
- **Information surfaces:** generous whitespace, fine borders, 12–16px radii, minimal shadows; align numbers consistently and show labels, timestamps and meaningful empty/error states. Dense tables should prioritize scanability over ornament.
- **Navigation and forms:** accessible, quiet and familiar. Authentication screens must remain fast, focused and free of 3D or cinematic transitions. Never trade clear validation or keyboard access for animation.

## Motion and technical direction

- **Three.js:** use only for a purposeful marketing hero, dynamically loaded after the essential content. Limit geometry, textures, pixel ratio and frame rate; suspend when offscreen/hidden and dispose of resources. A static image/CSS fallback covers reduced motion, no WebGL and constrained devices. No WebGL in the authenticated workspace by default.
- **Framer Motion:** subtle component state changes and short, interruptible transitions (roughly 150–250ms). Maintain focus and avoid layout shifts.
- **GSAP:** reserved for one or two carefully justified, progressive-enhancement scroll sequences, not basic hover states. Avoid scroll hijacking, pinned content that blocks navigation, and permanent motion loops.
- Respect `prefers-reduced-motion`: static hero, immediate transitions and no parallax. Check keyboard, screen reader, contrast, zoom and touch targets. Responsive layout should start at 320px, collapse the hero before text becomes cramped, and avoid horizontal scrolling. Validate with real devices and performance budgets before shipping; do not claim performance from the concept alone.

## Implementation gate

Framer Motion and GSAP are already declared dependencies; Three.js is not. This is only a visual/interaction brief: no Three.js dependency was installed, no 3D scene was built, and no product feature was promised. Before a future implementation, approve its scope, assess Three.js bundle/performance and security impact, and test accessibility, actual contrast and responsive behavior.
