# fonts/

LVGL 4-bpp bitmap faces (`gc_plex_<px>.c`) rendered from **IBM Plex Sans**
(Regular 400 / SemiBold 600 / Bold 700) at the design handoff's true type ramp
— 14–40 px ASCII+punctuation (plus `° · — … ‹ ← →` — the arrows carry the §7
empty-mode swipe hints), and an 84 px digits-only hero face; Plex digits
are tabular by default, which is the handoff's hard requirement. The 15/16/20 px
faces merge the `⇅` (U+21C5) flip-direction glyph from DejaVu Sans (license: `DEJAVU-LICENSE.txt` in this directory), which Plex
lacks. Regenerate with `../../../tools/genfonts.sh` (needs node + curl; every
invocation is pinned there — the generated files are committed so builds never
need node). Licensing: IBM Plex Sans is © IBM Corp., SIL Open Font License 1.1
(`OFL.txt`, verbatim); DejaVu Sans is © Bitstream Inc. under the free DejaVu
Fonts license. These `.c` files are rasterized glyph data compiled into the
firmware, not a redistributed font binary carrying the reserved name "Plex" —
the OFL's reserved-font-name rule for modified (here: subset) fonts is
satisfied because no renamed font file is distributed, only rendered glyph
arrays (`gc_plex_*`) plus this attribution and the full license text.
