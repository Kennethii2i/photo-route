> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# UX / visual principles (not a final screen design)

Status: design principles only; layout and visual tokens remain OPEN.

## Guiding experience

User should understand where photos were taken without fighting dense, permanently visible side panels. **Map-first** is a candidate default. A small circular photo thumbnail at a spot (inspired by journey-journal interfaces) is a candidate marker style, not a fixed UI contract. The user can later switch map layers/views.

## Design principles

1. **Spatial context first, not spatial-only.** Map plus accessible textual photo/Visit alternative.
2. **Progressive disclosure.** Show only important information initially; click/select for photo details.
3. **Uncertainty is visible.** Missing GPS, timezone unknown, suspect GPS, failed thumbnail, corrected coordinates are distinct states; no false precision.
4. **No duplication.** Avoid drawing linked Photo and Visit twice as if they were separate unique travels; layer toggles and explicit counts.
5. **Consistent interaction.** Map selection, photo detail, import status and saved Trip navigation share patterns.
6. **Device adaptability.** On mobile, avoid forced permanent map-and-photo split; on desktop explore side panels or overlays only after testing.
7. **Accessibility.** Keyboard operable list and selection, accessible labels, visible focus, text equivalents, contrast target WCAG 2.2 AA, reduced motion.
8. **Information density is controllable.** Distinct Photo and Visit layers; future zoom clustering; temporary cluster must never change persistent Visit.
9. **Privacy by design.** No unrequested location permission, clear map-provider notice, visible export sensitivity warning.

## Phase 1 UI minimum

- Trip chooser/create and a visible unclassified photo destination.
- Local file import with progress, result summary, missing metadata/thumbnail warnings.
- Map with photo capture markers for usable GPS and a non-map list of all imported photos (including unplaced ones).
- Selecting a marker identifies the correct Photo and can open a compact photo detail showing thumbnail and source time/GPS status; placeholder if thumbnail missing.
- Controls for export and import; explicit display when imports are rejected due to same Trip ID conflict.
- Loading, empty, error, map-unavailable and storage-full states.
- No mandatory route polyline and no 'travelled path' claim.

## Future UI behaviors, not Phase 1 acceptance

- Two independently selectable Photo/Visit map modes or layer visibility controls.
- Separate MapLibre source-level clustering and expansion behavior. Distinguish counts of Photos vs Visits.
- Access to several Photos at identical coordinates through a list or stack, even at max zoom.
- Optional representative thumbnail circle marker, density-aware fallback to pin/count.
- Photo→Visit creation and map→Visit creation workflows with independent location.

## Design tokens (OPEN)

Palette, typography, spacings, breakpoint thresholds, exact card sizes, marker visuals, animations and whether photos appear in a bottom sheet or a floating preview should be decided after basic usability observation. Codex must not present any provisional CSS as a product-owner-approved final design.
