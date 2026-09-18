Deno.serve(async (req) => {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  try {
    const b = await req.json();
    const k = Deno.env.get("GEMINI_API_KEY");
    if (!b.topic || !k) throw Error(!b.topic ? "Enter a Bible topic first." : "GEMINI_API_KEY is not configured.");
    const p = `Create exactly 10 different simple Bible quiz questions about ${b.topic}. Use short sentences and familiar Bible characters, stories, and facts for children and youth. Avoid trick questions and obscure details. Keep answer choices short and clearly different. Return only JSON: {"questions":[{"category":"BIBLE EVENTS","text":"...","choices":["...","...","...","..."],"correct":0,"reference":"...","explanation":"..."}]}. Use integer correct 0-3 and do not repeat.`;
    const models = ["gemini-2.0-flash", "gemini-2.5-flash"];
    let lastError = "";
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` + k, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.4, responseMimeType: "application/json" } }),
        });
        const x = await r.text();
        if (r.ok) {
          const z = JSON.parse(JSON.parse(x).candidates[0].content.parts[0].text);
          const qs = Array.isArray(z) ? z : z.questions;
          if (!Array.isArray(qs) || qs.length !== 10) throw Error("Gemini did not return exactly 10 questions.");
          qs.forEach((q) => {
            if (typeof q.correct === "string") q.correct = q.choices.findIndex((c: string) => c === q.correct);
            if (typeof q.text !== "string" || !Array.isArray(q.choices) || q.choices.length !== 4 || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
              throw Error("Gemini returned an invalid question format.");
            }
          });
          return new Response(JSON.stringify({ questions: qs }), { headers: h });
        }
        lastError = "Gemini request failed (" + r.status + "): " + x.slice(0, 200);
        if (r.status === 503 || r.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    throw Error(lastError || "Gemini request failed.");
  } catch (x) {
    return new Response(JSON.stringify({ error: x instanceof Error ? x.message : "Question generation failed." }), { status: 500, headers: h });
  }
});

