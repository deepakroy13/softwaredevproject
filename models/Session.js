const mongoose = require('mongoose');

/* ----------  PARTICIPANT  ---------- */
const participantSchema = new mongoose.Schema(
  {
    socketId: { type: String, default: null },
    nickname: { type: String, required: true },
    score: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    rank: { type: Number, default: 0 },
    connected: { type: Boolean, default: true }
  },
  { _id: false }
);

/* ----------  RESPONSE (one per player per slide)  ---------- */
const responseSchema = new mongoose.Schema(
  {
    socketId: { type: String, required: true },
    nickname: { type: String, default: '' },
    selectedOption: { type: Number, required: true },
    timeTaken: { type: Number, default: 0 },
    isCorrect: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

/* ----------  SLIDE / QUESTION  ---------- */
const slideSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['MCQ', 'Info'], default: 'MCQ' },
    title: { type: String, default: '' },
    question: { type: String, default: '' },
    choices: [{ type: String }],
    correctOption: { type: Number, default: 0 }, // index of correct choice
    timeLimit: { type: Number, default: 20000 }, // milliseconds
    responses: [responseSchema]
  },
  { _id: false }
);

/* ----------  SESSION / ROOM  ---------- */
const sessionSchema = new mongoose.Schema(
  {
    roomPin: { type: String, required: true, unique: true },

    // Lobby | Question | Reveal | Ended
    currentState: { type: String, default: 'Lobby' },

    currentSlideIndex: { type: Number, default: 0 },

    hostSocketId: { type: String, default: null },

    participants: [participantSchema],
    slides: [slideSchema],

    slideStartTime: { type: Date, default: null },
    startTime: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Session', sessionSchema);