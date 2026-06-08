# Browser Utilities

A userscript that injects a floating hamburger button into every page, opening a bottom sheet with a page inspector, image browser, cookie-banner handler, and settings. Works in Safari via the [Userscripts](https://github.com/quoid/userscripts) extension and in other browsers via Tampermonkey.

-----

## Install

**Safari (iOS and macOS)**

1. Install the [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) extension.
1. Open the [raw script URL](https://raw.githubusercontent.com/Tojioo/Browser-Utilities/main/browser_utilities.user.js) in Safari:
   ```
   https://raw.githubusercontent.com/Tojioo/Browser-Utilities/main/browser_utilities.user.js
   ```
1. Userscripts will prompt you to install. Once installed, updates happen automatically.

**Tampermonkey (Chrome, Firefox, Edge)**

1. Install [Tampermonkey](https://www.tampermonkey.net).
1. Navigate to the raw URL above. Tampermonkey will offer to install the script.

-----

## Features

- **Hamburger menu** - a draggable floating button that sits at a corner of every page, avoids native navigation bars automatically, and opens a panel with the tools below.
- **Page inspector** - a lightweight inspector covering identity, meta tags, security signals, DOM counts, resources, performance timing, links, images, fonts, accessibility, storage, and display. Each section can be copied as JSON.
- **Image browser** - lists all images on the page, grouped by source URL. Supports list, grid, and compact views, with sorting, filtering, and a full-screen preview per image. The preview shows all rendered sizes for the same source and lets you swipe between them. Download respects your preference: original file or rendered size.
- **Cookie-banner handling** - hide cookie consent banners automatically. Off by default. Can be set to always hide, or to show once per site and hide on return visits.
- **Themes** - preset accent colors plus custom hex input. Settings sync across all sites.
- **RoutineHub shortcut pages** - on `routinehub.co/shortcut/*`, the panel adds a button that copies the shortcut description as Markdown, useful for submitting shortcut listings.

-----

## Background

This project started as two separate scripts sitting side-by-side: one that copied the RoutineHub description to the clipboard, and one that copied the full page HTML. They worked fine independently, but having two floating buttons on every page was already awkward, and adding anything new would have meant a third.

**v2** merged them into a single hamburger FAB with a pop-up panel and a basic page inspector alongside the two copy actions.

**v3** fleshed out the inspector with all the sections it has today: identity, meta, security, DOM, resources, performance, links, images, fonts, accessibility, storage, and display.

**v4** added cookie-banner handling and a settings panel with theme support.

**v5** introduced the image browser: a dedicated view listing all `<img>` elements on the page with sizes, origins, alt text, and download.

**v6** introduced the sliding view stack (inspector pushes to settings and images as sub-views), resize-by-drag on the sheet header, and further inspector refinements.

**v7** added FAB collision detection (the button detects page navigation bars and nudges itself out of the way), cross-site settings sync via the GM storage API, and a ground-up redesign of the image browser with source deduplication, grouped variants, and a swipeable full-screen preview.

At that point the script worked equally well in Safari and Tampermonkey, and the Safari-specific name no longer fit. It was renamed to **Browser Utilities** at v7.2.1, moved to this repository, and relicensed under the ANC-SA-1.0 license.

-----

## License

Licensed under the **Attribution-NonCommercial-ShareAlike Source License v1.0 (ANC-SA-1.0)**.

You may use, copy, and modify this software for personal, educational, or research purposes at no charge. If you distribute a modified version, you must attribute the original author, link to this repository, and make the source of your modified version publicly available under the same or a substantially similar license. Commercial use is prohibited without prior written permission.

See the <LICENSE> file for the full terms.
