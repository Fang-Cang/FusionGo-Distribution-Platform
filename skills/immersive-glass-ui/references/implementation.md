# Web Implementation

## CSS foundation

```css
:root {
  --glass-accent: #5b55f6;
  --glass-radius-shell: 32px;
  --glass-radius-control: 16px;
}

.glass {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .62);
  background: rgba(241, 246, 251, .74);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .48),
    0 18px 45px rgba(30, 44, 68, .16);
  backdrop-filter: blur(22px) saturate(118%);
  -webkit-backdrop-filter: blur(22px) saturate(118%);
}

.glass--dark {
  color: #fff;
  border-color: rgba(255, 255, 255, .5);
  background: rgba(18, 25, 35, .5);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .18),
    0 22px 56px rgba(0, 0, 0, .3);
}

@supports not ((backdrop-filter: blur(1px)) or
  (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: rgb(236 242 248 / 96%); }
  .glass--dark { background: rgb(22 29 40 / 94%); }
}

@media (prefers-reduced-motion: reduce) {
  .glass, .glass * {
    scroll-behavior: auto;
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
  }
}
```

## Implementation order

1. Apply the background image and responsive crop.
2. Add a gradient/scrim pseudo-element where copy or controls overlap high-detail regions.
3. Add the glass surface with fallback background first.
4. Add backdrop blur and saturation.
5. Add border, inset highlight, and outer shadow.
6. Add nested controls with less blur and slightly denser fills.
7. Add states, keyboard behavior, responsive layout, and tests.

## Responsive behavior

- At narrow widths, turn a horizontal search dock into stacked fields and make the CTA full width.
- Collapse secondary nav links into an accessible menu; do not compress them until unreadable.
- Let large modals become edge-aware sheets with 16px viewport margins.
- Switch dual-month calendars to one month on mobile.
- Cap large surfaces with `max-width` and keep 16–24px page gutters.

## Common failure fixes

- **Looks foggy:** lower surface opacity before increasing blur; restore a sharp highlight edge.
- **Looks plastic:** reduce border brightness, add environmental tint, and soften the shadow.
- **Looks flat:** increase separation between the scrim, glass fill, inset highlight, and shadow.
- **Text flickers in contrast:** add a local gradient/scrim or make the surface more opaque.
- **Performance stutters:** reduce the number and area of backdrop-filter layers; avoid nested animated blur.
