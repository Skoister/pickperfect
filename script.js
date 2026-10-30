(() => {
  'use strict';
  const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/VG2YBc4Ab/';
  const LABELS = ['Unripe', 'Ripe', 'Overripe'];
  const STORAGE_KEY = 'pickperfect.savedScans.v1';
  const $ = (id) => document.getElementById(id);
  let model = null, stream = null, cameraTimer = null, currentPrediction = null;
  let currentSource = null, currentImageUrl = null, lastSavedSignature = null, savedThisItem = false;
  let savedScans = loadScans();

  function loadScans() {
    try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch (_) { return []; }
  }
  function persistScans() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedScans)); } catch (_) { setInputStatus('Could not save history in this browser.'); } }
  function setInputStatus(message) { $('inputStatus').textContent = message; }
  function setModelStatus(message, ready = false) {
    $('modelStatus').textContent = message;
    $('heroStatus').textContent = ready ? 'MODEL READY' : 'CONNECTING';
    $('heroStatus').classList.toggle('ready', ready);
    $('modelPill').textContent = ready ? 'MODEL READY' : 'MODEL LOADING';
    $('modelPill').classList.toggle('ready', ready);
  }
  async function loadModel() {
    try {
      if (!window.tmImage || !window.tf) throw new Error('The model libraries did not load. Check your internet connection and reload.');
      model = await tmImage.load(MODEL_URL + 'model.json', MODEL_URL + 'metadata.json');
      setModelStatus('Connected to Teachable Machine', true);
      setInputStatus('Model ready. Upload a photo or start your camera.');
    } catch (err) {
      setModelStatus('Model unavailable');
      $('modelPill').textContent = 'MODEL ERROR';
      setInputStatus(err.message || 'Unable to load model. Check your connection.');
    }
  }
  function normalizePredictions(predictions) {
    const byName = new Map(predictions.map(p => [String(p.className).toLowerCase(), Number(p.probability)]));
    return LABELS.map(label => ({ className: label, probability: Number.isFinite(byName.get(label.toLowerCase())) ? byName.get(label.toLowerCase()) : 0 }));
  }
  function adviceFor(label, confidence) {
    const notes = {
      Unripe: 'The model classified this fruit as unripe. Let it ripen at room temperature when appropriate for the fruit, then check it again. Ripening needs vary by fruit.',
      Ripe: 'The model classified this fruit as ripe. It may be ready to enjoy. Handle gently and refrigerate if that is appropriate for this type of fruit and you want to slow further ripening.',
      Overripe: 'The model classified this fruit as overripe. Check for mold, unusual odor, leaking, or other spoilage before use. If it is still safe and suitable, consider cooking; otherwise compost where accepted.'
    };
    return notes[label] + (confidence < 0.8 ? ' Confidence is below 80%, so treat this result as uncertain and verify it yourself.' : '');
  }
  function updatePrediction(predictions, source) {
    const ordered = normalizePredictions(predictions).sort((a,b) => b.probability - a.probability);
    const top = ordered[0];
    currentPrediction = { label: top.className, confidence: top.probability, scores: Object.fromEntries(ordered.map(p => [p.className, p.probability])), source };
    currentSource = source;
    $('primaryClass').textContent = top.className;
    $('topConfidence').textContent = `${(top.probability * 100).toFixed(1)}%`;
    $('resultMessage').textContent = top.probability < .8 ? 'Low-confidence classification. Please verify visually.' : 'Classification returned by your Teachable Machine model.';
    $('generalAdvice').textContent = adviceFor(top.className, top.probability);
    $('uncertainMessage').classList.toggle('hidden', top.probability >= .8);
    LABELS.forEach(label => {
      const score = currentPrediction.scores[label] || 0;
      $(label.toLowerCase() + 'Value').textContent = `${(score * 100).toFixed(1)}%`;
      $(label.toLowerCase() + 'Bar').style.width = `${Math.max(0, Math.min(100, score * 100))}%`;
    });
    $('saveScan').disabled = savedThisItem;
    updateBinFeedback();
  }
  async function predictImage(image) {
    if (!model) { setInputStatus('The model is not ready yet. Check your internet connection.'); return; }
    try {
      setInputStatus('Analyzing image…');
      const predictions = await model.predict(image);
      updatePrediction(predictions, 'Image upload');
      setInputStatus('Prediction complete. Save this scan if you want to add it to history.');
    } catch (err) { setInputStatus('Could not analyze this image. Try another photo.'); console.error(err); }
  }
  async function predictCameraFrame() {
    if (!model || !stream || $('cameraVideo').readyState < 2) return;
    try {
      const predictions = await model.predict($('cameraVideo'));
      updatePrediction(predictions, 'Live camera');
      setInputStatus('Live prediction updating. Camera frames are not saved automatically.');
    } catch (err) { console.error('Camera prediction failed:', err); }
  }
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setInputStatus('Camera access is unavailable. Open this site on HTTPS or localhost in a supported browser.'); return; }
    try {
      stopCamera(false);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      $('cameraVideo').srcObject = stream;
      $('cameraVideo').classList.remove('hidden');
      $('cameraPlaceholder').classList.add('hidden');
      $('startCamera').disabled = true; $('stopCamera').disabled = false;
      await $('cameraVideo').play();
      setInputStatus('Camera is on. Point it at one fruit; predictions update automatically.');
      await predictCameraFrame();
      cameraTimer = window.setInterval(predictCameraFrame, 1200);
    } catch (err) {
      setInputStatus(err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings.' : `Could not start camera: ${err.message}`);
      stopCamera(false);
    }
  }
  function stopCamera(updateStatus = true) {
    if (cameraTimer) { clearInterval(cameraTimer); cameraTimer = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    $('cameraVideo').srcObject = null;
    $('cameraVideo').classList.add('hidden');
    $('cameraPlaceholder').classList.remove('hidden');
    $('startCamera').disabled = false; $('stopCamera').disabled = true;
    if (updateStatus) setInputStatus('Camera stopped. Your last result remains until you choose Next Item.');
  }
  function updateBinFeedback() {
    const chosen = $('binSelect').value;
    const box = $('binFeedback');
    box.className = 'bin-feedback';
    if (!currentPrediction || !chosen) { box.textContent = 'Run a scan and choose a bin to see demo feedback.'; return; }
    // Demonstration-only rule set: edible unripe/ripe fruit is kept for later/eating; overripe fruit goes to organics if accepted.
    const correct = currentPrediction.label === 'Overripe' ? chosen === 'compost' : chosen === 'keep';
    if (correct) {
      box.classList.add('good');
      box.textContent = currentPrediction.label === 'Overripe' ? 'Correct under DEMO BIN RULES: overripe fruit goes to Compost / Organics if your local program accepts it.' : 'Correct under DEMO BIN RULES: keep this fruit to ripen or eat while it is in good condition.';
    } else {
      box.classList.add('bad');
      box.textContent = 'Not the recommended choice under DEMO BIN RULES. Check local collection guidance; real acceptance rules vary by municipality.';
    }
  }
  function renderHistory() {
    $('totalCount').textContent = savedScans.length;
    $('countUnripe').textContent = savedScans.filter(s => s.label === 'Unripe').length;
    $('countRipe').textContent = savedScans.filter(s => s.label === 'Ripe').length;
    $('countOverripe').textContent = savedScans.filter(s => s.label === 'Overripe').length;
    $('undoScan').disabled = savedScans.length === 0;
    const list = $('historyList');
    if (!savedScans.length) {
      list.innerHTML = '<div class="empty-history"><span>◷</span><b>No scans saved yet</b><p>Your saved fruit scans will appear here. Camera frames are never logged automatically.</p></div>';
      return;
    }
    list.replaceChildren();
    savedScans.slice().reverse().forEach(scan => {
      const row = document.createElement('article'); row.className = 'history-item';
      const detail = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = scan.label;
      const date = document.createElement('small'); date.textContent = `${new Date(scan.time).toLocaleString()} · ${scan.source}`;
      detail.append(title, date);
      const score = document.createElement('span'); score.className = 'history-score'; score.textContent = `${(scan.confidence * 100).toFixed(1)}%`;
      const bin = document.createElement('span'); bin.className = 'history-bin'; bin.textContent = `Bin: ${scan.bin || 'Not selected'}`;
      row.append(detail, score, bin); list.append(row);
    });
  }
  function saveScan() {
    if (!currentPrediction) return;
    const signature = `${currentPrediction.label}|${currentPrediction.confidence.toFixed(4)}|${currentPrediction.source}`;
    if (savedThisItem || signature === lastSavedSignature) { setInputStatus('This item has already been saved. Use Next Item before saving another scan.'); return; }
    const scan = { id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()), time: new Date().toISOString(), label: currentPrediction.label, confidence: currentPrediction.confidence, scores: currentPrediction.scores, source: currentPrediction.source, bin: $('binSelect').selectedOptions[0]?.textContent || '' };
    savedScans.push(scan); persistScans(); renderHistory(); lastSavedSignature = signature; savedThisItem = true;
    $('saveScan').disabled = true;
    setInputStatus('Scan saved to this browser.');
  }
  function nextItem() {
    stopCamera(false);
    currentPrediction = null; currentSource = null; currentImageUrl = null; lastSavedSignature = null; savedThisItem = false;
    $('imageInput').value = ''; $('imagePreview').removeAttribute('src'); $('imagePreviewWrap').classList.add('hidden');
    $('primaryClass').textContent = 'Waiting for scan'; $('topConfidence').textContent = '—'; $('resultMessage').textContent = 'Choose an image or start the camera to begin.';
    $('generalAdvice').textContent = 'A prediction will provide practical guidance here. Always check the fruit\'s smell, texture, and visible condition yourself.';
    $('uncertainMessage').classList.add('hidden'); $('binSelect').value = ''; updateBinFeedback();
    LABELS.forEach(label => { $(label.toLowerCase() + 'Value').textContent = '—'; $(label.toLowerCase() + 'Bar').style.width = '0%'; });
    $('saveScan').disabled = true; setInputStatus('Ready for the next fruit.');
  }
  function undoLast() { if (!savedScans.length) return; savedScans.pop(); persistScans(); renderHistory(); lastSavedSignature = null; savedThisItem = false; $('saveScan').disabled = !currentPrediction; setInputStatus('Last saved scan removed.'); }
  function switchMode(mode) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    $('uploadArea').classList.toggle('hidden', mode !== 'upload'); $('cameraArea').classList.toggle('hidden', mode !== 'camera');
    if (mode !== 'camera') stopCamera(false);
  }
  const dropZone = $('uploadArea');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', event => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) { setInputStatus('Drop an image file to scan it.'); return; }
    const transfer = new DataTransfer(); transfer.items.add(file); $('imageInput').files = transfer.files; $('imageInput').dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('imageInput').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { setInputStatus('Please choose an image file.'); return; }
    stopCamera(false);
    if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = URL.createObjectURL(file); $('imagePreview').src = currentImageUrl; $('imagePreviewWrap').classList.remove('hidden');
    $('imagePreview').onload = () => predictImage($('imagePreview'));
    $('imagePreview').onerror = () => setInputStatus('This image could not be opened. Try another file.');
  });
  $('clearImage').addEventListener('click', () => { $('imageInput').value = ''; $('imagePreviewWrap').classList.add('hidden'); nextItem(); });
  $('startCamera').addEventListener('click', startCamera); $('stopCamera').addEventListener('click', () => stopCamera());
  $('saveScan').addEventListener('click', saveScan); $('nextItem').addEventListener('click', nextItem); $('undoScan').addEventListener('click', undoLast); $('binSelect').addEventListener('change', updateBinFeedback);
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
  $('menuToggle').addEventListener('click', () => { const nav = document.querySelector('.desktop-nav'); const open = nav.classList.toggle('open'); $('menuToggle').setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('.desktop-nav a').forEach(link => link.addEventListener('click', () => { document.querySelector('.desktop-nav').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded', 'false'); }));
  window.addEventListener('beforeunload', () => { stopCamera(false); if (currentImageUrl) URL.revokeObjectURL(currentImageUrl); });
  renderHistory();
  window.addEventListener('load', loadModel);
})();
