# Visual System

## Reference reading

The supplied Accomy references combine two material families:

- A scenic hotel hero uses cool dark glass for the floating nav, segmented mode control, and large search dock. Strong photography remains visible beneath a dark scrim. White text, oversized rounded shells, fine bright edges, and indigo selection states create the hierarchy.
- A hotel-results page uses pale frosted overlays for forms, location menus, autocomplete lists, and a dual-month calendar. The page behind is muted and slightly defocused. Panels are milky, softly tinted, lightly outlined, and separated by quiet dividers.

## Token starter

Treat these as starting ranges, then tune against the actual background.

| Token | Immersive dark glass | Soft light glass |
|---|---:|---:|
| Surface | `rgba(18, 24, 34, .42–.62)` | `rgba(245, 248, 252, .68–.88)` |
| Blur | `18–32px` | `16–28px` |
| Saturation | `115–135%` | `105–125%` |
| Border | `rgba(255,255,255,.38–.68)` | `rgba(255,255,255,.60–.88)` |
| Inner highlight | `rgba(255,255,255,.10–.22)` | `rgba(255,255,255,.35–.58)` |
| Shadow | `0 18px 50px rgba(0,0,0,.28)` | `0 18px 45px rgba(36,48,70,.14)` |
| Primary radius | `28–48px` | `20–28px` |
| Control radius | `14–999px` | `10–16px` |

## Color and type

- Accent: indigo/violet around `#5B55F6`; hover may shift toward `#4B46E5`.
- Dark ink: near-black navy `#080B1C`, not pure black when placed on cool glass.
- Light ink: white or cool off-white; secondary copy uses 70–78% opacity.
- Use a clean neo-grotesk sans. Favor medium weights for controls and strong semibold/bold display text.
- Use an 8-point spacing base. Common gaps: 8, 16, 24, 32; shell padding: 24–36.

## Depth model

1. **Environment:** full-bleed image or product page.
2. **Atmosphere:** global/local scrim controlling contrast.
3. **Primary glass:** nav, search dock, modal, calendar.
4. **Nested control:** input, chip, segmented option.
5. **Active material:** saturated accent, dark CTA, focus ring.

Do not collapse levels 2–4 into one uniform translucent gray.

## State language

- Hover: slightly brighter edge and 2–4% denser fill.
- Focus: 2px accent ring with offset; retain the material border.
- Active/selected: accent fill or accent outline plus stronger text.
- Disabled: reduce contrast, not just opacity; keep labels readable.
- Error: warm red edge and helper copy outside the translucent input where possible.
- Loading: preserve geometry; use a restrained shimmer or spinner without changing layout.
