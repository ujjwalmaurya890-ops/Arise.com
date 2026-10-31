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
// Bound every upstream call. The three coding-platform proxies use the same
// pattern (8 s there; LLM responses are slower, so 20 s here, still inside the
// platform function limit). Without this a hung Anthropic connection kept the
// function alive until the platform killed it, with no useful client response.
const FETCH_TIMEOUT_MS = 20000;

const { authorize } = require('../../server/access.cjs');
const { getServices } = require('../../server/firebase.cjs');
const { fail } = require('../../server/http.cjs');

// AI responses are user-specific and must never be stored in a shared cache.
// These mirror the headers server/http.cjs puts on every authenticated API
// response (the local respond() helper previously omitted all of them).
function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    },
    body: JSON.stringify(bodyObj)
  };
}

exports.handler = async function (event) {
  try { await authorize(event, getServices()); } catch (error) { return fail(error); }
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond(500, {
      error: "Server is missing ANTHROPIC_API_KEY. Set it in Netlify: Site configuration -> Environment variables."
    });
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
  // Both 6,000-character fields may contain four-byte Unicode. Bound the raw
  // body as well, so unrelated fields cannot force an unbounded JSON parse.
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) return respond(413, { error: 'Request too large.' });
  let body;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch (e) {
    return respond(400, { error: "Expected a JSON object." });
  }

  const system = typeof body.system === "string" ? body.system : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const model = ALLOWED_MODELS.indexOf(body.model) !== -1 ? body.model : DEFAULT_MODEL;
  const requestedTokens = body.maxTokens === undefined ? 500 : Number(body.maxTokens);
  if (body.maxTokens !== undefined && !['number', 'string'].includes(typeof body.maxTokens) ||
      !Number.isSafeInteger(requestedTokens) || requestedTokens < 1) {
    return respond(400, { error: 'maxTokens must be a positive integer.' });
  }
  const maxTokens = Math.min(requestedTokens, MAX_TOKENS_CAP);

  if (!prompt.trim()) return respond(400, { error: "Missing prompt." });
  if (system.length > MAX_CHARS || prompt.length > MAX_CHARS) {
    return respond(400, { error: "Request too large." });
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
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
      }),
      signal: controller.signal
    });

    const data = await anthropicRes.json().catch(function () { return {}; });

    if (!anthropicRes.ok) {
      const msg = (data && data.error && data.error.message) ||
        "Anthropic request failed (" + anthropicRes.status + ").";
      return respond(anthropicRes.status === 429 ? 429 : 502, { error: msg });
    }

    const block = (Array.isArray(data?.content) ? data.content : []).find(function (b) { return b && b.type === "text"; });
    if (!block || typeof block.text !== 'string' || !block.text.trim()) {
      return respond(502, { error: "Model returned no text." });
    }

    return respond(200, { text: block.text.trim(), model: model });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return respond(504, { error: "The AI service took too long to respond. Please try again." });
    }
    return respond(502, { error: "Failed to reach Anthropic: " + err.message });
  } finally {
    clearTimeout(timer);
  }
};
