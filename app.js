import { createGame, joinGame, listPlayers, subscribeToGame, updateGame, claimBuzzer, generateQuestion, supabaseConfigured, supabase } from "./supabase.js";

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
        if (game.status === "answering" || game.status === "ready_to_reveal" || game.status === "revealed") {
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
        if (player.games.status === "answering" || player.games.status === "ready_to_reveal" || player.games.status === "revealed") {
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
  // Hide question card container for players
  const questionLeft = document.querySelector(".question-left");
  if (questionLeft) {
    questionLeft.hidden = !isHost;
  }
}

function applyBuzzState(game) {
  const hasBuzz = Boolean(game?.buzzed_player_id);
  lockedPlayers = hasBuzz ? 1 : 0;
  document.querySelector("#locked-count").textContent = String(lockedPlayers);
  document.querySelector("#lock-status").classList.toggle("locked", hasBuzz);
  const buzzedInfo = document.querySelector("#buzzed-player-info");
  const buzzedName = document.querySelector("#buzzed-player-name");
  if (hasBuzz) {
    clearInterval(timerId);
    const winner = activePlayer?.id === game.buzzed_player_id;
    if (isHost) {
      document.querySelector("#reveal-answer").disabled = selectedChoice === null;
    }
    if (game.buzzed_player_id) {
      supabase.from("players").select("display_name").eq("id", game.buzzed_player_id).single()
        .then(({ data: player }) => {
          if (player) {
            const buzzedNameStr = player.display_name;
            buzzedName.textContent = `${buzzedNameStr} buzzed in!`;
            buzzedInfo.hidden = false;
            if (!winner && !isHost) {
              document.querySelector("#buzzer-status").textContent = `Woops, ${buzzedNameStr} buzzed in first!`;
            }
            if (winner) {
              document.querySelector("#buzzer-status").textContent = "You buzzed first! Wait for the host to choose your answer.";
            }
          }
        });
    }
    document.querySelector("#buzz-in").disabled = true;
    document.querySelector("#admin-review-status").textContent = isHost
      ? "A player buzzed — choose their answer"
      : "A player buzzed first";
  } else {
    document.querySelector("#buzzer-status").textContent = "Listen to the host, then tap when you know it.";
    document.querySelector("#buzz-in").disabled = false;
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
      const { data: game } = await supabase.from("games").select("status, buzzed_player_id").eq("id", activeGame.id).single();
      if (game && game.status === "answering" && !document.querySelector("#quiz").classList.contains("active")) {
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
    try {
      const { data: game } = await supabase.from("games").select("buzzed_player_id, status, current_question, timer_seconds").eq("id", activeGame.id).single();
      if (!game) return;
      // Players: detect when admin starts the timer (buzzed_at is set but no one has buzzed)
      if (!isHost && game.status === "answering" && game.buzzed_at && !game.buzzed_player_id && !timerStarted) {
        if (Array.isArray(game.question_set) && game.question_set.length) {
          questionBank.splice(0, questionBank.length, ...game.question_set);
        }
        renderQuestion();
        startTimer();
        return;
      }
      // Host: detect buzz
      if (isHost && game.buzzed_player_id && !lockedPlayers) {
        applyBuzzState(game);
      }
      // Sync question changes
      if (game.current_question !== currentQuestion) {
        currentQuestion = game.current_question;
        renderQuestion();
      }
      // Sync timer changes
      if (game.timer_seconds !== undefined && game.timer_seconds !== questionTimeLimit) {
        questionTimeLimit = game.timer_seconds;
        if (!timerStarted) {
          secondsLeft = questionTimeLimit;
          document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
          document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
          document.querySelector("#live-timer-setting").value = String(questionTimeLimit);
        }
      }
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
        if (Array.isArray(newRecord.question_set) && newRecord.question_set.length) {
          questionBank.splice(0, questionBank.length, ...newRecord.question_set);
        }
        applyBuzzState(newRecord);
        applyStealState(newRecord);
        // Sync question to players when admin starts the timer
        if (newRecord.status === "answering" && newRecord.buzzed_at && !newRecord.buzzed_player_id) {
          if (Array.isArray(newRecord.question_set) && newRecord.question_set.length) {
            questionBank.splice(0, questionBank.length, ...newRecord.question_set);
          }
          if (!document.querySelector("#quiz").classList.contains("active")) {
            showScreen("quiz");
          }
          if (!timerStarted) {
            renderQuestion();
            startTimer();
          }
        }
        // Show/hide start timer button for host based on game status
        if (isHost && document.querySelector("#quiz").classList.contains("active")) {
          const startTimerRow = document.querySelector("#start-timer-row");
          if (startTimerRow) {
            if (newRecord.status === "answering" && !newRecord.buzzed_player_id && !timerExpired && !timerStarted) {
              startTimerRow.hidden = false;
              document.querySelector("#admin-review-status").textContent = "Ready — click 'Start timer' to begin";
            } else {
              startTimerRow.hidden = true;
            }
          }
        }
        if (timerChanged && document.querySelector("#quiz").classList.contains("active")) {
          secondsLeft = questionTimeLimit;
          timerExpired = false;
          document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
          document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
          document.querySelector("#timer-value").classList.remove("timer-expired");
          document.querySelector("#live-timer-setting").value = String(questionTimeLimit);
          if (!timerStarted) {
            resetTimer();
          }
        }
        if (newRecord.status === "answering" && !document.querySelector("#quiz").classList.contains("active")) {
          showScreen("quiz");
        }
        if (questionChanged && document.querySelector("#quiz").classList.contains("active")) {
          currentQuestion = newRecord.current_question ?? currentQuestion;
          renderQuestion();
        }
        if (timerChanged && document.querySelector("#quiz").classList.contains("active")) {
          secondsLeft = questionTimeLimit;
          timerExpired = false;
          resetTimer();
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
  document.querySelector("#locked-count").textContent = "0";
  document.querySelector("#lock-status").className = "lock-status";
  document.querySelector("#lock-answer").disabled = true;
  document.querySelector("#lock-answer").textContent = "Confirm selected answer";
  document.querySelector("#reveal-answer").disabled = true;
  document.querySelector("#live-timer-setting").value = String(questionTimeLimit);
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
  if (activeGame) {
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
  document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
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

function startTimer() {
  if (timerStarted) return;
  timerStarted = true;
  const startTimerRow = document.querySelector("#start-timer-row");
  if (startTimerRow) startTimerRow.hidden = true;
  document.querySelector("#admin-review-status").textContent = "Timer running — players can buzz now";
  document.querySelector("#buzz-in").disabled = false;
  document.querySelector("#buzzer-status").textContent = "Listen to the host, then tap when you know it.";
  // Sync timer start to all clients via database - use buzzed_at as timer-started signal
  if (activeGame) {
    updateGame(activeGame.id, { status: "answering", timer_seconds: questionTimeLimit, buzzed_at: new Date().toISOString() })
      .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not start timer: ${cause.message}`; });
  }
  timerId = setInterval(() => {
    secondsLeft -= 1;
    document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
    if (secondsLeft <= 0) {
      clearInterval(timerId);
      timerExpired = true;
      document.querySelector("#timer-value").classList.add("timer-expired");
      document.querySelector("#timer-label").textContent = "Time is up — waiting for admin";
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

function applyLiveTimer() {
  if (lockedPlayers > 0 || answerRevealed) return;
  questionTimeLimit = Number(document.querySelector("#live-timer-setting").value);
  secondsLeft = questionTimeLimit;
  timerExpired = false;
  document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
  document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
  document.querySelector("#admin-review-status").textContent = `Timer updated to ${questionTimeLimit} seconds`;
  if (activeGame) {
    updateGame(activeGame.id, { timer_seconds: questionTimeLimit })
      .catch((cause) => {
        document.querySelector("#admin-review-status").textContent = `Could not sync timer: ${cause.message}`;
      });
  }
  resetTimer();
}

function selectAnswer(choice) {
  if (!isHost || !lockedPlayers || answerRevealed) return;
  selectedChoice = choice;
  document.querySelectorAll(".answer").forEach((answer) => answer.classList.toggle("selected", Number(answer.dataset.choice) === choice));
  document.querySelector("#lock-answer").disabled = false;
  document.querySelector("#reveal-answer").disabled = false;
}

function lockAnswer() {
  if (!isHost || !lockedPlayers || selectedChoice === null) return;
  document.querySelectorAll(".answer").forEach((answer) => { answer.disabled = true; });
  document.querySelector("#lock-answer").disabled = true;
  document.querySelector("#lock-answer").textContent = "Answer selected ✓";
  document.querySelector("#admin-review-status").textContent = "Answer selected — reveal when ready";
  document.querySelector("#reveal-answer").disabled = false;
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
  if (isHost || !activeGame || lockedPlayers > 0 || buzzInCooldown) return;
  buzzInCooldown = true;
  document.querySelector("#buzz-in").disabled = true;
  try {
    const claimed = await claimBuzzer(activeGame.id, activePlayer.id);
    if (!claimed) {
      // Another player already buzzed - wait for realtime update
      setTimeout(() => {
        if (activeGame) {
          supabase.from("games").select("*").eq("id", activeGame.id).single()
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

function revealAnswer() {
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
    document.querySelector("#admin-review-status").textContent = "Answer revealed — moving to the next question";
    document.querySelector("#reveal-answer").disabled = true;
    setTimeout(() => {
      currentQuestion += 1;
      if (currentQuestion >= questionBank.length) {
        document.querySelector("#results").querySelector(".winner-card strong").innerHTML = `${score} <small>points</small>`;
        clearInterval(timerId);
        showScreen("results");
      } else {
        if (activeGame) updateGame(activeGame.id, { status: "answering", current_question: currentQuestion, buzzed_player_id: null, buzzed_at: null, steal_player_id: null, steal_status: null });
        renderQuestion();
      }
    }, 2200);
  } else {
    // Wrong answer - enable steal for other player
    const feedback = document.querySelector("#feedback");
    feedback.className = "feedback feedback-warn";
    feedback.innerHTML = `<strong>Keep learning!</strong> ${question.explanation} <span>${question.reference}</span>`;
    document.querySelector("#admin-review-status").textContent = "Wrong answer — other player can steal!";
    document.querySelector("#reveal-answer").disabled = true;
    enableSteal();
  }
}

async function revealStealAnswer() {
  if (!activeGame || !activeGame.steal_player_id || activeGame.steal_selected_choice === null) return;
  const question = questionBank[currentQuestion];
  const stealChoice = activeGame.steal_selected_choice;
  
  const isCorrect = stealChoice === question.correct;
  
  // Show correct/incorrect for steal answer
  document.querySelectorAll(".answer").forEach((answer) => {
    if (Number(answer.dataset.choice) === question.correct) answer.classList.add("correct");
    if (Number(answer.dataset.choice) === stealChoice && !isCorrect) answer.classList.add("incorrect");
  });
  
  if (isCorrect) {
    // Award points to steal player
    const stealPoints = Math.max(100, 150 - Math.floor((questionTimeLimit - secondsLeft) * 3));
    document.querySelector("#admin-review-status").textContent = `Steal successful! +${stealPoints} points`;
    
    // Update player score
    await supabase.from("players").update({ score: supabase.rpc("increment", { row_id: activeGame.steal_player_id, amount: stealPoints }) }).eq("id", activeGame.steal_player_id).catch(() => {
      // Fallback: just add to score directly
      supabase.from("players").select("score").eq("id", activeGame.steal_player_id).single()
        .then(({ data: player }) => {
          if (player) {
            supabase.from("players").update({ score: player.score + stealPoints }).eq("id", activeGame.steal_player_id);
          }
        });
    });
  } else {
    document.querySelector("#admin-review-status").textContent = "Steal failed — moving to next question";
  }
  
  // Mark steal as scored and move to next question
  await updateGame(activeGame.id, { steal_status: "scored", steal_player_id: null, steal_selected_choice: null });
  
  document.querySelector("#reveal-answer").disabled = true;
  setTimeout(() => {
    currentQuestion += 1;
    if (currentQuestion >= questionBank.length) {
      document.querySelector("#results").querySelector(".winner-card strong").innerHTML = `${score} <small>points</small>`;
      clearInterval(timerId);
      showScreen("results");
    } else {
      if (activeGame) updateGame(activeGame.id, { status: "answering", current_question: currentQuestion, buzzed_player_id: null, buzzed_at: null, steal_player_id: null, steal_status: null, steal_selected_choice: null });
      renderQuestion();
    }
  }, 2200);
}

function enableSteal() {
  if (!activeGame) return;
  stealEnabled = true;
  updateGame(activeGame.id, { steal_status: "available" })
    .catch((cause) => { document.querySelector("#admin-review-status").textContent = `Could not enable steal: ${cause.message}`; });
}

function applyStealState(game) {
  const stealPanel = document.querySelector("#steal-panel");
  const stealAnswers = document.querySelector("#steal-answers");
  const stealSubmit = document.querySelector("#steal-submit");
  const stealStatus = document.querySelector("#steal-status");
  
  if (game.steal_status === "available" && !isHost && activePlayer && game.buzzed_player_id !== activePlayer.id) {
    stealEnabled = true;
    stealPanel.hidden = false;
    const question = questionBank[currentQuestion];
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
  } else if (game.steal_status === "pending" && isHost) {
    if (game.steal_player_id) {
      supabase.from("players").select("display_name").eq("id", game.steal_player_id).single()
        .then(({ data: player }) => {
          if (player) {
            document.querySelector("#admin-review-status").textContent = `${player.display_name} submitted a steal answer!`;
            document.querySelector("#reveal-answer").disabled = false;
          }
        });
    }
  } else if (game.steal_status === "scored") {
    stealPanel.hidden = true;
    stealEnabled = false;
    stealSelectedChoice = null;
  }
}

document.querySelectorAll("[data-screen]").forEach((control) => {
  control.addEventListener("click", (event) => {
    event.preventDefault();
    if (control.dataset.screen === "quiz" && activeGame) {
      updateGame(activeGame.id, { status: "answering", current_question: currentQuestion })
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
document.querySelector("#reveal-answer").addEventListener("click", revealAnswer);
document.querySelector("#start-timer").addEventListener("click", () => {
  startTimer();
});
document.querySelector("#timer-setting").addEventListener("change", (event) => {
  questionTimeLimit = Number(event.target.value);
  document.querySelector("#setting-saved").textContent = `${questionTimeLimit} seconds set for the next question.`;
  document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
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
