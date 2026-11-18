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
    code = Array.from({length: 5}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, score: p.score, isHost: p.id === room.hostId,
    answered: room.status === "playing" ? p.answered : false
  }));
}
function roomInfo(room) {
  return { code: room.code, players: publicPlayers(room), status: room.status,
    category: room.category, questionIndex: room.questionIndex,
    totalQuestions: room.questions.length };
}
function sendRoom(room) { io.to(room.code).emit("room:update", roomInfo(room)); }
function cleanName(value) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, 12);
}
function selectQuestions(category) {
  let pool = category === "all" ? QUESTIONS : QUESTIONS.filter(q => q.categories.includes(category));
  if (!pool.length) pool = QUESTIONS;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, TOTAL_QUESTIONS);
}
function endGame(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.status = "finished";
  io.to(room.code).emit("game:finished", { players: publicPlayers(room).sort((a,b)=>b.score-a.score) });
  sendRoom(room);
}
function sendQuestion(room) {
  if (room.timer) clearTimeout(room.timer);
  if (room.questionIndex >= room.questions.length) return endGame(room);
  const q = room.questions[room.questionIndex];
  room.players.forEach(p => { p.answered = false; });
  io.to(room.code).emit("game:question", {
    question: q.question, options: q.options, category: q.label,
    number: room.questionIndex + 1, total: room.questions.length,
    seconds: QUESTION_SECONDS
  });
  sendRoom(room);
  room.timer = setTimeout(() => {
    io.to(room.code).emit("game:timeout");
    room.questionIndex++;
    sendQuestion(room);
  }, QUESTION_SECONDS * 1000);
}

io.on("connection", socket => {
  socket.on("room:create", ({name, category}, callback = () => {}) => {
    name = cleanName(name);
    if (!name) return callback({ok:false, error:"請先輸入暱稱"});
    const code = makeCode();
    const room = { code, hostId: socket.id, players: new Map(), status:"lobby",
      category: category || "all", questions:[], questionIndex:0, timer:null };
    room.players.set(socket.id, {id:socket.id, name, score:0, answered:false});
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback({ok:true, code});
    sendRoom(room);
  });

  socket.on("room:join", ({name, code}, callback = () => {}) => {
    name = cleanName(name); code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!name) return callback({ok:false, error:"請先輸入暱稱"});
    if (!room) return callback({ok:false, error:"找不到這個房間，請確認房號"});
    if (room.status !== "lobby") return callback({ok:false, error:"遊戲已經開始，無法加入"});
    if (room.players.size >= MAX_PLAYERS) return callback({ok:false, error:"房間已滿"});
    room.players.set(socket.id, {id:socket.id, name, score:0, answered:false});
    socket.join(code); socket.data.roomCode = code;
    callback({ok:true, code});
    sendRoom(room);
  });

  socket.on("game:start", callback => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback?.({ok:false,error:"房間不存在"});
    if (socket.id !== room.hostId) return callback?.({ok:false,error:"只有房主可以開始"});
    if (room.status !== "lobby") return callback?.({ok:false,error:"遊戲已經開始"});
    if (room.players.size < 1) return callback?.({ok:false,error:"至少需要一位玩家"});
    room.status = "playing";
    room.questions = selectQuestions(room.category);
    room.questionIndex = 0;
    room.players.forEach(p => p.score = 0);
    callback?.({ok:true});
    sendQuestion(room);
  });

  socket.on("game:answer", ({index}, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return callback({ok:false});
    const player = room.players.get(socket.id);
    const q = room.questions[room.questionIndex];
    if (!player || player.answered || !q) return callback({ok:false});
    player.answered = true;
    const correct = Number(index) === q.answer;
    if (correct) player.score += 100;
    callback({ok:true, correct, answer:q.answer, score:player.score});
    io.to(room.code).emit("player:answered", {playerId:socket.id, players:publicPlayers(room)});
    if ([...room.players.values()].every(p => p.answered)) {
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => {
        room.questionIndex++;
        sendQuestion(room);
      }, 1200);
    }
  });

  socket.on("game:restart", callback => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback?.({ok:false,error:"房間不存在"});
    if (socket.id !== room.hostId) return callback?.({ok:false,error:"只有房主可以重新開始"});
    if (room.timer) clearTimeout(room.timer);
    room.status = "lobby"; room.questions = []; room.questionIndex = 0;
    room.players.forEach(p => { p.score = 0; p.answered = false; });
    callback?.({ok:true}); sendRoom(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    if (!room.players.size) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    sendRoom(room);
    if (room.status === "playing" && [...room.players.values()].every(p=>p.answered)) {
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => { room.questionIndex++; sendQuestion(room); }, 800);
    }
  });
});

server.listen(PORT, () => console.log(`AniQuiz Love running on ${PORT}`));
