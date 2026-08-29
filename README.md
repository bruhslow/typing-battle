# ⚡ Typendo

> A real-time two-player typing race game. Join a room, wait for your rival, and type the same paragraph to the finish line.

🔗 **Live Demo:** [typing-battle-34rr.onrender.com](https://typing-battle-34rr.onrender.com)

---

## What is Typendo?

Typendo is a full-stack multiplayer web app where two players compete to type the same paragraph as fast as possible — live, in real time. No accounts. No downloads. Just share a room code and race.

---

## Features

- ⚡ Real-time multiplayer via WebSockets
- 🏠 Private rooms with custom room codes
- 📊 Live WPM tracking
- 📈 Live opponent progress bar
- 🏆 Winner screen on both devices simultaneously
- 📱 Works on mobile and desktop
- 🌍 Globally accessible — hosted on Render

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Real-time | Socket.io (WebSockets) |
| Frontend | HTML5 / CSS3 / Vanilla JS |
| Hosting | Render.com |
| Version Control | Git + GitHub |

---

## How It Works

```
[Player 1 Browser] ←── WebSocket ──→ [Node.js Server] ←── WebSocket ──→ [Player 2 Browser]
```

1. Both players open the app and enter the same room code
2. Server waits until 2 players are in the room
3. Both receive the same random paragraph
4. Every keystroke is sent to the server → broadcast to opponent in real time
5. First player to finish wins — winner screen appears on both screens

---

## Run Locally

```bash
# Clone the repo
git clone https://github.com/bruhslow/typing-battle.git
cd typing-battle

# Install dependencies
npm install

# Start the server
node server.js
```

Then open `http://localhost:3000` in two browser tabs and race yourself.

---

## Project Structure

```
typing-battle/
├── public/
│   └── index.html      # Frontend — UI, game logic, socket client
├── server.js           # Backend — Express + Socket.io server
├── package.json        # Dependencies and scripts
└── README.md
```

---

## Deployment

This project is deployed on **Render.com** with automatic deploys on every `git push`.

```bash
# Deploy new changes
git add .
git commit -m "your message"
git push
```

Render detects the push, runs `npm install`, and restarts the server automatically.

---

## Built By

**Giridharan N S & Shivani** — built in one night for a college hackathon.

---

*Fast fingers. Clear mind.*
