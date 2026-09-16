import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function generateQuestion(topic, category = "mixed", difficulty = "medium") {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("generate-question", {
    body: { topic, category, difficulty },
  });
  if (error) throw error;
  if (!data?.questions && !data?.question) throw new Error(data?.error || "No questions were generated.");
  const questions = data.questions || [data.question];
  return questions.map((question) => {
    const correct = typeof question.correct === "number"
      ? question.correct
      : question.choices?.findIndex((choice) => choice === question.correct);
    if (
      typeof question.text !== "string" ||
      !Array.isArray(question.choices) ||
      question.choices.length !== 4 ||
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct > 3
    ) {
      throw new Error("One generated question had an invalid format.");
    }
    return {
      ...question,
      category: question.category || "BIBLE EVENTS",
      correct,
    };
  });
}

function getOfflineGame() {
  const stored = localStorage.getItem("bqb_offline_game");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

function setOfflineGame(game) {
  if (game) {
    localStorage.setItem("bqb_offline_game", JSON.stringify(game));
  } else {
    localStorage.removeItem("bqb_offline_game");
  }
}

function getOfflinePlayers() {
  const stored = localStorage.getItem("bqb_offline_players");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }
  return [];
}

function setOfflinePlayers(players) {
  localStorage.setItem("bqb_offline_players", JSON.stringify(players));
}

export async function createGame(displayName, timerSeconds = 15) {
  if (!supabase) {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const game = { id: `offline-${Date.now()}`, room_code: roomCode, status: "lobby", current_question: 0, total_questions: 10, question_set: [], timer_seconds: timerSeconds, buzzed_player_id: null, buzzed_at: null, steal_player_id: null, steal_status: null, steal_selected_choice: null, admin_connected: false, created_at: new Date().toISOString() };
    setOfflineGame(game);
    setOfflinePlayers([]);
    return { game, player: null, offline: true };
  }

  const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const { data: game, error: gameError } = await supabase
    .from("games")
    .insert({ room_code: roomCode, timer_seconds: timerSeconds })
    .select()
    .single();

  if (gameError) throw gameError;
  return { game, player: null, offline: false };
}

export async function joinGame(roomCode, displayName) {
  if (!supabase) {
    const game = getOfflineGame();
    if (!game) throw new Error("That room could not be found.");
    if (game.status !== "lobby") throw new Error("This game has already started.");
    const players = getOfflinePlayers();
    if (players.length >= 2) throw new Error("This room already has two players.");
    const player = { id: `offline-player-${Date.now()}`, game_id: game.id, display_name: displayName, score: 0, connected: true, joined_at: new Date().toISOString() };
    players.push(player);
    setOfflinePlayers(players);
    return { game, player, offline: true };
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("room_code", roomCode.toUpperCase())
    .single();

  if (gameError) throw new Error("That room could not be found.");
  if (game.status !== "lobby") throw new Error("This game has already started.");

  const { count, error: countError } = await supabase
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("game_id", game.id);

  if (countError) throw countError;
  if ((count ?? 0) >= 2) throw new Error("This room already has two players.");

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({ game_id: game.id, display_name: displayName })
    .select()
    .single();

  if (playerError) throw playerError;
  return { game, player, offline: false };
}

export async function listPlayers(gameId) {
  if (!supabase || !gameId) {
    // Offline: return players from localStorage
    return getOfflinePlayers();
  }
  const { data, error } = await supabase
    .from("players")
    .select("id, display_name")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveLockedAnswer(gameId, playerId, questionIndex, selectedChoice, questionText) {
  if (!supabase || !gameId || !playerId) return;
  const { error } = await supabase.from("game_answers").upsert({
    game_id: gameId,
    player_id: playerId,
    question_index: questionIndex,
    question_key: questionText,
    selected_choice: selectedChoice
  }, { onConflict: "game_id,player_id,question_index" });
  if (error) throw error;
}

export async function updateGame(gameId, updates) {
  if (!supabase || !gameId) {
    // Offline: update localStorage
    const game = getOfflineGame();
    if (game) {
      Object.assign(game, updates);
      setOfflineGame(game);
    }
    return;
  }
  const { error } = await supabase.from("games").update(updates).eq("id", gameId);
  if (error) throw error;
}

export async function claimBuzzer(gameId, playerId) {
  if (!supabase || !gameId || !playerId) {
    // Offline: check and set buzz in localStorage
    const game = getOfflineGame();
    if (game && !game.buzzed_player_id) {
      game.buzzed_player_id = playerId;
      game.buzzed_at = new Date().toISOString();
      game.status = "answering";
      setOfflineGame(game);
      return true;
    }
    return false;
  }
  const { data, error } = await supabase
    .from("games")
    .update({ buzzed_player_id: playerId, buzzed_at: new Date().toISOString(), status: "answering" })
    .eq("id", gameId)
    .is("buzzed_player_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function countLockedAnswers(gameId, questionIndex) {
  if (!supabase || !gameId) return 0;
  const { count, error } = await supabase.from("game_answers")
    .select("*", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("question_index", questionIndex);
  if (error) throw error;
  return count ?? 0;
}

export function subscribeToGame(gameId, onChange) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`game:${gameId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_answers", filter: `game_id=eq.${gameId}` }, onChange);

  channel.subscribe();
  return () => supabase.removeChannel(channel);
}
