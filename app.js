
const socket = io();

const $ = id => document.getElementById(id);

const screens = [
  "homeScreen",
  "lobbyScreen",
  "gameScreen",
  "finishScreen"
];

let selectedCategory = "all";
let roomCode = null;
let isHost = false;
let roomState = null;

let timerInterval = null;
let toastTimer = null;
let hasAnswered = false;
let myScore = 0;

function showScreen(id) {
  screens.forEach(screen => {
    $(screen).classList.toggle("active", screen === id);
  });
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
}

function message(msg) {
  $("homeMessage").textContent = msg || "";
}

function emitAck(event, data = {}) {
  return new Promise(resolve => {
    socket.emit(event, data, result => {
      resolve(result || {
        ok: false,
        error: "連線沒有回應，請稍後再試"
      });
    });
  });
}

function categoryName(cat) {
  return ({
    all: "綜合全部",
    recent: "近期戀愛番",
    classic: "經典戀愛番",
    early: "早期戀愛番",
    school: "校園戀愛",
    pure: "純愛",
    comedy: "戀愛喜劇",
    fantasy: "奇幻戀愛",
    tearjerker: "虐心催淚"
  })[cat] || "綜合全部";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateScore() {
  $("myScore").textContent = myScore;
}

// 選擇題庫
document.querySelectorAll(".category").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".category").forEach(b => {
      b.classList.remove("selected");
    });

    btn.classList.add("selected");
    selectedCategory = btn.dataset.category;
  });
});

// 建立房間
$("createBtn").onclick = async () => {
  if (!socket.connected) {
    return message("目前尚未連線，請稍後再試");
  }

  message("");

  const name = $("playerName").value.trim();

  const res = await emitAck("room:create", {
    name,
    category: selectedCategory
  });

  if (!res.ok) {
    return message(res.error);
  }

  roomCode = res.code;
  isHost = true;

  $("roomCode").textContent = roomCode;

  showScreen("lobbyScreen");
};

// 加入房間
$("joinBtn").onclick = async () => {
  if (!socket.connected) {
    return message("目前尚未連線，請稍後再試");
  }

  message("");

  const name = $("playerName").value.trim();

  const code = $("roomCodeInput")
    .value.trim()
    .toUpperCase();

  const res = await emitAck("room:join", {
    name,
    code
  });

  if (!res.ok) {
    return message(res.error);
  }

  roomCode = res.code;
  isHost = false;

  showScreen("lobbyScreen");
};

// 房號輸入限制
$("roomCodeInput").addEventListener("input", e => {
  e.target.value = e.target.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
});

// 複製房號
$("copyCodeBtn").onclick = async () => {
  if (!roomCode) return;

  try {
    await navigator.clipboard.writeText(roomCode);
    toast("房號已複製！");
  } catch {
    toast("你的房號是 " + roomCode);
  }
};

// 開始遊戲
$("startBtn").onclick = async () => {
  const res = await emitAck("game:start");

  if (!res.ok) {
    toast(res.error);
  }
};

// 離開房間
$("leaveBtn").onclick = () => {
  location.reload();
};

// 重新開始
$("restartBtn").onclick = async () => {
  const res = await emitAck("game:restart");

  if (!res.ok) {
    toast(res.error);
  }
};

// 回到首頁
$("backHomeBtn").onclick = () => {
  location.reload();
};

// 房間狀態同步
socket.on("room:update", room => {
  roomState = room;
  roomCode = room.code;

  $("roomCode").textContent = room.code;

  $("lobbyCategory").textContent =
    categoryName(room.category);

  $("playerCount").textContent =
    `${room.players.length} / 12 人`;

  $("playerList").innerHTML = room.players
    .map(p => `
      <div class="player-chip ${p.isHost ? "host" : ""}">
        ${escapeHtml(p.name)}
      </div>
    `)
    .join("");

  const me = room.players.find(p => p.id === socket.id);

  isHost = Boolean(me && me.isHost);

  $("startBtn").style.display =
    isHost && room.status === "lobby"
      ? "block"
      : "none";

  $("restartBtn").style.display =
    isHost && room.status === "finished"
      ? "block"
      : "none";

  $("hostHint").textContent = isHost
    ? "你是房主，可以開始遊戲"
    : "等待房主開始遊戲";

  // 房主重新開始後，所有玩家返回大廳
  if (
    room.status === "lobby" &&
    (
      $("finishScreen").classList.contains("active") ||
      $("gameScreen").classList.contains("active")
    )
  ) {
    stopTimer();

    hasAnswered = false;
    myScore = 0;

    updateScore();

    $("answeredCount").textContent = "已作答 0 人";

    showScreen("lobbyScreen");
  }
});

// 題目發送
socket.on("game:question", data => {
  stopTimer();

  showScreen("gameScreen");

  hasAnswered = false;

  $("questionNumber").textContent =
    `${String(data.number).padStart(2, "0")} / ${data.total}`;

  $("questionCategory").textContent =
    data.category || "";

  $("questionText").textContent =
    data.question;

  $("progressBar").style.width =
    `${data.number / data.total * 100}%`;

  $("answerFeedback").textContent = "";
  $("answerFeedback").className = "feedback";

  $("answeredCount").textContent = "已作答 0 人";

  $("answerGrid").innerHTML = data.options
    .map((opt, i) => `
      <button class="answer" data-index="${i}">
        <span class="letter">${"ABCD"[i] || i + 1}</span>
        ${escapeHtml(opt)}
      </button>
    `)
    .join("");

  document.querySelectorAll(".answer").forEach(btn => {
    btn.onclick = () => {
      submitAnswer(Number(btn.dataset.index));
    };
  });

  startTimer(data.seconds);
  updateScore();
});

// 倒數計時
function startTimer(seconds) {
  stopTimer();

  let left = seconds;

  $("timer").textContent = left;

  timerInterval = setInterval(() => {
    left--;

    $("timer").textContent = Math.max(0, left);

    if (left <= 0) {
      stopTimer();
    }
  }, 1000);
}

// 玩家答題
async function submitAnswer(index) {
  if (hasAnswered) return;

  hasAnswered = true;

  stopTimer();

  const buttons = [
    ...document.querySelectorAll(".answer")
  ];

  buttons.forEach(btn => {
    btn.disabled = true;
  });

  const res = await emitAck("game:answer", {
    index
  });

  if (!res.ok) {
    $("answerFeedback").textContent =
      "未能送出答案，請等待下一題";

    return;
  }

  if (buttons[res.answer]) {
    buttons[res.answer].classList.add("correct");
  }

  if (!res.correct && buttons[index]) {
    buttons[index].classList.add("wrong");
  }

  $("answerFeedback").textContent =
    res.correct
      ? "答對了！ +100 分"
      : "再接再厲！";

  $("answerFeedback").className =
    "feedback " + (res.correct ? "good" : "bad");

  myScore = res.score;

  updateScore();
}

// 玩家作答同步
socket.on("player:answered", data => {
  const me = data.players.find(p => p.id === socket.id);

  if (me) {
    myScore = me.score;
    updateScore();
  }

  $("answeredCount").textContent =
    `已作答 ${data.players.filter(p => p.answered).length} 人`;
});

// 時間結束
socket.on("game:timeout", () => {
  stopTimer();

  if (!hasAnswered) {
    hasAnswered = true;

    document.querySelectorAll(".answer").forEach(btn => {
      btn.disabled = true;
    });

    $("answerFeedback").textContent = "時間到！";

    $("answerFeedback").className = "feedback bad";
  }
});

// 遊戲結束
socket.on("game:finished", data => {
  stopTimer();

  showScreen("finishScreen");

  const medals = ["🥇", "🥈", "🥉"];

  $("finalRanking").innerHTML = data.players
    .map((p, i) => `
      <div class="rank-row">
        <span class="rank-num">
          ${medals[i] || i + 1}
        </span>
        <span class="rank-name">
          ${escapeHtml(p.name)}
        </span>
        <span class="rank-score">
          ${p.score} 分
        </span>
      </div>
    `)
    .join("");

  $("restartBtn").style.display =
    isHost ? "block" : "none";
});

// 連線成功
socket.on("connect", () => {
  message("");
});

// 連線失敗
socket.on("connect_error", () => {
  message("連線失敗，請重新整理頁面");
});

// 伺服器斷線
socket.on("disconnect", () => {
  stopTimer();

  toast("連線中斷，請重新整理頁面");
});
