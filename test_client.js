/*
 * Quick CLI test for the PLAYER side. Assumes a room exists (e.g. run `npm run seed`
 * for PIN 9999, then start the quiz from the host dashboard or host_client.js).
 *
 *   node test_client.js
 */
const io = require('socket.io-client');

const PORT = process.env.PORT || 3001;
const ROOM_PIN = process.env.ROOM_PIN || '9999';
const socket = io(`http://localhost:${PORT}`);

socket.on('connect', () => {
  console.log('connected:', socket.id);
  socket.emit('player:join', { roomPin: ROOM_PIN, nickname: 'Alice' });
});

socket.on('player:joined', (data) => {
  console.log('player:joined:', JSON.stringify(data.state, null, 2));
});

// Auto-answer whenever a question starts (picks option 2 after a short delay).
socket.on('question', (q) => {
  console.log('question:', q.index + 1, q.question);
  setTimeout(() => {
    socket.emit('player:answer', { roomPin: ROOM_PIN, selectedOption: 2 });
  }, 1500);
});

socket.on('answerResult', (d) => console.log('answerResult:', JSON.stringify(d)));
socket.on('leaderboard', (d) => console.log('leaderboard:', JSON.stringify(d)));
socket.on('reveal', (d) => console.log('reveal:', JSON.stringify(d)));
socket.on('ended', (d) => console.log('ended:', JSON.stringify(d.leaderboard)));
socket.on('kicked', (d) => console.log('kicked:', d.message));
socket.on('errorMsg', (e) => console.log('errorMsg:', e.message));
socket.on('connect_error', (err) => console.log('connect_error:', err.message));
socket.on('disconnect', () => console.log('disconnected'));