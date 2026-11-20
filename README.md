# Dispack

Browse the contents of your Discord data package in the browser: search your messages, view and save every image you've sent, list your DMs, and see the servers you've joined. It's a static site that runs on GitHub Pages and works on phones.

It's a browser port of [Data Package Tool](https://github.com/aamiaa/Data-Package-Tool) by aamiaa, reimplemented in TypeScript.

## Features

- **Opens the zip or the extracted folder.** A folder can be the whole package or just part of it, such as `messages` or a single channel folder. Folders open with the folder picker or by dropping them on the page.
- **Fast loading.** Dispack has its own zip reader that only reads the parts of the zip it needs. A synthetic 300,000-message package parses in about half a second on a desktop. The activity log, which is often the largest part of the package, is only read when you open the Servers tab.
- **Images and files only**: an option that skips messages without attachments, for phones with less memory. Search then only covers those messages.
- **Message search** in exact, all-words or regex mode, with case sensitivity, newest/oldest sorting, before/after dates, has image/video/file, server, DM and group DM filters, and include/exclude channel or server IDs.
- **Image gallery** of every image you've sent, newest first, loaded as you scroll.
- **Image viewer** with swipe, pinch and double-tap zoom on phones; arrow keys and wheel zoom on desktop. It shows the message text, channel and date, and can jump to the message.
- **Saving images**: save one (the share sheet on phones, so it can go to Photos), select several, or save all of them as a zip. In Chromium desktop browsers, zips stream straight to disk.
- **DMs**: every DM you've talked in, with message counts, first-DM date, notes and duplicate-DM warnings.
- **Servers** joined, with join method, invite codes and analytics gaps, read from the activity log when you open the tab.
- **Jump to message** in Discord (web, mobile app, desktop app, PTB or Canary).
- **With an account token** (optional): delete messages, mass-delete search results, reopen lost DMs and look up deleted users.

## Viewing images: the bot token

Attachment links in a data package expire. Old packages have unsigned links, and new ones carry signatures that expire after a while. Dispack asks Discord for fresh links through the official `POST /attachments/refresh-urls` endpoint, which needs a **bot token**, not your account token:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **Bot**, press **Reset Token** and copy it.
3. Paste it in Dispack's Settings tab.

The bot doesn't need to be in any server.

## Your data and tokens

- The zip or folder is read inside your browser by a Web Worker. Nothing is uploaded.
- Tokens are kept in memory only and are gone when you reload. They're sent only to `discord.com`.
- The built page has a Content-Security-Policy that only allows connections to `discord.com`, `cdn.discordapp.com` and `media.discordapp.net`.
- Per-device preferences (search filters, and which messages you've deleted) live in `localStorage`.

> Using your **account** token with any tool counts as self-botting, which is against Discord's rules and can get your account banned. Only the delete, reopen-DM and user lookup features need it.

## Development

```bash
npm install
npm run dev
```

Generate a synthetic package and open it automatically in dev mode:

```bash
python scripts/make-fixture.py test-fixtures/package.zip 3000
```

Then visit `http://localhost:5173/?package=/test-fixtures/package.zip`. This loader only exists in dev builds.

```bash
npm run build
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**. The build uses relative paths, so it works at any `username.github.io/<repo>/` URL.

## Credits

Data package format knowledge and feature set: [aamiaa/Data-Package-Tool](https://github.com/aamiaa/Data-Package-Tool). Not affiliated with Discord.
