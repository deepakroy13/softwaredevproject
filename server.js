const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

require('dotenv').config({ path: 'env.txt' });

const Session = require('./models/Session');
const { computePoints } = require('./scoring');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/* ------------------------------------------------------------------ */
/*  DATABASE                                                          */
/* ------------------------------------------------------------------ */
const MONGOURI = process.env.MONGOURI || 'mongodb://127.0.0.1:27017/quizapp';

mongoose
  .connect(MONGOURI)
  .then(() => console.log('Mongo Connected'))
  .catch((err) => console.error('Mongo connection error:', err.message));

/* ------------------------------------------------------------------ */
/*  PER-ROOM WRITE LOCK                                               */
/*  Serializes mutations on a single room so concurrent answers       */
/*  don't collide on the same Mongoose document (VersionError).       */
/* ------------------------------------------------------------------ */
const locks = new Map();
function withRoomLock(roomPin, fn) {
  const prev = locks.get(roomPin) || Promise.resolve();
  const next = prev.then(fn, fn);
  // keep the chain alive but don't leak rejections
  locks.set(
    roomPin,
    next.catch(() => {})
  );
  return next;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                           */
/* ------------------------------------------------------------------ */
function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function uniquePin() {
  // try a handful of times to find an unused pin
  for (let i = 0; i < 10; i++) {
    const pin = genPin();
    const exists = await Session.exists({ roomPin: pin });
    if (!exists) return pin;
  }
  return String(Date.now()).slice(-6);
}

// Players only (host is NOT a participant), sorted, with ranks.
function rankedParticipants(session) {
  const players = [...session.participants];
  players.sort((a, b) => b.score - a.score);
  return players.map((p, i) => ({
    socketId: p.socketId,
    nickname: p.nickname,
    score: p.score,
    streak: p.streak,
    connected: p.connected,
    rank: i + 1
  }));
}

// What players & presenters may see about the current slide (no answer key).
function publicSlide(session) {
  const slide = session.slides[session.currentSlideIndex];
  if (!slide) return null;
  return {
    index: session.currentSlideIndex,
    total: session.slides.length,
    type: slide.type,
    title: slide.title,
    question: slide.question,
    choices: slide.choices,
    timeLimit: slide.timeLimit,
    startedAt: session.slideStartTime ? session.slideStartTime.getTime() : null
  };
}

// Generic room snapshot (safe for everyone — never contains correctOption).
function publicState(session) {
  return {
    roomPin: session.roomPin,
    currentState: session.currentState,
    currentSlideIndex: session.currentSlideIndex,
    totalSlides: session.slides.length,
    slide: publicSlide(session),
    participants: rankedParticipants(session)
  };
}

// Count how many players picked each option on the current slide.
function answerCounts(session) {
  const slide = session.slides[session.currentSlideIndex];
  if (!slide) return [];
  const counts = new Array((slide.choices || []).length).fill(0);
  slide.responses.forEach((r) => {
    if (r.selectedOption >= 0 && r.selectedOption < counts.length) {
      counts[r.selectedOption] += 1;
    }
  });
  return counts;
}

// Broadcast the standard bundle of updates to a room.
function broadcastRoom(session) {
  io.to(session.roomPin).emit('state', publicState(session));
  io.to(session.roomPin).emit('participants', rankedParticipants(session));
  io.to(session.roomPin).emit('leaderboard', rankedParticipants(session));
}

// Send the full question list (WITH answer keys) privately to the host.
function sendQuestionsToHost(session, hostSocketId) {
  const questions = session.slides.map((s, i) => ({
    index: i,
    type: s.type,
    title: s.title,
    question: s.question,
    choices: s.choices,
    correctOption: s.correctOption,
    timeLimit: s.timeLimit
  }));
  io.to(hostSocketId).emit('host:questions', questions);
}

// Move to a slide index (or end the quiz). Resets the timer.
function goToSlide(session, index) {
  if (index >= session.slides.length) {
    session.currentSlideIndex = session.slides.length;
    session.currentState = 'Ended';
    session.slideStartTime = null;
    return;
  }
  session.currentSlideIndex = Math.max(0, index);
  session.currentState = 'Question';
  session.slideStartTime = new Date();
}

function emitQuestion(session) {
  const slide = publicSlide(session);
  if (slide) io.to(session.roomPin).emit('question', slide);
}

function emitEnded(session) {
  io.to(session.roomPin).emit('ended', { leaderboard: rankedParticipants(session) });
}

/* ------------------------------------------------------------------ */
/*  SOCKET HANDLERS                                                   */
/* ------------------------------------------------------------------ */
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  /* ----------  HOST: create a brand new room  ---------- */
  socket.on('host:create', async () => {
    try {
      const roomPin = await uniquePin();
      const session = new Session({
        roomPin,
        currentState: 'Lobby',
        currentSlideIndex: 0,
        hostSocketId: socket.id,
        slides: [],
        participants: []
      });
      await session.save();

      socket.join(roomPin);
      socket.emit('host:created', { roomPin, state: publicState(session) });
      sendQuestionsToHost(session, socket.id);
    } catch (err) {
      socket.emit('errorMsg', { message: 'Could not create session' });
    }
  });

  /* ----------  HOST: join / take control of an existing room  ---------- */
  socket.on('host:join', async ({ roomPin }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return socket.emit('errorMsg', { message: 'Room not found' });

      session.hostSocketId = socket.id;
      await session.save();

      socket.join(roomPin);
      socket.emit('host:joined', { roomPin, state: publicState(session) });
      sendQuestionsToHost(session, socket.id);
      broadcastRoom(session);
    });
  });

  /* ----------  HOST: add a question  ---------- */
  socket.on('host:addQuestion', async ({ roomPin, question }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return socket.emit('errorMsg', { message: 'Room not found' });

      const choices = Array.isArray(question.choices)
        ? question.choices.map((c) => String(c)).filter((c) => c.trim() !== '')
        : [];

      if (!question.question || choices.length < 2) {
        return socket.emit('errorMsg', {
          message: 'A question needs text and at least 2 choices'
        });
      }

      session.slides.push({
        type: 'MCQ',
        title: question.title || `Question ${session.slides.length + 1}`,
        question: question.question,
        choices,
        correctOption: Math.min(
          Math.max(0, Number(question.correctOption) || 0),
          choices.length - 1
        ),
        timeLimit: Math.max(5000, Number(question.timeLimit) || 20000),
        responses: []
      });

      await session.save();
      sendQuestionsToHost(session, socket.id);
      broadcastRoom(session);
    });
  });

  /* ----------  HOST: delete a question  ---------- */
  socket.on('host:deleteQuestion', async ({ roomPin, index }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;
      if (index >= 0 && index < session.slides.length) {
        session.slides.splice(index, 1);
        await session.save();
        sendQuestionsToHost(session, socket.id);
        broadcastRoom(session);
      }
    });
  });

  /* ----------  HOST: start the quiz  ---------- */
  socket.on('host:start', async ({ roomPin }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;
      if (session.slides.length === 0) {
        return socket.emit('errorMsg', { message: 'Add at least one question first' });
      }
      session.startTime = new Date();
      goToSlide(session, 0);
      await session.save();
      broadcastRoom(session);
      emitQuestion(session);
    });
  });

  /* ----------  HOST / PRESENTER: navigation + reveal  ---------- */
  const advance = (dir) => async ({ roomPin }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;

      const target = session.currentSlideIndex + dir;
      goToSlide(session, target);
      await session.save();

      broadcastRoom(session);
      if (session.currentState === 'Ended') emitEnded(session);
      else emitQuestion(session);
    });
  };

  const reveal = async ({ roomPin }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;
      const slide = session.slides[session.currentSlideIndex];
      if (!slide) return;

      session.currentState = 'Reveal';
      await session.save();

      io.to(roomPin).emit('reveal', {
        correctOption: slide.correctOption,
        counts: answerCounts(session)
      });
      broadcastRoom(session);
    });
  };

  socket.on('host:next', advance(1));
  socket.on('host:prev', advance(-1));
  socket.on('host:reveal', reveal);
  socket.on('presenter:next', advance(1));
  socket.on('presenter:prev', advance(-1));
  socket.on('presenter:reveal', reveal);

  /* ----------  HOST: kick a participant  ---------- */
  socket.on('host:kick', async ({ roomPin, socketId }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;

      const before = session.participants.length;
      session.participants = session.participants.filter((p) => p.socketId !== socketId);
      if (session.participants.length !== before) {
        await session.save();

        const target = io.sockets.sockets.get(socketId);
        if (target) {
          target.emit('kicked', { message: 'You were removed by the host' });
          target.leave(roomPin);
        }
        broadcastRoom(session);
      }
    });
  });

  /* ----------  HOST: end the quiz  ---------- */
  socket.on('host:end', async ({ roomPin }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;
      session.currentState = 'Ended';
      session.slideStartTime = null;
      await session.save();
      broadcastRoom(session);
      emitEnded(session);
    });
  });

  /* ----------  PRESENTER: join a room (display only)  ---------- */
  socket.on('presenter:join', async ({ roomPin }) => {
    const session = await Session.findOne({ roomPin });
    if (!session) return socket.emit('errorMsg', { message: 'Room not found' });
    socket.join(roomPin);
    socket.emit('presenter:joined', { roomPin, state: publicState(session) });
    const ps = publicSlide(session);
    if (session.currentState === 'Question' && ps) socket.emit('question', ps);
  });

  /* ----------  PLAYER: join a room  ---------- */
  socket.on('player:join', async ({ roomPin, nickname }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return socket.emit('errorMsg', { message: 'Room not found' });

      const name = String(nickname || '').trim();
      if (!name) return socket.emit('errorMsg', { message: 'Nickname required' });

      socket.join(roomPin);

      let participant = session.participants.find((p) => p.socketId === socket.id);
      if (!participant) {
        session.participants.push({ socketId: socket.id, nickname: name, connected: true });
      } else {
        participant.nickname = name;
        participant.connected = true;
      }
      await session.save();

      socket.emit('player:joined', { roomPin, nickname: name, state: publicState(session) });
      // If they joined mid-question, push the live question to THIS socket only
      // (re-broadcasting to the room would reset everyone else's answer state).
      const ps = publicSlide(session);
      if (session.currentState === 'Question' && ps) socket.emit('question', ps);
      broadcastRoom(session);
    });
  });

  /* ----------  PLAYER: submit an answer  ---------- */
  socket.on('player:answer', async ({ roomPin, selectedOption }) => {
    await withRoomLock(roomPin, async () => {
      const session = await Session.findOne({ roomPin });
      if (!session) return;
      if (session.currentState !== 'Question') return;

      const slide = session.slides[session.currentSlideIndex];
      if (!slide) return;

      const participant = session.participants.find((p) => p.socketId === socket.id);
      if (!participant) return;

      // one answer per slide
      if (slide.responses.find((r) => r.socketId === socket.id)) return;

      // server-authoritative timing
      const startedAt = session.slideStartTime ? session.slideStartTime.getTime() : Date.now();
      const elapsed = Date.now() - startedAt;
      const timeTaken = Math.min(Math.max(0, elapsed), slide.timeLimit);
      const tooLate = elapsed > slide.timeLimit + 500; // small grace for latency

      const isCorrect =
        !tooLate && Number(selectedOption) === Number(slide.correctOption);

      let points = 0;
      if (isCorrect) {
        points = computePoints({
          timeTaken,
          timeLimit: slide.timeLimit,
          streak: participant.streak
        });
        participant.score += points;
        participant.streak += 1;
      } else {
        participant.streak = 0;
      }

      slide.responses.push({
        socketId: socket.id,
        nickname: participant.nickname,
        selectedOption: Number(selectedOption),
        timeTaken,
        isCorrect,
        pointsEarned: points
      });

      await session.save();

      const ranked = rankedParticipants(session);
      const myRank = ranked.find((p) => p.socketId === socket.id);

      socket.emit('answerResult', {
        isCorrect,
        points,
        totalScore: participant.score,
        rank: myRank ? myRank.rank : null
      });

      io.to(roomPin).emit('answerStats', {
        answered: slide.responses.length,
        total: session.participants.length
      });
      io.to(roomPin).emit('leaderboard', ranked);
    });
  });

  /* ----------  DISCONNECT  ---------- */
  socket.on('disconnect', async () => {
    console.log('Disconnected:', socket.id);
    // Best-effort: mark the player disconnected (keep their score on the board).
    try {
      const session = await Session.findOne({ 'participants.socketId': socket.id });
      if (!session) return;
      await withRoomLock(session.roomPin, async () => {
        const fresh = await Session.findOne({ roomPin: session.roomPin });
        if (!fresh) return;
        const p = fresh.participants.find((x) => x.socketId === socket.id);
        if (p) {
          p.connected = false;
          await fresh.save();
          broadcastRoom(fresh);
        }
      });
    } catch (_) {
      /* ignore */
    }
  });
});

/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Running On', PORT));