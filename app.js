const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const fileCard    = document.getElementById('fileCard');
const fileName    = document.getElementById('fileName');
const fileSize    = document.getElementById('fileSize');
const clearBtn    = document.getElementById('clearBtn');
const settingsCard= document.getElementById('settingsCard');
const convertBtn  = document.getElementById('convertBtn');
const progressCard= document.getElementById('progressCard');
const progressBar = document.getElementById('progressBar');
const progressPct = document.getElementById('progressPct');
const progressTitle= document.getElementById('progressTitle');
const progressSub = document.getElementById('progressSub');
const resultCard  = document.getElementById('resultCard');
const origSize    = document.getElementById('origSize');
const newSize     = document.getElementById('newSize');
const savingPct   = document.getElementById('savingPct');
const downloadBtn = document.getElementById('downloadBtn');
const convertAnotherBtn = document.getElementById('convertAnotherBtn');
const qualitySlider = document.getElementById('quality');
const qualityLabel  = document.getElementById('qualityLabel');

const qualityMap = { 1:'เล็กสุด', 2:'ปานกลาง', 3:'ดี', 4:'สูงสุด' };
qualitySlider.addEventListener('input', () => {
  qualityLabel.textContent = qualityMap[qualitySlider.value];
});

let selectedFile = null;
let ffmpeg = null;
let outputURL = null;

/* ─── Drag & Drop ─── */
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) setFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(f) {
  selectedFile = f;
  fileName.textContent = f.name;
  fileSize.textContent = fmtBytes(f.size);
  fileCard.classList.remove('hidden');
  settingsCard.classList.remove('hidden');
  document.getElementById('uploadCard').classList.add('hidden');
}

clearBtn.addEventListener('click', reset);

function reset() {
  selectedFile = null;
  fileInput.value = '';
  if (outputURL) { URL.revokeObjectURL(outputURL); outputURL = null; }
  ['fileCard','settingsCard','progressCard','resultCard'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.getElementById('uploadCard').classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPct.textContent = '0%';
}

convertAnotherBtn.addEventListener('click', reset);

/* ─── Convert ─── */
convertBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  const format  = document.querySelector('input[name="format"]:checked').value;
  const quality = parseInt(qualitySlider.value);
  const res     = document.getElementById('resolution').value;
  const fps     = document.getElementById('fps').value;

  settingsCard.classList.add('hidden');
  progressCard.classList.remove('hidden');

  try {
    await runConvert(format, quality, res, fps);
  } catch (err) {
    ffmpeg = null;
    progressCard.classList.add('hidden');
    settingsCard.classList.remove('hidden');
    const msg = err?.message || String(err) || 'ไม่ทราบสาเหตุ';
    showError(msg);
  }
});

function showError(msg) {
  if (!crossOriginIsolated) {
    msg = 'เบราว์เซอร์ไม่รองรับ SharedArrayBuffer (Cross-Origin Isolation)\n\nวิธีแก้: เปิดเว็บผ่าน MAMP ที่ http://localhost/videoConv/ แทน หรือ deploy ขึ้น GitHub Pages';
  }
  alert('เกิดข้อผิดพลาด:\n\n' + msg);
}

async function runConvert(format, quality, res, fps) {
  if (!crossOriginIsolated) {
    throw new Error('SharedArrayBuffer ไม่พร้อมใช้งาน');
  }

  if (!ffmpeg) {
    progressTitle.textContent = 'กำลังโหลด FFmpeg...';
    progressSub.textContent = 'ครั้งแรกอาจใช้เวลาสักครู่';
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      const match = message.match(/time=(\d+:\d+:\d+)/);
      if (match) progressSub.textContent = 'เวลา: ' + match[1];
    });
    ffmpeg.on('progress', ({ progress }) => {
      const p = Math.round(Math.min(progress, 1) * 100);
      progressBar.style.width = p + '%';
      progressPct.textContent = p + '%';
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  }

  progressTitle.textContent = 'กำลังแปลงไฟล์...';
  progressSub.textContent = 'กรุณารอสักครู่';
  progressBar.style.width = '0%';
  progressPct.textContent = '0%';

  const ext = format === 'mp4' ? 'mp4' : 'webm';
  const inName  = 'input.' + selectedFile.name.split('.').pop();
  const outName = 'output.' + ext;

  await ffmpeg.writeFile(inName, await fetchFile(selectedFile));

  const args = buildArgs(inName, outName, format, quality, res, fps);
  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(outName);
  const blob = new Blob([data.buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });

  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = URL.createObjectURL(blob);

  const baseName = selectedFile.name.replace(/\.[^.]+$/, '');
  downloadBtn.href = outputURL;
  downloadBtn.download = baseName + '_converted.' + ext;

  origSize.textContent = fmtBytes(selectedFile.size);
  newSize.textContent  = fmtBytes(blob.size);
  const saved = ((selectedFile.size - blob.size) / selectedFile.size * 100);
  savingPct.textContent = saved > 0 ? '-' + saved.toFixed(1) + '%' : '+' + Math.abs(saved).toFixed(1) + '%';

  await ffmpeg.deleteFile(inName);
  await ffmpeg.deleteFile(outName);

  progressCard.classList.add('hidden');
  resultCard.classList.remove('hidden');
}

function buildArgs(inName, outName, format, quality, res, fps) {
  const args = ['-i', inName];

  /* fps */
  if (fps !== 'original') args.push('-r', fps);

  /* resolution */
  if (res !== 'original') {
    args.push('-vf', `scale=-2:${res}`);
  }

  if (format === 'mp4') {
    /* CRF: quality 1→51, 2→35, 3→23, 4→18 */
    const crf = { 1:'51', 2:'35', 3:'23', 4:'18' }[quality];
    const preset = { 1:'ultrafast', 2:'fast', 3:'medium', 4:'slow' }[quality];
    args.push('-c:v','libx264','-crf',crf,'-preset',preset,'-c:a','aac','-b:a','128k');
  } else {
    /* WebM / VP9 — b:v 0 with crf for quality-based */
    const crf = { 1:'63', 2:'45', 3:'33', 4:'24' }[quality];
    args.push('-c:v','libvpx-vp9','-crf',crf,'-b:v','0','-c:a','libopus','-b:a','128k');
  }

  args.push('-y', outName);
  return args;
}

/* ─── Cross-Origin check ─── */
if (!crossOriginIsolated) {
  document.getElementById('coiBanner').classList.remove('hidden');
}

/* ─── Helpers ─── */
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024**2) return (b/1024).toFixed(1) + ' KB';
  if (b < 1024**3) return (b/1024**2).toFixed(1) + ' MB';
  return (b/1024**3).toFixed(2) + ' GB';
}
