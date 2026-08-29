# ⚡ Typendo — Competitive Real-Time Typing Duels

> A modern, high-octane multiplayer typing duel platform. Challenge friends directly, join private lobbies, manage friend lists, or compete in Ranked 1v1 ELO matchmaking.

🔗 **Live Platform:** [typendo.onrender.com](https://typendo.onrender.com)

---

## 🎮 What is Typendo?

**Typendo** is a full-stack real-time competitive typing platform where players race head-to-head. Featuring synchronized start countdowns, character-by-character live syntax highlighting, animated custom racer progression tracks, ELO rating leaderboards, a persistent Friend System with slide-out drawer, and an endless Solo Speed Lab.

---

## ✨ Features

- ⚡ **Real-Time Multiplayer Duels**: Sub-millisecond WebSocket state synchronization.
- 🏆 **Ranked 1v1 & Division Tiers**: Competitive ELO matchmaking spanning Bronze to Grandmaster.
- 👥 **Persistent Friends System & Right-Slide Drawer**:
  - **Right-Edge Pullout Drawer**: Dedicated task-manager style drawer with live badge notifications.
  - **🟢 Online Friends Tab**: See friends currently online with one-click **⚔️ Duel** instant casual 1v1 challenges.
  - **👥 All Friends Tab**: Manage your full friends list with online/offline status dots and removal.
  - **📬 Pending Requests Tab**: Full request/accept system with separate **Received** (Accept/Decline) and **Sent** (Cancel) sections.
  - **Search & Add**: Send friend requests by registered username or 6-character Friend Code.
- ⚔️ **Live Friend Invites**: Real-time sliding invite banner with Accept / Decline and a 30-second auto-dismiss countdown timer.
- 🏎️ **Animated Racer Tracks**: Dynamic live vehicle avatars (🏍️ Superbike, 🏎️ F1, 🚀 Cosmic Jet, 🐎 Stallion, 🛸 UFO, 🐆 Cheetah) tracking typist velocity.
- 📜 **2-Line Rolling Conveyor Display**: Focused, distraction-free Monkeytype-style 2-line smooth rolling text window.
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
| **Storage** | JSON-backed persistence (`data/accounts.json`) |
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
│   └── index.html      # Frontend — UI, Friends drawer, Web Audio engine, client sockets
├── data/
│   └── accounts.json   # Persisted user accounts, friends & pending requests
├── server.js           # Backend — Express, Socket.io, Friend System, ELO matchmaking, anti-cheat
├── package.json        # Dependencies and scripts
└── README.md
```

---

## 👥 Friends System & Invite Flows

| Feature | Details |
|---------|---------|
| **Friends Drawer** | Click the floating `👥 FRIENDS` tab on the right edge of the screen to open the panel. |
| **Online Friends** | Shows friends currently connected. Click **⚔️ Duel** to immediately create a private room and send them a live pop-up invite. |
| **All Friends** | Lists all accepted friends, sorted online first with live status indicators and ELO ratings. |
| **Pending Requests** | Incoming requests with **Accept / Decline** buttons and outgoing requests with **Cancel** buttons. |
| **Lobby Invites** | When in a custom lobby, enter any friend's code or username in the lobby panel to invite them directly. |

---

## 👥 Authors

**Giridharan N S & Shivani**

*Fast fingers. Clear mind.*
