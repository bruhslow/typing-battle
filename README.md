# ⚡ Typendo — Competitive Real-Time Typing Duels

> A modern, high-octane multiplayer typing duel platform. Challenge friends in private lobbies or compete in Ranked 1v1 ELO matchmaking.

🔗 **Live Platform:** [typendo.onrender.com](https://typendo.onrender.com)

---

## 🎮 What is Typendo?

**Typendo** is a full-stack real-time competitive typing platform where players race head-to-head. Featuring synchronized start countdowns, character-by-character live syntax highlighting, animated custom racer progression tracks, ELO rating leaderboards, and an endless Solo Speed Lab.

---

## ✨ Features

- ⚡ **Real-Time Multiplayer Duels**: Sub-millisecond WebSocket state synchronization.
- 🏆 **Ranked 1v1 & Division Tiers**: Competitive ELO matchmaking spanning Bronze to Grandmaster.
- 🏎️ **Animated Racer Tracks**: Dynamic live vehicle avatars (🏍️ Superbike, 🏎️ F1, 🚀 Cosmic Jet, 🐎 Stallion, 🛸 UFO, 🐆 Cheetah) tracking typist velocity.
- 📜 **2-Line Rolling Conveyor Display**: Focused, distraction-free Monkeytype-style 2-line smooth rolling text window.
- 🔬 **Solo Speed Lab Engine**: Endless continuous word stream with live WPM/accuracy telemetry and customizable duration tests (15s, 30s, 60s).
- 🔊 **Web Audio Synthesizer**: Zero-latency procedural sound effects for keystrokes, countdown beeps, button clicks, and victory fanfares with top-right mute toggle.
- 🛡️ **Anti-Cheat & Fair Judging**: Automatic bot/macro disqualification and real-time keystroke progress snapshots.
- 📱 **Mobile Virtual Keyboard Sanitization**: Optimized for mobile and desktop with zero autocorrect interference.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js |
| **Backend Framework** | Express.js |
| **Real-Time Engine** | Socket.io (WebSockets) |
| **Audio Engine** | Web Audio API (Synthesized) |
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

---

## 📂 Project Structure

```
typendo/
├── public/
│   └── index.html      # Frontend — UI, Web Audio engine, client sockets
├── server.js           # Backend — Express, ELO matchmaking, anti-cheat & game state
├── package.json        # Dependencies and scripts
└── README.md
```

---

## 👥 Authors

**Giridharan N S & Shivani**

*Fast fingers. Clear mind.*
