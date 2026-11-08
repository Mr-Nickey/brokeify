<div align="center">

<img src="./public/pwa-192x192.png" alt="Brokeify Logo" width="110" height="110" />

# Brokeify

**Because $11.99 a month is highway robbery.**  
*Powered by spite, hard drives, and a '99 retro stereo deck.*

[![Self-Hosted Music](https://img.shields.io/badge/Self--Hosted-Jellyfin%20%7C%20Navidrome%20%7C%20Emby%20%7C%20Plex-00ff66?style=for-the-badge&logo=jellyfin&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Built with Google AI Studio](https://img.shields.io/badge/Built%20With-Google%20AI%20Studio-a855f7?style=for-the-badge&logo=google&logoColor=white)](https://aistudio.google.com/)
[![Cloudflare Pages Ready](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-f59e0b?style=for-the-badge&logo=cloudflare&logoColor=black)](https://pages.cloudflare.com/)

<br />

<img src="./public/favicon.svg" alt="Brokeify Vector Icon" width="48" height="48" />

</div>

---

## 🎧 What is Brokeify?

**Brokeify** is a fast, zero-subscription, self-hosted web music player and car-ready stereo deck designed first and foremost for **Jellyfin** (with optional connectors for **Navidrome / Subsonic**, **Emby**, and **Plex**).

It was built to solve real-world annoyances when streaming your own music library on the road:
- **Loud FLACs next to quiet 240kbps MP3s?** Brokeify has an **Aggressive FLAC/MP3 Volume Stabilizer** (5-band EQ + heavy-duty compressor + LUFS preamp) so you stop reaching for your car volume knob every 3 minutes.
- **Downloader grabbed 4 copies of the same song with weird tags?** Brokeify's **Smart Anti-Repeat & Duplicate Song Guard** fingerprints song titles/artists, strips out `(Radio Version)` / `(feat. ...)` / `- Artist` suffixes, picks the cleanest copy, and guarantees the same song **never plays back-to-back**.
- **Spotty cell reception on rural highways?** Brokeify includes a **6s–15s Proactive Stream Buffer** plus an **IndexedDB Offline Vault** that automatically pre-downloads the next **2 to 12 tracks** ahead in your queue.
- **Ugly auto-imported server playlist names?** Rename any playlist inside Brokeify while still displaying the **Real Server Playlist Name** right underneath it.

---

## 🤖 Full Transparency: Coded with Google AI Studio

If you peek around the repo or commit history, you'll notice **Google AI Studio** fingerprints all over it—and there's zero hiding that!

This project was vibe-coded and iterated inside **Google AI Studio** by someone who wanted a custom, nostalgic late-'90s stereo deck that actually works smoothly in the car, over Cloudflare Pages, connected to a home Jellyfin server.

> **Friendly Disclaimer:**  
> If you enjoy tinkering with AI-built tools, awesome—clone it, fork it, break it, and have fun!  
> If you're someone who strongly prefers 100% hand-artisanal, organic, free-range human code and can't stand AI-generated repos, **no hard feelings at all—you definitely don't have to use it!** ❤️ Keep scrolling, enjoy your music however you play it, and have a great drive.

---

## ✨ Key Features

| Feature | What It Does |
| :--- | :--- |
| ⚡ **Jellyfin Quick Connect** | Log in with a 6-digit Quick Connect code or standard username & password—no hunting for API keys required. |
| 🛡️ **Smart Anti-Repeat & Duplicate Guard** | Detects duplicate downloads of the same song (even when one copy has artist `"a"` and title `"Song (Radio Version) - Artist"`), collapses duplicates, and **never plays the same song back-to-back**. |
| 🏷️ **Playlist Renaming + Real Name Display** | Give any playlist a clean custom display name while always showing its **Real Name** from your Jellyfin server right on the card. |
| 🔊 **Aggressive FLAC / MP3 Volume Stabilizer** | Balances booming lossless FLAC files and quiet legacy MP3 files using a Web Audio API compressor + format-aware preamp + 5-band Equalizer (`Car Stereo`, `Bass Boost`, `Rock`, `Vocal`, `Late Night`). |
| 🌊 **Seamless Crossfade (0s–12s)** | Dual-deck equal-power crossfader so songs blend smoothly without dead air while driving. |
| 📡 **Proactive Stream Buffer (2s–15s)** | Waits for a solid 6-second audio cushion (default) before unpausing on variable mobile data so songs never sound like a skipping FM radio. |
| 💾 **Dead-Zone Offline Queue Vault (2–12 Tracks)** | Uses `navigator.storage.persist()` + IndexedDB (`brokeify-offline-vault`) to cache upcoming tracks or entire playlists for offline playback—no `.apk` compilation needed. |
| 🚗 **Car Mode & Android Auto MediaSession** | Giant touch targets for driving plus native Android Auto / Bluetooth lock-screen **Skip Song** (`nexttrack`) and **Previous Song** (`previoustrack`) controls showing clean Track & Artist metadata. |
| 🎨 **6 Retro Dark & Light Skins** | Switch between **Cyber Deck '99**, **Classic Slate**, **Midnight Amber**, **Cobalt Studio**, **Platinum Daylight**, and **Warm Paper** in Settings. |
| ☁️ **Zero-Logout Jellyfin Cloud Sync** | Automatically backs up and restores your EQ, Stabilizer, Crossfade, Visual Skin, and custom playlist names to your Jellyfin server (`/DisplayPreferences/brokeify`). |

---

## 🚀 How to Use Brokeify

### 1. Connect Your Jellyfin Server
1. Open Brokeify (or click **Settings ⚙️ → Manage Providers**).
2. Enter your Jellyfin Server URL (for example, `https://jellyfin.yourdomain.com`).
3. Choose **⚡ Quick Connect** (enter the 6-digit code in your Jellyfin app under *Settings → Quick Connect*) **or** sign in with your **Username & Password**.
4. Brokeify will immediately load your audio library and playlists and disable any demo placeholders.

### 2. Rename Playlists (While Keeping the Real Server Name)
1. On the **Library → Playlists** tab, every playlist card displays both your **Custom Display Name** and a `Real Name:` badge showing the original server name.
2. Click the **Pencil (`✏️`)** button on any playlist card to rename it.
3. Click **Save** (`✓`), or click the **Reset (`↺`)** button anytime to revert back to the original server name.

### 3. Keep Duplicate Songs from Playing Back-to-Back
- **Smart Anti-Repeat** is **ON by default**.
- You can toggle it anytime in **Now Playing → `No Back-to-Back: ON`** or in **Settings → Audio Lab, EQ & Offline Vault → Smart Anti-Repeat & Duplicate Song Guard**.

### 4. Download Playlists for Offline Driving (No APK Needed!)
- Click the **Download (`⬇️`)** button on any playlist card to save every track into your browser's persistent IndexedDB Offline Vault (`brokeify-offline-vault`).
- On Android / Pixel phones: open your deployed Brokeify URL in Chrome, tap **⋮ → Add to Home screen → Install app**, and Android will install Brokeify with its custom emerald icon and up to 60% of free device storage for offline playlists.

---

## 🛠️ Local Development & Cloudflare Pages Deployment

### Run Locally
```bash
# 1. Install dependencies
npm install

# 2. Start the development server on port 3000
npm run dev

# 3. Run unit tests
npx tsx --test src/utils/musicLogic.test.ts
```

### Deploy to Cloudflare Pages (via GitHub)
1. Push this repository to GitHub (`https://github.com/Mr-Nickey/brokeify`).
2. In the **Cloudflare Dashboard**, go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your `brokeify` repository and use these build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Attach your custom domain (e.g., `music.yourdomain.com`) under **Custom Domains**.

---

## 🖼️ App Icons & Assets

| Asset | Preview | Path |
| :--- | :---: | :--- |
| **Vector App Emblem** | <img src="./public/favicon.svg" width="44" height="44" alt="Favicon SVG" /> | `./public/favicon.svg` |
| **192×192 WebAPK Icon** | <img src="./public/pwa-192x192.png" width="48" height="48" alt="192x192 Icon" /> | `./public/pwa-192x192.png` |
| **512×512 Maskable Icon** | <img src="./public/pwa-512x512.png" width="56" height="56" alt="512x512 Icon" /> | `./public/pwa-512x512.png` |

---

<div align="center">
  <sub>Built with spite, hard drives, and Google AI Studio · 100% Free · Zero Subscriptions Forever</sub>
</div>
