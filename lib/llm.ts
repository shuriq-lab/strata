/**
 * Optional narration. The demo's answers and merges are scripted either way.
 * Set OPENAI_API_KEY and pass --llm to add one paragraph. A missing key is not an error.
 */
export async function narrateAnswers(answers: { question: string; answer: string }[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = [
    "You are writing one short paragraph for a demo of a memory pyramid.",
    "Use only the answers below. Do not add facts.",
    ...answers.map((item) => `Q: ${item.question}\nA: ${item.answer}`),
  ].join("\n\n");
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.STRATA_LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}
