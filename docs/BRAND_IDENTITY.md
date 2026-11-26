# Smart Bioinformatics AI — Brand Identity

**Product name:** Smart Bioinformatics AI (always exactly this, including the "AI")
**Assistant name:** S Bio Assistant
**Design system:** "Precision Instrument Bench" — M7.4.1 `web-platform/public/css/tokens.css`
**Status:** Original artwork, authored for this project. No external font, image, icon library or CDN is required by any asset in this set.

---

## 1. Design rationale

The identity is built like an instrument marking, not like a consumer-tech mascot. The palette is the existing bench palette: cool porcelain surfaces, deep ink/slate text, one restrained teal accent, and amber reserved strictly for caution. The mark is a single geometric ribbon with a bifurcation — precise, quiet, and reproducible at favicon size.

The core glyph reads on two levels:

- an **S** for *Smart* — one continuous ribbon with round terminals;
- a **two-tip clade** at the head of the S — a phylogenetic bifurcation, and the two bowls of a **B** for *Bio*. It is an S–B monogram built from branching-line geometry rather than from overlaid letterforms.

The ribbon is the "sequence spine"; the fork is the point where one lineage resolves into two. No double helix, glow, brain, robot, atom or stock illustration is used.

### 1.1 Concept exploration

| # | Concept | Description | Outcome |
| --- | --- | --- | --- |
| 1 | **Sequence ladder** | A tile containing stacked base-pair rungs plus a fork at one end. | Rejected. At 16 px the rungs merged into a grey slab and the mark read as a generic barcode / DNA ladder. |
| 2 | **S–B ligature** | Two overlapping letterforms sharing a stem, with open counters. | Rejected. The counters collapsed below ~24 px and the result resembled a generic technology monogram. |
| 3 | **Bifurcating ribbon** *(chosen)* | A single bold S ribbon whose head splits into a two-tip clade. | Chosen. The silhouette survives 16 px, the fork is unmistakably biological, and the geometry is original and simple to maintain. |

Concept 3 won because it is the only one that keeps **one dominant shape** at every required size while still carrying the sequencing/phylogeny meaning. Complexity was removed, not added.

---

## 2. Geometry and construction

All mark geometry is authored in a **64 × 64 master grid** and reused verbatim in every variant.

- **Tile:** `<rect x="3" y="3" width="58" height="58" rx="13"/>` — radius follows the `--radius-4` (6 px) family scaled to the mark; the tile is a "bench plate", not a pill.
- **Spine (S ribbon):**
  `M42 19 C42 13 22 13 22 23 C22 32 42 30 42 40 C42 50 22 50 22 45`
  Three cubic segments, `stroke-width="7"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`.
- **Clade (bifurcation):**
  `M42 19 32 13 M32 13 25 7 M32 13 39 7`
  `stroke-width="4.2"`, same round caps/joins. The clade is intentionally offset left of the spine terminal so it does not merge with the upper bowl of the S at small sizes.
- The clade stroke is lighter than the spine (4.2 vs 7 units) so the hierarchy reads as "spine → branch" at every scale.
- **Horizontal lockups** place the same geometry inside `transform="scale(.75)"`, giving a 48-unit-tall field. The wordmark starts at `x="58"`, baseline `y="34"`.
- **Favicon** inverts the tile (porcelain plate, 4-unit teal keyline, dark teal glyph) so it remains visible on both light and dark browser chrome while staying opaque.
- No filters, gradients, masks, clipping paths, embedded raster data or external references are used. Every shape is an editable path or rectangle; colours are literal token values so the files render identically without CSS.

### 2.1 Clear space

Use the **tile height** as the unit `X`. Keep clear space of at least **`X` on all sides** of the compact mark and the primary lockup — i.e. a gap equal to the full symbol height. For the horizontal lockup, `X` = 48 units in the source viewBox.

Never place type, rules, borders or other graphics inside that zone. The only permitted exception is the intentional gap between the symbol and the wordmark inside the lockup, which is fixed at `x="58"` in the 48-unit field.

---

## 3. Variants and intended contexts

| File | Context |
| --- | --- |
| `web-platform/public/brand/sbio-logo-primary.svg` | Full-colour horizontal wordmark. Default for page headers, the workspace shell, slide titles and light-background documents. |
| `web-platform/public/brand/sbio-symbol.svg` | Compact symbol only. Available for future use in narrow headers, table/tool badges and app tiles; not referenced by the shipped public pages. |
| `web-platform/public/brand/sbio-logo-mono.svg` | Single-colour lockup using `currentColor`. Available for future use in one-colour print, stamps and monochrome exports; not referenced by the shipped public pages. Set `color` on the host element. |
| `web-platform/public/brand/sbio-logo-dark.svg` | Light artwork (`--ink-inverse` tile and text, `--focus-on-dark` accent). Dark footers, dark hero panels, dark assistant surfaces. |
| `web-platform/public/brand/sbio-assistant.svg` | S Bio Assistant avatar. Chat message lists, chat header, welcome card, typing indicator. |
| `web-platform/public/favicon.svg` | Browser tab / bookmark icon. Opaque, legible on light and dark chrome. |

Informative SVGs carry `role="img"` and an `aria-label` (`"Smart Bioinformatics AI"` for the mark, `"S Bio Assistant"` for the avatar). When an asset is purely decorative next to a visible text label, mark the host element `aria-hidden="true"` instead of stacking announcements.

---

## 4. Minimum sizes

| Asset | Absolute minimum | Recommended |
| --- | --- | --- |
| Favicon | 16 × 16 px | 32 × 32 px, 48 × 48 px |
| Compact symbol | 16 × 16 px (only with a plain background) | 24–32 px |
| Assistant avatar | 24 × 24 px | 32 px in chat header, 48 px in welcome card |
| Primary / dark / mono lockup | 24 px rendered height (~210 px wide) | ~28 px header height (~245 px wide) |

Below 16 px no variant is guaranteed legible; use a text label instead. The lockup must **never** be scaled down by narrowing only its height — scale uniformly. At the 28 px header height the wordmark text renders around 17 px, which is the intended header size.

---

## 5. Colour mapping

| Token | Value | Use in this identity |
| --- | --- | --- |
| `--doc-bg` | `#eef2f4` | Porcelain; light glyph on teal tile, favicon plate. |
| `--surface` | `#ffffff` | Work surface behind the primary lockup. |
| `--ink` | `#16252e` | Primary wordmark text on light surfaces. |
| `--ink-inverse` | `#f4f8f9` | Dark-variant tile and wordmark text. |
| `--accent` | `#176b6e` | Assistant avatar tile; secondary teal. |
| `--accent-strong` | `#0d5254` | Primary tile, "AI" word, favicon keyline/glyph. |
| `--focus-on-dark` | `#a9d8d5` | "AI" word in the dark lockup. |
| `--caution` | `#8a5a12` | **Never in the logo.** Caution/mock states only. |
| `--success` / `--danger` / `--info` | `#1d6b54` / `#a23b31` / `#2b5b6b` | Status chips only, never brand marks. |

No other hue is introduced. Teal is the only brand accent; amber is never decorative.

---

## 6. Typography

The wordmark uses the project's local UI stack — `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (`--font-ui`). No webfont is loaded.

- Source `font-size="29"` in the 48-unit field; baseline at `y="34"`.
- Weight `650` (`--fw-semibold`) for "Smart Bioinformatics"; weight `750` (`--fw-bold`) for "AI".
- Letter-spacing `-0.7` units, equivalent to the `--tracking-tight` setting (`-.025em`).
- The wordmark text is exactly **Smart Bioinformatics AI**. Do not substitute "Toolkit", abbreviate to "SB AI", or insert a hyphen.
- "AI" is the only word in accent colour. In mono it inherits `currentColor` and is distinguished by weight only.
- The wordmark is typeset, not hand-drawn paths: it stays crisp at any size and remains editable. The system stack guarantees no external font dependency.

---

## 7. Iconography principles

- One silhouette first, detail second. If a stroke disappears at 16 px, remove it.
- Geometry is derived from a grid; radii are shallow (`--radius-1`…`--radius-4`, i.e. 2–6 px equivalents), never pills everywhere.
- Hairlines carry structure; no glows, gradients, bevels, 3D extrusions, drop shadows or "AI" sparkles.
- Round caps are used only on the spine and clade; tile corners use a single radius.
- Marking is flat: one colour per surface, no duplicated outline treatment.
- Decorative icons elsewhere in the product should use the same stroke logic (geometric, hairline, token-coloured) but must not reuse or distort the brand glyph as a generic icon.

---

## 8. Button and status guidelines

- **Primary button:** `--accent-strong` (`#0d5254`) fill with `--ink-inverse` text; hover darkens within the teal family only.
- **Secondary button:** transparent/`--surface` with `--line-strong` hairline and `--ink` text; hover tint `--accent-tint`.
- **Quiet button / link:** `--ink` or `--accent` text, no filled plate.
- **Focus:** 3 px `--focus` (`#0d5254`) ring with 2 px offset; on dark surfaces use `--focus-on-dark` (`#a9d8d5`).
- **Status chips:** text-first. `--success` verified/complete, `--info` informational, `--caution` mock/limited/caution, `--danger` error. Colour is never the only signal — repeat the state in words or a chip.
- The logo is never used as a button fill, a progress indicator, a loading spinner or a status badge. Do not encode state by recolouring the mark outside the variants above.

---

## 9. Assistant identity

**S Bio Assistant** is an interface role, not a separate mascot.

- The avatar reuses the exact spine and clade paths from `sbio-symbol.svg`. Only the plate changes: a `--accent` (`#176b6e`) circle with a faint porcelain hairline ring marks the interactive assistant surface.
- No face, eyes, robot, headset, chat bubble or sparkle is added. Derivation from the main symbol must be obvious at a glance.
- Use `"S Bio Assistant"` as the accessible name and in any visible label. Do not shorten to "Assistant", "Bio Bot" or "SBA" in UI copy.
- Placement: 24 px minimum in message lists, 32 px in the conversation header, 48 px in the welcome/empty state. Keep the same clear-space rule as the compact symbol.
- The assistant uses the dark lockup on its dark/teal surface and the primary lockup on light surfaces; it never uses the mono lockup as a chat identity.

---

## 10. Light and dark usage

| Surface | Use |
| --- | --- |
| `--doc-bg` `#eef2f4`, `--surface` `#ffffff`, `--surface-2` `#f5f8f9` | `sbio-logo-primary.svg`; `sbio-symbol.svg`; `sbio-assistant.svg`. |
| `--ink` `#16252e` footer / dark panels | `sbio-logo-dark.svg`; `sbio-symbol.svg` if a compact mark is needed. |
| `--accent` `#176b6e` / `--accent-strong` `#0d5254` assistant surface | `sbio-logo-dark.svg`; `sbio-assistant.svg`. |
| Any, especially browser chrome | `favicon.svg` — its opaque keylined plate works on both light and dark backgrounds; it is never a transparent-only white mark. |
| One-colour / print | `sbio-logo-mono.svg` with `color` set to the required ink. |

Never place the primary lockup on a dark surface or the dark lockup on a light surface: the tile/glyph contrast relationship is reversed and the plate stops reading as a plate.

---

## 11. Prohibited treatments

- Gradients, glows, neon, blur, drop shadows, bevels, 3D or glass effects.
- Replacing the glyph with a brain, robot, atom, generic double helix, network node cloud, sparkle or any stock/AI-cliché imagery; no emoji.
- Unmodified icon-library symbols or third-party logos.
- Stretching, skewing, rotating the tile independently, changing stroke weights, removing the clade, or rearranging the lockup.
- Recolouring outside the token table; adding amber to the brand mark; using arbitrary teals.
- Adding "Toolkit" or any other word to the wordmark, or renaming S Bio Assistant.
- Rasterising these assets for delivery, embedding base64 images, or loading external fonts/images/CDNs.
- Placing the mark inside a pill, circle or shadowed card unless that shape is the specified assistant avatar plate.
- Using the logo as a background texture, watermark, wallpaper or interactive control.

---

## 12. Accessibility and contrast

All values are calculated against the token palette:

| Pairing | Ratio | Use |
| --- | --- | --- |
| `--ink` `#16252e` on `--doc-bg` `#eef2f4` | ≈ 13.7:1 | Primary wordmark on porcelain |
| `--accent-strong` `#0d5254` on `--doc-bg` `#eef2f4` | ≈ 8.0:1 | "AI" word on porcelain; body text on light |
| `--ink-inverse` `#f4f8f9` on `--accent-strong` `#0d5254` | ≈ 8.0:1 | Glyph on primary tile |
| `--ink-inverse` `#f4f8f9` on `--accent` `#176b6e` | ≈ 5.4:1 | Glyph on assistant tile |
| `--ink-inverse` `#f4f8f9` on `--ink` `#16252e` | ≈ 14.5:1 | Dark wordmark on ink |
| `--focus-on-dark` `#a9d8d5` on `--ink` `#16252e` | ≈ 10.1:1 | "AI" word and focus on dark |
| `--caution` `#8a5a12` on `--doc-bg` `#eef2f4` | ≈ 5.1:1 | Caution text (never logo) |

Every text pairing exceeds WCAG AA 4.5:1; the mark's figure/ground pairings exceed 3:1 for non-text contrast. The mono variant inherits `currentColor`, so its contrast is exactly the contrast of the host text — set it only on surfaces that meet the same thresholds. The SVG files include `role="img"` and `aria-label`; they do not rely on colour alone to convey identity.

---

## 13. Verification record

All six SVGs were parsed with Python's `xml.etree.ElementTree` and rasterised with `resvg` at 16, 24, 32, 64 and magnified inspection sizes on porcelain, white, ink, teal and dark-teal backgrounds. The same six files were then loaded as external SVGs in a real browser proof sheet on light, dark and teal surfaces (`browser-proof-sheet.png`); all 22 image instances loaded with non-zero natural dimensions. Screenshots are stored in `web-platform/test-results/uiux/brand/`. The favicon was checked on both light and dark backgrounds; the assistant avatar was checked at 24 px against the teal assistant surface.
