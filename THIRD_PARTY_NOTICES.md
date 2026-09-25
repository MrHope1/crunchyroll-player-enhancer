# Attribution and research references

## Original userscript

This project originated as modifications to **Crunchyroll Auto Skip Intro/Outro, Fullscreen Video & Mouse Volume Control**, authored by **JRem**. The upstream userscript declares the MIT license. Its attribution is retained in the userscript metadata and project license.

- [Original source and license declaration](https://greasyfork.org/en/scripts/452891-crunchyroll-auto-skip-intro-outro-fullscreen-video-mouse-volume-control/code)

## Research inspiration

- [Crunchyroll Quality Fixer by retouching](https://gist.github.com/retouching/155e0556d29056fb59b4de824609f8b3): the approach of filtering DASH representations before playback. No source from the gist is bundled; this project's filtering implementation was written independently.
- [CrOptix](https://github.com/stratumadev/croptix): native-player integration and persistent quality controls. Its code is AGPL-3.0; no CrOptix source, player bundle or assets are included or relicensed here. This project implements its own manifest filtering and DOM menu additions.
- [Bitmovin Player API](https://cdn.bitmovin.com/player/web/8/docs/interfaces/core.playerapi.html) and [Shaka Player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html): quality-selection documentation consulted during research.

The runtime userscript has no third-party package dependencies. jsdom is a development-only dependency installed separately through npm; its license and dependency notices remain with those packages.
