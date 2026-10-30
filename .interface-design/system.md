# Pulse design system (interface-design + better-* skills)

**Who:** a salon or clinic owner, standing between clients, checking the phone or front-desk laptop for 30 seconds.
**Verb:** see what needs me, act in one click, see money won.
**Feel:** calm stone counter in a quiet salon: warm greys, one deep green accent, ink text. Dense but unhurried.

## Tokens (app/public/stone.css)
- Surfaces: ground #e8e6e1 → panel #f6f5f2 → raise #fbfaf8; inputs inset (nest #efede8). Light mode = shadow for depth, no extra colours.
- Text, 4 levels: ink #1e1d1b · 2 #4a4741 · meta #7c776e · disabled 50% meta.
- Accent: green #2e6a52, ~10% of the screen; status colours only for status.
- Borders: low-contrast lines (#dcd9d2), never harsh.
- Depth strategy: subtle shadows only.

## Type
- Geist for UI, Newsreader serif for page titles only, Geist Mono for codes.
- Scale (rem): caption .75 · label .8125 · body .875 · lead 1 · h3 1.0625 · h2 1.375 · h1 2. Line-height: display 1.1, headings 1.25, body 1.5.
- Headings ≥24px: -0.015em. Uppercase labels: 0.05em, 11px, weight 600.
- Every number (KPIs, prices, table numeric columns): tabular-nums.
- Weight ≥400 below 18px. Headings balanced, paragraphs pretty-wrapped, prose capped at 70ch.

## Patterns
- Prefer cards, compact tables and charts over prose. A card = name + status pill + 3 numbers + one bar. Details open on click.
- One focal point per view (the hero KPI or the briefing).
- Spacing base 4px: 4/8/12/16/24/32.
- Radius: 8 controls · 12 cards · 16 modals.
