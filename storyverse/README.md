# StoryVerse

StoryVerse is a multi-page storytelling app for creating stories, planning scenes, and exporting a narrated AI video. All four creation paths — Bedtime Bestie, Drama Dream, Magnum Opus, and Curious Class — share one five-step studio (`/studio.html?path=…`). The public Site is served by an ESM Worker; provider calls run server-side.

## Included

- Public home and story-type pages
- One studio for every creation path, with drafts autosaved in the browser and reopenable project files
- Story editor and scene planning: reorder, add, or remove scenes; only edited scenes are re-planned
- AI scene-art generation with character-continuity prompts
- Veo video generation, separate AI voiceover, and browser-side video export
- Model availability APIs and worker-side request validation
- Built Worker artifact in `dist/`
- Build, validation, and mocked worker checks

## iOS App Store app

`ios/` contains a native SwiftUI app for the App Store: Sign in with Apple, native dictation, the iOS share sheet for videos and files, and in-app account deletion around the StoryVerse site. See [`ios/README.md`](ios/README.md) for setup, the extra `APPLE_BUNDLE_ID` and `STORYVERSE_SESSION_SECRET` secrets, and the release checklist.

## Install on iPhone and iPad (Home Screen web app)

StoryVerse is an installable web app, so it needs no App Store, Mac, or Apple Developer account.

1. Open the deployed site in Safari (or any iOS browser on iOS 16.4+).
2. Tap **Share**, then **Add to Home Screen**, then **Add**. The site also shows this tip once, at the bottom of the screen.
3. Launch StoryVerse from its Home Screen icon. It opens full-screen on the path chooser, with long-press shortcuts to each studio.

The app opens offline: the app shell, studio settings, and saved drafts are cached by `site-assets/sw.js`. AI generation, sign-in, and video export need a connection and are never cached. Redeploying updates the app on its next online launch; bump `CACHE` in `sw.js` whenever you change the precached file list.

Things to know on iOS:
- The installed app keeps its own storage, separate from Safari. Drafts started in Safari don't appear in the app (use **Save project file** and **Open a saved project** to move them), and you sign in again inside the app.
- Sign-in goes through `/signin-with-chatgpt`, which is provided by the Site runtime. Confirm on a real device that signing in returns you to the installed app before announcing it.
- Use **Share video to an app** to save a rendered video to Photos or Files; it is more reliable than the download button inside the installed app.

## Requirements

- Node.js 20 or newer
- Bash
- No npm package install is needed; the project uses Node built-ins and scripts.

## Build and verify

```bash
npm run build
npm run validate
npm run test:worker
```

`npm run build` embeds the files in `site-assets/` into `worker/assets.js` and creates `dist/server/`. The worker tests mock provider requests and do not start paid AI generation. The build does not publish the Site.

## Server secrets

Set provider keys as server-side Site secrets. Never put API keys in browser files, `site-assets/`, or `.openai/hosting.json`.

- `GEMINI_API_KEY` enables the configured Gemini story and visual models, Veo video models, and Google voiceover.
- `OPENAI_API_KEY` enables configured OpenAI story and image models.
- `ANTHROPIC_API_KEY` enables configured Claude story models.
- `APPLE_BUNDLE_ID` and `STORYVERSE_SESSION_SECRET` enable Sign in with Apple for the iOS app (see `ios/README.md`).
- `STORYVERSE_MOBILE_TEST_TOKEN` is optional and only needed for the native/mobile test-token path.

Configured model IDs, labels, video price estimates, and the per-path rules (lengths, moods, scene limits) are maintained in `worker/index.js`. The studio reads path rules from `/api/paths` and video limits from `/api/video-models`, so changing `PATHS`, `MAX_VIDEO_CLIPS`, or `MAX_NARRATION_CHARACTERS` there updates the browser too.

Story generation requires a signed-in ChatGPT user identity forwarded by the Site runtime. Visitors can browse the public pages; generation endpoints require authentication. Provider quotas and charges follow the configured provider accounts.

## Video export notes

Video export is available when a story fits `MAX_VIDEO_CLIPS` (24 clips of about 16 narrated words each, roughly 3 minutes) and the narrator's 8,000-character limit. In practice that covers Bedtime Bestie and short Curious Class stories; longer paths still get the script, scene plan, voice preview, and project file. The video flow submits 8-second Veo clips with the chosen portrait or landscape aspect ratio. Voiceover is generated separately after video jobs are accepted. The browser combines the clips and voiceover into a downloadable video; device sharing may hand the file to a social app. Direct upload or publishing to YouTube, Instagram, or Facebook is not connected.

## Project layout

- `site-assets/` — HTML, CSS, browser JavaScript, and supplied visual assets
  - `studio.html`, `studio.js`, `studio.css` — the shared five-step studio
  - `video-renderer.js` — Veo clip generation, voiceover, and in-browser video render
  - `create.html`, `create.js` — creation-path chooser
  - `manifest.webmanifest`, `sw.js`, `pwa.js`, `offline.html`, `icons/` — installable app (Home Screen icon, offline launch, install hint)
- `worker/index.js` — Worker routes, model configuration, validation, and provider integrations
- `worker/assets.js` — generated embedded Site assets
- `scripts/build.sh` — asset embedding and Worker build
- `scripts/generate-assets.mjs` — creates `worker/assets.js` from `site-assets/`
- `scripts/validate-artifact.mjs` — deployable Worker validation
- `scripts/test-worker.mjs` — mocked route and provider-flow checks
- `.openai/hosting.json` — Site project configuration
- `dist/` — generated deployable Worker artifact

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/apple` | POST | Exchange a Sign in with Apple identity token for an app session |
| `/api/paths` | GET | Creation paths and their lengths, moods, and scene limits |
| `/api/models` | GET | List story models for a story type |
| `/api/visual-models` | GET | List scene-art models |
| `/api/video-models` | GET | List video models, estimates, and export limits |
| `/api/generate-story` | POST | Generate a story |
| `/api/plan-scenes` | POST | Plan visual direction for scenes |
| `/api/generate-scene-image` | POST | Generate scene artwork |
| `/api/generate-video` | POST | Start a video clip job |
| `/api/video-job-status` | GET | Check a video job |
| `/api/video-job-content` | GET | Retrieve a completed clip |
| `/api/generate-voiceover` | POST | Generate narrator audio |

`/bedtime.html` permanently redirects to `/studio.html?path=bedtime`.

## Changes in v27

Installable app
- Add to Home Screen on iOS and install on Android/desktop browsers, with a StoryVerse icon cut from the brand sheet, full-screen launch, notch-safe layout, offline launch with saved drafts, and a one-time install tip.


Fixes
- Video generation could never finish on the live site: browsers don't send `Origin` on same-origin GETs, so job-status and download checks were refused. Same-origin GETs are now recognised with Fetch Metadata.
- Claude story and scene-plan requests failed on every call: they sent `temperature`, which current Claude models reject. They now use structured outputs (`output_config.format`) and opt into Anthropic's server-side refusal fallback.
- The cost estimate never refreshed on reaching the Finish step (`$('[data-panel="4"]')` passed a CSS selector to `getElementById` and threw).
- `/api/generate-scene-image` rejected the only style the app uses (`Cinematic realism`); it now renders photoreal stills for it.
- Scene planning rejected narration over 1,200 characters although the editor allowed 4,000.
- Error messages named Gemini regardless of provider; refusals and truncated responses now get specific messages.
- Removed `video-export.js`, which no page loaded.

Improvements
- Drama Dream, Magnum Opus, and Curious Class now use the full studio instead of downloading a text brief, with path-specific audience, length, and mood options validated by the Worker.
- Drafts autosave per path and restore after refresh or sign-in; the chooser offers to continue a draft.
- Project files (`storyverse-project-v2`, and v1 files from the old Bedtime studio) can be reopened.
- Scenes can be reordered; editing one scene keeps every other scene's visual plan.
- Script download (.txt) with scene directions.
- Video export explains when a story exceeds the clip or narration limit instead of failing mid-run.
- One shared rate-limit helper replaces four copies.
