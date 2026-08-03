---
name: immersive-glass-ui
description: Design, implement, or refine premium glassmorphism interfaces with convincing backdrop sampling, layered translucency, restrained blur, edge highlights, depth, and accessible interaction states. Use for web or app UI requests mentioning glass UI, glassmorphism, frosted glass, liquid glass, translucent panels, blurred navigation, floating search forms, modals, dropdowns, calendars, travel or hospitality interfaces, or when matching the Accomy-style visual language of immersive photographic hero screens and pale frosted overlay panels.
---

# Immersive Glass UI

Create glass as a material system, not as a transparency effect. Preserve legibility, hierarchy, and interaction clarity before adding atmosphere.

## Workflow

1. Inspect the product context, background, content density, platform, framework, and accessibility target.
2. Choose one material family:
   - Use **immersive dark glass** over photography, video, maps, or saturated artwork.
   - Use **soft light glass** for dialogs, calendars, dropdowns, command palettes, and data-heavy overlays.
   - Combine both only when the background and overlay layers require distinct depth levels.
3. Establish tokens before styling individual components. Read [visual-system.md](references/visual-system.md).
4. Build surfaces from back to front: background → scrim → glass shell → inner controls → selected states → foreground text.
5. Implement using the target stack. For CSS/Web implementations, read [implementation.md](references/implementation.md).
6. Verify the result at multiple viewport sizes and over both the brightest and darkest background regions.

## Non-negotiable Material Rules

- Make the backdrop visible through the surface, but never allow it to compete with text.
- Combine translucency, backdrop blur, a light edge, and a soft shadow. Missing any two produces a flat translucent card rather than glass.
- Use one dominant blur tier per depth level. Do not assign arbitrary blur values to every component.
- Tint glass toward its environment: cool gray-blue over landscapes; milky neutral or faint blue over light product pages.
- Use large radii and continuous silhouettes for primary shells; use smaller, related radii for nested controls.
- Reserve the saturated violet/indigo accent for selection, focus, links, primary values, and compact brand moments.
- Keep text and icons crisp. Never blur foreground content.
- Use a local scrim or stronger fill when the sampled background destroys contrast.
- Prefer thin inset highlights and subtle borders over thick white outlines.
- Keep motion short and material-like: opacity, translate, blur, and highlight shifts; avoid rubbery novelty animation unless requested.

## Component Construction

### Navigation and hero search

- Float the navigation inside the safe area with a pill silhouette.
- Use a wide photographic hero with a controlled dark scrim.
- Keep the headline solid and high contrast rather than translucent.
- Group mode selection and search fields into separate glass layers.
- Make the primary action visually denser and darker than adjacent fields.

### Dialogs, calendars, and dropdowns

- Place overlays above a dimmed or softly blurred page layer.
- Use pale glass with a mostly opaque fallback for dense forms.
- Separate rows using low-contrast dividers instead of individual heavy cards.
- Keep selected cells and chips unmistakable with accent fill or outline.
- Anchor popovers to their trigger and preserve predictable dismissal, focus trapping, and keyboard navigation.

### Lists and cards

- Use glass for the container, not every row.
- Let imagery remain saturated; apply blur only behind surfaces, not to the image asset itself.
- Use compact metadata, quiet dividers, and a consistent 8-point spacing rhythm.

## Accessibility and Performance

- Target WCAG AA contrast for normal text and visible focus indicators.
- Add `@supports` and non-blur fallbacks; never rely on `backdrop-filter` alone.
- Respect `prefers-reduced-motion`, forced colors, and increased contrast where supported.
- Limit large overlapping blur regions. Prefer one parent glass layer over many nested filters.
- Test scroll performance on mobile and reduce blur radius or surface area when necessary.

## Quality Gate

Reject or revise the result when:

- it reads as gray opacity rather than refractive/frosted material;
- text contrast changes unpredictably across the background;
- every card uses the same depth and visual weight;
- borders glow uniformly on all sides;
- nested blur creates muddy halos;
- active, hover, focus, disabled, loading, and error states are missing;
- mobile layout simply shrinks desktop controls;
- glass is used on dense tables or long-form reading without an opaque mode.

Deliver implementation plus a brief token summary and note any accessibility or browser fallback decisions.
