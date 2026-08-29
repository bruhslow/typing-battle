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

Typendo is built on a **3-layer full-stack architecture** combining a persistent HTTP server, a real-time WebSocket engine, and a JSON-backed data store — all running on a single Node.js process.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│                      (Browser / Mobile)                         │
│                                                                 │
│   index.html — Vanilla JS + CSS                                 │
│   ├── Socket.io Client  →  real-time game events               │
│   ├── Clerk Frontend SDK →  Google SSO / OTP auth              │
│   ├── Web Audio API     →  synthesized sound engine            │
│   ├── Friends Drawer    →  live friend status & invites        │
│   └── Solo Speed Lab    →  endless random word stream          │
└────────────────────┬────────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │   HTTP (REST)       │   WebSocket (Socket.io)
          │   /login /signup    │   persistent full-duplex
          │   /api/friends      │   bi-directional connection
          └──────────┬──────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│                       SERVER LAYER                              │
│                    (Node.js + Express)                          │
│                                                                 │
│   server.js                                                     │
│   ├── Express.js                                                │
│   │   ├── Serves static index.html                             │
│   │   ├── REST API routes (auth, friends, leaderboard)        │
│   │   └── Clerk middleware (verifies session tokens)           │
│   │                                                             │
│   ├── Socket.io Server                                          │
│   │   ├── Room Manager     → creates/destroys game rooms       │
│   │   ├── Matchmaking      → pairs ranked players by ELO       │
│   │   ├── Game Engine      → syncs progress, declares winner   │
│   │   ├── Friends Engine   → live status, invites, requests    │
│   │   └── Anti-Cheat       → keystroke velocity analysis       │
│   │                                                             │
│   └── ELO Calculator       → updates ratings post-match        │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│                      DATA LAYER                                 │
│                   (JSON File Storage)                           │
│                                                                 │
│   data/accounts.json                                            │
│   ├── User accounts (username, credentials)                    │
│   ├── ELO ratings & tier rankings                              │
│   ├── Friends lists (accepted connections)                      │
│   └── Pending friend requests                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### 🔄 Match Lifecycle — Step by Step

```
1. AUTHENTICATION
   Player opens app → Clerk verifies identity → session token issued
   Server validates token on every request via Clerk Express middleware

2. MATCHMAKING
   Player clicks "Find Match" → socket emits join-queue event
   Server checks ELO rating → pairs with closest-ranked opponent
   Both players assigned to a shared Socket.io room (unique room ID)

3. GAME START
   Server selects random paragraph → emits game-start to both sockets
   Synchronized 3-second countdown pushed to both clients simultaneously

4. LIVE SYNC (per keystroke)
   Player types → client calculates progress % and WPM
   socket.emit('progress', { percent, wpm }) → hits server instantly
   Server runs anti-cheat check on velocity
   socket.to(roomId).emit('opponent-progress', data) → opponent updates

5. FINISH & ELO UPDATE
   First player completes paragraph or has typed more words correct → server declares winner
   ELO delta calculated using standard ELO formula
   Both players' ratings updated in accounts.json
   Results screen emitted to both clients simultaneously

6. CLEANUP
   Room destroyed, sockets released
   Player stats updated in persistent storage
```

---

### 👥 Friends System Flow

```
SEND REQUEST
User A searches username/friendcode → server saves pending entry
Socket.io pushes live notification to User B if online

ACCEPT REQUEST
User B clicks Accept → entry moves from pending to accepted
Both users' friend lists updated simultaneously in accounts.json
Socket.io emits friend-online status to User A instantly

DUEL INVITE
User A clicks ⚔️ Duel on online friend
Server creates a private room → emits invite-banner to User B
User B has 30 seconds to Accept or Decline
If accepted → both enter private room → game starts
```

---

### 🔐 Authentication Flow (Clerk)

```
User clicks "Sign in with Google"
        ↓
Clerk SDK redirects to Google OAuth
        ↓
Google verifies identity → returns token to Clerk
        ↓
Clerk issues a signed session token to the browser
        ↓
Every API request carries this token in the header
        ↓
Clerk Express middleware on server verifies the token
        ↓
Server trusts the request → creates/fetches account in accounts.json
```

---

### 🛡️ Anti-Cheat Engine

```
Every keystroke emits a timestamp to the server
Server maintains a rolling window of the last 10 keystrokes
Calculates instantaneous CPM (characters per minute)
Human ceiling ≈ 800 CPM (world record ~900 CPM)
If CPM spike exceeds threshold → player flagged
On second violation → auto-disqualified, match awarded to opponent
```

---

### 📡 WebSocket Event Map

| Event (Client → Server) | Purpose |
|--------------------------|---------|
| `join-queue` | Enter ranked matchmaking |
| `join-room` | Join a private room by code |
| `progress` | Send typing progress update |
| `finish` | Signal race completion |
| `friend-request` | Send a friend request |
| `duel-invite` | Invite a friend to race |
| `accept-invite` | Accept a duel invitation |

| Event (Server → Client) | Purpose |
|--------------------------|---------|
| `game-start` | Match found, send paragraph |
| `opponent-progress` | Relay opponent's progress |
| `game-over` | Declare winner, send ELO delta |
| `friend-online` | Notify friend came online |
| `incoming-invite` | Show duel invite banner |
| `opponent-left` | Opponent disconnected |

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

## 👥 Authors

**Giridharan N S & Shivani** — Built for a college hackathon.

---

*Fast fingers. Clear mind.*
