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
let realtimeSubscribed = false;

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
    document.querySelector("#buzzer-status").textContent = winner
      ? "You buzzed first! Wait for the host to choose your answer."
      : "Another player buzzed first. Wait for the host to reveal the answer.";
    document.querySelector("#buzz-in").disabled = true;
    document.querySelector("#admin-review-status").textContent = isHost
      ? "A player buzzed — choose their answer"
      : "A player buzzed first";
    if (isHost) {
      document.querySelector("#reveal-answer").disabled = selectedChoice === null;
      if (game.buzzed_player_id) {
        supabase.from("players").select("display_name").eq("id", game.buzzed_player_id).single()
          .then(({ data: player }) => {
            if (player) {
              buzzedName.textContent = `${player.display_name} buzzed in!`;
              buzzedInfo.hidden = false;
            }
          });
      }
    }
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
      const { data: game } = await supabase.from("games").select("status").eq("id", activeGame.id).single();
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
        activeGame = newRecord;
        questionTimeLimit = newRecord.timer_seconds ?? questionTimeLimit;
        if (Array.isArray(newRecord.question_set) && newRecord.question_set.length) {
          questionBank.splice(0, questionBank.length, ...newRecord.question_set);
        }
        applyBuzzState(newRecord);
        if (newRecord.status === "answering" && !document.querySelector("#quiz").classList.contains("active")) {
          showScreen("quiz");
        }
        if (questionChanged && document.querySelector("#quiz").classList.contains("active")) {
          currentQuestion = newRecord.current_question ?? currentQuestion;
          renderQuestion();
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
      throw new Error("Online room service is unavailable. Please refresh and try again.");
    }
    setRoomState(result.game, result.player);
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
      throw new Error("Online room service is unavailable. Please refresh and try again.");
    }
    setRoomState(result.game, result.player);
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
  secondsLeft = questionTimeLimit;
  document.querySelector("#timer-value").textContent = formatSeconds(secondsLeft);
  document.querySelector("#timer-label").textContent = `${questionTimeLimit} seconds allowed`;
  document.querySelector("#timer-value").classList.remove("timer-expired");
  document.querySelectorAll(".answer").forEach((answer) => { answer.disabled = !isHost; });
  document.querySelector("#lock-answer").disabled = selectedChoice === null;
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
  if (isHost || !activeGame || lockedPlayers > 0) return;
  try {
    const claimed = await claimBuzzer(activeGame.id, activePlayer.id);
    if (claimed) applyBuzzState({ ...activeGame, buzzed_player_id: activePlayer.id });
    else applyBuzzState({ ...activeGame, buzzed_player_id: "another-player" });
  } catch (cause) {
    document.querySelector("#buzzer-status").textContent = `Could not buzz in: ${cause.message}`;
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
  if (isCorrect) score += Math.max(100, 150 - Math.floor((questionTimeLimit - secondsLeft) * 3));
  document.querySelector("#score").textContent = score;
  const feedback = document.querySelector("#feedback");
  feedback.className = `feedback ${isCorrect ? "feedback-good" : "feedback-warn"}`;
  feedback.innerHTML = `<strong>${isCorrect ? "Great answer!" : "Keep learning!"}</strong> ${question.explanation} <span>${question.reference}</span>`;
  document.querySelector("#admin-review-status").textContent = "Answer revealed — moving to the next question";
  document.querySelector("#reveal-answer").disabled = true;
  setTimeout(() => {
    currentQuestion += 1;
    if (currentQuestion >= questionBank.length) {
      document.querySelector("#results").querySelector(".winner-card strong").innerHTML = `${score} <small>points</small>`;
      clearInterval(timerId);
      showScreen("results");
    } else {
      if (activeGame) updateGame(activeGame.id, { status: "answering", current_question: currentQuestion, buzzed_player_id: null, buzzed_at: null });
      renderQuestion();
    }
  }, 2200);
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
    document.querySelector("#lobby-ai-preview-question").textContent = `${aiDraft.length} questions ready for review`;
    document.querySelector("#lobby-ai-preview-choices").innerHTML = aiDraft.map((question, index) =>
      `<li><strong>${index + 1}. ${question.text}</strong><br /><small>${question.choices.join(" · ")}</small></li>`
    ).join("");
    document.querySelector("#lobby-ai-preview-meta").textContent = aiDraft.map((question) =>
      `${question.reference} · ${question.explanation}`
    ).join(" | ");
    document.querySelector("#lobby-ai-preview").classList.add("visible");
  } catch (cause) {
    error.textContent = cause.message || "Could not generate questions.";
  } finally {
    button.disabled = false;
    button.textContent = "Generate 10 questions ✦";
  }
});

document.querySelector("#lobby-use-ai-question").addEventListener("click", () => {
  if (!aiDraft.length) return;
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

if (!supabaseConfigured) {
  document.querySelector(".connection-pill").innerHTML = '<span class="live-dot"></span> Preview mode';
}
