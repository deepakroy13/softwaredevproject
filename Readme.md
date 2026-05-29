# QuizArcade — Real-time Kahoot-style Quiz Platform

Express + Socket.IO + MongoDB (Mongoose). One room, many players, a host who builds
and controls the quiz, and a presenter big-screen view. Speed-based scoring with streak
bonuses, live leaderboards on every screen, kick + reveal controls.

## Requirements
- Node.js 18+
- A MongoDB database (local `mongod` or a free MongoDB Atlas cluster)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Edit **env.txt** and set your MongoDB connection string:
   ```
   MONGOURI=mongodb://127.0.0.1:27017/quizapp
   PORT=3001
   ```
3. (Optional) Seed a demo room with PIN `9999`:
   ```bash
   npm run seed
   ```
4. Start the server:
   ```bash
   npm start      # or: npm run dev   (auto-reload with nodemon)
   ```
5. Open the app: **http://localhost:3001**

## How to use
- **Host** (`/host.html`): click **Create New Room** → you get a PIN. Add questions
  (mark the correct shape with the toggle), then **Start quiz**. Use **Next / Prev /
  Reveal / End** to drive the game, and **Kick** to remove a player.
- **Players** (`/participant.html`): enter the PIN + a nickname, then tap a colored
  shape before the timer runs out. Faster correct answers score more.
- **Presenter** (`/presenter.html`): enter the PIN for a big-screen view with the live
  question, answer distribution on reveal, a leaderboard, and slide controls.

## Project structure
```
server.js            Express + Socket.IO server (all game logic)
scoring.js           Speed + streak scoring
create_session.js    Optional DB seeder (npm run seed)
models/Session.js    Mongoose schema (room, players, slides, responses)
public/
  index.html         Landing page
  host.html          Host dashboard
  participant.html   Player screen
  presenter.html     Big-screen presenter view
  style.css          Shared theme
  common.js          Shared client helpers (toast, leaderboard)
test_client.js       CLI player bot (node test_client.js)
host_client.js       CLI host bot (node host_client.js)
```

## Socket protocol (reference)
**Client → server:** `host:create`, `host:join`, `host:addQuestion`,
`host:deleteQuestion`, `host:start`, `host:next`, `host:prev`, `host:reveal`,
`host:kick`, `host:end`, `presenter:join`, `presenter:next`, `presenter:prev`,
`presenter:reveal`, `player:join`, `player:answer`.

**Server → client:** `host:created`, `host:joined`, `host:questions`,
`presenter:joined`, `player:joined`, `state`, `participants`, `leaderboard`,
`question`, `reveal`, `answerResult`, `answerStats`, `ended`, `kicked`, `errorMsg`.

### Notes
- **Timing is server-authoritative.** The on-screen countdown is visual; points are
  computed from `slideStartTime` on the server, so a player can't cheat by faking the
  elapsed time.
- The **answer key is never sent to players or presenters** — `correctOption` only
  travels in the `reveal` event and in the host's private `host:questions` list.
- A small **per-room write lock** serializes mutations so simultaneous answers don't
  collide on the same Mongoose document.