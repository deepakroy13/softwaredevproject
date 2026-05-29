/*
 * Quick CLI test for the HOST side. Creates a room, adds a question,
 * starts the quiz, then reveals and advances.
 *
 *   node host_client.js
 */
const io = require('socket.io-client');

const PORT = process.env.PORT || 3001;
const socket = io(`http://localhost:${PORT}`);

let roomPin = null;

socket.on('connect', () => {
  console.log('host connected', socket.id);
  socket.emit('host:create');
});

socket.on('host:created', ({ roomPin: pin }) => {
  roomPin = pin;
  console.log('Room created. PIN =', pin);

  // Add a question
  socket.emit('host:addQuestion', {
    roomPin,
    question: {
      question: 'What is 2 + 2?',
      choices: ['1', '2', '4', '5'],
      correctOption: 2,
      timeLimit: 15000
    }
  });

  // Start after players have had a moment to join
  setTimeout(() => {
    console.log('Host: starting quiz');
    socket.emit('host:start', { roomPin });
  }, 4000);

  // Reveal, then advance
  setTimeout(() => socket.emit('host:reveal', { roomPin }), 9000);
  setTimeout(() => socket.emit('host:next', { roomPin }), 11000);
});

socket.on('host:questions', (q) => console.log('questions:', q.length));
socket.on('participants', (p) => console.log('participants:', p.map((x) => x.nickname)));
socket.on('leaderboard', (l) => console.log('leaderboard:', l.map((x) => `${x.rank}.${x.nickname}=${x.score}`)));
socket.on('reveal', (d) => console.log('reveal correctOption:', d.correctOption, 'counts:', d.counts));
socket.on('ended', (d) => console.log('ended:', d.leaderboard.map((x) => `${x.rank}.${x.nickname}`)));
socket.on('errorMsg', (e) => console.log('errorMsg:', e.message));