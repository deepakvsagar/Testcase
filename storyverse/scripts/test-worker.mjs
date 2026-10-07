import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';

const studioHtml = await readFile(new URL('../site-assets/studio.html', import.meta.url), 'utf8');
const videoLayout = studioHtml.match(/<select id="video-layout">([\s\S]*?)<\/select>/u);
assert.ok(videoLayout, 'the video layout selector exists');
assert.deepEqual([...videoLayout[1].matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]), ['9:16', '16:9'], 'video layout values match the worker aspect-ratio allowlist');
const videoRenderer = await readFile(new URL('../site-assets/video-renderer.js', import.meta.url), 'utf8');
assert.match(videoRenderer, /value === '9:16' \? \[720, 1280\] : \[1280, 720\]/u, 'portrait and landscape exports use their selected canvas dimensions');

const url = 'https://storyverse.test/api/generate-story';
const idea = { path: 'bedtime', model: 'gemini-3.8-flash', idea: 'A fox discovers the moon is missing and asks fireflies for help.', age: '3–5 years', minutes: 1, mood: 'Calm & cozy', style: 'Cinematic realism' };
const send = (body = idea, user = 'test-user') => worker.fetch(new Request(url, {
  method: 'POST',
  headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', ...(user ? { 'oai-authenticated-user-id': user } : {}) },
  body: JSON.stringify(body),
}), {});

assert.equal((await send(idea, null)).status, 401, 'generation requires a signed-in user');
assert.equal((await send({ ...idea, minutes: 30 })).status, 400, 'rejects invalid length');
assert.equal((await send(idea)).status, 503, 'does not call Gemini when the server secret is missing');
const nativeWithoutToken = await worker.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(idea) }), { GEMINI_API_KEY: 'test-secret' });
assert.equal(nativeWithoutToken.status, 401, 'native requests require the separate tester token');
const nativeWithToken = await worker.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mobile-test-secret' }, body: JSON.stringify(idea) }), { STORYVERSE_MOBILE_TEST_TOKEN: 'mobile-test-secret' });
assert.equal(nativeWithToken.status, 503, 'a valid native tester token reaches provider configuration checks');
const models = await worker.fetch(new Request('https://storyverse.test/api/models?path=magnum'), { GEMINI_API_KEY: 'test-secret' });
const modelList = await models.json();
assert.equal(modelList.models.find((model) => model.id === 'gemini-3.8-flash').available, true);
assert.equal(modelList.models.some((model) => model.id === 'claude-opus-5-5'), true, 'model recommendations vary by story type');
const visualModels = await (await worker.fetch(new Request('https://storyverse.test/api/visual-models'), { GEMINI_API_KEY: 'test-secret' })).json();
assert.equal(visualModels.models.find((model) => model.id === 'gemini-nano-banana-2.1').available, true);
assert.equal(visualModels.models.find((model) => model.id === 'gemini-3-pro-image').available, true);
assert.equal(visualModels.models.find((model) => model.id === 'gpt-image-2').available, false, 'OpenAI image model requires its own server key');

const originalFetch = globalThis.fetch;
const originalConsoleErrorForV27 = console.error;
try {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    assert.equal(requestBody.generationConfig.responseFormat.text.schema.additionalProperties, false);
    assert.equal('responseSchema' in requestBody.generationConfig, false, 'uses Gemini JSON Schema response format');
    const plan = { shot: 'Wide establishing shot', camera: 'Gentle low angle', lighting: 'Soft moonlight', palette: 'Navy, silver, firefly gold', composition: 'Fox centered below moon', motion: 'Slow drift upward' };
    const isVisualPlan = options.body.includes('one scene entry per supplied narration');
    const payload = isVisualPlan ? { scenes: [{ visualPlan: plan }] } : {
      title: 'The Missing Moon',
      scenes: [
        { narration: 'The moon went away.', visualPlan: plan },
        { narration: 'A fox asked three friendly fireflies to help.', visualPlan: plan },
        { narration: 'They found it hiding behind a cloud, and everyone drifted safely to sleep.', visualPlan: plan },
      ],
    };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  };
  const response = await worker.fetch(new Request(url, {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'authenticated-test-user' }, body: JSON.stringify(idea),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.title, 'The Missing Moon');
  assert.equal(result.scenes.length, 3);
  assert.equal(result.scenes[0].visualPlan.camera, 'Gentle low angle');
  assert.equal(result.model, 'gemini-3.8-flash');
  assert.equal(result.script.split(/\s+/u).length, result.wordCount);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);

  const visuals = await worker.fetch(new Request('https://storyverse.test/api/plan-scenes', {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'visual-test-user' }, body: JSON.stringify({ ...idea, scenes: [{ narration: 'The fox steps into the moonlit clearing.' }] }),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(visuals.status, 200);
  assert.equal((await visuals.json()).scenes[0].visualPlan.lighting, 'Soft moonlight');

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, 'gemini-nano-banana-2.1');
    assert.equal(requestBody.response_format.aspect_ratio, '9:16');
    assert.equal(requestBody.response_format.image_size, '1K');
    assert.match(requestBody.input[0].text, /exactly consistent/u);
    return Response.json({ id: 'image-story-session', output_image: { data: 'aGVsbG8=', mime_type: 'image/jpeg' } });
  };
  const sceneArt = await worker.fetch(new Request('https://storyverse.test/api/generate-scene-image', {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'image-test-user' },
    body: JSON.stringify({ model: 'gemini-nano-banana-2.1', path: 'bedtime', title: 'The Missing Moon', sceneNumber: 1, narration: 'A fox looks up at the empty sky.', visualPlan: { shot: 'Wide scene', camera: 'Low angle', lighting: 'Moonlight', palette: 'Blue and silver', composition: 'Fox beneath sky', motion: 'Slow drift' }, style: 'Soft watercolor', aspectRatio: '9:16', previousInteractionId: null }),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(sceneArt.status, 200);
  const generatedArt = await sceneArt.json();
  assert.equal(generatedArt.imageData, 'aGVsbG8=');
  assert.equal(generatedArt.interactionId, 'image-story-session');
  assert.equal(generatedArt.model, 'gemini-nano-banana-2.1');

  const videoModelPayload = await (await worker.fetch(new Request('https://storyverse.test/api/video-models'), { GEMINI_API_KEY: 'test-secret' })).json();
  assert.equal(videoModelPayload.models.find((model) => model.id === 'veo-3.1-fast-generate-preview').available, true);
  assert.equal(videoModelPayload.models.find((model) => model.id === 'veo-3.1-lite-generate-preview').pricePerSecond, 0.05);
  assert.equal(videoModelPayload.models.find((model) => model.id === 'veo-3.1-generate-preview').available, true);
  const videoUrl = 'https://storyverse.test/api/generate-video';
  const videoInput = { model: 'veo-3.1-fast-generate-preview', path: 'bedtime', title: 'The Missing Moon', storyContext: 'A fox and fireflies look for the moon.', narration: 'The fox follows the fireflies through a silver forest.', visualPlan: { shot: 'Wide shot', camera: 'Slow tracking', lighting: 'Soft moonlight', palette: 'Silver blue and amber', composition: 'Fox in foreground', motion: 'Gliding movement' }, shotIndex: 1, shotCount: 1, aspectRatio: '9:16', durationSeconds: 8 };
  const longVideoInput = { ...videoInput,
    storyContext: 'Fern is a red fox with a yellow scarf. The fireflies glow gold and guide Fern through a silver forest. '.repeat(36),
    narration: 'The fox follows the fireflies through a silver forest. '.repeat(20),
    visualPlan: { shot: 'A wide moonlit establishing view of the fox and fireflies. '.repeat(3), camera: 'Slow tracking movement at fox eye level. '.repeat(4), lighting: 'Soft blue moonlight and warm firefly glow. '.repeat(4), palette: 'Silver blue, navy, and firefly gold. '.repeat(4), composition: 'Fox centered with fireflies in the foreground. '.repeat(4), motion: 'Gentle gliding movement through the forest. '.repeat(4) },
  };
  assert.equal((await worker.fetch(new Request(videoUrl, { method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json' }, body: JSON.stringify(videoInput) }), { GEMINI_API_KEY: 'test-secret' })).status, 401, 'video generation requires an authenticated user');
  assert.equal((await worker.fetch(new Request(videoUrl, { method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'video-test-user' }, body: JSON.stringify(videoInput) }), {})).status, 503, 'video generation requires the Gemini server secret');
  assert.equal((await worker.fetch(new Request(videoUrl, { method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'video-test-user' }, body: JSON.stringify({ ...videoInput, durationSeconds: 5 }) }), { GEMINI_API_KEY: 'test-secret' })).status, 400, 'video clip duration is allowlisted');
  globalThis.fetch = async (requestUrl, options) => {
    assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning');
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.parameters.aspectRatio, '9:16');
    assert.deepEqual(requestBody.parameters, { aspectRatio: '9:16' }, 'leaves clip duration at Google’s documented 8-second default');
    assert.ok(Array.from(requestBody.instances[0].prompt).length <= 900, 'keeps long scene prompts under the Veo input budget');
    assert.match(requestBody.instances[0].prompt, /photorealistic live-action film shot/u);
    assert.match(requestBody.instances[0].prompt, /No subtitles/u);
    return Response.json({ name: 'models/veo-3.1-fast-generate-preview/operations/video-job-123' });
  };
  const generatedVideoResponse = await worker.fetch(new Request(videoUrl, {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'video-test-user' }, body: JSON.stringify(longVideoInput),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(generatedVideoResponse.status, 200);
  const generatedVideoJob = await generatedVideoResponse.json();
  assert.equal(generatedVideoJob.durationSeconds, 8);
  assert.equal(typeof generatedVideoJob.job, 'string', 'the provider job reference is stored in a signed, user-bound ticket');

  let providerDiagnostic = '';
  const originalVideoConsoleError = console.error;
  console.error = (...args) => { providerDiagnostic += args.join(' '); };
  globalThis.fetch = async (_requestUrl, options) => {
    const requestBody = JSON.parse(options.body);
    assert.deepEqual(requestBody.parameters, { aspectRatio: '9:16' });
    return Response.json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid aspectRatio parameter. PRIVATE_STORY_MARKER.' } }, { status: 400, headers: { 'x-request-id': 'safe-request-400' } });
  };
  let rejectedVideoResponse;
  try {
    rejectedVideoResponse = await worker.fetch(new Request(videoUrl, {
      method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'video-provider-400-test' }, body: JSON.stringify({ ...videoInput, storyContext: 'PRIVATE_STORY_MARKER describes the fox and forest.' }),
    }), { GEMINI_API_KEY: 'test-secret' });
  } finally { console.error = originalVideoConsoleError; }
  assert.equal(rejectedVideoResponse.status, 502);
  const rejectedVideo = await rejectedVideoResponse.json();
  assert.equal(rejectedVideo.noVideoJobAccepted, true, 'a provider HTTP 400 means no video job was accepted');
  assert.equal(rejectedVideo.providerCode, 'INVALID_ARGUMENT');
  assert.match(rejectedVideo.error, /No video job was accepted/u);
  assert.match(providerDiagnostic, /INVALID_ARGUMENT/u);
  assert.match(providerDiagnostic, /request_parameters/u);
  assert.match(providerDiagnostic, /safe-request-400/u);
  assert.match(providerDiagnostic, /aspectRatio/u, 'logs only allowlisted provider field names for diagnosis');
  assert.match(providerDiagnostic, /parameterNames.*aspectRatio/u, 'records the non-sensitive request shape');
  assert.doesNotMatch(providerDiagnostic, /PRIVATE_STORY_MARKER/u, 'provider logs never include story content');

  globalThis.fetch = async (requestUrl, options) => {
    assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview/operations/video-job-123');
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    return Response.json({ done: false });
  };
  const videoStatus = await worker.fetch(new Request(`https://storyverse.test/api/video-job-status?job=${encodeURIComponent(generatedVideoJob.job)}`, { headers: { origin: 'https://storyverse.test', 'oai-authenticated-user-id': 'video-test-user' } }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(videoStatus.status, 200);
  assert.equal((await videoStatus.json()).done, false);
  const wrongUserStatus = await worker.fetch(new Request(`https://storyverse.test/api/video-job-status?job=${encodeURIComponent(generatedVideoJob.job)}`, { headers: { origin: 'https://storyverse.test', 'oai-authenticated-user-id': 'another-user' } }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(wrongUserStatus.status, 403, 'video job tickets cannot be reused by another signed-in user');

  let downloadCalls = 0;
  globalThis.fetch = async (requestUrl, options) => {
    downloadCalls++;
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const requestedUrl = String(requestUrl);
    if (requestedUrl === 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview/operations/video-job-123') return Response.json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/video-123:download?alt=media' } }] } } });
    assert.equal(requestedUrl, 'https://generativelanguage.googleapis.com/v1beta/files/video-123:download?alt=media');
    return new Response(new Uint8Array([0, 0, 0, 0]), { headers: { 'content-length': '4' } });
  };
  const videoDownload = await worker.fetch(new Request(`https://storyverse.test/api/video-job-content?job=${encodeURIComponent(generatedVideoJob.job)}`, { headers: { origin: 'https://storyverse.test', 'oai-authenticated-user-id': 'video-test-user' } }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(videoDownload.status, 200);
  assert.equal(videoDownload.headers.get('content-type'), 'video/mp4');
  assert.equal((await videoDownload.arrayBuffer()).byteLength, 4);
  assert.equal(downloadCalls, 2, 'downloads use the provider operation and verified video URI');

  const wavBytes = new Uint8Array(48);
  wavBytes.set([0x52, 0x49, 0x46, 0x46]);
  wavBytes.set([0x57, 0x41, 0x56, 0x45], 8);
  const wavBase64 = Buffer.from(wavBytes).toString('base64');
  globalThis.fetch = async (requestUrl, options) => {
    assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, 'gemini-3.8-flash-tts');
    assert.equal(requestBody.response_format.mime_type, 'audio/wav');
    assert.equal(requestBody.generation_config.speech_config[0].voice, 'Kore');
    assert.match(requestBody.input[0].content[0].annotations[0].style, /Read the supplied story verbatim/u);
    return Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: wavBase64, mime_type: 'audio/wav' }] }] });
  };
  const voiceoverResponse = await worker.fetch(new Request('https://storyverse.test/api/generate-voiceover', {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'voiceover-test-user' }, body: JSON.stringify({ text: 'The fox follows the fireflies home.', voice: 'Kore' }),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(voiceoverResponse.status, 200);
  assert.equal(voiceoverResponse.headers.get('content-type'), 'audio/wav');
  assert.equal((await voiceoverResponse.arrayBuffer()).byteLength, 48);

  let retryAttempts = 0;
  globalThis.fetch = async () => {
    retryAttempts++;
    if (retryAttempts === 1) return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      title: 'The Missing Moon',
      scenes: [
        { narration: 'The moon went away.', visualPlan: { shot: 'Wide shot', camera: 'Low angle', lighting: 'Moonlight', palette: 'Blue and silver', composition: 'Fox below moon', motion: 'Slow drift' } },
        { narration: 'A fox asked three friendly fireflies to help.', visualPlan: { shot: 'Medium shot', camera: 'Eye level', lighting: 'Firefly glow', palette: 'Gold and blue', composition: 'Friends together', motion: 'Gentle float' } },
        { narration: 'They found it hiding behind a cloud, and everyone drifted safely to sleep.', visualPlan: { shot: 'Wide shot', camera: 'High angle', lighting: 'Soft moonlight', palette: 'Navy and silver', composition: 'Fox beneath moon', motion: 'Slow fade' } },
      ],
    }) }] } }] });
  };
  const retried = await worker.fetch(new Request(url, {
    method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'provider-retry-test-user' }, body: JSON.stringify(idea),
  }), { GEMINI_API_KEY: 'test-secret' });
  assert.equal(retried.status, 200, 'recovers from a temporary provider 503');
  assert.equal(retryAttempts, 2, 'retries a provider 5xx exactly once');

  globalThis.fetch = async () => Response.json({ error: { status: 'INTERNAL' } }, { status: 503 });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const unavailable = await worker.fetch(new Request(url, {
      method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'provider-outage-test-user' }, body: JSON.stringify(idea),
    }), { GEMINI_API_KEY: 'test-secret' });
    assert.equal(unavailable.status, 502);
    assert.match((await unavailable.json()).error, /Gemini service returned a temporary error \(HTTP 503\)/);
  } finally { console.error = originalConsoleError; }
} finally { globalThis.fetch = originalFetch; }

// ---- v27: shared story paths, Claude structured outputs, provider-specific errors ----
const plan = { shot: 'Wide shot', camera: 'Slow push in', lighting: 'Golden hour', palette: 'Amber and teal', composition: 'Rule of thirds', motion: 'Steady dolly' };
const post = (path, body, user, env) => worker.fetch(new Request(`https://storyverse.test${path}`, {
  method: 'POST', headers: { origin: 'https://storyverse.test', 'content-type': 'application/json', 'oai-authenticated-user-id': user }, body: JSON.stringify(body),
}), env);

const pathList = await (await worker.fetch(new Request('https://storyverse.test/api/paths'), {})).json();
assert.deepEqual(pathList.paths.map((path) => path.id), ['bedtime', 'drama', 'magnum', 'curious'], 'every creation path is served to the studio');
assert.equal(pathList.paths.find((path) => path.id === 'drama').audience, 'text');
assert.equal('kind' in pathList.paths[0], false, 'prompt wording stays server-side');
assert.equal(pathList.wordsPerMinute, 120);

const redirect = await worker.fetch(new Request('https://storyverse.test/bedtime.html'), {});
assert.equal(redirect.status, 301, 'the old Bedtime page redirects');
assert.equal(redirect.headers.get('location'), 'https://storyverse.test/studio.html?path=bedtime');
for (const page of ['/studio.html', '/studio.js', '/create.js', '/studio.css']) assert.equal((await worker.fetch(new Request(`https://storyverse.test${page}`), {})).status, 200, `${page} is embedded`);
assert.equal((await worker.fetch(new Request('https://storyverse.test/video-export.js'), {})).status, 404, 'unused export script is no longer shipped');

const videoLimits = await (await worker.fetch(new Request('https://storyverse.test/api/video-models'), {})).json();
assert.equal(videoLimits.maxClips, 24);
assert.equal(videoLimits.maxNarrationCharacters, 8000);

const dramaIdea = { path: 'drama', model: 'claude-sonnet-5-5', idea: 'A chef discovers every dish she cooks predicts tomorrow.', audience: 'Food creators on short-form video', minutes: 5, mood: 'Suspenseful', style: 'Cinematic realism' };
assert.equal((await post('/api/generate-story', { ...dramaIdea, audience: '' }, 'drama-validate', {})).status, 400, 'non-bedtime paths require an audience description');
assert.equal((await post('/api/generate-story', { ...dramaIdea, mood: 'Calm & cozy' }, 'drama-validate', {})).status, 400, 'moods are allowlisted per path');
assert.equal((await post('/api/generate-story', { ...dramaIdea, minutes: 2 }, 'drama-validate', {})).status, 400, 'lengths are allowlisted per path');

const dramaScenes = Array.from({ length: 6 }, (_, i) => ({ narration: `Scene ${i + 1}. ${'The kitchen hums as Mara reads the steam for tomorrow. '.repeat(9)}`, visualPlan: plan }));
try {
  let anthropicBody = null;
  let anthropicHeaders = null;
  globalThis.fetch = async (requestUrl, options) => {
    assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages');
    anthropicHeaders = options.headers;
    anthropicBody = JSON.parse(options.body);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ title: 'Tomorrow’s Menu', scenes: dramaScenes }) }] });
  };
  const claudeStory = await post('/api/generate-story', dramaIdea, 'claude-drama-user', { ANTHROPIC_API_KEY: 'claude-secret' });
  assert.equal(claudeStory.status, 200, 'Claude generates a drama story');
  const claudeResult = await claudeStory.json();
  assert.equal(claudeResult.title, 'Tomorrow’s Menu');
  assert.equal(claudeResult.scenes.length, 6);
  assert.equal(anthropicHeaders['x-api-key'], 'claude-secret');
  assert.equal(anthropicHeaders['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(anthropicBody.model, 'claude-sonnet-5-5');
  assert.equal('temperature' in anthropicBody, false, 'current Claude models reject sampling parameters');
  assert.equal(anthropicBody.output_config.format.type, 'json_schema', 'Claude uses structured outputs');
  assert.equal(anthropicBody.output_config.format.schema.additionalProperties, false);
  assert.equal(anthropicBody.fallbacks, 'default');
  assert.match(anthropicBody.messages[0].content, /Audience: Food creators on short-form video/u);
  assert.match(anthropicBody.messages[0].content, /never more than 600/u);

  globalThis.fetch = async () => Response.json({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] });
  const refused = await post('/api/generate-story', dramaIdea, 'claude-refusal-user', { ANTHROPIC_API_KEY: 'claude-secret' });
  assert.equal(refused.status, 502);
  assert.match((await refused.json()).error, /declined/u, 'a refusal gets a specific message');

  globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"title":"Cut' }] } }] });
  const truncated = await post('/api/generate-story', idea, 'gemini-truncated-user', { GEMINI_API_KEY: 'test-secret' });
  assert.match((await truncated.json()).error, /ran out of room/u, 'a truncated response is reported as such');

  console.error = () => {};
  globalThis.fetch = async () => Response.json({ error: { type: 'overloaded_error' } }, { status: 529 });
  const overloaded = await post('/api/generate-story', dramaIdea, 'claude-outage-user', { ANTHROPIC_API_KEY: 'claude-secret' });
  assert.match((await overloaded.json()).error, /^The Claude service returned a temporary error \(HTTP 529\)/u, 'errors name the provider actually used');

  globalThis.fetch = async (_requestUrl, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.contents[0].parts[0].text, /Drama Dream story/u);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ scenes: [{ visualPlan: plan }, { visualPlan: plan }] }) }] } }] });
  };
  const longScene = 'A'.repeat(2_000);
  const planned = await post('/api/plan-scenes', { ...dramaIdea, model: 'gemini-3.8-flash', scenes: [{ narration: longScene }, { narration: 'Short.' }] }, 'plan-long-user', { GEMINI_API_KEY: 'test-secret' });
  assert.equal(planned.status, 200, 'scene planning accepts the same narration length the editor allows');

  globalThis.fetch = async (_requestUrl, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.input[0].text, /photorealistic cinematic film still/u);
    return Response.json({ id: 'interaction-1', output_image: { data: 'aGVsbG8=', mime_type: 'image/jpeg' } });
  };
  const realism = await post('/api/generate-scene-image', { model: 'gemini-nano-banana-2.1', path: 'drama', title: 'Tomorrow’s Menu', sceneNumber: 1, narration: 'Steam curls over the pan.', visualPlan: plan, style: 'Cinematic realism', aspectRatio: '16:9' }, 'realism-image-user', { GEMINI_API_KEY: 'test-secret' });
  assert.equal(realism.status, 200, 'scene art accepts the cinematic style the studio uses');

  globalThis.fetch = async () => Response.json({ name: 'models/veo-3.1-fast-generate-preview/operations/drama-clip' });
  const dramaClip = await post('/api/generate-video', { model: 'veo-3.1-fast-generate-preview', path: 'drama', title: 'Tomorrow’s Menu', storyContext: 'A chef reads the future.', narration: 'Steam curls over the pan.', visualPlan: plan, shotIndex: 1, shotCount: 1, aspectRatio: '16:9', durationSeconds: 8 }, 'drama-video-user', { GEMINI_API_KEY: 'test-secret' });
  assert.equal(dramaClip.status, 200, 'video jobs accept every story path');
  let limited = 0;
  for (let i = 0; i < 26; i++) if ((await post('/api/generate-video', { model: 'veo-3.1-fast-generate-preview', path: 'drama', title: 'T', storyContext: 'C', narration: 'N', visualPlan: plan, shotIndex: 1, shotCount: 1, aspectRatio: '16:9', durationSeconds: 8 }, 'video-limit-user', { GEMINI_API_KEY: 'test-secret' })).status === 429) limited++;
  assert.equal(limited, 2, 'the hourly clip limit allows exactly 24 clips');
} finally { globalThis.fetch = originalFetch; console.error = originalConsoleErrorForV27; }

const studioScript = await readFile(new URL('../site-assets/studio.js', import.meta.url), 'utf8');
assert.doesNotMatch(videoRenderer, /\$\('\[/u, 'the renderer never passes a CSS selector to getElementById');
assert.doesNotMatch(videoRenderer, /path: 'bedtime'/u, 'video requests use the project’s own path');
assert.match(studioScript, /storyverse:draft:/u, 'studio drafts are autosaved');

console.log('Worker checks passed: auth, input validation, all four story paths, Claude structured outputs and refusals, provider-specific errors, story and scene planning, image-model availability, authenticated Veo jobs and limits, signed job access, secure video download, generated WAV voiceover, and studio wiring.');
