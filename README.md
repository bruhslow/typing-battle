# ⚡ Typendo — Competitive Real-Time Typing Duels

> A modern, high-octane multiplayer typing duel platform. Challenge friends directly, join private lobbies, or compete in Ranked 1v1 ELO matchmaking.

🔗 **Live Platform:** [typendo.onrender.com](https://typendo.onrender.com)

---

## 🎮 What is Typendo?

**Typendo** is a full-stack real-time competitive typing platform where players race head-to-head. Featuring synchronized start countdowns, character-by-character live syntax highlighting, animated custom racer progression tracks, ELO rating leaderboards, a Friend Invite system, and an endless Solo Speed Lab.

---

## ✨ Features

- ⚡ **Real-Time Multiplayer Duels**: Sub-millisecond WebSocket state synchronization.
- 🏆 **Ranked 1v1 & Division Tiers**: Competitive ELO matchmaking spanning Bronze to Grandmaster.
- ⚔️ **Friend Invite System**: Send a direct 1v1 casual challenge to any online player via their Friend Code. Invite friends into your existing custom lobby with a single click. Live in-app invite banner with Accept / Decline and a 30-second auto-dismiss timer.
- 🏎️ **Animated Racer Tracks**: Dynamic live vehicle avatars ( 🏎️ F1, 🚀 Cosmic Jet, 🐎 Stallion, 🛸 UFO, 🐆 Cheetah) tracking typist velocity.
- 📜 **2-Line Rolling Conveyor Display**: Focused, distraction-free 2-line smooth rolling text window.
- 🔬 **Solo Speed Lab Engine**: Endless continuous word stream with live WPM/accuracy telemetry and customizable duration tests (15s, 30s, 60s).
- 🔊 **Web Audio Synthesizer**: Zero-latency procedural sound effects for keystrokes, countdown beeps, button clicks, and victory fanfares with top-right mute toggle.
- 🛡️ **Anti-Cheat & Fair Judging**: Automatic bot/macro disqualification and real-time keystroke progress snapshots.
- 📱 **Mobile-Optimised Layout**: Single-row header (logo left, tools right), proper touch keyboard handling, and zero autocorrect interference.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js |
| **Backend Framework** | Express.js |
| **Real-Time Engine** | Socket.io (WebSockets) |
| **Audio Engine** | Web Audio API (Synthesized) |
| **Auth** | Clerk (Google SSO + Email OTP) + Custom Username/Password |
| **Frontend** | Vanilla HTML5 / Modern CSS Design Tokens / Vanilla JS |
| **Hosting** | Render.com |
| **Version Control** | Git + GitHub |

---

## 🚀 Run Locally

```bash
# Clone the repository
git clone https://github.com/bruhslow/typing-battle.git
cd typing-battle

# Install dependencies
npm install

# Start the dev server
node server.js
```

Open `http://localhost:3000` in multiple browser tabs or devices to start racing.

### Optional Environment Variables

| Variable | Purpose |
|----------|---------|
| `GMAIL_USER` | Gmail address for OTP emails |
| `GMAIL_APP_PASS` | Gmail App Password |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Custom SMTP provider |
| `CLERK_SECRET_KEY` | Clerk backend secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend key |

If no SMTP variables are set, OTP codes are printed to the terminal console (development mode).

---

## 📂 Project Structure

```
typendo/
├── public/
│   └── index.html      # Frontend — UI, Web Audio engine, client sockets, Friend Invite UI
├── data/
│   └── accounts.json   # Persisted user accounts (auto-created on first run)
├── server.js           # Backend — Express, Socket.io, ELO matchmaking, anti-cheat, Friend Invite
├── package.json        # Dependencies and scripts
└── README.md
```

---

## ⚔️ Friend Invite System

Players receive a unique **Friend Code** (e.g. `AB3X7F`) visible in the header on every page load.

| Flow | How it works |
|------|-------------|
| **Direct 1v1 Challenge** | From the home screen, enter a friend's code → server creates a private casual room → friend receives an in-app invite banner → Accept drops both into the room |
| **Lobby Invite** | While hosting a custom room, enter a friend's code → friend gets the banner → Accept joins your lobby directly |

- Casual invite rooms are **never ranked** — zero ELO impact.
- Invites auto-expire after **30 seconds** if not accepted.
- Friend Codes are **session-based** — they change on login/refresh (share in real-time via Discord, chat, etc.).

---

## 👥 Authors

**Giridharan N S & Shivani**

*Fast fingers. Clear mind.*
