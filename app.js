const socket = io();
const $ = id => document.getElementById(id);
const screens = ["homeScreen","lobbyScreen","gameScreen","finishScreen"];
let selectedCategory = "all", roomCode = null, isHost = false, roomState = null;
let timerInterval = null, toastTimer = null, hasAnswered = false, myScore = 0;

function showScreen(id){ screens.forEach(s => $(s).classList.toggle("active",s===id)); }
function toast(msg){ const el=$("toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2200); }
function message(msg){ $("homeMessage").textContent=msg||""; }
function emitAck(event,data){ return new Promise(resolve=>socket.emit(event,data,result=>resolve(result||{ok:false,error:"連線沒有回應"}))); }
function categoryName(cat){ return ({all:"綜合全部",recent:"近期戀愛番",classic:"經典戀愛番",early:"早期戀愛番",school:"校園戀愛",pure:"純愛",comedy:"戀愛喜劇",fantasy:"奇幻戀愛",tearjerker:"虐心催淚"})[cat]||"綜合全部"; }

document.querySelectorAll(".category").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".category").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected"); selectedCategory=btn.dataset.category;
}));
$("createBtn").onclick=async()=>{
  message(""); const name=$("playerName").value.trim();
  const res=await emitAck("room:create",{name,category:selectedCategory});
  if(!res.ok) return message(res.error);
  roomCode=res.code; isHost=true; showScreen("lobbyScreen");
};
$("joinBtn").onclick=async()=>{
  message(""); const name=$("playerName").value.trim(), code=$("roomCodeInput").value.trim().toUpperCase();
  const res=await emitAck("room:join",{name,code});
  if(!res.ok) return message(res.error);
  roomCode=res.code; isHost=false; showScreen("lobbyScreen");
};
$("roomCodeInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5));
$("copyCodeBtn").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast("房號已複製！")}catch{toast("你的房號是 "+roomCode)}};
$("startBtn").onclick=async()=>{const res=await emitAck("game:start");if(!res.ok)toast(res.error);};
$("leaveBtn").onclick=()=>{location.reload();};
$("restartBtn").onclick=async()=>{const res=await emitAck("game:restart");if(!res.ok)toast(res.error);};
$("backHomeBtn").onclick=()=>location.reload();

socket.on("room:update",room=>{
  roomState=room; roomCode=room.code;
  $("roomCode").textContent=room.code;
  $("lobbyCategory").textContent=categoryName(room.category);
  $("playerCount").textContent=`${room.players.length} / 12 人`;
  $("playerList").innerHTML=room.players.map(p=>`<div class="player-chip ${p.isHost?"host":""}">${escapeHtml(p.name)}</div>`).join("");
  isHost=room.players.some(p=>p.id===socket.id&&p.isHost);
  $("startBtn").style.display=isHost&&room.status==="lobby"?"block":"none";
  $("hostHint").textContent=isHost?"你是房主，可以開始遊戲":"等待房主開始遊戲";
  if(room.status==="lobby"&&screens.every(s=>!$(s).classList.contains("active")))showScreen("lobbyScreen");
});
socket.on("game:question",data=>{
  showScreen("gameScreen");hasAnswered=false;
  $("questionNumber").textContent=`${String(data.number).padStart(2,"0")} / ${data.total}`;
  $("questionCategory").textContent=data.category;
  $("questionText").textContent=data.question;
  $("progressBar").style.width=`${data.number/data.total*100}%`;
  $("answerFeedback").textContent="";$("answerFeedback").className="feedback";
  $("answerGrid").innerHTML=data.options.map((opt,i)=>`<button class="answer" data-index="${i}"><span class="letter">${"ABCD"[i]}</span>${escapeHtml(opt)}</button>`).join("");
  document.querySelectorAll(".answer").forEach(btn=>btn.onclick=()=>submitAnswer(Number(btn.dataset.index)));
  startTimer(data.seconds); updateScore();
});
function startTimer(seconds){clearInterval(timerInterval);let left=seconds;$("timer").textContent=left;timerInterval=setInterval(()=>{left--; $("timer").textContent=Math.max(0,left);if(left<=0)clearInterval(timerInterval);},1000);}
async function submitAnswer(index){
  if(hasAnswered)return;hasAnswered=true;clearInterval(timerInterval);
  document.querySelectorAll(".answer").forEach(b=>b.disabled=true);
  const res=await emitAck("game:answer",{index});
  if(!res.ok){$("answerFeedback").textContent="未能送出答案";return;}
  const buttons=[...document.querySelectorAll(".answer")];
  if(buttons[res.answer])buttons[res.answer].classList.add("correct");
  if(!res.correct&&buttons[index])buttons[index].classList.add("wrong");
  $("answerFeedback").textContent=res.correct?"答對了！ +100 分":"再接再厲！";
  $("answerFeedback").className="feedback "+(res.correct?"good":"bad");
  myScore=res.score;updateScore();
}
function updateScore(){ $("myScore").textContent=myScore; }
socket.on("player:answered",data=>{const me=data.players.find(p=>p.id===socket.id);if(me){myScore=me.score;updateScore();}$("answeredCount").textContent=`已作答 ${data.players.filter(p=>p.answered).length} 人`;});
socket.on("game:timeout",()=>{clearInterval(timerInterval);if(!hasAnswered){hasAnswered=true;document.querySelectorAll(".answer").forEach(b=>b.disabled=true);$("answerFeedback").textContent="時間到！";$("answerFeedback").className="feedback bad";}});
socket.on("game:finished",data=>{
  clearInterval(timerInterval);showScreen("finishScreen");
  const medals=["🥇","🥈","🥉"];
  $("finalRanking").innerHTML=data.players.map((p,i)=>`<div class="rank-row"><span class="rank-num">${medals[i]||i+1}</span><span class="rank-name">${escapeHtml(p.name)}</span><span class="rank-score">${p.score} 分</span></div>`).join("");
  $("restartBtn").style.display=isHost?"block":"none";
});
socket.on("connect_error",()=>message("連線失敗，請重新整理頁面"));
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
