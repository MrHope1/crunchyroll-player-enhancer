# Crunchyroll Player Enhancer

A community userscript that extends Crunchyroll's existing player controls.

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. [Open the userscript](https://github.com/MrHope1/crunchyroll-player-enhancer/raw/refs/heads/main/crunchyroll-player-enhancer.user.js) and choose Install. Alternatively, copy its entire contents into a new userscript.
3. Disable older copies of this script and reload the Crunchyroll watch page once.

The maximum-quality hook must run in the page at document start. Browser and userscript-manager settings must allow userscripts on Crunchyroll.

## Features

- Automatically clicks available intro/credits skip controls.
- Adds speeds from **0.25× to 3×** inside the native speed menu while preserving voice pitch.
- Adds **Maximum quality — locked** above the native Quality options; enabled by default and remembered locally.
- Mouse-wheel volume in **5% steps**. **Alt** bypasses it; **Shift** toggles it.
- Fullscreen controls/cursor hide after **0.7 seconds** of inactivity. Open menus remain usable.
- No automatic page-fill or forced fullscreen.

Extra speed/quality menu entries, wheel-volume shortcuts and notifications appear only in player fullscreen. Auto-skip and an enabled quality lock operate during normal playback too. Use Crunchyroll's own Fullscreen button.

## Quality lock

In fullscreen, open **Player Settings → Quality → Maximum quality — locked**.

For supported DASH manifests, the script keeps the highest resolution and then the highest declared bitrate at that resolution within each codec group. It also retains the highest audio bitrate within each compatible audio group. Languages, subtitles, DRM metadata, and segment addresses remain intact. For HLS master playlists it filters video variants; separate audio playlists remain unchanged.

This applies to streams Crunchyroll actually supplies. It cannot unlock resolutions, codecs, account features, or media unavailable to the normal player. A connection that cannot sustain the selected stream may buffer instead of reducing quality.

The menu reports when a supported manifest has been processed. **Waiting for the next playback load** is not confirmation that the current video is locked. The displayed bitrate is declared video bitrate, not measured network throughput.

Changing the toggle offers **Reload to apply** because the current stream list may already be loaded. Choosing a built-in quality mode disables the lock for the next load. Reload to restore the full adaptive stream list.

## Compatibility and limits

The native menu selectors were checked against Crunchyroll's English desktop player. Other languages, layouts and future site updates may need changes. The script supports page-level fetch and XMLHttpRequest manifest loading; worker-only or other loading paths may bypass the hook. Unsupported or malformed manifests are left unchanged. There is no guarantee of compatibility with every device or userscript manager.

## Privacy

No analytics, telemetry, external services, remote code dependencies, credential access, or media downloads are added. The script observes the player's existing manifest responses locally; it does not send them elsewhere. One preference, `cr-enhancer.maximum-quality`, is stored in localStorage. Normal Crunchyroll network requests continue as usual.

Do not include cookies, authorization headers, signed streaming URLs, viewing history, or personal account information in public issues.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm test
```

The tests exercise simulated player controls and synthetic manifests, plus a local HTTP server for real XMLHttpRequest text/binary handling. They do not access a Crunchyroll account. Automated tests are not a live-service compatibility guarantee.

## License and attribution

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the original script attribution and research references.

This is an unofficial project, not affiliated with or endorsed by Crunchyroll. Crunchyroll names and trademarks belong to their respective owners; no logos, anime assets or media are distributed. The script does not decrypt media or bypass DRM, subscriptions, authentication or region restrictions. Use only with media you are authorized to access. The software license does not grant rights to third-party services or content.
