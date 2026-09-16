const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const promptFor = (topic: string, category: string, difficulty: string) => `
Create exactly 10 different, simple Bible quiz questions for a church game.
Topic: ${topic}
Category: ${category}
Difficulty: ${difficulty}

Use short sentences and familiar Bible characters, stories, and facts. Write questions that
children and youth can understand quickly. Avoid trick questions, difficult measurements,
technical wording, denominational disputes, unverified claims, and questions with more than
one reasonable answer. Keep each answer choice short and clearly different. Use a clear Bible reference.
Return ONLY valid JSON with exactly this shape:
{
  "questions": [{
  "category": "PEOPLE OF THE BIBLE" or "BIBLE EVENTS",
  "text": "question text",
  "choices": ["choice A", "choice B", "choice C", "choice D"],
  "correct": 0,
  "reference": "Book chapter:verses",
  "explanation": "short explanation"
  }]
}
The correct value must be an integer from 0 to 3. Do not repeat questions. Prefer questions
such as "Who built the ark?" or "Where was Jesus born?" rather than obscure details.
`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { topic, category = "mixed", difficulty = "medium" } = await request.json();
    if (!topic || typeof topic !== "string" || topic.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Enter a Bible topic first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured in Supabase.");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptFor(topic.trim(), category, difficulty) }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${details.slice(0, 200)}`);
    }
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned an empty question.");

    const parsed = JSON.parse(text);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(questions) || questions.length !== 10) {
      throw new Error("Gemini did not return exactly 10 questions.");
    }
    questions.forEach((question) => {
      if (
        typeof question.text !== "string" ||
        !Array.isArray(question.choices) ||
        question.choices.length !== 4 ||
        !Number.isInteger(question.correct) &&
        typeof question.correct !== "string" ||
        typeof question.reference !== "string" ||
        typeof question.explanation !== "string"
      ) throw new Error("Gemini returned an invalid question format.");
      if (typeof question.correct === "string") {
        question.correct = question.choices.findIndex((choice: string) => choice === question.correct);
      }
      if (question.correct < 0 || question.correct > 3) {
        throw new Error("Gemini returned an invalid answer index.");
      }
    });

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Question generation failed." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
