// StoryVerse studio: one five-step editor (Imagine → Story → Scenes → Voice → Finish)
// shared by every creation path. Path rules (lengths, moods, scene limits) come from
// /api/paths so the browser and the Worker validate against the same values.
'use strict';

const $ = (id) => document.getElementById(id);
const STEP_BUTTONS = [...document.querySelectorAll('[data-step]')];
const PROJECT_FORMAT = 'storyverse-project-v2';

// Display copy only. Validation rules live in the Worker's PATHS table.
const COPY = {
  bedtime: {
    title: ['Bedtime', 'Bestie'], tagline: 'A little story. A world of wonder.',
    intro: 'Tell us about a character or adventure, then let AI draft a story and scenes for you to edit.',
    ideaLabel: 'Your story idea', ideaPlaceholder: 'A little fox is afraid of the dark, until a firefly helps him find the stars…',
  },
  drama: {
    title: ['Drama', 'Dream'], tagline: 'An idea worth the spotlight.',
    intro: 'Start with a fresh concept or dramatic hook. AI drafts a story built to keep your audience watching.',
    ideaLabel: 'What’s the concept or dramatic hook?', ideaPlaceholder: 'A food-truck chef discovers every order she cooks comes true the next day…',
    audienceLabel: 'Who is your audience?', audiencePlaceholder: 'Your followers, niche, or intended viewers',
  },
  magnum: {
    title: ['Magnum', 'Opus'], tagline: 'Think big. Build a universe.',
    intro: 'Describe the world, its central conflict, or your series idea. AI drafts a full episode with coherent arcs.',
    ideaLabel: 'What’s the world, central conflict, or series idea?', ideaPlaceholder: 'Two rival lighthouse keepers on a planet with no sun must share the last working lamp…',
    audienceLabel: 'Who are you telling this story for?', audiencePlaceholder: 'The audience for your series or project',
  },
  curious: {
    title: ['Curious', 'Class'], tagline: 'Make understanding an adventure.',
    intro: 'Name the learning goal. AI builds an accurate story that makes the idea easier to understand.',
    ideaLabel: 'What should learners understand by the end?', ideaPlaceholder: 'Why the moon has phases, told through a curious owl who keeps a moon diary…',
    audienceLabel: 'Who are your learners?', audiencePlaceholder: 'For example: Grade 5 science students',
  },
};

const SAMPLE = {
  title: 'Pip and the Little Lights',
  idea: 'A little fox discovers that the night is full of friendly lights.',
  script: `Pip the little fox loved the forest, but he did not love the dark. One evening, he peeped outside his den. “What if I get lost?” he whispered.

A firefly blinked beside his nose. “We can take one small step,” she said. Pip followed her warm little light to a patch of soft moss.

Above them, the clouds drifted apart. Hundreds of stars twinkled in the sky. Pip smiled. The night was not empty after all. It was full of tiny lights.

He thanked his new friend and curled up at home. Outside, the stars kept shining. Pip closed his eyes, feeling safe, warm, and ready to dream.`,
};

const pathId = (() => {
  const requested = new URLSearchParams(location.search).get('path');
  return Object.hasOwn(COPY, requested) ? requested : 'bedtime';
})();
const storageKey = `storyverse:draft:${pathId}`;

let rules = null; // this path's entry from /api/paths
let wordsPerMinute = 120;
let state = blankState();
let current = 0;
let voices = [];
let recognition = null;
let dictating = false;
let saveTimer = 0;
let nextSceneId = 1;

function blankState() {
  return { idea: '', age: '', audience: '', minutes: null, mood: '', model: '', title: '', script: '', builtScript: '', scenes: [], source: 'own', approved: false, unlocked: 0, step: 0 };
}

// ---------- persistence ----------

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  const ok = storageSet(storageKey, JSON.stringify({ ...state, step: current, savedAt: Date.now() }));
  $('save-note').textContent = ok
    ? 'Your draft is saved automatically in this browser.'
    : 'This browser isn’t saving drafts. Save a project file before leaving the page.';
}

function normalizeScenes(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.slice(0, 64).map((scene) => ({
    id: nextSceneId++,
    narration: typeof scene?.narration === 'string' ? scene.narration : '',
    visualPlan: validPlan(scene?.visualPlan) ? { ...scene.visualPlan } : null,
  }));
}
function validPlan(plan) {
  return Boolean(plan) && ['shot', 'camera', 'lighting', 'palette', 'composition', 'motion'].every((key) => typeof plan[key] === 'string' && plan[key].trim());
}
function restoreState(saved) {
  const next = blankState();
  for (const key of ['idea', 'age', 'audience', 'mood', 'model', 'title', 'script', 'builtScript']) if (typeof saved?.[key] === 'string') next[key] = saved[key];
  if (Number.isFinite(saved?.minutes)) next.minutes = saved.minutes;
  if (['own', 'ai', 'sample'].includes(saved?.source)) next.source = saved.source;
  next.scenes = normalizeScenes(saved?.scenes);
  next.approved = saved?.approved === true && next.scenes.length > 0 && next.scenes.every((scene) => scene.visualPlan);
  next.unlocked = Math.max(0, Math.min(4, Number(saved?.unlocked) || 0));
  if (!next.approved) next.unlocked = Math.min(next.unlocked, next.scenes.length ? 2 : next.script ? 1 : 0);
  next.step = Math.min(next.unlocked, Math.max(0, Number(saved?.step) || 0));
  return next;
}

// ---------- settings ----------

function fillSelect(select, values, format = String) {
  select.replaceChildren(...values.map((value) => new Option(format(value), String(value))));
}

function applyPathRules() {
  const copy = COPY[pathId];
  document.title = `${rules.name} · StoryVerse`;
  document.querySelector('.studio').dataset.path = pathId;
  $('studio-title').replaceChildren(`${copy.title[0]} `, Object.assign(document.createElement('span'), { className: 'gradient', textContent: copy.title[1] }));
  $('studio-tagline').textContent = copy.tagline;
  $('studio-badge').textContent = `${rules.minutes[0]}–${rules.minutes.at(-1)} MINUTE STORIES`;
  $('idea-intro').textContent = copy.intro;
  $('idea-label').textContent = copy.ideaLabel;
  $('idea').placeholder = copy.ideaPlaceholder;
  const byAge = rules.audience === 'age';
  $('age-field').hidden = !byAge;
  $('audience-field').hidden = byAge;
  if (!byAge) { $('audience-label').textContent = copy.audienceLabel; $('audience').placeholder = copy.audiencePlaceholder; }
  $('sample').hidden = pathId !== 'bedtime';
  fillSelect($('length'), rules.minutes, (minutes) => `${minutes} minute${minutes === 1 ? '' : 's'}`);
  fillSelect($('mood'), rules.moods);
}

function config() {
  return {
    path: pathId, model: $('model').value, idea: $('idea').value.trim(),
    ...(rules.audience === 'age' ? { age: $('age').value } : { audience: $('audience').value.trim() }),
    minutes: Number($('length').value), mood: $('mood').value, style: 'Cinematic realism',
  };
}
function audienceText() { return rules.audience === 'age' ? $('age').value : $('audience').value.trim(); }
function maxWords() { return Number($('length').value) * wordsPerMinute; }

function readSettingsIntoState() {
  Object.assign(state, { idea: $('idea').value, age: $('age').value, audience: $('audience').value, minutes: Number($('length').value), mood: $('mood').value, model: $('model').value });
}
function writeStateIntoForm() {
  $('idea').value = state.idea;
  $('audience').value = state.audience;
  if (state.age && [...$('age').options].some((option) => option.value === state.age)) $('age').value = state.age;
  if (state.minutes && rules.minutes.includes(state.minutes)) $('length').value = String(state.minutes);
  if (state.mood && rules.moods.includes(state.mood)) $('mood').value = state.mood;
  $('story-title').value = state.title;
  $('script').value = state.script;
}

async function loadModels() {
  const select = $('model');
  try {
    const response = await fetch(`/api/models?path=${encodeURIComponent(pathId)}`);
    const payload = await response.json();
    if (!response.ok || !payload.models?.length) throw Error();
    select.replaceChildren(...payload.models.map((model) => new Option(`${model.recommended ? 'Recommended · ' : ''}${model.label} · ${model.note}${model.available ? '' : ' · server key needed'}`, model.id)));
    const preferred = payload.models.find((model) => model.id === state.model) || payload.models.find((model) => model.available) || payload.models[0];
    select.value = preferred.id;
    state.model = preferred.id;
    $('model-note').textContent = 'Recommendations change by story type. A connected server key is needed to run a model.';
  } catch {
    select.replaceChildren(new Option('Model list unavailable', ''));
    $('model-note').textContent = 'Could not load model options. Refresh and try again.';
  }
}

// ---------- step navigation ----------

function setUnlocked(n) {
  state.unlocked = n;
  STEP_BUTTONS.forEach((button, i) => { button.disabled = i > n; });
  scheduleSave();
}
// Lower the furthest reachable step without ever raising it.
function lockAfter(n) {
  state.approved = false;
  setUnlocked(Math.min(state.unlocked, n));
  notifyChange();
}
function notifyChange() { window.dispatchEvent(new Event('storyverse:change')); }

function stopVoice() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

function showStep(n, { focus = true } = {}) {
  if (n > state.unlocked) return;
  stopVoice();
  if (dictating) recognition?.stop();
  current = n;
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = Number(panel.dataset.panel) !== n; });
  STEP_BUTTONS.forEach((button, i) => { if (i === n) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
  if (n === 1) updateCount();
  if (n === 2) renderScenes();
  if (n === 4) renderSummary();
  if (focus) {
    const heading = document.querySelector(`[data-panel="${n}"] h2`);
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    document.querySelector('.stage-nav').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  scheduleSave();
  window.dispatchEvent(new Event('storyverse:step'));
}
STEP_BUTTONS.forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.step))));
document.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.back))));

// ---------- step 1: idea ----------

function renderIdeaSummary() {
  const c = config();
  $('idea-summary').textContent = `${audienceText() || 'Audience not set'} · ${c.minutes} minute${c.minutes > 1 ? 's' : ''} · ${c.mood}\n${c.idea || 'No idea written yet.'}`;
  $('story-source').textContent = state.source === 'sample'
    ? 'Sample story: Pip and the Little Lights. Edit it freely; this example was not generated from your idea.'
    : state.source === 'ai' ? 'AI draft: review and edit the story below before approving it.' : 'Write or paste your own script below.';
}

function storyStart() {
  readSettingsIntoState();
  renderIdeaSummary();
  if (state.unlocked < 1) setUnlocked(1);
  showStep(1);
}

function requireIdea(minLength) {
  const idea = $('idea');
  if (idea.value.trim().length >= minLength) { idea.setCustomValidity(''); return true; }
  idea.setCustomValidity(minLength > 1 ? `Describe your idea in at least ${minLength} characters.` : 'Please enter your story idea.');
  idea.reportValidity();
  idea.focus();
  return false;
}
function requireAudience() {
  if (rules.audience === 'age') return true;
  const field = $('audience');
  if (field.value.trim().length >= 2) { field.setCustomValidity(''); return true; }
  field.setCustomValidity('Describe who this story is for.');
  field.reportValidity();
  field.focus();
  return false;
}

$('idea-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!requireIdea(1)) return;
  if (state.source !== 'own' && !state.script.trim()) state.source = 'own';
  storyStart();
});
$('idea').addEventListener('input', () => $('idea').setCustomValidity(''));
$('audience').addEventListener('input', () => $('audience').setCustomValidity(''));
$('idea-form').addEventListener('input', onSettingsChange);
$('idea-form').addEventListener('change', onSettingsChange);
function onSettingsChange(event) {
  if (event.target === $('import-file')) return;
  readSettingsIntoState();
  lockAfter(state.script.trim() ? 1 : 0);
}

$('sample').addEventListener('click', () => {
  if ((state.script.trim() || state.scenes.length) && !confirm('Replace your current script and scenes with the sample story?')) return;
  $('idea').value = SAMPLE.idea;
  $('length').value = '1';
  Object.assign(state, { source: 'sample', title: SAMPLE.title, script: SAMPLE.script, scenes: [], builtScript: '' });
  $('story-title').value = SAMPLE.title;
  $('script').value = SAMPLE.script;
  lockAfter(1);
  storyStart();
});

function signInLink() {
  // In the iOS app, sign-in is Sign in with Apple, handled natively.
  if (window.storyverseNative) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary signin-link';
    button.textContent = 'Sign in with Apple';
    button.addEventListener('click', async () => {
      try {
        await window.storyverseNative.call('signIn');
        button.replaceWith('Signed in. Try again now.');
      } catch (error) {
        if (!/cancel/iu.test(error?.message ?? '')) button.after(` ${error?.message || 'Sign-in failed.'}`);
      }
    });
    return button;
  }
  const link = document.createElement('a');
  link.href = `/signin-with-chatgpt?return_to=${encodeURIComponent(`/studio.html?path=${pathId}`)}`;
  link.textContent = 'Sign in with ChatGPT';
  link.className = 'signin-link';
  return link;
}

$('generate-ai').addEventListener('click', async () => {
  if (!requireIdea(8) || !requireAudience()) return;
  if ((state.script.trim() || state.scenes.length) && !confirm('Replace your current script and scenes with a new AI draft?')) return;
  const button = $('generate-ai');
  const status = $('generation-status');
  button.disabled = true;
  status.textContent = rules.minutes[0] >= 10 ? 'Writing your story and shot plan… longer stories can take a minute or two.' : 'Writing your story and AI-designed shot plan…';
  saveNow(); // keep the idea if the user has to sign in first
  try {
    const response = await fetch('/api/generate-story', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config()) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      status.textContent = window.storyverseNative ? 'Sign in to generate. Your idea is saved.' : 'Sign in with ChatGPT to generate. Your idea is saved and will be here when you return.';
      status.append(' ', signInLink());
      return;
    }
    if (!response.ok) throw Error(payload.error || 'Story generation failed. Try again.');
    if (!Array.isArray(payload.scenes) || typeof payload.title !== 'string' || typeof payload.script !== 'string') throw Error('The generated draft was incomplete. Please try again.');
    Object.assign(state, { source: 'ai', title: payload.title, script: payload.script, builtScript: payload.script, scenes: normalizeScenes(payload.scenes) });
    $('story-title').value = payload.title;
    $('script').value = payload.script;
    lockAfter(1);
    status.textContent = 'AI draft ready. Review and edit it before approving.';
    window.StoryVerseApp?.haptic('success');
    storyStart();
  } catch (error) {
    status.textContent = error.message || 'Could not create a story. Please try again.';
  } finally {
    button.disabled = false;
  }
});

// ---------- step 2: story ----------

function count(text) { const trimmed = text.trim(); return trimmed ? trimmed.split(/\s+/u).length : 0; }
function seconds(text) { return Math.round(count(text) / wordsPerMinute * 60); }
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return minutes ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${rest} seconds`;
}

function updateCount() {
  const words = count($('script').value);
  const limit = maxWords();
  $('word-count').textContent = `${words.toLocaleString()} words · about ${formatDuration(seconds($('script').value))}`;
  $('word-target').textContent = `Target: up to ${limit.toLocaleString()} words (${wordsPerMinute} words/minute)`;
  const ratio = Math.min(1.25, words / limit);
  $('length-bar').style.width = `${Math.min(100, ratio * 100)}%`;
  $('length-bar').dataset.state = words > limit ? 'over' : ratio >= 0.6 ? 'good' : 'short';
  $('timing-warning').textContent = words > limit
    ? `This script is ${(words - limit).toLocaleString()} words over the selected length. Shorten it or choose a longer length.`
    : 'Actual timing varies by voice and pace.';
}

$('script').addEventListener('input', () => { state.script = $('script').value; updateCount(); lockAfter(1); });
$('story-title').addEventListener('input', () => { state.title = $('story-title').value; lockAfter(1); });

$('approve-story').addEventListener('click', () => {
  const text = $('script').value.trim();
  const error = $('story-error');
  if (!$('story-title').value.trim() || !text) { error.textContent = 'Add a title and story script to continue.'; return; }
  if (count(text) > maxWords()) { error.textContent = 'Shorten the script to fit your selected story length.'; return; }
  if (text !== state.builtScript.trim()) {
    const paragraphs = text.split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean);
    if (paragraphs.length > rules.maxEditorScenes) { error.textContent = `Combine your paragraphs into ${rules.maxEditorScenes} scenes or fewer.`; return; }
    if (state.scenes.length && !confirm('Rebuild scenes from the updated script? Scenes whose text is unchanged keep their visual plan.')) return;
    const previous = new Map(state.scenes.filter((scene) => scene.visualPlan).map((scene) => [scene.narration.trim(), scene.visualPlan]));
    state.scenes = paragraphs.map((narration) => ({ id: nextSceneId++, narration, visualPlan: previous.get(narration) ?? null }));
    state.builtScript = text;
  }
  error.textContent = '';
  state.approved = false;
  setUnlocked(Math.max(state.unlocked, 2));
  notifyChange();
  showStep(2);
});

// ---------- step 3: scenes ----------

const PLAN_LABELS = [['shot', 'Shot'], ['camera', 'Camera'], ['lighting', 'Lighting'], ['palette', 'Color palette'], ['composition', 'Composition'], ['motion', 'Motion']];

function renderPlan(box, scene) {
  const heading = document.createElement('strong');
  heading.textContent = scene.visualPlan ? 'AI visual plan' : 'AI visual plan · pending';
  box.replaceChildren(heading);
  box.classList.toggle('pending', !scene.visualPlan);
  if (!scene.visualPlan) {
    const note = document.createElement('p');
    note.textContent = 'The selected model will choose the camera, lighting, palette, and movement when you plan and approve your scenes.';
    box.append(note);
    return;
  }
  for (const [key, title] of PLAN_LABELS) {
    const row = document.createElement('p');
    const name = document.createElement('b');
    name.textContent = `${title}: `;
    row.append(name, document.createTextNode(scene.visualPlan[key] || ''));
    box.append(row);
  }
}

function sceneButton(label, text, handler, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function renderScenes(focusId) {
  const box = $('scenes');
  box.replaceChildren();
  state.scenes.forEach((scene, i) => {
    const article = document.createElement('article');
    article.className = 'scene-editor';
    const top = document.createElement('div');
    top.className = 'scene-top';
    const heading = document.createElement('h3');
    heading.textContent = `Scene ${i + 1}`;
    const tools = document.createElement('div');
    tools.className = 'scene-actions';
    tools.append(
      sceneButton(`Move scene ${i + 1} up`, '↑', () => moveScene(i, -1), i === 0),
      sceneButton(`Move scene ${i + 1} down`, '↓', () => moveScene(i, 1), i === state.scenes.length - 1),
      sceneButton(`Remove scene ${i + 1}`, 'Remove', () => removeScene(i), state.scenes.length === 1),
    );
    top.append(heading, tools);
    const grid = document.createElement('div');
    grid.className = 'scene-grid';
    const label = document.createElement('label');
    label.textContent = 'Narration';
    const narration = document.createElement('textarea');
    narration.rows = 5;
    narration.maxLength = 4000;
    narration.value = scene.narration;
    narration.placeholder = 'What will the narrator say?';
    narration.dataset.sceneId = String(scene.id);
    const plan = document.createElement('div');
    plan.className = 'visual-plan';
    narration.addEventListener('input', () => {
      scene.narration = narration.value;
      if (scene.visualPlan) { scene.visualPlan = null; renderPlan(plan, scene); }
      onScenesChanged();
    });
    label.append(narration);
    renderPlan(plan, scene);
    grid.append(label, plan);
    article.append(top, grid);
    box.append(article);
  });
  const planned = state.scenes.filter((scene) => scene.visualPlan).length;
  $('scene-count').textContent = `${state.scenes.length} of ${rules.maxEditorScenes} scenes · ${planned} planned`;
  $('add-scene').disabled = state.scenes.length >= rules.maxEditorScenes;
  if (focusId) box.querySelector(`[data-scene-id="${focusId}"]`)?.focus();
}

function onScenesChanged() {
  // Scenes now differ from the script text; keep the script in sync so the story
  // step and project file reflect what will actually be narrated.
  state.script = state.scenes.map((scene) => scene.narration.trim()).join('\n\n');
  state.builtScript = state.script;
  $('script').value = state.script;
  const planned = state.scenes.filter((scene) => scene.visualPlan).length;
  $('scene-count').textContent = `${state.scenes.length} of ${rules.maxEditorScenes} scenes · ${planned} planned`;
  lockAfter(2);
}
function moveScene(index, delta) {
  const [scene] = state.scenes.splice(index, 1);
  state.scenes.splice(index + delta, 0, scene);
  onScenesChanged();
  renderScenes();
  const moved = $('scenes').querySelector(`[aria-label="Move scene ${index + delta + 1} ${delta < 0 ? 'up' : 'down'}"]`);
  if (moved && !moved.disabled) moved.focus();
  else $('scenes').querySelector(`[data-scene-id="${scene.id}"]`)?.focus();
}
function removeScene(index) {
  const scene = state.scenes[index];
  if (scene.narration.trim() && !confirm(`Remove scene ${index + 1}?`)) return;
  state.scenes.splice(index, 1);
  onScenesChanged();
  renderScenes();
}
$('add-scene').addEventListener('click', () => {
  if (state.scenes.length >= rules.maxEditorScenes) return;
  const scene = { id: nextSceneId++, narration: '', visualPlan: null };
  state.scenes.push(scene);
  onScenesChanged();
  renderScenes(scene.id);
});
$('replan-all').addEventListener('click', () => {
  if (!state.scenes.some((scene) => scene.visualPlan)) return;
  if (!confirm('Clear every visual plan and ask the model to plan all scenes again?')) return;
  state.scenes.forEach((scene) => { scene.visualPlan = null; });
  onScenesChanged();
  renderScenes();
});

$('approve-scenes').addEventListener('click', async () => {
  const error = $('scene-error');
  if (state.scenes.some((scene) => !scene.narration.trim())) { error.textContent = 'Add narration to every scene, or remove empty scenes.'; return; }
  if (count(state.scenes.map((scene) => scene.narration).join(' ')) > maxWords()) { error.textContent = 'The scene narration is longer than the selected length. Shorten it before continuing.'; return; }
  const missing = state.scenes.filter((scene) => !scene.visualPlan).length;
  if (missing) {
    const button = $('approve-scenes');
    button.disabled = true;
    error.textContent = `Planning the shot, camera, lighting, palette, and motion for ${missing} scene${missing === 1 ? '' : 's'}…`;
    try {
      const response = await fetch('/api/plan-scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...config(), scenes: state.scenes.map((scene) => ({ narration: scene.narration })) }) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) { error.textContent = `Sign in${window.storyverseNative ? '' : ' with ChatGPT'} to generate the visual plan. Your scenes are saved.`; error.append(' ', signInLink()); return; }
      if (!response.ok) throw Error(payload.error || 'Visual planning failed. Try again.');
      if (!Array.isArray(payload.scenes) || payload.scenes.length !== state.scenes.length) throw Error('The AI plan was incomplete. Please try again.');
      // Keep plans the writer already approved; fill only the gaps, with the model
      // still seeing every scene so continuity holds.
      state.scenes.forEach((scene, i) => { if (!scene.visualPlan) scene.visualPlan = payload.scenes[i].visualPlan; });
      renderScenes();
    } catch (failure) {
      error.textContent = failure.message || 'Visual planning failed. Try again.';
      return;
    } finally {
      button.disabled = false;
    }
  }
  error.textContent = '';
  state.approved = true;
  setUnlocked(Math.max(state.unlocked, 3));
  notifyChange();
  window.StoryVerseApp?.haptic('success');
  showStep(3);
});

// ---------- step 4: voice preview ----------

function loadVoices() {
  if (!('speechSynthesis' in window)) {
    $('voice').replaceChildren(new Option('Device voices unavailable', ''));
    $('listen').disabled = true;
    $('voice-status').textContent = 'Voice preview isn’t supported in this browser. You can still continue.';
    return;
  }
  const previous = $('voice').value;
  voices = speechSynthesis.getVoices();
  $('voice').replaceChildren(new Option('Device default', ''), ...voices.map((voice, i) => new Option(`${voice.name} (${voice.lang})`, String(i))));
  if ([...$('voice').options].some((option) => option.value === previous)) $('voice').value = previous;
}
loadVoices();
if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', loadVoices);

$('listen').addEventListener('click', () => {
  stopVoice();
  if (!state.approved) return;
  const utterance = new SpeechSynthesisUtterance(state.scenes.map((scene) => scene.narration).join('\n\n'));
  if ($('voice').value !== '') utterance.voice = voices[Number($('voice').value)];
  utterance.rate = Number($('pace').value);
  utterance.onstart = () => { $('voice-status').textContent = 'Playing device-voice preview…'; };
  utterance.onend = () => { $('voice-status').textContent = 'Preview finished.'; };
  utterance.onerror = (event) => { $('voice-status').textContent = event.error === 'interrupted' || event.error === 'canceled' ? 'Preview stopped.' : 'The device couldn’t play this voice. Try another voice or browser.'; };
  speechSynthesis.speak(utterance);
});
$('stop').addEventListener('click', () => { stopVoice(); $('voice-status').textContent = 'Preview stopped.'; });
$('finish').addEventListener('click', () => {
  if (!state.approved) return;
  setUnlocked(4);
  showStep(4);
});

// ---------- step 5: finish ----------

function renderSummary() {
  const c = config();
  $('finished-title').textContent = state.title || 'Your project';
  const narration = state.scenes.map((scene) => scene.narration).join(' ');
  const rows = {
    'Story type': rules.name,
    Audience: audienceText(),
    'Target length': `${c.minutes} minute${c.minutes === 1 ? '' : 's'}`,
    Mood: c.mood,
    'AI model': $('model').selectedOptions[0]?.textContent || 'Not selected',
    Scenes: state.scenes.length,
    Narration: `${count(narration).toLocaleString()} words · about ${formatDuration(seconds(narration))}`,
    Source: state.source === 'sample' ? 'Edited sample story' : state.source === 'ai' ? 'AI draft, reviewed by you' : 'Your own script',
  };
  const list = $('project-summary');
  list.replaceChildren();
  for (const [key, value] of Object.entries(rows)) {
    const term = document.createElement('dt');
    term.textContent = key;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }
}

function safeName(title) {
  return title.normalize('NFKD').replace(/[^A-Za-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'Story';
}
function downloadBlob(blob, name) {
  if (window.storyverseNative) {
    window.StoryVerseApp.shareFile(blob, name).catch((error) => { $('download-status').textContent = error?.message || 'The file couldn’t be shared.'; });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function projectFile() {
  return {
    format: PROJECT_FORMAT, path: pathId, pathName: rules.name, savedAt: new Date().toISOString(),
    title: $('story-title').value.trim(), ...config(), source: state.source,
    scenes: state.scenes.map(({ narration, visualPlan }) => ({ narration, visualPlan })),
    voicePreview: { voice: $('voice').selectedOptions[0]?.textContent, rate: Number($('pace').value) },
  };
}

$('download').addEventListener('click', () => {
  if (!state.approved) return;
  downloadBlob(new Blob([JSON.stringify(projectFile(), null, 2)], { type: 'application/json' }), `StoryVerse-${safeName(state.title)}.json`);
  $('download-status').textContent = 'Project file saved. Open it later with “Open a saved project” to keep editing.';
});
$('download-script').addEventListener('click', () => {
  const lines = [state.title, '', ...state.scenes.flatMap((scene, i) => {
    const plan = scene.visualPlan ? PLAN_LABELS.map(([key, title]) => `  ${title}: ${scene.visualPlan[key]}`) : [];
    return [`SCENE ${i + 1}`, scene.narration.trim(), ...plan, ''];
  })];
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `StoryVerse-${safeName(state.title)}-script.txt`);
  $('download-status').textContent = 'Script downloaded with its scene directions.';
});

// ---------- import ----------

$('import-project').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0];
  $('import-file').value = '';
  if (!file) return;
  const status = $('generation-status');
  try {
    if (file.size > 2_000_000) throw Error('That file is too large to be a StoryVerse project.');
    const data = JSON.parse(await file.text());
    // v1 files came from the Bedtime-only studio and named the path by its label.
    const importedPath = data?.format === PROJECT_FORMAT ? data.path : data?.format === 'storyverse-project-v1' ? 'bedtime' : null;
    if (!Object.hasOwn(COPY, importedPath)) throw Error('This isn’t a StoryVerse project file.');
    if ((state.script.trim() || state.scenes.length) && !confirm('Replace your current draft with the project from this file?')) return;
    const restored = restoreState({ ...data, script: (data.scenes ?? []).map((scene) => scene?.narration ?? '').join('\n\n') });
    restored.builtScript = restored.script;
    restored.approved = restored.scenes.length > 0 && restored.scenes.every((scene) => scene.visualPlan);
    restored.unlocked = restored.approved ? 3 : restored.scenes.length ? 2 : 1;
    restored.step = restored.unlocked;
    if (importedPath !== pathId) {
      storageSet(`storyverse:draft:${importedPath}`, JSON.stringify(restored));
      location.href = `/studio.html?path=${importedPath}`;
      return;
    }
    state = restored;
    writeStateIntoForm();
    if (state.model && [...$('model').options].some((option) => option.value === state.model)) $('model').value = state.model;
    setUnlocked(state.unlocked);
    notifyChange();
    status.textContent = `Opened “${state.title || 'Untitled story'}”.`;
    showStep(state.step);
  } catch (error) {
    status.textContent = error instanceof SyntaxError ? 'That file couldn’t be read as a project.' : error.message;
  }
});

$('start-fresh').addEventListener('click', () => {
  if (!confirm('Start a new story? Your saved draft for this story type will be cleared.')) return;
  storageRemove(storageKey);
  location.reload();
});

// ---------- dictation ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.storyverseNative) {
  // The app's web view has no Speech API, so the app listens natively.
  $('speech-status').textContent = 'Tap to speak your idea. Transcription stays on your device where supported.';
  $('dictate').addEventListener('click', async () => {
    if (dictating) { window.storyverseNative.call('stopDictation').catch(() => {}); return; }
    dictating = true;
    $('dictate').textContent = 'Stop listening';
    $('speech-status').textContent = 'Listening…';
    try {
      const { transcript } = await window.storyverseNative.call('dictate');
      if (transcript) {
        $('idea').value = `${$('idea').value} ${transcript}`.trim();
        $('idea').dispatchEvent(new Event('input', { bubbles: true }));
        $('speech-status').textContent = 'Idea captured. You can edit it above.';
      } else {
        $('speech-status').textContent = 'Didn’t catch that. Try again or type your idea.';
      }
    } catch (error) {
      $('speech-status').textContent = error?.message || 'Dictation stopped. Type your idea instead.';
    } finally {
      dictating = false;
      $('dictate').textContent = 'Speak my idea';
    }
  });
} else if (!Recognition) {
  $('dictate').disabled = true;
  $('speech-status').textContent = 'Dictation is unavailable here. Type your idea or use your keyboard’s microphone.';
} else {
  $('dictate').addEventListener('click', () => {
    if (dictating) { recognition.stop(); return; }
    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => { dictating = true; $('dictate').textContent = 'Stop listening'; $('speech-status').textContent = 'Listening… Your browser may process speech through its speech service.'; };
    recognition.onresult = (event) => {
      $('idea').value = `${$('idea').value} ${event.results[0][0].transcript}`.trim();
      $('idea').dispatchEvent(new Event('input', { bubbles: true }));
      $('speech-status').textContent = 'Idea captured. You can edit it above.';
    };
    recognition.onerror = (event) => { $('speech-status').textContent = event.error === 'not-allowed' ? 'Microphone access was declined. You can type your idea.' : 'Couldn’t capture speech. Try again or type your idea.'; };
    recognition.onend = () => { dictating = false; $('dictate').textContent = 'Speak my idea'; };
    try { recognition.start(); } catch { $('speech-status').textContent = 'Dictation couldn’t start. Please type your idea.'; }
  });
}
window.addEventListener('pagehide', () => { stopVoice(); recognition?.abort(); saveNow(); });

// ---------- boot ----------

window.storyVerseExport = {
  getProject: () => ({ approved: state.approved, path: pathId, title: $('story-title').value.trim(), minutes: Number($('length').value), scenes: state.scenes.map(({ narration, visualPlan }) => ({ narration, visualPlan })) }),
  getConfig: () => config(),
};

async function boot() {
  try {
    const response = await fetch('/api/paths');
    const payload = await response.json();
    rules = payload.paths?.find((path) => path.id === pathId);
    if (!response.ok || !rules) throw Error();
    wordsPerMinute = payload.wordsPerMinute || wordsPerMinute;
    fillSelect($('age'), payload.ageGroups ?? []);
  } catch {
    $('studio-tagline').textContent = 'The studio couldn’t load its settings. Refresh the page to try again.';
    document.querySelectorAll('.stage button, .stage-nav button').forEach((button) => { button.disabled = true; });
    return;
  }
  applyPathRules();
  let saved = null;
  try { saved = JSON.parse(storageGet(storageKey) ?? 'null'); } catch { saved = null; }
  if (saved) {
    state = restoreState(saved);
    if (state.idea || state.script) {
      $('restore-banner').hidden = false;
      const when = Number.isFinite(saved.savedAt) ? new Date(saved.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      $('restore-text').textContent = `Welcome back. Your draft${state.title ? ` “${state.title}”` : ''}${when ? ` from ${when}` : ''} has been restored.`;
    }
  }
  writeStateIntoForm();
  readSettingsIntoState();
  await loadModels();
  setUnlocked(state.unlocked);
  if (state.step >= 1) renderIdeaSummary();
  showStep(state.step, { focus: false });
  notifyChange();
}
boot();
