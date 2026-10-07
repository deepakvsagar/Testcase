# StoryVerse for iOS

A native SwiftUI app that runs the deployed StoryVerse site in a web view and adds native features:

- **Sign in with Apple** (asks for no name or email), exchanged for a StoryVerse session by the Worker's `/api/auth/apple`
- **Native dictation** for “Speak my idea” (on-device where supported; the web Speech API isn't available in app web views)
- **iOS share sheet** for finished videos, project files, and scripts (Save Video, Save to Files, AirDrop, social apps)
- **Account screen** with sign-out, in-app account and data deletion, privacy policy, and support links
- Haptics, pull to refresh, native offline and error screens, and offline drafts through the site's service worker

The site detects the app through `window.storyverseNative` (injected by `Web/BridgeScript.swift`) and switches to these features; in a browser it behaves as before.

## What you need

- A Mac with Xcode 16 or newer, and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- An [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year) to install on devices, use TestFlight, or publish
- The StoryVerse site deployed over HTTPS

## 1. Configure the server

Set these Site secrets in addition to the provider keys in the main README:

| Secret | Value |
| --- | --- |
| `APPLE_BUNDLE_ID` | The app's bundle ID, e.g. `com.mavir.storyverse` (must match `PRODUCT_BUNDLE_IDENTIFIER`) |
| `STORYVERSE_SESSION_SECRET` | A random string of at least 32 characters, e.g. `openssl rand -base64 48` |

Then fill in the bracketed placeholders in `site-assets/privacy.html` and `site-assets/support.html`, have the privacy policy reviewed, and redeploy.

## 2. Configure and open the project

In `project.yml`, set:

- `STORYVERSE_SITE_HOST` — your site's host only, e.g. `stories.mavir.com` (no `https://`)
- `PRODUCT_BUNDLE_IDENTIFIER` — your bundle ID
- `DEVELOPMENT_TEAM` — your Team ID (or pick the team in Xcode)

```bash
cd storyverse/ios
xcodegen generate
open StoryVerse.xcodeproj
```

Run on a simulator or device (⌘R). The Sign in with Apple capability is declared in `StoryVerse.entitlements`; Xcode registers it for your bundle ID when automatic signing is on. Unit tests run with ⌘U.

## 3. Ship to TestFlight and the App Store

1. In [App Store Connect](https://appstoreconnect.apple.com), create the app with the same bundle ID.
2. In Xcode: **Product → Archive**, then **Distribute App → App Store Connect → Upload**.
3. Add internal testers in TestFlight and test on real iPhones and iPads, including sign-in, dictation, video save, account deletion, and airplane mode.
4. Complete the listing: description, keywords, screenshots (6.9" iPhone and 13" iPad), **Privacy Policy URL** (`https://<host>/privacy.html`), **Support URL** (`https://<host>/support.html`), and age rating.
5. **App Privacy** answers: matches `Resources/PrivacyInfo.xcprivacy` — *User Content* (not linked, app functionality) and *User ID* (linked, app functionality); no tracking.
6. Submit for review. In **App Review notes**, explain that sign-in is Sign in with Apple, that AI generation calls Google, OpenAI, and Anthropic models, and that video export bills a Gemini account (consider a reviewer allowance so review doesn't fail on quota).

## App Review risks to plan for

- **Minimum functionality (4.2).** Apps that mostly display a website are often rejected. The native features above are there to address this; if review pushes back, bundling the site's pages inside the app is the next step.
- **Content in Kids Category.** Don't list StoryVerse in the Kids Category: it links to social apps and calls AI services, which Kids Category rules restrict. Choose a general category (e.g. Entertainment or Education) and an age rating that reflects AI-generated content.
- **AI-generated content.** Expect questions about safeguards for generated text and video. Server prompts already restrict content by path; a way for people to report a bad result would strengthen the submission.
- **Account deletion (5.1.1(v)).** Provided in Account → Delete account and data. StoryVerse stores no account data on its servers and never exchanges Apple's authorization code for tokens, so there are no Apple tokens to revoke; say so in the review notes if asked.
- **App icon.** `AppIcon-1024.png` is upscaled from the brand sheet and slightly soft. Replace it with a 1024×1024 export from the original artwork (RGB PNG, no transparency) before release.

## Project layout

- `project.yml` — XcodeGen spec (targets, Info.plist keys, entitlements, build settings)
- `StoryVerse/App` — app entry, configuration, root view
- `StoryVerse/Web` — web view, navigation rules, JavaScript bridge
- `StoryVerse/Account` — Sign in with Apple, session storage (Keychain), Account screen
- `StoryVerse/Native` — dictation, share sheet, haptics
- `StoryVerse/Resources` — asset catalog, privacy manifest
- `StoryVerseTests` — unit tests for navigation rules, bridge parsing, session handling, and nonce hashing

CI (`.github/workflows/storyverse.yml`) generates the project, builds it, and runs the unit tests on a macOS runner for every change under `storyverse/`.
