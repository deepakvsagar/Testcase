import { ASSETS } from './assets.js';

const MODELS = [
  { id: 'gemini-3.8-flash', provider: 'gemini', key: 'GEMINI_API_KEY', label: 'Gemini 3.8 Flash', fit: ['bedtime', 'drama', 'magnum', 'curious'], note: 'Recommended · fast, capable, cost-conscious' },
  { id: 'gemini-3.1-pro-preview', provider: 'gemini', key: 'GEMINI_API_KEY', label: 'Gemini 3.1 Pro', fit: ['drama', 'magnum', 'curious'], note: 'Advanced reasoning · preview' },
  { id: 'gpt-6.1-sol', provider: 'openai', key: 'OPENAI_API_KEY', label: 'OpenAI GPT-6.1 Sol', fit: ['bedtime', 'drama', 'magnum', 'curious'], note: 'Strong balance of quality, speed, and cost' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', key: 'ANTHROPIC_API_KEY', label: 'Claude Sonnet 5.5', fit: ['bedtime', 'drama', 'magnum', 'curious'], note: 'Balanced · strong writing and speed' },
  { id: 'claude-opus-5-5', provider: 'anthropic', key: 'ANTHROPIC_API_KEY', label: 'Claude Opus 5.5', fit: ['drama', 'magnum'], note: 'Premium · longer, more intricate narratives' },
];
const VISUAL_MODELS = [
  { id: 'gemini-nano-banana-2.1', provider: 'gemini', key: 'GEMINI_API_KEY', label: 'Nano Banana 2.1', note: 'Recommended · strong character consistency' },
  { id: 'gemini-3.1-flash-lite-image', provider: 'gemini', key: 'GEMINI_API_KEY', label: 'Nano Banana Lite', note: 'Fast image generation' },
  { id: 'gemini-3-pro-image', provider: 'gemini', key: 'GEMINI_API_KEY', label: 'Nano Banana Pro', note: 'Premium detail and scene direction' },
  { id: 'gpt-image-2', provider: 'openai', key: 'OPENAI_API_KEY', label: 'GPT Image 2', note: 'OpenAI image generation and editing' },
];
const VIDEO_MODELS = [
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast · Recommended', pricePerSecond: 0.10 },
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite · Lowest cost', pricePerSecond: 0.05 },
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Standard · Highest quality', pricePerSecond: 0.40 },
];
const MODEL_PRIORITY = {
  bedtime: ['gemini-3.8-flash', 'claude-sonnet-5-5', 'gpt-6.1-sol'],
  drama: ['claude-sonnet-5-5', 'gemini-3.1-pro-preview', 'gpt-6.1-sol', 'claude-opus-5-5', 'gemini-3.8-flash'],
  magnum: ['claude-opus-5-5', 'gpt-6.1-sol', 'gemini-3.1-pro-preview', 'claude-sonnet-5-5', 'gemini-3.8-flash'],
  curious: ['gemini-3.8-flash', 'claude-sonnet-5-5', 'gemini-3.1-pro-preview', 'gpt-6.1-sol'],
};
const PATHS = {
  bedtime: { name: 'Bedtime Bestie', minutes: [1, 2], moods: ['Calm & cozy', 'Playful & funny', 'Curious & adventurous'], audience: 'age', maxScenes: 8, maxEditorScenes: 12, kind: 'a gentle, child-friendly bedtime story' },
  drama: { name: 'Drama Dream', minutes: [5, 6, 7, 8, 9, 10], moods: ['Suspenseful', 'Heartfelt', 'Comedic', 'Mysterious'], audience: 'text', maxScenes: 32, maxEditorScenes: 32, kind: 'a hook-driven concept story for social and creator audiences' },
  magnum: { name: 'Magnum Opus', minutes: [20, 25, 30], moods: ['Epic', 'Hopeful', 'Dark & dramatic', 'Mysterious'], audience: 'text', maxScenes: 32, maxEditorScenes: 32, kind: 'a substantial story episode or large-canvas narrative with coherent character and plot arcs' },
  curious: { name: 'Curious Class', minutes: [2, 5, 10, 15, 20, 30], moods: ['Playful & funny', 'Curious & adventurous', 'Calm & clear'], audience: 'text', maxScenes: 32, maxEditorScenes: 32, kind: 'an educational story that teaches the stated learning goal accurately and clearly' },
};
const PATH_IDS = Object.keys(PATHS);
const AGE_GROUPS = ['3–5 years', '6–8 years', '9–12 years', 'Family audience'];
const STORY_STYLES = ['Cinematic realism'];
const IMAGE_STYLES = ['Cinematic realism', 'Soft watercolor', '3D storybook', 'Paper cutout'];
const PLAN_FIELDS = ['shot', 'camera', 'lighting', 'palette', 'composition', 'motion'];
const WORDS_PER_MINUTE = 120;
const PROVIDER_LABELS = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };
const MAX_REQUEST_BYTES = 10_000;
const MAX_REQUESTS_PER_MINUTE = 4;
const MAX_VIDEO_CLIPS = 24;
const MAX_NARRATION_CHARACTERS = 8_000;
const requestsByUser = new Map();
const imageRequestsByUser = new Map();
const videoRequestsByUser = new Map();
const voiceRequestsByUser = new Map();
const PRIVATE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...PRIVATE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

// Same-origin check. Browsers attach Origin to POSTs but not to same-origin GETs,
// so a GET without Origin is accepted unless Fetch Metadata marks it cross-site.
function sameSiteRequest(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

async function requestIdentity(request, env) {
  const siteOriginOk = sameSiteRequest(request);
  const authorization = request.headers.get('authorization') || '';
  // The iOS app signs in with Apple and sends a StoryVerse session token.
  if (siteOriginOk && authorization.startsWith('Bearer sv1.')) {
    const session = await readAppSession(authorization.slice(7), env);
    return session ? { userId: `apple:${session.sub}`, mobile: true } : null;
  }
  const mobileKey = env.STORYVERSE_MOBILE_TEST_TOKEN;
  const mobileOk = Boolean(mobileKey && constantTimeEqual(authorization, `Bearer ${mobileKey}`));
  if (!siteOriginOk && !mobileOk) return null;
  const forwardedId = request.headers.get('oai-authenticated-user-id');
  if (forwardedId) return { userId: `site:${forwardedId}`, mobile: false };
  if (mobileOk) return { userId: `mobile-test:${mobileKey.slice(0, 16)}`, mobile: true };
  return null;
}

// ---------- Sign in with Apple (iOS app) ----------

const APPLE_ISSUER = 'https://appleid.apple.com';
const APP_SESSION_DAYS = 30;
const authRequestsByClient = new Map();
let appleKeysCache = { keys: null, fetchedAt: 0 };

function base64UrlToText(value) { return new TextDecoder().decode(base64UrlToBytes(value)); }

async function appleSigningKey(kid) {
  const stale = Date.now() - appleKeysCache.fetchedAt > 60 * 60 * 1000;
  if (!appleKeysCache.keys || stale || !appleKeysCache.keys.some((key) => key.kid === kid)) {
    const response = await fetch(`${APPLE_ISSUER}/auth/keys`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('apple-keys-unavailable');
    const payload = await response.json();
    appleKeysCache = { keys: Array.isArray(payload?.keys) ? payload.keys : [], fetchedAt: Date.now() };
  }
  const jwk = appleKeysCache.keys.find((key) => key.kid === kid && key.kty === 'RSA');
  return jwk ? crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
}

async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Verifies an Apple identity token: signature, issuer, audience (the app's bundle
// ID), expiry, and the one-time nonce the app generated for this sign-in.
async function verifyAppleIdentityToken(token, rawNonce, bundleId) {
  if (typeof token !== 'string' || token.length > 4_000) return null;
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) return null;
  let head; let claims;
  try { head = JSON.parse(base64UrlToText(header)); claims = JSON.parse(base64UrlToText(payload)); } catch { return null; }
  if (head?.alg !== 'RS256' || typeof head.kid !== 'string') return null;
  const key = await appleSigningKey(head.kid);
  if (!key) return null;
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(signature), new TextEncoder().encode(`${header}.${payload}`));
  if (!valid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== APPLE_ISSUER || claims.aud !== bundleId || !Number.isFinite(claims.exp) || claims.exp < now) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200) return null;
  if (typeof rawNonce !== 'string' || rawNonce.length < 16 || rawNonce.length > 200 || claims.nonce !== await sha256Hex(rawNonce)) return null;
  return { sub: claims.sub };
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`storyverse-app-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeAppSession(sub, env) {
  const expiresAt = Date.now() + APP_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ sub, expiresAt })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env.STORYVERSE_SESSION_SECRET), new TextEncoder().encode(payload)));
  return { token: `sv1.${payload}.${bytesToBase64Url(signature)}`, expiresAt };
}

async function readAppSession(token, env) {
  if (!env.STORYVERSE_SESSION_SECRET || typeof token !== 'string' || token.length > 2_000) return null;
  const [version, payload, signature, extra] = token.split('.');
  if (version !== 'sv1' || !payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await sessionKey(env.STORYVERSE_SESSION_SECRET), base64UrlToBytes(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const value = JSON.parse(base64UrlToText(payload));
    return typeof value.sub === 'string' && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}

function appSignInConfigured(env) {
  return Boolean(env.APPLE_BUNDLE_ID && typeof env.STORYVERSE_SESSION_SECRET === 'string' && env.STORYVERSE_SESSION_SECRET.length >= 32);
}

async function appleSignIn(request, env) {
  if (!sameSiteRequest(request)) return json({ error: 'Request origin could not be verified.' }, 403);
  if (!appSignInConfigured(env)) return json({ error: 'Sign in with Apple is not configured on the server.' }, 503);
  const client = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!takeRequestSlot(authRequestsByClient, client, 20, 60_000)) return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429, { 'retry-after': '60' });
  const body = await readJson(request, 8_000);
  if (body.tooLarge || body.invalid) return json({ error: 'Send a valid sign-in request.' }, 400);
  let identity;
  try { identity = await verifyAppleIdentityToken(body.value?.identityToken, body.value?.nonce, env.APPLE_BUNDLE_ID); }
  catch { return json({ error: 'Apple sign-in could not be checked right now. Try again.' }, 502); }
  if (!identity) return json({ error: 'Apple sign-in could not be verified. Try again.' }, 401);
  const session = await makeAppSession(identity.sub, env);
  return json({ session: session.token, expiresAt: session.expiresAt });
}

function identityError(request, message) {
  const origin = request.headers.get('origin');
  const mismatchedOrigin = origin && origin !== new URL(request.url).origin;
  return json({ error: mismatchedOrigin ? 'Request origin could not be verified.' : message }, mismatchedOrigin ? 403 : 401);
}

// Sliding-window limiter shared by every paid endpoint. Isolate-local, so it is a
// courtesy guard against accidental repeat clicks, not a global quota.
function takeRequestSlot(buckets, userId, limit, windowMs) {
  const now = Date.now();
  for (const [id, timestamps] of buckets) {
    const recent = timestamps.filter((time) => now - time < windowMs);
    if (recent.length) buckets.set(id, recent);
    else buckets.delete(id);
  }
  if (buckets.size > 2_000) {
    for (const id of buckets.keys()) {
      buckets.delete(id);
      if (buckets.size <= 1_000) break;
    }
  }
  const recent = buckets.get(userId) ?? [];
  if (recent.length >= limit) return false;
  buckets.set(userId, [...recent, now]);
  return true;
}

async function readJson(request, maxBytes) {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return { tooLarge: true };
  const raw = await request.text();
  if (raw.length > maxBytes) return { tooLarge: true };
  try { return { value: JSON.parse(raw) }; } catch { return { invalid: true }; }
}

function validateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Send a valid story brief.';
  if (typeof value.idea !== 'string' || value.idea.trim().length < 8 || value.idea.length > 1_200) return 'Describe your idea in 8–1,200 characters.';
  const path = PATHS[value.path];
  if (!path) return 'Choose a story type.';
  if (!MODELS.some((model) => model.id === value.model && model.fit.includes(value.path))) return 'Choose an available AI model for this story type.';
  if (path.audience === 'age' && !AGE_GROUPS.includes(value.age)) return 'Choose an age group.';
  if (path.audience === 'text' && (typeof value.audience !== 'string' || value.audience.trim().length < 2 || value.audience.length > 160)) return 'Describe your audience in 2–160 characters.';
  if (!path.minutes.includes(value.minutes)) return 'Choose a supported story length.';
  if (!path.moods.includes(value.mood)) return 'Choose a story mood.';
  if (!STORY_STYLES.includes(value.style)) return 'Choose the cinematic story style.';
  return null;
}

function parseModelJson(text) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

function validateDraft(draft, minutes, path) {
  if (!draft || typeof draft.title !== 'string' || !Array.isArray(draft.scenes)) return null;
  const title = draft.title.trim().slice(0, 120);
  if (!title || draft.scenes.length < 2 || draft.scenes.length > PATHS[path].maxScenes) return null;
  const scenes = draft.scenes.map((scene) => ({
    narration: typeof scene?.narration === 'string' ? scene.narration.trim().slice(0, 1_200) : '',
    visualPlan: Object.fromEntries(PLAN_FIELDS.map((key) => [key, typeof scene?.visualPlan?.[key] === 'string' ? scene.visualPlan[key].trim().slice(0, 240) : ''])),
  }));
  if (scenes.some((scene) => !scene.narration || Object.values(scene.visualPlan).some((part) => !part))) return null;
  const words = scenes.map((scene) => scene.narration).join(' ').trim().split(/\s+/u).length;
  const minWords = path === 'bedtime' ? 25 : Math.min(45, minutes * 80);
  if (words > minutes * WORDS_PER_MINUTE || words < minWords) return null;
  return { title, scenes, script: scenes.map((scene) => scene.narration).join('\n\n'), wordCount: words };
}

function storySchema() {
  const fields = Object.fromEntries(PLAN_FIELDS.map((key) => [key, { type: 'string' }]));
  const visualPlan = { type: 'object', additionalProperties: false, properties: fields, required: Object.keys(fields) };
  return { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { narration: { type: 'string' }, visualPlan }, required: ['narration', 'visualPlan'] } } }, required: ['title', 'scenes'] };
}

function buildPrompt(input) {
  const path = PATHS[input.path];
  const audience = path.audience === 'age' ? input.age : input.audience.trim();
  const maxWords = input.minutes * WORDS_PER_MINUTE;
  const minWords = Math.min(45, input.minutes * 80);
  const targetWords = Math.round(maxWords * 0.85);
  const suitability = input.path === 'bedtime' || input.path === 'curious'
    ? 'Keep it age-appropriate for the audience, with no violence or frightening content.'
    : 'Keep it suitable for a general audience: no graphic violence, sexual content, or gratuitous cruelty.';
  return `Create ${path.kind} from this brief.\n\nStory type: ${path.name}\nIdea or learning goal: ${input.idea.trim()}\nAudience: ${audience}\nTarget length: ${input.minutes} minute(s) of narration, about ${targetWords} spoken words and never more than ${maxWords}\nMood: ${input.mood}\nVisual production: cinematic realism for future live-action AI video; do not write around an illustration or subtitle format.\n\nReturn only JSON with a title and 2 to ${path.maxScenes} scenes. Each scene must contain narration and a visualPlan object. You, the model, must make all visual decisions: shot, camera angle or movement, lighting, color palette, composition, and motion. Do not ask the user to supply visual directions. Keep characters and visual continuity consistent from scene to scene. Make camera and lighting choices serve the emotional beat and the story. Narration across scenes must form a complete story with a clear beginning, middle, and ending, and stay between ${minWords} and ${maxWords} words. ${input.path === 'curious' ? 'Teach the requested learning goal accurately; do not invent facts. ' : ''}${suitability} Avoid private personal data and imitation of copyrighted characters or living creators.`;
}

function modelOutput(payload, provider) {
  if (provider === 'gemini') return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (provider === 'openai') return payload?.output?.flatMap((item) => item.content ?? []).filter((part) => part.type === 'output_text').map((part) => part.text).join('') ?? '';
  return payload?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('') ?? '';
}

// Why a provider stopped early, so the user gets an actionable message instead of
// a generic "unexpected format" when the JSON is cut off or the request is declined.
function stopProblem(payload, provider) {
  if (provider === 'anthropic') {
    if (payload?.stop_reason === 'refusal') return 'refused';
    if (payload?.stop_reason === 'max_tokens') return 'truncated';
  } else if (provider === 'gemini') {
    const reason = payload?.candidates?.[0]?.finishReason;
    if (reason === 'MAX_TOKENS') return 'truncated';
    if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || payload?.promptFeedback?.blockReason) return 'refused';
  } else if (payload?.status === 'incomplete') {
    return payload?.incomplete_details?.reason === 'content_filter' ? 'refused' : 'truncated';
  }
  return null;
}

const STOP_MESSAGES = {
  refused: 'The model declined this request. Try rephrasing your idea or choose another model.',
  truncated: 'The model ran out of room before finishing. Try a shorter length or another model.',
};

async function requestModel(model, env, prompt, schema = storySchema(), maxOutputTokens = 16_000) {
  const maxTokens = 1_200 + Math.ceil(prompt.length / 2) + 250 * 60; // generous ceiling; capped by maxOutputTokens
  let url; let headers; let body;
  if (model.provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`;
    headers = { 'content-type': 'application/json', 'x-goog-api-key': env[model.key] };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: Math.min(maxTokens, maxOutputTokens), responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } } };
  } else if (model.provider === 'openai') {
    url = 'https://api.openai.com/v1/responses';
    headers = { 'content-type': 'application/json', authorization: `Bearer ${env[model.key]}` };
    body = { model: model.id, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], text: { format: { type: 'json_schema', name: 'storyverse_story', strict: true, schema } }, max_output_tokens: Math.min(maxTokens, maxOutputTokens) };
  } else {
    // Current Claude models reject sampling parameters such as temperature, so the
    // request relies on structured outputs for the JSON shape instead. `fallbacks`
    // re-runs a safety-declined request on Anthropic's recommended model server-side.
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'content-type': 'application/json', 'x-api-key': env[model.key], 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' };
    body = { model: model.id, max_tokens: Math.min(maxTokens, maxOutputTokens), output_config: { effort: 'medium', format: { type: 'json_schema', schema } }, fallbacks: 'default', messages: [{ role: 'user', content: prompt }] };
  }
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
}

async function requestModelWithRetry(model, env, prompt, schema = storySchema(), maxOutputTokens = 16_000) {
  let response = await requestModel(model, env, prompt, schema, maxOutputTokens);
  // Provider 5xx responses are transient. Retry once after a short pause; avoid
  // retrying client errors or rate limits, which repetition cannot fix.
  if (response.status >= 500 && response.status <= 599) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    response = await requestModel(model, env, prompt, schema, maxOutputTokens);
  }
  return response;
}

function providerFailure(response, model, task) {
  const provider = PROVIDER_LABELS[model.provider];
  const providerRequestId = response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('x-goog-request-id') || null;
  console.error('StoryVerse model request failed', JSON.stringify({ task, provider: model.provider, model: model.id, status: response.status, providerRequestId }));
  if (response.status === 429) return json({ error: `${provider}’s usage limit for the selected model was reached. Wait before trying again.` }, 429);
  if (response.status === 400 || response.status === 404) return json({ error: `${provider} could not use this ${task} request. Try a simpler idea or another model.` }, 502);
  if (response.status === 401 || response.status === 403) return json({ error: `${provider} rejected its server key. Check the secret and model access.` }, 502);
  if (response.status >= 500) return json({ error: `The ${provider} service returned a temporary error (HTTP ${response.status}). Wait a minute and try again.` }, 502);
  return json({ error: `${provider} could not complete the ${task}. Please try again.` }, 502);
}

// Calls the model and returns either { draft } (parsed JSON) or { response } (an error to send).
async function runStructuredRequest(model, env, prompt, schema, maxOutputTokens, task) {
  const provider = PROVIDER_LABELS[model.provider];
  let response;
  try { response = await requestModelWithRetry(model, env, prompt, schema, maxOutputTokens); }
  catch { return { response: json({ error: `The ${provider} service could not be reached. Please try again.` }, 502) }; }
  if (!response.ok) return { response: providerFailure(response, model, task) };
  let result;
  try { result = await response.json(); } catch { return { response: json({ error: `${provider} returned an unreadable response. Please try again.` }, 502) }; }
  const problem = stopProblem(result, model.provider);
  if (problem) return { response: json({ error: STOP_MESSAGES[problem] }, 502) };
  const text = modelOutput(result, model.provider);
  if (!text) return { response: json({ error: `${provider} returned an empty ${task}. Please try a different idea.` }, 502) };
  try { return { draft: parseModelJson(text) }; }
  catch { return { response: json({ error: `${provider} returned the ${task} in an unexpected format. Please try again.` }, 502) }; }
}

async function generate(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT or use a configured mobile tester token to generate a story.');
  const body = await readJson(request, MAX_REQUEST_BYTES);
  if (body.tooLarge) return json({ error: 'Your brief is too long.' }, 413);
  if (body.invalid) return json({ error: 'Send a valid JSON story brief.' }, 400);
  const input = body.value;
  const invalid = validateInput(input);
  if (invalid) return json({ error: invalid }, 400);
  const model = MODELS.find((candidate) => candidate.id === input.model);
  if (!env[model.key]) return json({ error: `This model is not connected yet. Add the server secret ${model.key} to enable it.` }, 503);
  if (!takeRequestSlot(requestsByUser, identity.userId, MAX_REQUESTS_PER_MINUTE, 60_000)) {
    return json({ error: 'You have reached the short-term generation limit. Wait a minute and try again.' }, 429, { 'retry-after': '60' });
  }
  const outcome = await runStructuredRequest(model, env, buildPrompt(input), storySchema(), 16_000, 'story');
  if (outcome.response) return outcome.response;
  const safe = validateDraft(outcome.draft, input.minutes, input.path);
  if (!safe) return json({ error: 'The generated story did not fit the selected length. Please try again.' }, 502);
  return json({ ...safe, model: model.id });
}

function planSchema() {
  const fields = Object.fromEntries(PLAN_FIELDS.map((key) => [key, { type: 'string' }]));
  return { type: 'object', additionalProperties: false, properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { visualPlan: { type: 'object', additionalProperties: false, properties: fields, required: PLAN_FIELDS } }, required: ['visualPlan'] } } }, required: ['scenes'] };
}

async function planScenes(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT or use a configured mobile tester token to generate a visual plan.');
  const body = await readJson(request, 40_000);
  if (body.tooLarge) return json({ error: 'Your visual brief is too long.' }, 413);
  if (body.invalid) return json({ error: 'Send a valid JSON visual brief.' }, 400);
  const input = body.value;
  const path = PATHS[input?.path];
  if (!path || !MODELS.some((model) => model.id === input.model && model.fit.includes(input.path)) || !STORY_STYLES.includes(input.style) || !Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > path.maxEditorScenes || input.scenes.some((scene) => typeof scene?.narration !== 'string' || scene.narration.trim().length < 1 || scene.narration.length > 4_000)) return json({ error: `Add 1–${path?.maxEditorScenes ?? 32} scenes with narration and use cinematic realism.` }, 400);
  const model = MODELS.find((candidate) => candidate.id === input.model);
  if (!env[model.key]) return json({ error: `This model is not connected yet. Add the server secret ${model.key} to enable it.` }, 503);
  if (!takeRequestSlot(requestsByUser, identity.userId, MAX_REQUESTS_PER_MINUTE, 60_000)) return json({ error: 'You have reached the short-term generation limit. Wait a minute and try again.' }, 429, { 'retry-after': '60' });
  const prompt = `Create visual plans for every scene in this ${path.name} story. The user does not provide visual directions. You decide them. Style: ${input.style}. Keep the same characters, wardrobe, setting details, and palette logic across scenes. Return JSON with one scene entry per supplied narration and a visualPlan containing concise strings for shot, camera, lighting, palette, composition, and motion. Do not rewrite the narration.\n\n${input.scenes.map((scene, i) => `Scene ${i + 1}: ${scene.narration.trim()}`).join('\n')}`;
  const outcome = await runStructuredRequest(model, env, prompt, planSchema(), 8_000, 'visual plan');
  if (outcome.response) return outcome.response;
  const draft = outcome.draft;
  if (!Array.isArray(draft?.scenes) || draft.scenes.length !== input.scenes.length || draft.scenes.some((scene) => !validVisualPlan(scene?.visualPlan, Infinity))) return json({ error: 'The model did not return a complete visual plan. Please try again.' }, 502);
  return json({ scenes: draft.scenes.map((scene) => ({ visualPlan: Object.fromEntries(PLAN_FIELDS.map((key) => [key, scene.visualPlan[key].trim().slice(0, 240)])) })), model: model.id });
}

async function generateSceneImage(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT or use a configured mobile tester token to generate scene art.');
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 8_000_000) return json({ error: 'The scene image reference is too large.' }, 413);
    input = JSON.parse(raw);
  } catch { return json({ error: 'Send a valid scene image request.' }, 400); }
  const model = VISUAL_MODELS.find((candidate) => candidate.id === input?.model);
  const aspectRatios = ['9:16', '16:9', '1:1'];
  if (!model || !PATHS[input?.path] || !IMAGE_STYLES.includes(input?.style) || typeof input?.title !== 'string' || input.title.length > 120 || typeof input?.narration !== 'string' || input.narration.trim().length < 1 || input.narration.length > 1_200 || !input?.visualPlan || !PLAN_FIELDS.every((key) => typeof input.visualPlan[key] === 'string' && input.visualPlan[key].length <= 240) || !aspectRatios.includes(input?.aspectRatio) || (input.previousInteractionId !== null && input.previousInteractionId !== undefined && (typeof input.previousInteractionId !== 'string' || input.previousInteractionId.length > 200)) || (input.referenceImage !== null && input.referenceImage !== undefined && (typeof input.referenceImage !== 'string' || input.referenceImage.length > 7_000_000))) return json({ error: 'Check the scene, visual model, and video layout.' }, 400);
  const apiKey = env[model.key];
  if (!apiKey) return json({ error: `This image model is not connected yet. Add the server secret ${model.key} to enable it.` }, 503);
  if (!takeRequestSlot(imageRequestsByUser, identity.userId, 32, 60_000)) return json({ error: 'You have reached the scene image limit. Wait a minute before generating more.' }, 429, { 'retry-after': '60' });

  const { shot, camera, lighting, palette, composition, motion } = input.visualPlan;
  const photoreal = input.style === 'Cinematic realism';
  const medium = photoreal ? 'photorealistic cinematic film still' : 'polished storybook illustration';
  const prompt = `Create one ${medium} for scene ${Math.max(1, Math.min(32, Number(input.sceneNumber) || 1))} of “${input.title.trim()}”. Story type: ${input.path}. Art direction: ${input.style}. Scene narration: ${input.narration.trim()}\n\nScene direction chosen by the story director: ${shot}; ${camera}; ${lighting}; palette ${palette}; composition ${composition}; motion impression ${motion}.\n\nContinuity rules: depict the same named and unnamed characters with exactly consistent face, age, body shape, colors, clothing, accessories, and proportions in every scene. Keep the ${photoreal ? 'photographic look, lens character' : 'illustration medium, line quality'}, lighting logic, and color palette consistent. Continue naturally from the previous scene image when one is provided; change pose, setting details, and camera framing only as the story beat requires. No lettering, captions, logos, borders, collage panels, or extra characters. Make a full-bleed cinematic ${input.aspectRatio} ${photoreal ? 'frame' : 'illustration'} with clear foreground, midground, and background. Keep important characters and story objects inside safe margins for caption overlays.`;

  let response;
  try {
    if (model.provider === 'gemini') {
      const body = {
        model: model.id,
        input: [{ type: 'text', text: prompt }],
        ...(input.previousInteractionId ? { previous_interaction_id: input.previousInteractionId } : {}),
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: input.aspectRatio, image_size: '1K' },
      };
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      if (response.status >= 500 && response.status <= 599) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      }
    } else {
      let body;
      let headers = { authorization: `Bearer ${apiKey}` };
      let url = 'https://api.openai.com/v1/images/generations';
      if (input.referenceImage) {
        url = 'https://api.openai.com/v1/images/edits';
        const form = new FormData();
        form.set('model', model.id); form.set('prompt', prompt); form.set('size', input.aspectRatio === '9:16' ? '1024x1536' : input.aspectRatio === '16:9' ? '1536x1024' : '1024x1024'); form.set('quality', 'low');
        const bytes = Uint8Array.from(atob(input.referenceImage), (char) => char.charCodeAt(0));
        form.set('image', new Blob([bytes], { type: 'image/jpeg' }), 'previous-scene.jpg');
        body = form;
      } else {
        headers = { ...headers, 'content-type': 'application/json' };
        body = JSON.stringify({ model: model.id, prompt, size: input.aspectRatio === '9:16' ? '1024x1536' : input.aspectRatio === '16:9' ? '1536x1024' : '1024x1024', quality: 'low', output_format: 'jpeg' });
      }
      response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(90_000) });
      if (response.status >= 500 && response.status <= 599) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(90_000) });
      }
    }
  } catch { return json({ error: 'The image service could not be reached. Try again.' }, 502); }
  if (!response.ok) {
    const providerRequestId = response.headers.get('x-request-id') || response.headers.get('x-goog-request-id') || null;
    console.error('StoryVerse image request failed', JSON.stringify({ provider: model.provider, model: model.id, status: response.status, providerRequestId }));
    if (response.status === 429) return json({ error: 'The image model’s usage limit was reached. Wait before trying again.' }, 429);
    if (response.status === 401 || response.status === 403) return json({ error: 'The image provider rejected its server key. Check the secret and model access.' }, 502);
    if (response.status >= 500) return json({ error: `The ${model.provider === 'gemini' ? 'Gemini' : 'OpenAI'} image service returned a temporary error (HTTP ${response.status}).` }, 502);
    return json({ error: 'The selected image model could not create this scene. Try another image model.' }, 502);
  }
  let result;
  try { result = await response.json(); } catch { return json({ error: 'The image model returned an unreadable response.' }, 502); }
  const imageData = model.provider === 'gemini' ? result?.output_image?.data : result?.data?.[0]?.b64_json;
  if (typeof imageData !== 'string' || imageData.length > 7_000_000) return json({ error: 'The image model returned no usable scene artwork.' }, 502);
  return json({ imageData, mimeType: model.provider === 'gemini' ? (result?.output_image?.mime_type || 'image/jpeg') : 'image/jpeg', interactionId: model.provider === 'gemini' ? (result?.id || null) : null, model: model.id });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function ticketKey(apiKey) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeVideoTicket(operationName, userId, apiKey) {
  if (!/^models\/veo-3\.1-(?:generate-preview|fast-generate-preview|lite-generate-preview)\/operations\/[A-Za-z0-9_-]{1,200}$/u.test(operationName)) return null;
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ operationName, userId, expiresAt: Date.now() + 4 * 60 * 60 * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await ticketKey(apiKey), new TextEncoder().encode(payload)));
  return `${payload}.${bytesToBase64Url(signature)}`;
}

async function readVideoTicket(ticket, userId, apiKey) {
  if (typeof ticket !== 'string' || ticket.length > 2_000) return null;
  const [payload, signature, extra] = ticket.split('.');
  if (!payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await ticketKey(apiKey), base64UrlToBytes(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (value.userId !== userId || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || !/^models\/veo-3\.1-(?:generate-preview|fast-generate-preview|lite-generate-preview)\/operations\/[A-Za-z0-9_-]{1,200}$/u.test(value.operationName)) return null;
    return value.operationName;
  } catch { return null; }
}

function validVisualPlan(plan, maxLength = 240) {
  return Boolean(plan) && typeof plan === 'object' && PLAN_FIELDS.every((key) => typeof plan[key] === 'string' && plan[key].trim().length > 0 && plan[key].length <= maxLength);
}

function trimVideoPromptText(value, limit) {
  const clean = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const characters = Array.from(clean);
  if (characters.length <= limit) return clean;
  const shortened = characters.slice(0, limit).join('');
  const lastSpace = shortened.lastIndexOf(' ');
  return lastSpace >= Math.floor(limit * 0.6) ? shortened.slice(0, lastSpace) : shortened;
}

function makeVideoPrompt(input) {
  const limits = { title: 100, context: 400, narration: 320, plan: 80 };
  const render = () => {
    const title = trimVideoPromptText(input.title, limits.title);
    const context = trimVideoPromptText(input.storyContext, limits.context);
    const narration = trimVideoPromptText(input.narration, limits.narration);
    const design = ['shot', 'camera', 'lighting', 'palette', 'composition', 'motion']
      .map((key) => trimVideoPromptText(input.visualPlan[key], limits.plan)).join('; ');
    return `One continuous ${input.durationSeconds}-second photorealistic live-action film shot (${input.shotIndex}/${input.shotCount}) for “${title}”. Story continuity: ${context}. Beat: ${narration}. Camera and look: ${design}. Preserve character appearance, clothing, props, and setting across scenes. Use natural motion, realistic materials, and film lighting. No subtitles, readable text, logos, illustrations, animation, 3D rendering, or dialogue; narration is added separately.`;
  };
  let prompt = render();
  while (Array.from(prompt).length > 900) {
    if (limits.context > 120) limits.context = Math.max(120, limits.context - 40);
    else if (limits.narration > 140) limits.narration = Math.max(140, limits.narration - 30);
    else if (limits.plan > 32) limits.plan = Math.max(32, limits.plan - 8);
    else if (limits.title > 40) limits.title = Math.max(40, limits.title - 10);
    else break;
    prompt = render();
  }
  return prompt;
}

function videoProviderHints(message) {
  const hints = [];
  if (/prompt|input|token|length|too long/iu.test(message)) hints.push('prompt_or_input');
  if (/duration|aspect.?ratio|resolution|parameter|field/iu.test(message)) hints.push('request_parameters');
  if (/model|not found|unsupported|not supported/iu.test(message)) hints.push('model_access');
  if (/safety|policy|person|blocked/iu.test(message)) hints.push('safety_or_policy');
  if (/billing|quota|permission|credential|key/iu.test(message)) hints.push('account_access_or_quota');
  return hints;
}

function videoProviderFields(message) {
  const known = ['instances', 'prompt', 'parameters', 'aspectRatio', 'durationSeconds', 'resolution', 'numberOfVideos', 'personGeneration'];
  const lower = message.toLowerCase();
  return known.filter((field) => lower.includes(field.toLowerCase())).slice(0, 8);
}

async function generateVideoClip(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT to generate realistic video.');
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 16_000) return json({ error: 'This video scene brief is too long.' }, 413);
    input = JSON.parse(raw);
  } catch { return json({ error: 'Send a valid video scene request.' }, 400); }
  const model = VIDEO_MODELS.find((candidate) => candidate.id === input?.model);
  const aspectRatio = ['9:16', '16:9'].includes(input?.aspectRatio);
  const durationSeconds = [4, 6, 8].includes(input?.durationSeconds);
  if (!model || !PATHS[input?.path] || typeof input?.title !== 'string' || input.title.trim().length < 1 || input.title.length > 120 || typeof input?.narration !== 'string' || input.narration.trim().length < 1 || input.narration.length > 1_200 || typeof input?.storyContext !== 'string' || input.storyContext.length > 4_000 || typeof input?.shotIndex !== 'number' || !Number.isInteger(input.shotIndex) || input.shotIndex < 1 || input.shotIndex > MAX_VIDEO_CLIPS || typeof input?.shotCount !== 'number' || !Number.isInteger(input.shotCount) || input.shotCount < input.shotIndex || input.shotCount > MAX_VIDEO_CLIPS || !validVisualPlan(input?.visualPlan) || !aspectRatio || !durationSeconds) return json({ error: 'Check the video model, story scene, visual plan, clip duration, and video layout.', noVideoJobAccepted: true }, 400);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI video generation is not connected. Add the server secret GEMINI_API_KEY.', noVideoJobAccepted: true }, 503);
  if (!takeRequestSlot(videoRequestsByUser, identity.userId, MAX_VIDEO_CLIPS, 60 * 60 * 1000)) return json({ error: 'You have reached the video-generation limit for this hour. Wait before creating more clips.', noVideoJobAccepted: true }, 429, { 'retry-after': '3600' });
  const prompt = makeVideoPrompt(input);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:predictLongRunning`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      // Gemini's documented REST request supports aspectRatio here and uses
      // the model's default 8-second clip length when durationSeconds is omitted.
      body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: input.aspectRatio } }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch { return json({ error: 'The video service could not be reached. No automatic retry was made, to avoid duplicate paid generation.', videoSubmissionUncertain: true }, 502); }
  if (!response.ok) {
    const providerRequestId = response.headers.get('x-request-id') || response.headers.get('x-goog-request-id') || null;
    const providerPayload = await response.clone().json().catch(() => ({}));
    const providerError = providerPayload?.error ?? {};
    const providerCode = typeof providerError.status === 'string' ? providerError.status : null;
    const providerMessage = typeof providerError.message === 'string' ? providerError.message : '';
    const detailedFields = Array.isArray(providerError.details)
      ? providerError.details.flatMap((detail) => Array.isArray(detail?.fieldViolations) ? detail.fieldViolations.map((violation) => violation?.field) : [])
        .filter((field) => typeof field === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(field)).slice(0, 8)
      : [];
    const providerFields = [...new Set([...detailedFields, ...videoProviderFields(providerMessage)])].slice(0, 8);
    const hints = videoProviderHints(providerMessage);
    console.error('StoryVerse video request failed', JSON.stringify({ model: model.id, status: response.status, providerRequestId, providerCode, providerFields, providerHints: hints, requestSummary: { aspectRatio: input.aspectRatio, durationSeconds: 8, promptCharacters: Array.from(prompt).length, parameterNames: ['aspectRatio'] } }));
    if (response.status === 429) return json({ error: 'The selected video model’s usage limit was reached. Check Gemini API billing and quota.', noVideoJobAccepted: true }, 429);
    if (response.status === 401 || response.status === 403) return json({ error: 'Google rejected the video-generation key or this project does not have video billing enabled.', noVideoJobAccepted: true }, 502);
    if (response.status >= 500) return json({ error: `The video service returned a temporary error (HTTP ${response.status}).`, videoSubmissionUncertain: true }, 502);
    if (response.status === 400) return json({ error: `Google rejected the scene settings${providerCode ? ` (${providerCode})` : ''}. No video job was accepted.`, noVideoJobAccepted: true, ...(providerCode ? { providerCode } : {}) }, 502);
    return json({ error: 'The video provider rejected this scene before starting a clip.', noVideoJobAccepted: true }, 502);
  }
  let result;
  try { result = await response.json(); } catch { return json({ error: 'The video model returned an unreadable job.', videoSubmissionUncertain: true }, 502); }
  const job = await makeVideoTicket(result?.name, identity.userId, apiKey);
  if (!job) return json({ error: 'The video model returned an invalid job reference.', videoSubmissionUncertain: true }, 502);
  return json({ job, model: model.id, durationSeconds: 8 });
}

async function fetchVideoOperation(operationName, apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`, {
    headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`status:${response.status}`);
  return response.json();
}

async function videoJobStatus(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT to check this video job.');
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI video generation is not connected. Add the server secret GEMINI_API_KEY.' }, 503);
  const operationName = await readVideoTicket(new URL(request.url).searchParams.get('job'), identity.userId, apiKey);
  if (!operationName) return json({ error: 'This video job is invalid or has expired. Start it again.' }, 403);
  try {
    const operation = await fetchVideoOperation(operationName, apiKey);
    if (!operation.done) return json({ done: false });
    if (operation.error) return json({ done: true, error: 'The video model could not complete this scene. Check its safety/usage status before retrying.' });
    const videoUri = operation?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (typeof videoUri !== 'string') return json({ done: true, error: 'The video model completed without returning a downloadable video.' });
    return json({ done: true, ready: true });
  } catch (error) {
    const status = Number(String(error?.message || '').replace('status:', ''));
    return status === 429 ? json({ error: 'The video status limit was reached. Wait briefly and try again.' }, 429) : json({ error: 'Could not check the video job. Please try again.' }, 502);
  }
}

async function downloadVideoJob(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT to download this video job.');
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI video generation is not connected. Add the server secret GEMINI_API_KEY.' }, 503);
  const operationName = await readVideoTicket(new URL(request.url).searchParams.get('job'), identity.userId, apiKey);
  if (!operationName) return json({ error: 'This video job is invalid or has expired. Start it again.' }, 403);
  let operation;
  try { operation = await fetchVideoOperation(operationName, apiKey); } catch { return json({ error: 'Could not load the completed video. Please try again.' }, 502); }
  if (!operation.done || operation.error) return json({ error: 'This video scene is not ready to download.' }, 409);
  const videoUri = operation?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (typeof videoUri !== 'string') return json({ error: 'The video model returned no downloadable video.' }, 502);
  let videoUrl;
  try { videoUrl = new URL(videoUri); } catch { return json({ error: 'The video model returned an invalid download address.' }, 502); }
  if (videoUrl.protocol !== 'https:' || videoUrl.hostname !== 'generativelanguage.googleapis.com') return json({ error: 'The video download address could not be verified.' }, 502);
  try {
    let videoResponse = await fetch(videoUrl, { headers: { 'x-goog-api-key': apiKey }, redirect: 'manual', signal: AbortSignal.timeout(90_000) });
    for (let redirects = 0; videoResponse.status >= 300 && videoResponse.status < 400 && redirects < 3; redirects++) {
      const location = videoResponse.headers.get('location');
      if (!location) break;
      const nextUrl = new URL(location, videoUrl);
      if (nextUrl.protocol !== 'https:' || !['generativelanguage.googleapis.com', 'storage.googleapis.com'].includes(nextUrl.hostname)) return json({ error: 'The video download redirect could not be verified.' }, 502);
      videoUrl = nextUrl;
      videoResponse = await fetch(videoUrl, { ...(videoUrl.hostname === 'generativelanguage.googleapis.com' ? { headers: { 'x-goog-api-key': apiKey } } : {}), redirect: 'manual', signal: AbortSignal.timeout(90_000) });
    }
    if (!videoResponse.ok) return json({ error: 'The finished video could not be downloaded. Try exporting again.' }, 502);
    return new Response(videoResponse.body, { headers: { ...PRIVATE_HEADERS, 'cache-control': 'no-store', 'content-type': 'video/mp4', ...(videoResponse.headers.has('content-length') ? { 'content-length': videoResponse.headers.get('content-length') } : {}) } });
  } catch { return json({ error: 'The finished video could not be downloaded. Try again.' }, 502); }
}

async function generateVoiceover(request, env) {
  const identity = await requestIdentity(request, env);
  if (!identity) return identityError(request, 'Sign in with ChatGPT to generate the narrator voiceover.');
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return json({ error: 'This narration is too long to voice in one pass.' }, 413);
    input = JSON.parse(raw);
  } catch { return json({ error: 'Send a valid narration request.' }, 400); }
  if (typeof input?.text !== 'string' || input.text.trim().length < 1 || input.text.length > MAX_NARRATION_CHARACTERS) return json({ error: `Add narration of 1–${MAX_NARRATION_CHARACTERS.toLocaleString('en-US')} characters.` }, 400);
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'AI voiceover is not connected. Add the server secret GEMINI_API_KEY.' }, 503);
  if (!takeRequestSlot(voiceRequestsByUser, identity.userId, 6, 60 * 60 * 1000)) return json({ error: 'You have reached the narrator limit for this hour. Wait before generating another voiceover.' }, 429, { 'retry-after': '3600' });
  const voice = ['Kore', 'Puck', 'Zephyr', 'Aoede'].includes(input.voice) ? input.voice : 'Kore';
  const body = {
    model: 'gemini-3.8-flash-tts',
    input: [{ type: 'user_input', content: [{ type: 'text', text: input.text.trim(), annotations: [{ type: 'speech_metadata', style: 'Warm, clear, natural audiobook storyteller. Emotionally expressive but gentle, with smooth pacing and clean pauses. Read the supplied story verbatim; do not add, omit, or paraphrase words.' }] }] }],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice }] },
  };
  let response;
  try { response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) }); }
  catch { return json({ error: 'The narrator service could not be reached. Please try again.' }, 502); }
  if (!response.ok) {
    if (response.status === 429) return json({ error: 'The voice model’s usage limit was reached. Wait and try again.' }, 429);
    if (response.status === 401 || response.status === 403) return json({ error: 'Google rejected the voiceover key. Check the server secret and Gemini API access.' }, 502);
    if (response.status >= 500) return json({ error: `The narrator service returned a temporary error (HTTP ${response.status}).` }, 502);
    return json({ error: 'The narrator could not voice this script. Shorten the story and try again.' }, 502);
  }
  let result;
  try { result = await response.json(); } catch { return json({ error: 'The narrator returned an unreadable audio response.' }, 502); }
  // The Interactions REST API returns audio in steps[].content[].data. The
  // output_audio convenience property belongs to SDK responses, so accept it
  // as well without assuming the raw REST response has that shape.
  const audioBlocks = Array.isArray(result?.steps)
    ? result.steps.flatMap((step) => step?.type === 'model_output' && Array.isArray(step.content) ? step.content : []).filter((block) => block?.type === 'audio')
    : [];
  const audioData = result?.output_audio?.data
    ?? result?.interaction?.output_audio?.data
    ?? audioBlocks[audioBlocks.length - 1]?.data;
  if (typeof audioData !== 'string' || audioData.length > 30_000_000) return json({ error: 'The narrator returned no usable voiceover audio.' }, 502);
  try {
    const audioBytes = Uint8Array.from(atob(audioData), (char) => char.charCodeAt(0));
    if (audioBytes.length < 44 || audioBytes[0] !== 0x52 || audioBytes[1] !== 0x49 || audioBytes[2] !== 0x46 || audioBytes[3] !== 0x46 || audioBytes[8] !== 0x57 || audioBytes[9] !== 0x41 || audioBytes[10] !== 0x56 || audioBytes[11] !== 0x45) return json({ error: 'The narrator audio was not a valid WAV file.' }, 502);
    return new Response(audioBytes, { headers: { ...PRIVATE_HEADERS, 'cache-control': 'no-store', 'content-type': 'audio/wav', 'content-length': String(audioBytes.length) } });
  } catch { return json({ error: 'The narrator audio could not be decoded.' }, 502); }
}

function availableVideoModels(env) {
  return json({ maxClips: MAX_VIDEO_CLIPS, maxNarrationCharacters: MAX_NARRATION_CHARACTERS, models: VIDEO_MODELS.map(({ id, label, pricePerSecond }, index) => ({ id, label, pricePerSecond, durationSeconds: 8, available: Boolean(env.GEMINI_API_KEY), recommended: index === 0, aspectRatios: ['9:16', '16:9'] })) });
}

function storyPaths() {
  return json({ wordsPerMinute: WORDS_PER_MINUTE, ageGroups: AGE_GROUPS, paths: PATH_IDS.map((id) => { const { kind, maxScenes, ...rest } = PATHS[id]; return { id, ...rest }; }) });
}

function availableVisualModels(env) {
  return json({ models: VISUAL_MODELS.map(({ id, provider, key, label, note }, index) => ({ id, provider, label, note, available: Boolean(env[key]), recommended: index === 0 })) });
}

function availableModels(request, env) {
  const path = new URL(request.url).searchParams.get('path') || 'bedtime';
  if (!PATHS[path]) return json({ error: 'Choose a story type.' }, 400);
  const candidates = MODELS.filter((model) => model.fit.includes(path)).sort((a, b) => MODEL_PRIORITY[path].indexOf(a.id) - MODEL_PRIORITY[path].indexOf(b.id));
  return json({ models: candidates.map(({ id, provider, label, note, key }, index) => ({ id, provider, label, note, available: Boolean(env[key]), recommended: index === 0 })) });
}

function assetResponse(path) {
  const asset = ASSETS.get(path);
  if (!asset) return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
  const body = asset.binary ? Uint8Array.from(atob(asset.body), (char) => char.charCodeAt(0)) : asset.body;
  return new Response(body, { headers: { ...PRIVATE_HEADERS, 'cache-control': asset.binary ? 'public, max-age=86400' : 'no-cache', 'content-type': asset.type } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/auth/apple') return request.method === 'POST' ? appleSignIn(request, env) : json({ error: 'Use POST to sign in.' }, 405, { allow: 'POST' });
    if (url.pathname === '/api/paths') return request.method === 'GET' ? storyPaths() : json({ error: 'Use GET to list story paths.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/models') return request.method === 'GET' ? availableModels(request, env) : json({ error: 'Use GET to list models.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/visual-models') return request.method === 'GET' ? availableVisualModels(env) : json({ error: 'Use GET to list visual models.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/video-models') return request.method === 'GET' ? availableVideoModels(env) : json({ error: 'Use GET to list video models.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/generate-story') {
      if (request.method !== 'POST') return json({ error: 'Use POST to generate a story.' }, 405, { allow: 'POST' });
      return generate(request, env);
    }
    if (url.pathname === '/api/plan-scenes') {
      if (request.method !== 'POST') return json({ error: 'Use POST to plan scenes.' }, 405, { allow: 'POST' });
      return planScenes(request, env);
    }
    if (url.pathname === '/api/generate-scene-image') {
      if (request.method !== 'POST') return json({ error: 'Use POST to generate scene artwork.' }, 405, { allow: 'POST' });
      return generateSceneImage(request, env);
    }
    if (url.pathname === '/api/generate-video') {
      if (request.method !== 'POST') return json({ error: 'Use POST to generate a video scene.' }, 405, { allow: 'POST' });
      return generateVideoClip(request, env);
    }
    if (url.pathname === '/api/video-job-status') return request.method === 'GET' ? videoJobStatus(request, env) : json({ error: 'Use GET to check a video job.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/video-job-content') return request.method === 'GET' ? downloadVideoJob(request, env) : json({ error: 'Use GET to download a video job.' }, 405, { allow: 'GET' });
    if (url.pathname === '/api/generate-voiceover') {
      if (request.method !== 'POST') return json({ error: 'Use POST to generate narrator audio.' }, 405, { allow: 'POST' });
      return generateVoiceover(request, env);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    // The Bedtime-only studio moved to the shared studio; keep old links working.
    if (url.pathname === '/bedtime.html') return Response.redirect(new URL('/studio.html?path=bedtime', url).href, 301);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    return assetResponse(path);
  },
};
