// Netlify Function: proxies AI requests to Anthropic so the API key never
// has to live in the browser (no localStorage, no visible network header,
// nothing lost when the user switches devices or clears site data).
//
// Setup: in the Netlify dashboard go to
//   Site configuration -> Environment variables
// and add ANTHROPIC_API_KEY = sk-ant-... (this is only ever read on the
// server; it is never sent to the client).

const ALLOWED_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"];
const DEFAULT_MODEL = ALLOWED_MODELS[0];
const MAX_TOKENS_CAP = 800; // hard ceiling regardless of what the client asks for
const MAX_CHARS = 6000; // guards against runaway prompts / cost

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond(500, {
      error: "Server is missing ANTHROPIC_API_KEY. Set it in Netlify: Site configuration -> Environment variables."
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return respond(400, { error: "Invalid JSON body." });
  }

  const system = typeof body.system === "string" ? body.system : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const model = ALLOWED_MODELS.indexOf(body.model) !== -1 ? body.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Number(body.maxTokens) || 500, MAX_TOKENS_CAP);

  if (!prompt) return respond(400, { error: "Missing prompt." });
  if (system.length > MAX_CHARS || prompt.length > MAX_CHARS) {
    return respond(400, { error: "Request too large." });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        system: system,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await anthropicRes.json().catch(function () { return {}; });

    if (!anthropicRes.ok) {
      const msg = (data && data.error && data.error.message) ||
        "Anthropic request failed (" + anthropicRes.status + ").";
      return respond(anthropicRes.status === 429 ? 429 : 502, { error: msg });
    }

    const block = (data.content || []).find(function (b) { return b.type === "text"; });
    if (!block || !block.text) {
      return respond(502, { error: "Model returned no text." });
    }

    return respond(200, { text: block.text.trim(), model: model });
  } catch (err) {
    return respond(502, { error: "Failed to reach Anthropic: " + err.message });
  }
};

function respond(statusCode, bodyObj) {
  return {
    statusCode: statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj)
  };
}
