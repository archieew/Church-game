import { createGame, joinGame, listPlayers, subscribeToGame, updateGame, claimBuzzer, generateQuestion, supabaseConfigured, supabase, isGameColumnSupported, buildGameSelect, ensureGameColumns } from "./supabase.js";

const screens = document.querySelectorAll(".screen");
const questionBank = [
  { category: "PEOPLE OF THE BIBLE", text: "Who was known for his incredible strength and long hair?", choices: ["David", "Samson", "Solomon", "Samuel"], correct: 1, reference: "Judges 13–16", explanation: "Samson’s strength was connected to his Nazirite vow and uncut hair." },
  { category: "BIBLE EVENTS", text: "What did Jesus do when the storm threatened the disciples’ boat?", choices: ["He walked to shore", "He calmed the wind and waves", "He called for Roman soldiers", "He made the boat disappear"], correct: 1, reference: "Mark 4:35–41", explanation: "Jesus rebuked the wind and said to the sea, “Peace! Be still!”" },
  { category: "PEOPLE OF THE BIBLE", text: "Who interpreted Pharaoh’s dreams and became a leader in Egypt?", choices: ["Moses", "Joseph", "Daniel", "Nehemiah"], correct: 1, reference: "Genesis 41", explanation: "Joseph interpreted the dreams as seven years of abundance followed by seven years of famine." },
  { category: "BIBLE EVENTS", text: "What happened immediately after Jesus was baptized?", choices: ["He called the twelve disciples", "He entered Jerusalem", "He was led into the wilderness", "He fed the five thousand"], correct: 2, reference: "Matthew 4:1–11", explanation: "The Spirit led Jesus into the wilderness, where He was tempted." },
  { category: "PEOPLE OF THE BIBLE", text: "Who was Ruth’s mother-in-law?", choices: ["Sarah", "Hannah", "Naomi", "Elizabeth"], correct: 2, reference: "Ruth 1:3–5", explanation: "After the deaths of their husbands, Ruth stayed faithfully with Naomi." },
  { category: "BIBLE EVENTS", text: "Which event happened first?", choices: ["David defeated Goliath", "Solomon built the temple", "Israel crossed the Red Sea", "Jesus fed the five thousand"], correct: 2, reference: "Exodus 14", explanation: "Israel crossed the Red Sea during the Exodus, long before David, Solomon, and Jesus." },
  { category: "PEOPLE OF THE BIBLE", text: "Who was protected by God in a den of lions?", choices: ["Daniel", "Jeremiah", "Ezekiel", "Isaiah"], correct: 0, reference: "Daniel 6", explanation: "Daniel continued praying to God despite the king’s decree." },
  { category: "BIBLE EVENTS", text: "What sign did Jesus perform at the wedding in Cana?", choices: ["Healed a blind man", "Walked on water", "Turned water into wine", "Multiplied bread"], correct: 2, reference: "John 2:1–11", explanation: "Turning water into wine was Jesus’ first recorded sign in John’s Gospel." },
  { category: "PEOPLE OF THE BIBLE", text: "Who was the first king of Israel?", choices: ["David", "Saul", "Samuel", "Solomon"], correct: 1, reference: "1 Samuel 10:1", explanation: "Saul was anointed as Israel’s first king; David later succeeded him." },
  { category: "BIBLE EVENTS", text: "What did the Israelites receive in the wilderness as food from God?", choices: ["Manna", "Grapes", "Olives", "Fish"], correct: 0, reference: "Exodus 16:4–15", explanation: "God provided manna each morning during Israel’s journey through the wilderness." }
];

let currentQuestion = 0;
let score = 0;
let timerId;
let secondsLeft = 15;
let questionTimeLimit = 15;
let selectedChoice = null;
let lockedPlayers = 0;
let answerRevealed = false;
let timerExpired = false;
let activeGame = null;
let activePlayer = null;
let unsubscribeGame = () => {};
let aiDraft = [];
let isHost = false;
let lobbyRefreshId = 0;
let quizRefreshId = 0;
let realtimeSubscribed = false;
let stealEnabled = false;
let stealSelectedChoice = null;
let buzzInCooldown = false;
let timerStarted = false;
let lastStealStatus = null;
let lastStealPlayerId = null;
let lastPopupKey = null;
let lastStealWasCorrect = false;
// Statuses where the round is already under way, used to pull reconnecting players
// straight back to the quiz screen instead of leaving them in the lobby.
const IN_ROUND_STATUSES = ["answering", "answered_correct", "revealed"];
function isRoundInProgress(status) {
  return IN_ROUND_STATUSES.includes(status);
}

function saveSession(game, player) {
  if (game) localStorage.setItem("bqb_room_code", game.room_code);
  if (player) localStorage.setItem("bqb_player_id", player.id);
  localStorage.setItem("bqb_is_host", String(isHost));
}

function clearSession() {
  localStorage.removeItem("bqb_room_code");
  localStorage.removeItem("bqb_player_id");
  localStorage.removeItem("bqb_is_host");
}

async function tryRejoinSession() {
  const roomCode = localStorage.getItem("bqb_room_code");
  const playerId = localStorage.getItem("bqb_player_id");
  const wasHost = localStorage.getItem("bqb_is_host") === "true";
  if (!roomCode) return false;
  try {
    if (wasHost) {
      const { data: game } = await supabase.from("games").select("*").eq("room_code", roomCode).single();
      if (game) {
        setRoomState(game, null);
        if (isRoundInProgress(game.status)) {
          showScreen("quiz");
        } else {
          showScreen("lobby");
        }
        return true;
      }
    } else if (playerId) {
      const { data: player } = await supabase.from("players").select("*, games(*)").eq("id", playerId).single();
      if (player && player.games) {
        setRoomState(player.games, player);
        if (isRoundInProgress(player.games.status)) {
          showScreen("quiz");
        } else {
          showScreen("lobby");
        }
        return true;
      }
    }
  } catch {
    clearSession();
  }
  return false;
}

async function loadRoomsList() {
  const list = document.querySelector("#rooms-list");
  const loading = document.querySelector("#rooms-loading");
  const empty = document.querySelector("#rooms-empty");
  loading.hidden = false;
  empty.hidden = true;
  list.innerHTML = "";
  try {
    const { data: games } = await supabase
      .from("games")
      .select("id, room_code, status, total_questions, current_question, created_at")
      .in("status", ["waiting", "answering"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (!games || games.length === 0) {
      loading.hidden = true;
      empty.hidden = false;
      return;
    }
    loading.hidden = true;
    games.forEach((game) => {
      const li = document.createElement("li");
      li.style.cssText = "padding:12px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px";
      const playersText = game.status === "answering" ? "In progress" : "Waiting for players";
      li.innerHTML = `
        <div style="flex:1 1 200px">
          <strong>${game.room_code}</strong>
          <small style="display:block;color:var(--muted);font-size:12px;margin-top:4px">${playersText} · ${game.total_questions || 10} questions</small>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="button button-secondary join-room-btn" data-room-code="${game.room_code}">Join</button>
          <button class="button button-outline delete-room-btn" data-room-id="${game.id}" data-room-code="${game.room_code}" style="color:#c86e56;border-color:#c86e56">Delete</button>
        </div>
      `;
      list.appendChild(li);
    });
    list.querySelectorAll(".join-room-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelector(".code-input").value = btn.dataset.roomCode;
        showScreen("join");
        document.querySelector("#join input[type=\"text\"]").focus();
      });
    });
    list.querySelectorAll(".delete-room-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const roomCode = btn.dataset.roomCode;
        const roomId = btn.dataset.roomId;
        const pwd = prompt(`Enter admin password to delete room ${roomCode}:`);
        if (pwd !== "admin") {
          alert("Incorrect admin password.");
          return;
        }
        try {
          await supabase.from("players").delete().eq("game_id", roomId);
          await supabase.from("games").delete().eq("id", roomId);
          btn.closest("li").remove();
          const remaining = list.querySelectorAll("li");
          if (remaining.length === 0) {
            document.querySelector("#rooms-empty").hidden = false;
          }
        } catch (cause) {
          alert(`Failed to delete room: ${cause.message}`);
        }
      });
    });
  } catch (cause) {
    loading.hidden = true;
    empty.hidden = false;
    empty.textContent = `Failed to load rooms: ${cause.message}`;
  }
}

async function renderLobbyPlayers() {
  if (!activeGame) return;
  const playersPanel = document.querySelector(".players-panel");
  const heading = playersPanel.querySelector(".panel-heading h3");
  const checkLabel = playersPanel.querySelector(".check-label");
  const startButton = document.querySelector("#start-battle");
  const existingRows = playersPanel.querySelectorAll(".player-row");
  existingRows.forEach((row) => row.remove());

  const players = await listPlayers(activeGame.id);
  heading.innerHTML = `Players <span>${players.length}/2</span>`;
  checkLabel.textContent = players.length === 2 ? "Ready to play" : "Waiting for players";

  const hostRow = document.createElement("div");
  hostRow.className = "player-row";
  hostRow.innerHTML = '<span class="avatar avatar-purple">♛</span><div><strong>Admin host</strong><small>Managing the game</small></div><span class="host-badge">HOST</span>';
  playersPanel.insertBefore(hostRow, startButton);

  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = '<span class="avatar avatar-yellow">★</span>';
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = player.display_name;
    const status = document.createElement("small");
    status.textContent = "Ready to buzz";
    details.append(name, status);
    row.append(details);
    playersPanel.insertBefore(row, startButton);
  });

  startButton.disabled = !isHost || players.length < 2;
}

function updateQuizRole() {
  document.querySelectorAll(".host-only").forEach((node) => { node.hidden = !isHost; });
  document.querySelector("#player-buzzer").hidden = isHost;
  document.querySelector("#quiz")?.classList.toggle("host-view", isHost);
  // Hide question card container for players
  const questionLeft = document.querySelector(".question-left");
  if (questionLeft) {
    questionLeft.hidden = !isHost;
  }
}

function applyBuzzState(game) {
  const hasBuzz = Boolean(game?.buzzed_player_id);
  lockedPlayers = hasBuzz ? 1 : 0;
  setBuzzStatusText(hasBuzz);
  document.querySelector("#lock-status").classList.toggle("locked", hasBuzz);
  const buzzedInfo = document.querySelector("#buzzed-player-info");
  const buzzedName = document.querySelector("#buzzed-player-name");
  if (hasBuzz) {
    clearInterval(timerId);
    const winner = activePlayer?.id === game.buzzed_player_id;
    if (game.buzzed_player_id) {
      const showBuzzedName = (buzzedNameStr) => {
        buzzedName.textContent = `${buzzedNameStr} buzzed in!`;
        buzzedInfo.hidden = false;
        if (!winner && !isHost) {
          document.querySelector("#buzzer-status").textContent = `Woops, ${buzzedNameStr} buzzed in first!`;
        }
        if (winner) {
          document.querySelector("#buzzer-status").textContent = "You buzzed first! Wait for the host to choose your answer.";
        }
      };
      if (supabase) {
        supabase.from("players").select("display_name").eq("id", game.buzzed_player_id).single()
          .then(({ data: player }) => { if (player) showBuzzedName(player.display_name); });
      } else {
        showBuzzedName(winner ? "You" : "A player");
      }
    }
    document.querySelector("#buzz-in").disabled = true;
    document.querySelector("#admin-review-status").textContent = isHost
      ? "A player buzzed — choose their answer"
      : "A player buzzed first";
  } else {
    // Never let players buzz before the host has started the timer.
    document.querySelector("#buzzer-status").textContent = timerStarted
      ? "Listen to the host, then tap when you know it."
      : "Wait for the host to start the timer";
    document.querySelector("#buzz-in").disabled = !timerStarted;
    buzzedInfo.hidden = true;
  }
}

document.querySelector("#dismiss-buzz").addEventListener("click", () => {
  document.querySelector("#buzzed-player-info").hidden = true;
  if (activeGame) {
    updateGame(activeGame.id, { buzzed_player_id: null, buzzed_at: null, status: "answering" })
      .catch((cause) => {
        document.querySelector("#admin-review-status").textContent = `Could not dismiss buzz: ${cause.message}`;
      });
  }
});

function startLobbyPolling() {
  if (!activeGame) return;
  stopLobbyPolling();
  lobbyRefreshId = window.setInterval(async () => {
    try {
      await renderLobbyPlayers();
      // Preview mode (no Supabase) keeps the game in localStorage, so there is no shared row to poll.
      if (!supabase) return;
      const { data: game } = await supabase.from("games").select("status, buzzed_player_id").eq("id", activeGame.id).maybeSingle();
      if (game && isRoundInProgress(game.status) && !document.querySelector("#quiz").classList.contains("active")) {
        showScreen("quiz");
      }
    } catch (cause) {
      document.querySelector("#join-error").textContent = cause.message || "Unable to load players.";
    }
  }, 2000);
}

function stopLobbyPolling() {
  if (lobbyRefreshId) {
    window.clearInterval(lobbyRefreshId);
    lobbyRefreshId = 0;
  }
}

function startQuizPolling() {
  if (!activeGame) return;
  stopQuizPolling();
  quizRefreshId = window.setInterval(async () => {
    // Preview mode (no Supabase) keeps the game in localStorage, so there is no shared row to poll.
    if (!supabase) return;
    try {
      const selectColumns = await buildGameSelect(["buzzed_player_id", "buzzed_at", "status", "current_question", "timer_seconds", "question_set", "timer_started", "steal_player_id", "steal_selected_choice", "steal_status"]);
      const { data: game } = await supabase
        .from("games")
        .select(selectColumns)
        .eq("id", activeGame.id)
        .maybeSingle();
      if (!game) return;
      activeGame = { ...activeGame, ...game };

      // Keep the admin's approved question set in sync on every client.
      if (Array.isArray(game.question_set) && game.question_set.length) {
        questionBank.splice(0, questionBank.length, ...game.question_set);
      }

      // The host advanced to a new question.
      if (typeof game.current_question === "number" && game.current_question !== currentQuestion) {
        currentQuestion = game.current_question;
        renderQuestion();
      }

      // The host changed the timer length — reflect it even mid-countdown.
      if (game.timer_seconds !== undefined && game.timer_seconds !== questionTimeLimit) {
        applyTimerLength(game.timer_seconds);
      }

      // Players: the host pressed "Start timer".
      if (!isHost && timerStartSignal(game) && !game.buzzed_player_id && !timerStarted) {
        renderQuestion();
        beginBuzzPhase({ broadcast: false });
      }

      // A player buzzed in — every screen must freeze its timer, not just the host.
      if (game.buzzed_player_id && !lockedPlayers) {
        activeGame = { ...activeGame, buzzed_player_id: game.buzzed_player_id };
        applyBuzzState(activeGame);
      }

      // Steal state must survive even when Realtime drops out.
      applyStealState(game);

      // Popups for player screens (wrong answer, steal turn, final reveal).
      syncRoundPopups(game);
    } catch (cause) {
      console.warn("Quiz poll failed:", cause);
    }
  }, 2000);
}

function stopQuizPolling() {
  if (quizRefreshId) {
    window.clearInterval(quizRefreshId);
    quizRefreshId = 0;
  }
}

function setRoomState(game, player) {
  activeGame = game;
  activePlayer = player;
  isHost = Boolean(game && !player);
  updateQuizRole();
  if (Array.isArray(game?.question_set) && game.question_set.length) {
    questionBank.splice(0, questionBank.length, ...game.question_set);
  }
  document.querySelector("#lobby-admin-tools").hidden = !isHost;
  document.querySelector("#start-battle").hidden = !isHost;
  if (game) {
    document.querySelectorAll(".room-code strong").forEach((node) => { node.textContent = game.room_code; });
    unsubscribeGame();
    realtimeSubscribed = false;
    unsubscribeGame = subscribeToGame(game.id, async (payload) => {
      const table = payload.table;
      const eventType = payload.eventType || payload.type;
      const newRecord = payload.new || payload.record;
      
      if (table === "players") {
        await renderLobbyPlayers();
      }
      if (table === "games" && newRecord) {
        const questionChanged = newRecord.current_question !== activeGame?.current_question;
        const timerChanged = newRecord.timer_seconds !== undefined && newRecord.timer_seconds !== questionTimeLimit;
        activeGame = newRecord;
        questionTimeLimit = newRecord.timer_seconds ?? questionTimeLimit;

        // Keep the admin's approved question set in sync.
        if (Array.isArray(newRecord.question_set) && newRecord.question_set.length) {
          questionBank.splice(0, questionBank.length, ...newRecord.question_set);
        }

        // Rebuild from a clean slate whenever the host moves to a new question.
        if (questionChanged) {
          currentQuestion = newRecord.current_question ?? currentQuestion;
          renderQuestion();
        } else if (timerChanged) {
          applyTimerLength(questionTimeLimit);
        }

        // The host pressed "Start timer".
        if (newRecord.status === "answering" && timerStartSignal(newRecord) && !newRecord.buzzed_player_id && !timerStarted) {
          if (!document.querySelector("#quiz").classList.contains("active")) showScreen("quiz");
          renderQuestion();
          beginBuzzPhase({ broadcast: false });
        }

        applyBuzzState(newRecord);
        applyStealState(newRecord);
        syncRoundPopups(newRecord);

        // Players: the host opened the quiz screen (or a player reconnected mid-round).
        if (isRoundInProgress(newRecord.status) && !document.querySelector("#quiz").classList.contains("active")) {
          showScreen("quiz");
        }

        // Host: offer the "Start timer" control while the question is waiting.
        if (isHost && document.querySelector("#quiz").classList.contains("active") && !timerStarted) {
          const startTimerRow = document.querySelector("#start-timer-row");
          if (startTimerRow) startTimerRow.hidden = false;
        }
      }
      if (!realtimeSubscribed) {
        realtimeSubscribed = true;
        startLobbyPolling();
      }
    });
    renderLobbyPlayers().catch((cause) => {
      document.querySelector("#join-error").textContent = cause.message || "Unable to load players.";
    });
    startLobbyPolling();
  }
}

async function createRoom() {
  const button = document.querySelector("#create-room");
  const error = document.querySelector("#create-admin-error");
  const adminCode = document.querySelector("#create-admin-code").value.trim();
  error.textContent = "";
  if (adminCode !== "admin") {
    error.textContent = "Only the admin can create a game.";
    document.querySelector("#create-admin-code").focus();
    return;
  }
  button.disabled = true;
  try {
    const result = await createGame("", questionTimeLimit);
    if (result.offline) {
      // Offline mode: generate local questions from questionBank
      result.game.question_set = questionBank.slice(0, 10);
    }
    setRoomState(result.game, result.player);
    saveSession(result.game, result.player);
    showScreen("lobby");
  } catch (cause) {
    error.textContent = cause.message || "Unable to create the room.";
  } finally {
    button.disabled = false;
  }
}

async function joinRoom() {
  const button = document.querySelector("#join-room");
  const error = document.querySelector("#join-error");
  error.textContent = "";
  button.disabled = true;
  try {
    const result = await joinGame(document.querySelector(".code-input").value.trim(), document.querySelector("#join input[type=\"text\"]").value.trim() || "Player");
    if (result.offline) {
      // Offline mode: game already has question_set
    }
    setRoomState(result.game, result.player);
    saveSession(result.game, result.player);
    showScreen("lobby");
  } catch (cause) {
    error.textContent = cause.message || "Unable to join the room.";
  } finally {
    button.disabled = false;
  }
}

function showScreen(id) {
  screens.forEach((screen) => screen.classList.toggle("active", screen.id === id));
  if (id === "lobby") {
    startLobbyPolling();
  } else {
    stopLobbyPolling();
  }
  if (id === "quiz") {
    startQuizPolling();
  } else {
    stopQuizPolling();
  }
  if (id === "rooms") {
    loadRoomsList();
  }
  if (id === "quiz") {
    if (currentQuestion >= questionBank.length) {
      currentQuestion = 0;
      score = 0;
      document.querySelector("#score").textContent = "0";
      document.querySelector("#answers").innerHTML = "";
    }

    startQuiz();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderQuestion() {
  const question = questionBank[currentQuestion];
  document.querySelector("#question-count").textContent = `Question ${currentQuestion + 1} of ${questionBank.length}`;
  document.querySelector("#question-category").textContent = question.category;
  document.querySelector("#question-text").textContent = question.text;
  document.querySelector("#progress-bar").style.width = `${((currentQuestion + 1) / questionBank.length) * 100}%`;
  document.querySelector("#feedback").textContent = "";
  document.querySelector("#feedback").className = "feedback";
  setBuzzStatusText(false);
  document.querySelector("#lock-status").className = "lock-status";
  document.querySelector("#lock-answer").disabled = true;
  document.querySelector("#lock-answer").textContent = "Judge: correct or wrong";
  document.querySelector("#live-timer-setting").value = String(questionTimeLimit);
  hideResultPopup();
  document.querySelector("#admin-review-status").textContent = isHost ? "Waiting for a player to buzz" : "Waiting for the host";
  document.querySelector("#simulate-locks").disabled = false;
  selectedChoice = null;
  lockedPlayers = 0;
  answerRevealed = false;
  timerExpired = false;
  document.querySelector("#answers").innerHTML = isHost
    ? question.choices.map((choice, index) =>
      `<button class="answer" data-choice="${index}"><span>${String.fromCharCode(65 + index)}</span>${choice}</button>`
    ).join("")
    : "";
  document.querySelectorAll(".answer").forEach((answer) => answer.addEventListener("click", () => selectAnswer(Number(answer.dataset.choice))));
  updateQuizRole();
  applyBuzzState(activeGame);
  resetTimer();
  // Only the host owns the shared timer value; players must never write it back.
  if (activeGame && isHost && activeGame.timer_seconds !== questionTimeLimit) {
    updateGame(activeGame.id, { timer_seconds: questionTimeLimit }).catch((cause) => {
      document.querySelector("#admin-review-status").textContent = `Could not sync timer: ${cause.message}`;
    });
  }
}

function resetTimer() {
  clearInterval(timerId);
  timerStarted = false;
  secondsLeft = questionTimeLimit;
  document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
  document.querySelector("#timer-value").classList.remove("timer-expired");
  document.querySelectorAll(".answer").forEach((answer) => { answer.disabled = !isHost; });
  document.querySelector("#lock-answer").disabled = selectedChoice === null;
  // Disable buzz-in until timer starts
  document.querySelector("#buzz-in").disabled = true;
  document.querySelector("#buzzer-status").textContent = "Wait for the host to start the timer";
  // Show start timer button for host, hide for players
  const startTimerRow = document.querySelector("#start-timer-row");
  if (startTimerRow) {
    startTimerRow.hidden = !isHost;
  }
  if (isHost) {
    document.querySelector("#admin-review-status").textContent = "Ready — click 'Start timer' to begin";
  } else {
    document.querySelector("#admin-review-status").textContent = "Waiting for the host to start the timer";
  }
}

// Supabase rejects an entire UPDATE if it references an unknown column, which would
// silently block the game on a database that has not had schema.sql applied yet.
function timerStartPatch() {
  if (isGameColumnSupported("timer_started")) {
    return { timer_started: true, buzzed_player_id: null };
  }
  // Fallback for a database without timer_started: reuse buzzed_at as the start signal.
  return { buzzed_at: new Date().toISOString(), buzzed_player_id: null };
}

function timerResetPatch() {
  return { timer_started: false, buzzed_at: null };
}

function timerStartSignal(record) {
  if (!record) return false;
  if (isGameColumnSupported("timer_started")) return Boolean(record.timer_started);
  // Fallback: the host starting the timer is the only time buzzed_at is set with no buzzer.
  return Boolean(record.buzzed_at) && !record.buzzed_player_id;
}

function startTimer() {
  beginBuzzPhase({ broadcast: true });
}

// Shared by the host (broadcast) and players (local only) so every screen ticks together.
function beginBuzzPhase({ broadcast }) {
  if (timerStarted) return;
  timerStarted = true;
  const startTimerRow = document.querySelector("#start-timer-row");
  if (startTimerRow) startTimerRow.hidden = true;
  document.querySelector("#admin-review-status").textContent = "Timer running — players can buzz now";
  document.querySelector("#buzz-in").disabled = false;
  document.querySelector("#buzzer-status").textContent = "Listen to the host, then tap when you know it.";
  // The host is the single writer of the timer_started flag.
  if (broadcast && activeGame && supabase) {
    updateGame(activeGame.id, { status: "answering", timer_seconds: questionTimeLimit, ...timerStartPatch() })
      .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not start timer: ${cause.message}`; });
  }
  runCountdown();
}

function runCountdown() {
  clearInterval(timerId);
  timerId = setInterval(() => {
    secondsLeft -= 1;
    document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
    if (secondsLeft <= 0) {
      clearInterval(timerId);
      timerExpired = true;
      document.querySelector("#timer-value").classList.add("timer-expired");
      document.querySelectorAll(".answer").forEach((answer) => { answer.disabled = true; });
      document.querySelector("#buzz-in").disabled = true;
      document.querySelector("#lock-answer").disabled = true;
      document.querySelector("#admin-review-status").textContent = "Time is up — add time or reveal";
    }
  }, 1000);
}

function formatSeconds(value) {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// Only the first buzz matters, so the label must not imply both players need to buzz.
function setBuzzStatusText(hasBuzz) {
  const node = document.querySelector("#lock-status-text");
  if (!node) return;
  node.textContent = hasBuzz ? "1 player buzzed — first buzz answers" : "Waiting for the first buzz";
}

function showResultPopup({ emoji, eyebrow, title, message, detail, tone, actionLabel }) {
  const popup = document.querySelector("#result-popup");
  if (!popup) return;
  document.querySelector("#result-popup-emoji").textContent = emoji || "";
  document.querySelector("#result-popup-eyebrow").textContent = eyebrow || "";
  document.querySelector("#result-popup-title").textContent = title || "";
  document.querySelector("#result-popup-message").textContent = message || "";
  const answerBox = document.querySelector("#result-popup-answer");
  if (detail) {
    answerBox.textContent = detail;
    answerBox.hidden = false;
  } else {
    answerBox.textContent = "";
    answerBox.hidden = true;
  }
  document.querySelector("#result-popup-action").textContent = actionLabel || "Got it";
  popup.className = `result-popup visible tone-${tone || "warn"}`;
  popup.hidden = false;
}

function hideResultPopup() {
  const popup = document.querySelector("#result-popup");
  if (popup) {
    popup.hidden = true;
    popup.className = "result-popup";
  }
  lastPopupKey = null;
}

// Player dismissed the popup: hide it but keep the key so the next poll does not
// immediately show the same one again.
function dismissResultPopup() {
  const popup = document.querySelector("#result-popup");
  if (popup) {
    popup.hidden = true;
    popup.className = "result-popup";
  }
}

// Players only: turn the synced game state into a clear on-screen popup.
// Keyed so the 2s poll never re-triggers or re-animates the same popup.
function syncRoundPopups(game) {
  if (isHost || !activePlayer || !game) return;
  const question = questionBank[currentQuestion];
  if (!question) return;
  const correctLabel = `${String.fromCharCode(65 + question.correct)}. ${question.choices[question.correct]}`;
  const isBuzzedPlayer = game.buzzed_player_id === activePlayer.id;
  let key = null;
  let payload = null;

  if (game.status === "answered_correct") {
    // First player answered correctly — same instant popup the host already saw.
    key = `correct-${currentQuestion}`;
    payload = { emoji: "✅", eyebrow: "Correct answer", title: "That is right!", message: question.explanation, detail: `Reference: ${question.reference}`, tone: "good", actionLabel: "Continue" };
  } else if (game.status === "revealed") {
    key = `revealed-${currentQuestion}`;
    payload = { emoji: "📖", eyebrow: "The correct answer", title: correctLabel, message: question.explanation, detail: `Reference: ${question.reference}`, tone: "reveal", actionLabel: "Continue" };
  } else if (game.steal_status === "scored" && game.status === "answering") {
    // Steal was judged: right = stolen points, wrong = nobody got it.
    const stealWasRight = lastStealWasCorrect;
    key = `steal-scored-${currentQuestion}-${stealWasRight ? "right" : "wrong"}`;
    payload = stealWasRight
      ? { emoji: "🏆", eyebrow: "Steal successful", title: "That is right — points stolen!", message: question.explanation, detail: `Reference: ${question.reference}`, tone: "good", actionLabel: "Continue" }
      : { emoji: "❌", eyebrow: "Steal answer", title: "Still wrong!", message: `Nobody got it. The correct answer is ${correctLabel}.`, detail: `Reference: ${question.reference}`, tone: "warn", actionLabel: "Got it" };
  } else if (game.steal_status === "available") {
    key = `steal-${currentQuestion}-${isBuzzedPlayer ? "own" : "turn"}`;
    payload = isBuzzedPlayer
      ? { emoji: "❌", eyebrow: "Your answer", title: "It is wrong!", message: "You are out of this question. The other player can now steal the points.", tone: "warn", actionLabel: "Got it" }
      : { emoji: "⚡", eyebrow: "Steal opportunity", title: "It's your turn!", message: "The other player answered incorrectly. Choose your answer below to steal the points.", tone: "turn", actionLabel: "Choose my answer" };
  } else if (game.steal_status === "pending" && !isBuzzedPlayer) {
    key = `steal-sent-${currentQuestion}`;
    payload = { emoji: "⏳", eyebrow: "Steal submitted", title: "Waiting for the host", message: "The host is judging your steal answer.", tone: "reveal", actionLabel: "Got it" };
  }

  if (!payload) return;
  if (key === lastPopupKey) return;
  lastPopupKey = key;
  showResultPopup(payload);
}

// Apply a new timer length everywhere, including while the countdown is already running.
function applyTimerLength(value) {
  questionTimeLimit = value;
  secondsLeft = questionTimeLimit;
  timerExpired = false;
  document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
  document.querySelector("#timer-value").classList.remove("timer-expired");
  const liveSetting = document.querySelector("#live-timer-setting");
  if (liveSetting) liveSetting.value = String(questionTimeLimit);
  if (timerStarted) {
    // Extending the time gives the players a fresh window to buzz in —
    // unless someone already buzzed, in which case the round is frozen.
    if (!answerRevealed && !lockedPlayers && !activeGame?.buzzed_player_id) {
      document.querySelector("#buzz-in").disabled = false;
      document.querySelector("#buzzer-status").textContent = "Listen to the host, then tap when you know it.";
    }
    runCountdown();
  } else {
    resetTimer();
  }
}

function applyLiveTimer() {
  const next = Number(document.querySelector("#live-timer-setting").value);
  if (!next) return;
  questionTimeLimit = next;
  document.querySelector("#admin-review-status").textContent = timerStarted
    ? `Timer reset to ${questionTimeLimit} seconds — still running`
    : `Timer set to ${questionTimeLimit} seconds`;
  if (activeGame) {
    // Only clear the start flag when the countdown has not begun, so a live change
    // does not stop the other screen's timer.
    const patch = timerStarted ? {} : timerResetPatch();
    updateGame(activeGame.id, { timer_seconds: questionTimeLimit, ...patch })
      .catch((cause) => {
        document.querySelector("#admin-review-status").textContent = `Could not sync timer: ${cause.message}`;
      });
  }
  applyTimerLength(questionTimeLimit);
}

function selectAnswer(choice) {
  if (!isHost || !lockedPlayers || answerRevealed) return;
  selectedChoice = choice;
  document.querySelectorAll(".answer").forEach((answer) => answer.classList.toggle("selected", Number(answer.dataset.choice) === choice));
  document.querySelector("#lock-answer").disabled = false;
}

function lockAnswer() {
  if (!isHost || !lockedPlayers || selectedChoice === null) return;
  document.querySelectorAll(".answer").forEach((answer) => { answer.disabled = true; });
  document.querySelector("#lock-answer").disabled = true;
  document.querySelector("#lock-answer").textContent = "Answer selected ✓";
  document.querySelector("#admin-review-status").textContent = "Answer locked in — judging now";
  // No separate reveal step: judging happens instantly on confirm.
  judgeFirstAnswer();
}

function simulateOtherLocks() {
  if (!isHost || !activeGame || lockedPlayers > 0) return;
  const player = activeGame.players?.[0];
  if (player) claimBuzzer(activeGame.id, player.id).catch((cause) => {
    document.querySelector("#admin-review-status").textContent = `Could not simulate buzz: ${cause.message}`;
  });
  document.querySelector("#simulate-locks").disabled = true;
}

async function buzzIn() {
  if (isHost || !activeGame || lockedPlayers > 0 || buzzInCooldown || !timerStarted) return;
  buzzInCooldown = true;
  document.querySelector("#buzz-in").disabled = true;
  try {
    const claimed = await claimBuzzer(activeGame.id, activePlayer.id);
    if (claimed) {
      // Freeze this screen immediately — do not wait up to 2s for the poll round-trip.
      activeGame = { ...activeGame, buzzed_player_id: activePlayer.id };
      applyBuzzState(activeGame);
    } else {
      // Another player already buzzed - wait for realtime update
      setTimeout(() => {
        if (activeGame && supabase) {
          supabase.from("games").select("*").eq("id", activeGame.id).maybeSingle()
            .then(({ data: game }) => { if (game) applyBuzzState(game); });
        }
      }, 500);
    }
  } catch (cause) {
    document.querySelector("#buzzer-status").textContent = `Could not buzz in: ${cause.message}`;
    document.querySelector("#buzz-in").disabled = false;
  } finally {
    // Re-enable buzz button after 1 second cooldown
    setTimeout(() => {
      buzzInCooldown = false;
      if (!lockedPlayers && !answerRevealed) {
        document.querySelector("#buzz-in").disabled = false;
      }
    }, 1000);
  }
}

// Move on to the next question (or the results screen). Shared by every reveal path.
async function advanceQuestion() {
  hideResultPopup();
  currentQuestion += 1;
  if (currentQuestion >= questionBank.length) {
    document.querySelector("#results").querySelector(".winner-card strong").innerHTML = `${score} <small>points</small>`;
    clearInterval(timerId);
    showScreen("results");
    return;
  }
  if (activeGame) {
    await updateGame(activeGame.id, {
      status: "answering",
      current_question: currentQuestion,
      timer_seconds: questionTimeLimit,
      buzzed_player_id: null,
      steal_player_id: null,
      steal_status: null,
      steal_selected_choice: null,
      ...timerResetPatch()
    }).catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not start the next question: ${cause.message}`; });
  }
  renderQuestion();
}

// Both players missed — show the correct answer, then move on.
async function showFinalAnswer() {
  if (!isHost || !activeGame) return;
  const question = questionBank[currentQuestion];
  const feedback = document.querySelector("#feedback");
  feedback.className = "feedback feedback-warn";
  feedback.innerHTML = `<strong>The answer is ${String.fromCharCode(65 + question.correct)}: ${question.choices[question.correct]}</strong> ${question.explanation} <span>${question.reference}</span>`;
  document.querySelector("#admin-review-status").textContent = "Answer revealed — moving to the next question";
  await updateGame(activeGame.id, { status: "revealed" })
    .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not reveal: ${cause.message}`; });
  setTimeout(() => { advanceQuestion(); }, 2600);
}

function judgeFirstAnswer() {
  if (!isHost || lockedPlayers < 1 || selectedChoice === null || answerRevealed) return;
  const question = questionBank[currentQuestion];
  answerRevealed = true;
  const isCorrect = selectedChoice === question.correct;
  document.querySelectorAll(".answer").forEach((answer) => {
    if (Number(answer.dataset.choice) === question.correct) answer.classList.add("correct");
    if (Number(answer.dataset.choice) === selectedChoice && !isCorrect) answer.classList.add("incorrect");
  });
  if (isCorrect) {
    score += Math.max(100, 150 - Math.floor((questionTimeLimit - secondsLeft) * 3));
    document.querySelector("#score").textContent = score;
    const feedback = document.querySelector("#feedback");
    feedback.className = "feedback feedback-good";
    feedback.innerHTML = `<strong>Great answer!</strong> ${question.explanation} <span>${question.reference}</span>`;
    document.querySelector("#admin-review-status").textContent = "Correct — moving to the next question";
    // Instant popup on every screen: host sees it now, players sync via poll.
    showResultPopup({
      emoji: "✅", eyebrow: "Correct answer", title: "That is right!",
      message: `${question.explanation}`, detail: `Reference: ${question.reference}`,
      tone: "good", actionLabel: "Continue"
    });
    if (activeGame) {
      updateGame(activeGame.id, { status: "answered_correct", steal_status: null })
        .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not sync result: ${cause.message}`; });
    }
    setTimeout(() => { advanceQuestion(); }, 2600);
  } else {
    // Wrong answer — instant WRONG popup everywhere, then the other player steals.
    const feedback = document.querySelector("#feedback");
    feedback.className = "feedback feedback-warn";
    feedback.innerHTML = `<strong>Wrong answer!</strong> ${question.explanation} <span>${question.reference}</span>`;
    document.querySelector("#admin-review-status").textContent = "Wrong! The other player can steal the points";
    showResultPopup({
      emoji: "❌", eyebrow: "Wrong answer", title: "It is wrong!",
      message: "The other player can now steal the points.", tone: "warn", actionLabel: "Got it"
    });
    enableSteal();
  }
}

async function revealStealAnswer() {
  if (!activeGame) return;
  // Pull the freshest steal submission so a fast click cannot miss the player's answer.
  if (supabase && isGameColumnSupported("steal_player_id") && isGameColumnSupported("steal_selected_choice")) {
    const { data: fresh } = await supabase
      .from("games")
      .select("steal_player_id, steal_selected_choice")
      .eq("id", activeGame.id)
      .maybeSingle();
    if (fresh) activeGame = { ...activeGame, ...fresh };
  }
  if (!activeGame.steal_player_id || activeGame.steal_selected_choice === null) return;
  const question = questionBank[currentQuestion];
  const stealChoice = activeGame.steal_selected_choice;
  
  const isCorrect = stealChoice === question.correct;

  // Show correct/incorrect for steal answer
  document.querySelectorAll(".answer").forEach((answer) => {
    if (Number(answer.dataset.choice) === question.correct) answer.classList.add("correct");
    if (Number(answer.dataset.choice) === stealChoice && !isCorrect) answer.classList.add("incorrect");
  });

  // The steal answers the question either way: instant popup on the host screen,
  // and players sync it via the steal_status change below.
  if (isCorrect) {
    const stealPoints = Math.max(100, 150 - Math.floor((questionTimeLimit - secondsLeft) * 3));
    document.querySelector("#admin-review-status").textContent = `Steal successful! +${stealPoints} points`;
    showResultPopup({
      emoji: "✅", eyebrow: "Steal answer", title: "That is right!",
      message: `${question.explanation}`, detail: `Reference: ${question.reference}`,
      tone: "good", actionLabel: "Continue"
    });
  } else {
    document.querySelector("#admin-review-status").textContent = "Steal was wrong too — showing the correct answer";
    showResultPopup({
      emoji: "❌", eyebrow: "Steal answer", title: "Still wrong!",
      message: `Nobody got it. The correct answer is ${String.fromCharCode(65 + question.correct)}: ${question.choices[question.correct]}.`,
      detail: `Reference: ${question.reference}`, tone: "warn", actionLabel: "Got it"
    });
  }

  // Mark the steal as resolved and clear the submission — and record whether
  // it was right so every screen can show the matching popup.
  lastStealWasCorrect = isCorrect;
  await updateGame(activeGame.id, { steal_status: "scored", steal_player_id: null, steal_selected_choice: null });

  if (isCorrect) {
    // Award points to the stealing player.
    const stealPoints = Math.max(100, 150 - Math.floor((questionTimeLimit - secondsLeft) * 3));
    if (supabase) {
      const stealPlayerId = activeGame.steal_player_id;
      const { data: player } = await supabase.from("players").select("score").eq("id", stealPlayerId).single();
      if (player) {
        await supabase.from("players").update({ score: player.score + stealPoints }).eq("id", stealPlayerId);
      }
    }
    setTimeout(() => { advanceQuestion(); }, 2600);
  } else {
    // Both players missed — show the correct answer, then move on.
    await updateGame(activeGame.id, { status: "revealed" })
      .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not update the round: ${cause.message}`; });
    setTimeout(() => { advanceQuestion(); }, 2600);
  }
}

// Player submits their steal answer; the host then reveals it.
async function submitStealAnswer() {
  if (!activeGame || isHost || !activePlayer || stealSelectedChoice === null) return;
  const stealSubmit = document.querySelector("#steal-submit");
  const stealStatus = document.querySelector("#steal-status");
  if (!isGameColumnSupported("steal_status")) {
    stealStatus.textContent = "Steal needs the database migration — run supabase/schema.sql in Supabase.";
    return;
  }
  stealSubmit.disabled = true;
  try {
    await updateGame(activeGame.id, {
      steal_player_id: activePlayer.id,
      steal_selected_choice: stealSelectedChoice,
      steal_status: "pending"
    });
    stealStatus.textContent = "Steal submitted — waiting for the host to reveal.";
  } catch (cause) {
    stealStatus.textContent = `Could not submit steal: ${cause.message}`;
    stealSubmit.disabled = false;
  }
}

function enableSteal() {
  if (!activeGame) return;
  if (!isGameColumnSupported("steal_status")) {
    document.querySelector("#admin-review-status").textContent = "Steal needs the database migration — run supabase/schema.sql in Supabase.";
    return;
  }
  stealEnabled = true;
  updateGame(activeGame.id, { steal_status: "available" })
    .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not enable steal: ${cause.message}`; });
}

function applyStealState(game) {
  const stealPanel = document.querySelector("#steal-panel");
  const stealAnswers = document.querySelector("#steal-answers");
  const stealSubmit = document.querySelector("#steal-submit");
  const status = game.steal_status ?? null;
  const canSteal = status === "available" && !isHost && activePlayer && game.buzzed_player_id !== activePlayer.id;
  if (status !== lastStealStatus) lastStealPlayerId = null;

  if (canSteal) {
    stealEnabled = true;
    stealPanel.hidden = false;
    // Only build once: a 2s poll must never wipe the player's selection.
    if (!stealAnswers.children.length) {
      const question = questionBank[currentQuestion];
      if (question) {
        stealSelectedChoice = null;
        stealSubmit.disabled = true;
        stealAnswers.innerHTML = question.choices.map((choice, idx) =>
          `<button class="steal-answer-btn" data-choice="${idx}" style="display:block;width:100%;margin:8px 0;padding:14px;border:3px solid #855f34;border-radius:4px;background:#f4d89b;color:#3e2b1a;font:700 17px Fredoka;box-shadow:inset 0 0 0 2px #ffecc1,0 3px 0 #65482c;text-align:left">${choice}</button>`
        ).join("");
        stealAnswers.querySelectorAll(".steal-answer-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            stealSelectedChoice = Number(btn.dataset.choice);
            stealAnswers.querySelectorAll(".steal-answer-btn").forEach((b) => b.classList.toggle("selected", b === btn));
            stealSubmit.disabled = false;
          });
        });
        stealSubmit.onclick = submitStealAnswer;
      }
    }
  } else if (status === "pending" && isHost && game.steal_player_id && game.steal_player_id !== lastStealPlayerId) {
    lastStealPlayerId = game.steal_player_id;
    // Judge the submitted steal instantly — no reveal button anymore.
    revealStealAnswer();
    if (supabase) {
      supabase.from("players").select("display_name").eq("id", game.steal_player_id).single()
        .then(({ data: player }) => {
          if (player) {
            document.querySelector("#admin-review-status").textContent = `${player.display_name} submitted a steal answer — judging now`;
          }
        });
    } else {
      document.querySelector("#admin-review-status").textContent = "A steal answer was submitted!";
    }
  } else {
    // Hide/reset the panel for every other state, including the player who already missed.
    stealPanel.hidden = true;
    if (status !== "available") {
      stealEnabled = false;
      stealSelectedChoice = null;
      stealAnswers.innerHTML = "";
    }
  }
  lastStealStatus = status;
}

document.querySelectorAll("[data-screen]").forEach((control) => {
  control.addEventListener("click", (event) => {
    event.preventDefault();
    if (control.dataset.screen === "quiz" && activeGame) {
      updateGame(activeGame.id, { status: "answering", current_question: currentQuestion, ...timerResetPatch() })
        .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not start round: ${cause.message}`; });
    }
    showScreen(control.dataset.screen);
  });
});

function startQuiz() {
  if (currentQuestion === 0 && !document.querySelector("#answers").children.length) renderQuestion();
}

document.querySelector("#admin-enter").addEventListener("click", () => {
  const code = document.querySelector("#admin-code").value.trim();
  const error = document.querySelector("#admin-code-error");
  error.textContent = "";
  if (code !== "admin") {
    document.querySelector("#admin-code").focus();
    error.textContent = "Incorrect admin password.";
    document.querySelector("#admin-controls").classList.remove("visible");
    return;
  }
  document.querySelector("#admin-controls").classList.add("visible");
});

document.querySelector("#lock-answer").addEventListener("click", lockAnswer);
document.querySelector("#buzz-in").addEventListener("click", buzzIn);
document.querySelector("#simulate-locks").addEventListener("click", simulateOtherLocks);
document.querySelector("#result-popup-action").addEventListener("click", dismissResultPopup);
document.querySelector("#start-timer").addEventListener("click", () => {
  startTimer();
});
document.querySelector("#timer-setting").addEventListener("change", (event) => {
  questionTimeLimit = Number(event.target.value);
  document.querySelector("#setting-saved").textContent = `${questionTimeLimit} seconds set for the next question.`;
  document.querySelector("#live-timer-setting").value = String(questionTimeLimit);
});
document.querySelector("#apply-live-timer").addEventListener("click", applyLiveTimer);
document.querySelector("#generate-question").addEventListener("click", async () => {
  const button = document.querySelector("#generate-question");
  const error = document.querySelector("#ai-error");
  const topic = document.querySelector("#ai-topic").value.trim();
  error.textContent = "";
  if (!topic) {
    error.textContent = "Enter a topic, character, or Bible event.";
    return;
  }
  button.disabled = true;
  button.textContent = "Generating…";
  try {
    aiDraft = await generateQuestion(topic, document.querySelector("#ai-category").value, document.querySelector("#ai-difficulty").value);
    document.querySelector("#ai-preview-question").textContent = `${aiDraft.length} questions ready for review`;
    document.querySelector("#ai-preview-choices").innerHTML = aiDraft.map((question, index) =>
      `<li><strong>${index + 1}. ${question.text}</strong><br /><small>${question.choices.join(" · ")}</small></li>`
    ).join("");
    document.querySelector("#ai-preview-meta").textContent = aiDraft.map((question) =>
      `${question.reference} · ${question.explanation}`
    ).join(" | ");
    document.querySelector("#ai-preview").classList.add("visible");
  } catch (cause) {
    error.textContent = cause.message || "Could not generate a question.";
  } finally {
    button.disabled = false;
    button.textContent = "Generate 10 questions ✦";
  }
});

document.querySelector("#lobby-generate-question").addEventListener("click", async () => {
  const button = document.querySelector("#lobby-generate-question");
  const error = document.querySelector("#lobby-ai-error");
  const topic = document.querySelector("#lobby-ai-topic").value.trim();
  error.textContent = "";
  if (!topic) {
    error.textContent = "Enter a topic, character, or Bible event.";
    return;
  }
  button.disabled = true;
  button.textContent = "Generating…";
  try {
    aiDraft = await generateQuestion(topic, document.querySelector("#lobby-ai-category").value, document.querySelector("#lobby-ai-difficulty").value);
    document.querySelector("#lobby-ai-preview-question").textContent = `${aiDraft.length} questions ready for review — edit if needed`;
    document.querySelector("#lobby-ai-preview-choices").innerHTML = aiDraft.map((question, index) =>
      `<li class="editable-question" data-index="${index}">
        <div class="editable-field">
          <label>Q${index + 1}: <input type="text" class="question-text" value="${question.text.replace(/"/g, '"')}" /></label>
        </div>
        <div class="editable-field">
          <label>A: <input type="text" class="choice-input" value="${question.choices[0].replace(/"/g, '"')}" /></label>
          <label>B: <input type="text" class="choice-input" value="${question.choices[1].replace(/"/g, '"')}" /></label>
          <label>C: <input type="text" class="choice-input" value="${question.choices[2].replace(/"/g, '"')}" /></label>
          <label>D: <input type="text" class="choice-input" value="${question.choices[3].replace(/"/g, '"')}" /></label>
        </div>
        <div class="editable-field">
          <label>Correct (0-3): <input type="number" class="correct-input" min="0" max="3" value="${question.correct}" /></label>
          <label>Verse: <input type="text" class="reference-input" value="${question.reference.replace(/"/g, '"')}" /></label>
        </div>
        <small>${question.explanation}</small>
      </li>`
    ).join("");
    document.querySelector("#lobby-ai-preview-meta").textContent = "";
    document.querySelector("#lobby-ai-preview").classList.add("visible");
  } catch (cause) {
    error.textContent = cause.message || "Could not generate questions.";
  } finally {
    button.disabled = false;
    button.textContent = "Generate 10 questions ✦";
  }
});

document.querySelector("#lobby-use-ai-question").addEventListener("click", () => {
  const items = document.querySelectorAll("#lobby-ai-preview-choices .editable-question");
  if (!items.length) return;
  
  const questions = Array.from(items).map((item) => {
    const text = item.querySelector(".question-text").value.trim();
    const choices = Array.from(item.querySelectorAll(".choice-input")).map((input) => input.value.trim());
    const correct = parseInt(item.querySelector(".correct-input").value, 10);
    const reference = item.querySelector(".reference-input").value.trim();
    return { text, choices, correct, reference, explanation: "", category: "BIBLE EVENTS" };
  }).filter((q) => q.text && q.choices.every((c) => c) && q.choices.length === 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3);

  if (questions.length !== 10) {
    document.querySelector("#lobby-ai-error").textContent = "Please fill in all 10 questions completely (4 choices each, correct 0-3).";
    return;
  }

  aiDraft = questions;
  questionBank.splice(0, questionBank.length, ...aiDraft);
  currentQuestion = 0;
  document.querySelector("#lobby-ai-preview").classList.remove("visible");
  document.querySelector("#lobby-ai-error").textContent = "Questions approved. Players can now join with the room code.";
  document.querySelector("#start-battle").disabled = false;
  if (activeGame) {
    updateGame(activeGame.id, { question_set: aiDraft, total_questions: aiDraft.length })
      .then(() => { activeGame.question_set = aiDraft; })
      .catch((cause) => {
        document.querySelector("#lobby-ai-error").textContent = `Questions approved locally, but could not sync them: ${cause.message}`;
      });
  }
});
document.querySelector("#use-ai-question").addEventListener("click", () => {
  if (!aiDraft.length) return;
  questionBank.splice(0, questionBank.length, ...aiDraft);
  currentQuestion = 0;
  document.querySelector("#ai-preview").classList.remove("visible");
  showScreen("quiz");
  renderQuestion();
  document.querySelector("#admin-review-status").textContent = "AI question approved for this round";
});
document.querySelector("#create-room").addEventListener("click", (event) => {
  event.preventDefault();
  createRoom();
});
document.querySelector("#join-room").addEventListener("click", (event) => {
  event.preventDefault();
  joinRoom();
});
document.querySelector("#refresh-players").addEventListener("click", () => {
  renderLobbyPlayers().catch((cause) => {
    document.querySelector("#join-error").textContent = cause.message || "Unable to load players.";
  });
});
document.querySelector("#rejoin-room").addEventListener("click", () => {
  tryRejoinSession().catch((cause) => {
    document.querySelector("#join-error").textContent = cause.message || "No saved room found.";
  });
});

if (!supabaseConfigured) {
  document.querySelector(".connection-pill").innerHTML = '<span class="live-dot"></span> Preview mode';
}
// Tell the host when the database is missing columns declared in supabase/schema.sql.
if (supabaseConfigured) {
  ensureGameColumns().then((missing) => {
    if (!missing.length) return;
    const pill = document.querySelector(".connection-pill");
    if (pill) pill.innerHTML = '<span class="live-dot"></span> Database needs migration';
    console.warn(`Supabase is missing these games columns: ${missing.join(", ")}. Run supabase/schema.sql in the Supabase SQL editor to unlock timer sync and steal.`);
  });
}
