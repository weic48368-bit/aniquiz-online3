
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const QUESTIONS = require("./questions");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MAX_PLAYERS = 12;
const QUESTION_SECONDS = 20;
const TOTAL_QUESTIONS = 10;

app.use(express.static(__dirname));
app.get("/health", (_req, res) => res.json({ ok: true }));

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 12);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    isHost: p.id === room.hostId,
    answered: room.status === "playing" ? p.answered : false
  }));
}

function roomInfo(room) {
  return {
    code: room.code,
    players: publicPlayers(room),
    status: room.status,
    category: room.category,
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length
  };
}

function sendRoom(room) {
  io.to(room.code).emit("room:update", roomInfo(room));
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}


function selectQuestions(category) {
  const validQuestions = QUESTIONS.filter(q =>
    q &&
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.length >= 2 &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer < q.options.length &&
    Array.isArray(q.categories)
  );

  let pool = category === "all"
    ? validQuestions
    : validQuestions.filter(q => q.categories.includes(category));

  if (!pool.length) pool = validQuestions;

  return shuffle(pool)
    .slice(0, TOTAL_QUESTIONS)
    .map(q => {
      const options = shuffle(
        q.options.map((text, index) => ({
          text,
          originalIndex: index
        }))
      );

      return {
        ...q,
        options: options.map(item => item.text),
        answer: options.findIndex(
          item => item.originalIndex === q.answer
        )
      };
    });
}


function endGame(room) {
  clearRoomTimer(room);

  room.status = "finished";

  const players = publicPlayers(room)
    .sort((a, b) => b.score - a.score);

  io.to(room.code).emit("game:finished", { players });

  sendRoom(room);
}

function advanceQuestion(room, token) {
  if (room.status !== "playing") return;
  if (room.roundToken !== token) return;

  clearRoomTimer(room);

  room.questionIndex++;
  sendQuestion(room);
}

function sendQuestion(room) {
  clearRoomTimer(room);

  if (room.status !== "playing") return;

  if (room.questionIndex >= room.questions.length) {
    return endGame(room);
  }

  const q = room.questions[room.questionIndex];
  const token = ++room.roundToken;

  room.players.forEach(p => {
    p.answered = false;
  });

  io.to(room.code).emit("game:question", {
    question: q.question,
    options: q.options,
    category: q.label || q.title || "動漫",
    number: room.questionIndex + 1,
    total: room.questions.length,
    seconds: QUESTION_SECONDS
  });

  sendRoom(room);

  room.timer = setTimeout(() => {
    if (room.roundToken !== token) return;

    io.to(room.code).emit("game:timeout");
    advanceQuestion(room, token);
  }, QUESTION_SECONDS * 1000);
}

function scheduleNextQuestion(room, delay = 1200) {
  clearRoomTimer(room);

  const token = room.roundToken;

  room.timer = setTimeout(() => {
    advanceQuestion(room, token);
  }, delay);
}

io.on("connection", socket => {

  // 建立房間
  socket.on("room:create", (data = {}, callback = () => {}) => {
    const name = cleanName(data.name);
    const category = data.category || "all";

    if (!name) {
      return callback({ ok: false, error: "請先輸入暱稱" });
    }

    const code = makeCode();

    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      status: "lobby",
      category,
      questions: [],
      questionIndex: 0,
      roundToken: 0,
      timer: null
    };

    room.players.set(socket.id, {
      id: socket.id,
      name,
      score: 0,
      answered: false
    });

    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    callback({ ok: true, code });
    sendRoom(room);
  });

  // 加入房間
  socket.on("room:join", (data = {}, callback = () => {}) => {
    const name = cleanName(data.name);
    const code = String(data.code || "").trim().toUpperCase();

    const room = rooms.get(code);

    if (!name) {
      return callback({ ok: false, error: "請先輸入暱稱" });
    }

    if (!room) {
      return callback({
        ok: false,
        error: "找不到這個房間，請確認房號"
      });
    }

    if (room.status !== "lobby") {
      return callback({
        ok: false,
        error: "遊戲已經開始，無法加入"
      });
    }

    if (room.players.size >= MAX_PLAYERS) {
      return callback({ ok: false, error: "房間已滿" });
    }

    room.players.set(socket.id, {
      id: socket.id,
      name,
      score: 0,
      answered: false
    });

    socket.join(code);
    socket.data.roomCode = code;

    callback({ ok: true, code });
    sendRoom(room);
  });

  // 開始遊戲
  socket.on("game:start", (_data, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room) {
      return callback({
        ok: false,
        error: "房間不存在"
      });
    }

    if (socket.id !== room.hostId) {
      return callback({
        ok: false,
        error: "只有房主可以開始"
      });
    }

    if (room.status !== "lobby") {
      return callback({
        ok: false,
        error: "目前無法開始遊戲"
      });
    }

    if (!room.players.size) {
      return callback({
        ok: false,
        error: "至少需要一位玩家"
      });
    }

    room.questions = selectQuestions(room.category);

    if (!room.questions.length) {
      return callback({
        ok: false,
        error: "題庫沒有可用題目"
      });
    }

    room.status = "playing";
    room.questionIndex = 0;
    room.roundToken = 0;

    room.players.forEach(p => {
      p.score = 0;
      p.answered = false;
    });

    callback({ ok: true });
    sendQuestion(room);
  });

  // 玩家回答
  socket.on("game:answer", (data = {}, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.status !== "playing") {
      return callback({ ok: false });
    }

    const player = room.players.get(socket.id);
    const q = room.questions[room.questionIndex];

    if (!player || player.answered || !q) {
      return callback({ ok: false });
    }

    const index = Number(data.index);

    if (!Number.isInteger(index) ||
        index < 0 ||
        index >= q.options.length) {
      return callback({ ok: false });
    }

    player.answered = true;

    const correct = index === q.answer;

    if (correct) {
      player.score += 100;
    }

    callback({
      ok: true,
      correct,
      answer: q.answer,
      score: player.score
    });

    io.to(room.code).emit("player:answered", {
      playerId: socket.id,
      players: publicPlayers(room)
    });

    if (
      [...room.players.values()].length > 0 &&
      [...room.players.values()].every(p => p.answered)
    ) {
      scheduleNextQuestion(room);
    }
  });

  // 房主重新開始
  socket.on("game:restart", (_data, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room) {
      return callback({
        ok: false,
        error: "房間不存在"
      });
    }

    if (socket.id !== room.hostId) {
      return callback({
        ok: false,
        error: "只有房主可以重新開始"
      });
    }

    if (room.status !== "finished") {
      return callback({
        ok: false,
        error: "目前無法重新開始"
      });
    }

    clearRoomTimer(room);

    room.status = "lobby";
    room.questions = [];
    room.questionIndex = 0;
    room.roundToken++;

    room.players.forEach(p => {
      p.score = 0;
      p.answered = false;
    });

    callback({ ok: true });
    sendRoom(room);
  });

  // 玩家離線
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room) return;

    room.players.delete(socket.id);

    if (!room.players.size) {
      clearRoomTimer(room);
      rooms.delete(code);
      return;
    }

    // 房主離開時轉移房主
    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value;
    }

    sendRoom(room);

    // 遊戲中所有剩餘玩家都已作答
    if (
      room.status === "playing" &&
      [...room.players.values()].every(p => p.answered)
    ) {
      scheduleNextQuestion(room, 800);
    }
  });
});

server.listen(PORT, () => {
  console.log(`AniQuiz LOVE 3.0 running on port ${PORT}`);
});
