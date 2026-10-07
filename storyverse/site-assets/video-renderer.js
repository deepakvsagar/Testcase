const $ = (id) => document.getElementById(id);
const canvas = $('render-canvas');
const ctx = canvas.getContext('2d');
const recorderTypes = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
function findRecorderMime() {
  const Recorder = window.MediaRecorder;
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return null;
  try { return recorderTypes.find((type) => Recorder.isTypeSupported(type)) ?? null; } catch { return null; }
}
const recorderMime = findRecorderMime();
const videoModels = new Map();
let activeController = null;
let activeRecorder = null;
let renderBlob = null;
let renderUrl = null;
let renderName = '';
let renderSnapshot = '';
let animationFrame = 0;
let working = false;
let videoModelsLoading = true;
let videoModelsLoadFailed = false;
// Defaults until /api/video-models reports the Worker's limits.
let maxClips = 24;
let maxNarrationCharacters = 8_000;

function getProject() { return window.storyVerseExport.getProject(); }
function narrationText(project) { return project.scenes.map((scene) => scene.narration.trim()).join('\n\n'); }
// Why this project can't be sent for video yet, or '' when it fits the limits.
function exportLimitProblem(project, beats) {
  if (beats.length > maxClips) return `Video export supports up to ${maxClips} clips (about ${Math.round(maxClips * 16 / 2)} seconds of narration). This story needs ${beats.length}. Shorten it, or share the script and project file instead.`;
  if (narrationText(project).length > maxNarrationCharacters) return `The narrator can voice up to ${maxNarrationCharacters.toLocaleString()} characters in one pass. Shorten the story to export video.`;
  return '';
}
function projectSnapshot() { return JSON.stringify(getProject()); }
function status(message) { $('render-status').textContent = message; }
function setBusy(value) {
  working = value;
  document.querySelector('.studio').classList.toggle('exporting', value);
  document.querySelectorAll('.stage-nav button,[data-back],#download,#video-layout,#video-model,#cost-acknowledged,#render-video').forEach((node) => {
    if (value) { node.dataset.wasDisabled = String(node.disabled); node.disabled = true; }
    else { node.disabled = node.dataset.wasDisabled === 'true'; delete node.dataset.wasDisabled; }
  });
  $('cancel-render').disabled = !value;
}
function clearOutput() {
  renderBlob = null;
  if (renderUrl) URL.revokeObjectURL(renderUrl);
  renderUrl = null;
  $('rendered-video').pause();
  $('rendered-video').removeAttribute('src');
  $('rendered-video').hidden = true;
  $('save-video').disabled = true;
  $('share-video').disabled = true;
  $('format-note').textContent = 'Export format depends on your browser: MP4 when supported, otherwise WebM.';
}

function makeBeats(project) {
  const words = [];
  for (const scene of project.scenes) {
    if (!scene.narration?.trim() || !scene.visualPlan) throw Error('Approve every scene and its AI film plan before rendering.');
    for (const word of scene.narration.trim().split(/\s+/u)) words.push({ word, visualPlan: scene.visualPlan });
  }
  if (!words.length) throw Error('Add narration to your story before rendering.');
  const beats = [];
  let offset = 0;
  while (offset < words.length) {
    let size = Math.min(16, words.length - offset);
    const remainder = words.length - offset - size;
    if (remainder > 0 && remainder < 8 && size > 8) size -= 8 - remainder;
    const selected = words.slice(offset, offset + size);
    const planCounts = new Map();
    for (const token of selected) planCounts.set(token.visualPlan, (planCounts.get(token.visualPlan) || 0) + 1);
    const visualPlan = [...planCounts].sort((a, b) => b[1] - a[1])[0][0];
    beats.push({ narration: selected.map((token) => token.word).join(' '), visualPlan, wordCount: selected.length, durationSeconds: 8 });
    offset += size;
  }
  return beats;
}

function updateEstimate() {
  const project = getProject();
  let beats = [];
  try { if (project.scenes.length) beats = makeBeats(project); } catch { beats = []; }
  const model = videoModels.get($('video-model').value);
  $('render-video').disabled = working;
  if (!model || !model.available) {
    $('cost-estimate').textContent = 'Connect GEMINI_API_KEY to see the video estimate.';
    $('asset-status').textContent = 'Add the GEMINI_API_KEY server secret to enable AI-generated footage and narration.';
    status(videoModelsLoading ? 'Video model choices are loading.' : videoModelsLoadFailed ? 'Video model choices could not be loaded. Refresh the page and try again.' : 'Connect the Gemini server key to enable AI video and voiceover.');
    return;
  }
  $('voice-cost-note').textContent = 'Google currently lists Veo with no free tier. Voiceover is separate: about $0.014 per spoken minute at current standard pricing when billable; your Gemini quota and tier may change the charge. ';
  const pricingLink = document.createElement('a');
  pricingLink.href = 'https://ai.google.dev/gemini-api/docs/pricing';
  pricingLink.target = '_blank';
  pricingLink.rel = 'noopener noreferrer';
  pricingLink.textContent = 'Current Google pricing';
  $('voice-cost-note').append(pricingLink);
  const generatedSeconds = beats.reduce((sum, beat) => sum + beat.durationSeconds, 0);
  const estimatedCost = generatedSeconds * model.pricePerSecond;
  $('cost-estimate').textContent = beats.length ? `Estimated video charge: $${estimatedCost.toFixed(2)} · ${beats.length} AI clip${beats.length === 1 ? '' : 's'} / ${generatedSeconds} generated seconds` : 'Approve your scenes to calculate the video estimate.';
  $('asset-status').textContent = 'Each story beat becomes one 8-second AI clip. The narrator is generated separately. The final video has no subtitles, image cards, or title overlays.';
  const limitProblem = beats.length ? exportLimitProblem(project, beats) : '';
  if (limitProblem) $('cost-estimate').textContent = `Not available for this story · needs ${beats.length} clips`;
  $('render-video').disabled = working || Boolean(limitProblem);
  if (!project.approved) status('Approve your story and scene plan before rendering.');
  else if (!beats.length) status('Add narration and approve the scene plan before rendering.');
  else if (limitProblem) status(limitProblem);
  else if (!recorderMime || typeof canvas.captureStream !== 'function' || !ctx) status('This browser cannot record the finished video. Try an up-to-date desktop Chrome, Edge, or Safari browser.');
  else if (!$('cost-acknowledged').checked) status('Review the estimate and check the cost acknowledgment before generating.');
  else status('Ready to create. Google may bill the Gemini account for the narrator and video clips.');
}

async function loadVideoModels() {
  try {
    const response = await fetch('/api/video-models');
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.models)) throw Error();
    if (Number.isInteger(payload.maxClips)) maxClips = payload.maxClips;
    if (Number.isInteger(payload.maxNarrationCharacters)) maxNarrationCharacters = payload.maxNarrationCharacters;
    videoModelsLoading = false;
    videoModelsLoadFailed = false;
    const select = $('video-model');
    select.replaceChildren();
    for (const model of payload.models) {
      videoModels.set(model.id, model);
      const option = document.createElement('option');
      option.value = model.id;
      option.disabled = !model.available;
      option.textContent = `${model.label}${model.available ? '' : ' · Add GEMINI_API_KEY'}`;
      select.append(option);
    }
    const recommended = payload.models.find((model) => model.recommended && model.available);
    if (recommended) select.value = recommended.id;
    $('asset-status').textContent = payload.models.some((model) => model.available) ? 'AI footage and generated narration are ready when you approve the cost estimate.' : 'Add the GEMINI_API_KEY server secret to enable AI-generated footage and narration.';
    updateEstimate();
  } catch {
    videoModelsLoading = false;
    videoModelsLoadFailed = true;
    $('video-model').replaceChildren(new Option('Could not load video models', ''));
    $('cost-estimate').textContent = 'Video model choices could not be loaded. Refresh the page and try again.';
    $('render-video').disabled = working;
    status('Video model choices could not be loaded. Refresh the page and try again.');
  }
}
void loadVideoModels();

async function parseError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw Error('Sign in with ChatGPT, then return here to generate the video.');
  const error = Error(data.error || fallback);
  error.noVideoJobAccepted = data.noVideoJobAccepted === true;
  error.videoSubmissionUncertain = data.videoSubmissionUncertain === true;
  throw error;
}
async function generateVoiceover(project, signal) {
  status('Generating the clean AI narrator voiceover…');
  const response = await fetch('/api/generate-voiceover', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ text: narrationText(project), voice: 'Kore' }),
  });
  if (!response.ok) return parseError(response, 'Could not create the narrator voiceover.');
  const audio = await response.blob();
  if (audio.type && !audio.type.includes('audio/wav')) throw Error('The narrator returned an unsupported audio format.');
  if (audio.size < 44) throw Error('The narrator returned an empty recording.');
  return audio;
}
async function startClip(beat, index, count, project, model, signal, onAccepted) {
  const response = await fetch('/api/generate-video', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model, path: project.path, title: project.title, storyContext: project.scenes.map((scene) => scene.narration.trim()).join(' ').slice(0, 4_000), narration: beat.narration, visualPlan: beat.visualPlan, shotIndex: index + 1, shotCount: count, aspectRatio: $('video-layout').value, durationSeconds: beat.durationSeconds }),
  });
  if (!response.ok) return parseError(response, 'The video model could not start this clip.');
  const result = await response.json();
  if (typeof result.job !== 'string') throw Error('The video model returned an invalid job.');
  onAccepted();
  return result.job;
}
  function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
  });
}
async function fetchClip(beat, index, count, project, model, signal, onSubmit, onAccepted, onComplete) {
  onSubmit();
  const job = await startClip(beat, index, count, project, model, signal, onAccepted);
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(10_000, signal);
    const response = await fetch(`/api/video-job-status?job=${encodeURIComponent(job)}`, { signal });
    if (!response.ok) return parseError(response, 'Could not check a video generation job.');
    const result = await response.json();
    if (result.error) throw Error(result.error);
    if (!result.done) continue;
    if (!result.ready) throw Error('The video model did not return a finished clip.');
    const download = await fetch(`/api/video-job-content?job=${encodeURIComponent(job)}`, { signal });
    if (!download.ok) return parseError(download, 'Could not download a finished video clip.');
    const clip = await download.blob();
    if (clip.size < 1_000) throw Error('The video model returned an empty clip.');
    onComplete(index);
    return clip;
  }
  throw Error('A video clip took too long. Check your Gemini API quota before retrying, since submitted generations may finish in the background.');
}

async function generateClips(beats, project, model, signal, onSubmit, onAccepted) {
  const clips = new Array(beats.length);
  let next = 0;
  let completed = 0;
  let failure = null;
  async function runner() {
    while (!failure && next < beats.length) {
      if (signal.aborted) { failure = new DOMException('Cancelled', 'AbortError'); return; }
      const index = next++;
      status(`Generating realistic footage · clip ${index + 1} of ${beats.length}. This can take several minutes.`);
      try {
        clips[index] = await fetchClip(beats[index], index, beats.length, project, model, signal, onSubmit, onAccepted, () => {
          completed++;
          $('render-progress').value = completed;
          status(`AI footage complete · ${completed} of ${beats.length} clips. Keep this page open.`);
        });
      } catch (error) {
        failure ||= error;
        if (error.name !== 'AbortError') status('A scene request failed. Waiting for any already submitted clip request to settle…');
      }
    }
  }
  await Promise.all([runner(), runner()]);
  if (failure) throw failure;
  return clips;
}

function loadVideo(blob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl;
    video.oncanplay = () => resolve({ video, objectUrl });
    video.onerror = () => { URL.revokeObjectURL(objectUrl); reject(Error('A generated clip could not be decoded in this browser.')); };
    video.load();
  });
}
function drawVideo(video) {
  ctx.fillStyle = '#080b14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!video || video.readyState < 2) return;
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  ctx.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}
function renderTimeline(clips, beats, audioBuffer, audioContext) {
  return new Promise((resolve, reject) => {
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);
    const dimensions = $('video-layout').value === '9:16' ? [720, 1280] : [1280, 720];
    [canvas.width, canvas.height] = dimensions;
    canvas.hidden = false;
    const stream = canvas.captureStream(24);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const recorder = new window.MediaRecorder(stream, { mimeType: recorderMime, videoBitsPerSecond: 5_000_000 });
    activeRecorder = recorder;
    const parts = [];
    let completed = false;
    let currentVideo = null;
    const fail = (error) => {
      if (completed) return;
      completed = true;
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      reject(error);
    };
    const recorded = new Promise((done, failRecording) => {
      recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
      recorder.onerror = () => failRecording(Error('Your browser could not encode this video. Try a current Safari, Chrome, or Edge browser.'));
      recorder.onstop = () => done(new Blob(parts, { type: recorder.mimeType }));
    });
    recorded.catch(() => {});
    recorder.start(500);
    source.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const totalWords = beats.reduce((sum, beat) => sum + beat.wordCount, 0);
    const totalDuration = audioBuffer.duration;
    source.start();
    const started = audioContext.currentTime;
    const drawFrame = () => {
      if (activeController?.signal.aborted) { fail(new DOMException('Cancelled', 'AbortError')); return; }
      drawVideo(currentVideo);
      $('render-progress').value = Math.min(99, 70 + ((audioContext.currentTime - started) / totalDuration) * 29);
      animationFrame = requestAnimationFrame(drawFrame);
    };
    animationFrame = requestAnimationFrame(drawFrame);
    (async () => {
      let timeline = started;
      for (let index = 0; index < clips.length; index++) {
        if (activeController?.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        currentVideo = clips[index].video;
        currentVideo.currentTime = 0;
        const segmentDuration = totalDuration * beats[index].wordCount / totalWords;
        currentVideo.playbackRate = Math.max(0.5, Math.min(2, currentVideo.duration / segmentDuration));
        await currentVideo.play();
        timeline += segmentDuration;
        while (audioContext.currentTime < timeline) {
          if (activeController?.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          await new Promise((nextFrame) => requestAnimationFrame(nextFrame));
        }
        currentVideo.pause();
      }
      if (audioContext.currentTime < started + totalDuration) await wait((started + totalDuration - audioContext.currentTime) * 1_000, activeController.signal);
      currentVideo?.pause();
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 150);
      const result = await recorded;
      if (completed) return;
      completed = true;
      stream.getTracks().forEach((track) => track.stop());
      if (!result.size) reject(Error('Your browser returned an empty video. Please try again.'));
      else resolve(result);
    })().catch(fail);
  });
}

function safeFileName(title, mime) {
  const clean = title.normalize('NFKD').replace(/[^A-Za-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'Story';
  return `StoryVerse-${clean}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
}
function showResult(blob, project) {
  renderBlob = blob;
  renderUrl = URL.createObjectURL(blob);
  renderName = safeFileName(project.title, blob.type);
  const player = $('rendered-video');
  player.src = renderUrl;
  player.hidden = false;
  $('save-video').disabled = false;
  const file = new File([blob], renderName, { type: blob.type.split(';')[0] });
  $('share-video').disabled = !(navigator.share && navigator.canShare?.({ files: [file] }));
  const format = blob.type.includes('mp4') ? 'MP4' : 'WebM';
  $('format-note').textContent = `${format} · AI-generated moving footage + clean voiceover · no subtitles. Review before sharing; captions can be added later in your social app.`;
}

$('video-model').addEventListener('change', () => { clearOutput(); updateEstimate(); });
$('video-layout').addEventListener('change', () => { clearOutput(); updateEstimate(); });
$('cost-acknowledged').addEventListener('change', updateEstimate);
// Keep the estimate in step with edits made anywhere in the studio.
const refreshEstimate = () => { if (!document.querySelector('[data-panel="4"]').hidden && !videoModelsLoading) updateEstimate(); };
window.addEventListener('storyverse:step', refreshEstimate);
window.addEventListener('storyverse:change', refreshEstimate);

$('render-video').addEventListener('click', async () => {
  if (working) return;
  const project = getProject();
  if (videoModelsLoading) { status('Video model choices are still loading. Try again in a moment.'); return; }
  if (videoModelsLoadFailed) { status('Video model choices could not be loaded. Refresh the page and try again.'); return; }
  const model = videoModels.get($('video-model').value);
  if (!project.approved) { status('Approve your story and scenes before rendering.'); return; }
  if (!model?.available) { status('Connect the Gemini server key to enable AI video and voiceover.'); return; }
  if (!$('cost-acknowledged').checked) { status('Review the estimate and check the acknowledgment before generating.'); return; }
  if (!recorderMime || typeof canvas.captureStream !== 'function' || !ctx || typeof window.MediaRecorder !== 'function') { status('This browser cannot render video. Try an up-to-date desktop Chrome, Edge, or Safari browser.'); return; }
  let beats;
  try { beats = makeBeats(project); } catch (error) { status(error.message); return; }
  const limitProblem = exportLimitProblem(project, beats);
  if (limitProblem) { status(limitProblem); return; }
  clearOutput();
  renderSnapshot = projectSnapshot();
  activeController = new AbortController();
  setBusy(true);
  $('render-progress').hidden = false;
  $('render-progress').max = beats.length;
  $('render-progress').value = 0;
  let audioContext;
  let narratorRequestStarted = false;
  let videoSubmissionStarted = false;
  let acceptedVideoJobs = 0;
  let loadedClips = [];
  try {
    if (document.hidden) throw Error('Keep the StoryVerse tab visible before starting generation.');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw Error('Audio rendering is unavailable in this browser.');
    audioContext = new AudioContextClass();
    await audioContext.resume();
    status('Creating cinematic video clips…');
    const clips = await generateClips(beats, project, model.id, activeController.signal,
      () => { videoSubmissionStarted = true; },
      () => { acceptedVideoJobs++; });
    if (activeController.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    narratorRequestStarted = true;
    const voiceBlob = await generateVoiceover(project, activeController.signal);
    if (activeController.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    status('Preparing video and narrator tracks for the final render…');
    const audioBuffer = await audioContext.decodeAudioData(await voiceBlob.arrayBuffer());
    if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration < 1 || audioBuffer.duration > project.minutes * 60 + 30) throw Error('The generated narrator duration did not fit the selected story length.');
    loadedClips = await Promise.all(clips.map(loadVideo));
    status('Rendering the complete story with synchronized AI voiceover…');
    $('render-progress').max = 100;
    $('render-progress').value = 70;
    const result = await renderTimeline(loadedClips, beats, audioBuffer, audioContext);
    if (activeController.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    showResult(result, project);
    $('render-progress').value = 100;
    status('Your realistic video and narrator are ready. Play it back to review before downloading or sharing.');
  } catch (error) {
    clearOutput();
    const suffix = acceptedVideoJobs > 0
      ? ` ${acceptedVideoJobs} video job${acceptedVideoJobs === 1 ? ' was' : 's were'} accepted by Google and may still finish and be billed.${narratorRequestStarted ? ' The separate narrator request may also be billed.' : ''}`
      : videoSubmissionStarted && error.noVideoJobAccepted
        ? ` Google rejected the video request before accepting a clip. No video job was created.${narratorRequestStarted ? ' The separate narrator request may still be billed.' : ' No narrator request was submitted.'}`
        : videoSubmissionStarted
          ? ` Google may have received a video request without returning a job ID. Check API usage before retrying.${narratorRequestStarted ? ' The separate narrator request may also be billed.' : ' No narrator request was submitted.'}`
          : narratorRequestStarted ? ' No video clips were submitted. The narrator request may still be billed if Google received it.' : '';
    status(`${error.message || 'Video export failed.'}${suffix}`);
  } finally {
    cancelAnimationFrame(animationFrame);
    loadedClips.forEach(({ video, objectUrl }) => { video.pause(); video.removeAttribute('src'); URL.revokeObjectURL(objectUrl); });
    if (audioContext) await audioContext.close().catch(() => {});
    activeRecorder = null;
    activeController = null;
    canvas.hidden = true;
    setBusy(false);
  }
});

$('cancel-render').addEventListener('click', () => {
  if (!activeController) return;
  activeController.abort();
  if (activeRecorder?.state === 'recording') activeRecorder.stop();
  status('Stopping browser work. Video jobs already submitted may continue on Google and may still be billed.');
});
function outputIsCurrent() {
  if (!renderBlob || renderSnapshot !== projectSnapshot()) { clearOutput(); status('Your story changed. Generate a new video for the updated project.'); return false; }
  return true;
}
$('save-video').addEventListener('click', () => {
  if (!outputIsCurrent()) return;
  const link = document.createElement('a');
  link.href = renderUrl; link.download = renderName; link.click();
  status('Video download requested. Check your browser downloads or save menu.');
});
$('share-video').addEventListener('click', async () => {
  if (!outputIsCurrent()) return;
  const file = new File([renderBlob], renderName, { type: renderBlob.type.split(';')[0] });
  try {
    if (!navigator.canShare?.({ files: [file] })) throw Error('File sharing is unavailable here. Download the video and upload it in your social app.');
    await navigator.share({ files: [file], title: getProject().title });
    status('Video handed to the selected app. Complete and verify publishing there.');
  } catch (error) { status(error.name === 'AbortError' ? 'Sharing cancelled. Your video is still available.' : error.message); }
});
window.addEventListener('pagehide', () => { activeController?.abort(); if (activeRecorder?.state === 'recording') activeRecorder.stop(); if (renderUrl) URL.revokeObjectURL(renderUrl); });
if (!recorderMime || typeof canvas.captureStream !== 'function' || !ctx) status('This browser cannot record video. You can still download your project brief.');
