# ⚡ Typendo — Competitive Real-Time Typing Duels

> A modern, high-octane multiplayer typing duel platform. Challenge friends directly, join private lobbies, manage friend lists, or compete in Ranked 1v1 ELO matchmaking.

🔗 **Live Platform:** [typendo.onrender.com](https://typendo.onrender.com)

---

## 🎮 What is Typendo?

**Typendo** is a full-stack real-time competitive typing platform where players race head-to-head. Featuring synchronized start countdowns, character-by-character live syntax highlighting, animated custom racer progression tracks, ELO rating leaderboards, a persistent Friend System with slide-out drawer, and an endless Solo Speed Lab.

---

## ✨ Features

- ⚡ **Real-Time Multiplayer Duels** — Sub-millisecond WebSocket state synchronization
- 🏆 **Ranked 1v1 & Division Tiers** — Competitive ELO matchmaking spanning Bronze to Grandmaster
- 👥 **Persistent Friends System & Right-Slide Drawer**
  - Right-edge pullout drawer with live badge notifications
  - 🟢 Online Friends tab with one-click ⚔️ Duel challenges
  - 👥 All Friends tab with online/offline status and removal
  - 📬 Pending Requests tab with Accept / Decline / Cancel flows
  - Search & Add friends by username or 6-character Friend Code
- ⚔️ **Live Friend Invites** — Real-time sliding invite banner with 30-second auto-dismiss countdown
- 🏎️ **Animated Racer Tracks** — Dynamic vehicle avatars (🏍️ Superbike, 🏎️ F1, 🚀 Cosmic Jet, 🐎 Stallion, 🛸 UFO, 🐆 Cheetah) tracking typist velocity
- 📜 **2-Line Rolling Conveyor Display** — Focused Monkeytype-style smooth rolling text window
- 🔬 **Solo Speed Lab** — Endless word stream with live WPM/accuracy and customizable duration tests (15s, 30s, 60s)
- 🔊 **Web Audio Synthesizer** — Zero-latency procedural sound effects for keystrokes, countdown, and victory fanfares
- 🛡️ **Anti-Cheat Engine** — Automatic bot/macro disqualification via keystroke velocity analysis
- 📱 **Mobile-Optimised** — Touch keyboard handling, zero autocorrect interference

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js |
| **Backend Framework** | Express.js |
| **Real-Time Engine** | Socket.io (WebSockets) |
| **Authentication** | Clerk (Google SSO + Email OTP) |
| **Audio Engine** | Web Audio API (Synthesized) |
| **Storage** | JSON-backed persistence (`data/accounts.json`) |
| **Frontend** | Vanilla HTML5 / Modern CSS / Vanilla JS |
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

# Start the server
node server.js
```

Open `http://localhost:3000` in multiple tabs or devices to start racing.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLERK_SECRET_KEY` | Clerk backend secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend publishable key |

> If no Clerk keys are set, the app runs in guest mode (no persistent accounts).

---

## 📂 Project Structure

```
typendo/
├── public/
│   └── index.html       # Frontend — UI, Friends drawer, Web Audio, client sockets
├── data/
│   └── accounts.json    # Persisted user accounts, ELO ratings, friends data
├── server.js            # Backend — Express, Socket.io, ELO, Friends system, Anti-cheat
├── package.json         # Dependencies and scripts
└── README.md
```

---

## 🏗️ System Architecture

```
[Browser Client] ←── WebSocket (Socket.io) ──→ [Node.js + Express Server]
                                                          ↕
                                                  [accounts.json]
                                                  (Users, ELO, Friends)
```

- **Express.js** serves the frontend and handles REST API routes (login, signup)
- **Socket.io** maintains persistent connections for real-time game state sync
- **Clerk** handles all authentication — Google SSO, Email OTP, session tokens
- **accounts.json** stores all persistent data — accounts, ELO ratings, friend lists

---

## 👥 Friends & Invite Flow

```
Player A sends friend request
        ↓
Server saves pending request to accounts.json
        ↓
Player B receives live notification via Socket.io
        ↓
Player B accepts → both added as friends
        ↓
Player A can now send a live ⚔️ Duel invite
        ↓
Private room created → both players race
```

---

## 🏆 ELO Ranking System

| Tier | ELO Range |
|------|-----------|
| 🥉 Bronze | 0 — 999 |
| 🥈 Silver | 1000 — 1199 |
| 🥇 Gold | 1200 — 1499 |
| 💎 Diamond | 1500 — 1799 |
| 🏆 Master | 1800 — 1999 |
| 👑 Grandmaster | 2000+ |

Win against stronger players = more ELO gained. Lose against weaker players = more ELO lost.

---

## 🛡️ Anti-Cheat System

- Tracks keystroke velocity in real time
- Flags and disqualifies players typing above human-possible speeds
- Protects ranked integrity from macros and bots

---

## 👥 Authors

**Giridharan N S & Shivani** — Built for a college hackathon.

---

*Fast fingers. Clear mind.*
