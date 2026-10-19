/**
 * Visual Search Priming Experiment Engine
 * Covers:
 * 1. Configuration parsing & dynamic quadrant/prime setup
 * 2. Visual search presentation (T target rotated 90L/90R, L distractors 4-way rotated)
 * 3. Double prime simultaneous target displays & response attribution
 * 4. Post-trial 1000ms space bar mistake/anomaly reporting
 * 5. Mouse trajectory streaming option
 * 6. CSV generation and Chart.js summary visualizations
 */

// ==========================================
// STATE MANAGEMENT
// ==========================================
const State = {
  config: {
    numTrials: 63,
    setSizeMode: 'preset-3', // 'preset-2', 'preset-3', 'fixed'
    setSizes: [8, 16, 32],
    primeQuadrantCondition: 'different', // 'different' | 'same'
    prime1Interval: 3,
    prime2Interval: 7,
    responseMode: 'keyboard', // 'keyboard' | 'mouse'
    keybindingPreset: 'arrows', // 'arrows' | 'zm' | 'fj'
  },
  keys: {
    leftKey: 'ArrowLeft',
    rightKey: 'ArrowRight',
    leftLabel: '←',
    rightLabel: '→'
  },
  locations: {
    prime1: null, // { row, col, index, quadrant }
    prime2: null  // { row, col, index, quadrant }
  },
  currentTrialIndex: 0,
  trialList: [],
  results: [],
  mouseTrajectories: [], // per trial: { trialIndex, samples: [{t, x, y}] }
  currentTrialStartTime: 0,
  awaitingTrialResponse: false,
  postTrialTimeoutId: null,
  activeTrialMouseTrack: [],
  isModalOpen: false,
  charts: {
    rtCondition: null,
    accCondition: null,
    rtSetSize: null
  },
  questionnaire: {
    currentStep: 0,
    sequence: [], // Array of question definition objects
    answers: {
      q1_oddities: '',
      multi_target_noticed_rating: null,
      multi_target_count_estimate: null,
      prime_location_noticed_rating: null,
      prime_location_clicks_order: [] // Up to 5 cell indices [idx1, idx2, ...]
    }
  }
};

// ==========================================
// SVG GENERATOR (T & L)
// ==========================================
const SVG_ICONS = {
  // Upright T: Stem goes down from center, horizontal bar across top
  // When rotated 90 deg clockwise (rot-90), it points Right
  // When rotated 270 deg (rot-270 / 90L), it points Left
  T: `<svg viewBox="0 0 24 24"><line x1="3" y1="5" x2="21" y2="5"/><line x1="12" y1="5" x2="12" y2="21"/></svg>`,
  // Upright L: Vertical stem along left, horizontal foot along bottom
  L: `<svg viewBox="0 0 24 24"><line x1="5" y1="3" x2="5" y2="19"/><line x1="5" y1="19" x2="19" y2="19"/></svg>`
};

// ==========================================
// INITIALIZATION & UI LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  renderSetSizeConfigInputs();
  setupConfigListeners();
  setupModalListeners();
  setupSummaryButtons();
});

function showSection(sectionId) {
  document.querySelectorAll('.app-section').forEach(sec => sec.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ==========================================
// CONFIGURATION LOGIC
// ==========================================
function setupConfigListeners() {
  const setSizeModeSelect = document.getElementById('set-size-mode');
  setSizeModeSelect.addEventListener('change', () => {
    State.config.setSizeMode = setSizeModeSelect.value;
    renderSetSizeConfigInputs();
  });

  const responseModeSelect = document.getElementById('response-mode');
  const keyboardGroup = document.getElementById('keyboard-config-group');
  const mouseInfo = document.getElementById('mouse-config-info');

  responseModeSelect.addEventListener('change', () => {
    State.config.responseMode = responseModeSelect.value;
    if (State.config.responseMode === 'mouse') {
      keyboardGroup.classList.add('hidden');
      mouseInfo.classList.remove('hidden');
    } else {
      keyboardGroup.classList.remove('hidden');
      mouseInfo.classList.add('hidden');
    }
  });

  document.getElementById('btn-start-experiment').addEventListener('click', () => {
    saveConfigFromUI();
    updateInstructionsUI();
    showSection('section-instructions');
  });

  document.getElementById('btn-begin-trials').addEventListener('click', () => {
    initializeExperiment();
  });

  document.getElementById('btn-next-question').addEventListener('click', () => {
    handleQuestionnaireNext();
  });
}

function updateInstructionsUI() {
  const isMouse = (State.config.responseMode === 'mouse');
  const reminderBox = document.getElementById('instr-keys-reminder-box');
  const leftKeyBadge = document.getElementById('instr-key-left');
  const rightKeyBadge = document.getElementById('instr-key-right');
  const reminderKeysText = document.getElementById('instr-reminder-keys-text');

  if (isMouse) {
    leftKeyBadge.textContent = 'Click on Target';
    rightKeyBadge.textContent = 'Click on Target';
    reminderBox.innerHTML = `
      <div class="reminder-icon">🖱️</div>
      <div>
        <strong>Mouse Response Reminder:</strong>
        <p>Please keep your hand on your mouse. Click directly on the target <strong>T</strong> as quickly and accurately as possible.</p>
      </div>
    `;
  } else {
    leftKeyBadge.textContent = State.keys.leftLabel;
    rightKeyBadge.textContent = State.keys.rightLabel;
    reminderBox.innerHTML = `
      <div class="reminder-icon">👉</div>
      <div>
        <strong>Finger Placement Reminder:</strong>
        <p>Please place your fingers on the <span id="instr-reminder-keys-text"><strong>${State.keys.leftLabel}</strong> and <strong>${State.keys.rightLabel}</strong></span> keys now so you are ready to respond as quickly and accurately as possible.</p>
      </div>
    `;
  }
}

function renderSetSizeConfigInputs() {
  const container = document.getElementById('set-size-values-container');
  const mode = document.getElementById('set-size-mode').value;
  container.innerHTML = '';

  let html = '';
  if (mode === 'preset-2') {
    html = `
      <div class="form-grid-2">
        <div class="input-with-hint">
          <label for="set-size-1">Set Size 1 (2 – 144):</label>
          <input type="number" id="set-size-1" min="2" max="144" value="16" required>
        </div>
        <div class="input-with-hint">
          <label for="set-size-2">Set Size 2 (2 – 144):</label>
          <input type="number" id="set-size-2" min="2" max="144" value="32" required>
        </div>
      </div>
    `;
  } else if (mode === 'preset-3') {
    html = `
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
        <div class="input-with-hint">
          <label for="set-size-1">Set Size 1:</label>
          <input type="number" id="set-size-1" min="2" max="144" value="8" required>
        </div>
        <div class="input-with-hint">
          <label for="set-size-2">Set Size 2:</label>
          <input type="number" id="set-size-2" min="2" max="144" value="16" required>
        </div>
        <div class="input-with-hint">
          <label for="set-size-3">Set Size 3:</label>
          <input type="number" id="set-size-3" min="2" max="144" value="32" required>
        </div>
      </div>
    `;
  } else {
    // Fixed Single Set Size
    html = `
      <div class="input-with-hint">
        <label for="set-size-fixed">Uniform Set Size for All Trials (2 – 144):</label>
        <input type="number" id="set-size-fixed" min="2" max="144" value="24" required>
        <span class="hint">Every trial will have this exact number of items.</span>
      </div>
    `;
  }
  container.innerHTML = html;
}

function saveConfigFromUI() {
  State.config.numTrials = parseInt(document.getElementById('num-trials').value, 10) || 63;
  State.config.primeQuadrantCondition = document.getElementById('prime-quadrant-condition').value;
  State.config.prime1Interval = parseInt(document.getElementById('prime1-interval').value, 10) || 3;
  State.config.prime2Interval = parseInt(document.getElementById('prime2-interval').value, 10) || 7;
  State.config.responseMode = document.getElementById('response-mode').value;
  State.config.keybindingPreset = document.getElementById('keybinding-preset').value;

  // Extract set sizes
  const mode = State.config.setSizeMode;
  if (mode === 'preset-2') {
    const s1 = parseInt(document.getElementById('set-size-1').value, 10) || 16;
    const s2 = parseInt(document.getElementById('set-size-2').value, 10) || 32;
    State.config.setSizes = [s1, s2];
  } else if (mode === 'preset-3') {
    const s1 = parseInt(document.getElementById('set-size-1').value, 10) || 8;
    const s2 = parseInt(document.getElementById('set-size-2').value, 10) || 16;
    const s3 = parseInt(document.getElementById('set-size-3').value, 10) || 32;
    State.config.setSizes = [s1, s2, s3];
  } else {
    const sFixed = parseInt(document.getElementById('set-size-fixed').value, 10) || 24;
    State.config.setSizes = [sFixed];
  }

  // Set Keybindings
  if (State.config.keybindingPreset === 'arrows') {
    State.keys = { leftKey: 'ArrowLeft', rightKey: 'ArrowRight', leftLabel: '← Left Arrow', rightLabel: '→ Right Arrow' };
  } else if (State.config.keybindingPreset === 'zm') {
    State.keys = { leftKey: 'KeyZ', rightKey: 'KeyM', leftLabel: 'Z', rightLabel: 'M' };
  } else {
    State.keys = { leftKey: 'KeyF', rightKey: 'KeyJ', leftLabel: 'F', rightLabel: 'J' };
  }

  // Update Experiment HUD instructions
  if (State.config.responseMode === 'keyboard') {
    document.getElementById('exp-controls-reminder').innerHTML = 
      `Press [<span>${State.keys.leftLabel}</span>] for Left or [<span>${State.keys.rightLabel}</span>] for Right`;
  } else {
    document.getElementById('exp-controls-reminder').innerHTML = 
      `Click directly on the target [<span>T</span>] with your mouse`;
  }
}

// ==========================================
// GRID GEOMETRY & PRIME LOCATIONS
// 12x12 Grid: 144 cells total.
// Coordinate System:
//   Origin (1, 1) is at the BOTTOM-LEFT.
//   Col 1..12 goes Left -> Right.
//   Row 1..12 goes Bottom -> Top.
//
// Visual display DOM index:
//   DOM row (0..11, Top -> Bottom), DOM col (0..11, Left -> Right).
//   domRow = 12 - row;  domCol = col - 1;
//   index = domRow * 12 + domCol;
//
// Central 16 cells (excluded from prime selection):
//   Rows 5..8 and Cols 5..8.
//
// Quadrants (with 1,1 at bottom-left):
//   Q1 (Bottom-Left):  Rows 1..6,  Cols 1..6
//   Q2 (Bottom-Right): Rows 1..6,  Cols 7..12
//   Q3 (Top-Left):     Rows 7..12, Cols 1..6
//   Q4 (Top-Right):    Rows 7..12, Cols 7..12
// ==========================================
function getCellFromCoords(row, col) {
  // row: 1..12 (1 = bottom), col: 1..12 (1 = left)
  const domRow = 12 - row;
  const domCol = col - 1;
  const index = domRow * 12 + domCol;
  const isCenter16 = (row >= 5 && row <= 8 && col >= 5 && col <= 8);

  let quadrant = 'bottom_left';
  if (row <= 6 && col <= 6) quadrant = 'bottom_left';
  else if (row <= 6 && col > 6) quadrant = 'bottom_right';
  else if (row > 6 && col <= 6) quadrant = 'top_left';
  else quadrant = 'top_right';

  return { row, col, domRow, domCol, index, isCenter16, quadrant };
}

function getCellFromIndex(index) {
  const domRow = Math.floor(index / 12);
  const domCol = index % 12;
  const row = 12 - domRow; // 1 = bottom, 12 = top
  const col = domCol + 1;  // 1 = left, 12 = right
  return getCellFromCoords(row, col);
}

function getOppositeQuadrant(quadrant) {
  // Diagonal opposites:
  // bottom_left <-> top_right
  // bottom_right <-> top_left
  switch (quadrant) {
    case 'bottom_left': return 'top_right';
    case 'top_right': return 'bottom_left';
    case 'bottom_right': return 'top_left';
    case 'top_left': return 'bottom_right';
    default: return 'top_right';
  }
}

function selectPrimeLocations(condition) {
  // Collect all eligible cells outside the central 16
  const eligibleCells = [];
  for (let r = 1; r <= 12; r++) {
    for (let c = 1; c <= 12; c++) {
      const cell = getCellFromCoords(r, c);
      if (!cell.isCenter16) {
        eligibleCells.push(cell);
      }
    }
  }

  // 1. Pick Prime 1 randomly from all eligible cells
  const prime1 = eligibleCells[Math.floor(Math.random() * eligibleCells.length)];

  // 2. Pick Prime 2 according to quadrant condition
  let eligibleForPrime2 = [];
  if (condition === 'same') {
    eligibleForPrime2 = eligibleCells.filter(c => c.quadrant === prime1.quadrant && c.index !== prime1.index);
  } else {
    // Different quadrant: diagonally opposite quadrant
    const targetQ = getOppositeQuadrant(prime1.quadrant);
    eligibleForPrime2 = eligibleCells.filter(c => c.quadrant === targetQ);
  }

  const prime2 = eligibleForPrime2[Math.floor(Math.random() * eligibleForPrime2.length)];
  return { prime1, prime2 };
}

// ==========================================
// TRIAL GENERATION & CLASSIFICATION
// ==========================================
function generateTrialList() {
  const { numTrials, prime1Interval, prime2Interval, setSizes } = State.config;
  const trials = [];

  for (let t = 1; t <= numTrials; t++) {
    const isPrime1 = (t % prime1Interval === 0);
    const isPrime2 = (t % prime2Interval === 0);

    let trialType = 'random';
    if (isPrime1 && isPrime2) {
      trialType = 'double_prime';
    } else if (isPrime1) {
      trialType = 'prime_1';
    } else if (isPrime2) {
      trialType = 'prime_2';
    }

    // Random set size drawn from config
    const setSize = setSizes[Math.floor(Math.random() * setSizes.length)];

    // Target orientation: 90L (rot-270) or 90R (rot-90)
    const targetOrientation = Math.random() < 0.5 ? 'left' : 'right';

    trials.push({
      trialNumber: t,
      trialType,
      setSize,
      targetOrientation, // For double prime, this is target1; target2 will be opposite
    });
  }

  return trials;
}

// ==========================================
// EXPERIMENT EXECUTION & ENGINE
// ==========================================
function initializeExperiment() {
  State.locations = selectPrimeLocations(State.config.primeQuadrantCondition);
  State.trialList = generateTrialList();
  State.currentTrialIndex = 0;
  State.results = [];
  State.mouseTrajectories = [];

  document.getElementById('exp-total-trials').textContent = State.config.numTrials;
  showSection('section-experiment');

  // Attach global keyboard and mouse tracking handlers
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('keydown', handleGlobalKeydown);

  const arena = document.getElementById('experiment-arena');
  arena.removeEventListener('mousemove', handleMouseMoveTracking);
  arena.addEventListener('mousemove', handleMouseMoveTracking);

  startTrial(State.currentTrialIndex);
}

function startTrial(index) {
  if (index >= State.trialList.length) {
    finishExperiment();
    return;
  }

  State.currentTrialIndex = index;
  const trial = State.trialList[index];

  // Update HUD
  document.getElementById('exp-current-trial').textContent = index + 1;
  const progressPercent = ((index) / State.trialList.length) * 100;
  document.getElementById('exp-progress-fill').style.width = `${progressPercent}%`;

  // Hide search grid, show fixation cross
  const searchGrid = document.getElementById('search-grid');
  const fixation = document.getElementById('fixation-cross');
  const postPrompt = document.getElementById('post-trial-flag-prompt');

  searchGrid.innerHTML = '';
  postPrompt.classList.add('hidden');
  fixation.classList.remove('hidden');
  State.awaitingTrialResponse = false;
  State.activeTrialMouseTrack = [];

  // 600ms Fixation Cross presentation before search array
  setTimeout(() => {
    fixation.classList.add('hidden');
    renderSearchDisplay(trial);
  }, 600);
}

function renderSearchDisplay(trial) {
  const searchGrid = document.getElementById('search-grid');
  searchGrid.innerHTML = '';

  const totalCells = 144;
  const allIndices = Array.from({ length: totalCells }, (_, i) => i);
  const p1Index = State.locations.prime1.index;
  const p2Index = State.locations.prime2.index;

  // Determine target locations & orientations
  let target1CellIndex = null;
  let target1Orient = trial.targetOrientation;
  let target2CellIndex = null;
  let target2Orient = null;

  if (trial.trialType === 'prime_1') {
    target1CellIndex = p1Index;
  } else if (trial.trialType === 'prime_2') {
    target1CellIndex = p2Index;
  } else if (trial.trialType === 'double_prime') {
    target1CellIndex = p1Index;
    target2CellIndex = p2Index;
    // Opposite orientations for double prime
    target2Orient = (target1Orient === 'left') ? 'right' : 'left';
  } else {
    // Random trial: equal probability across all cells EXCEPT prime 1 and prime 2
    const availableRandomCells = allIndices.filter(idx => idx !== p1Index && idx !== p2Index);
    target1CellIndex = availableRandomCells[Math.floor(Math.random() * availableRandomCells.length)];
  }

  // Determine distractor cells count
  // Total items on screen = setSize
  const targetCount = (trial.trialType === 'double_prime') ? 2 : 1;
  const distractorCount = Math.max(0, trial.setSize - targetCount);

  // Eligible distractor positions: all cells except target cells
  const reservedIndices = new Set([target1CellIndex]);
  if (target2CellIndex !== null) reservedIndices.add(target2CellIndex);

  const availableForDistractors = allIndices.filter(idx => !reservedIndices.has(idx));
  // Shuffle available
  for (let i = availableForDistractors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableForDistractors[i], availableForDistractors[j]] = [availableForDistractors[j], availableForDistractors[i]];
  }
  const distractorIndices = availableForDistractors.slice(0, distractorCount);

  // Store metadata on trial object
  trial.target1Index = target1CellIndex;
  trial.target1Orientation = target1Orient;
  trial.target2Index = target2CellIndex;
  trial.target2Orientation = target2Orient;

  // Create 144 grid cells
  const distractorRotations = [0, 90, 180, 270];

  for (let idx = 0; idx < totalCells; idx++) {
    const cellEl = document.createElement('div');
    cellEl.className = 'grid-cell';
    cellEl.dataset.index = idx;

    if (idx === target1CellIndex) {
      const rotClass = (target1Orient === 'left') ? 'rot-270' : 'rot-90';
      // Subtle random jitter (-4px to +4px) on both X and Y to avoid multicollinearities
      const jitterX = (Math.random() * 8 - 4).toFixed(1);
      const jitterY = (Math.random() * 8 - 4).toFixed(1);
      cellEl.innerHTML = `<div class="search-item ${rotClass}" data-type="target" data-prime-id="prime1" data-orient="${target1Orient}" style="transform: translate(${jitterX}px, ${jitterY}px) ${rotClass === 'rot-270' ? 'rotate(270deg)' : 'rotate(90deg)'};">${SVG_ICONS.T}</div>`;
    } else if (idx === target2CellIndex) {
      const rotClass = (target2Orient === 'left') ? 'rot-270' : 'rot-90';
      const jitterX = (Math.random() * 8 - 4).toFixed(1);
      const jitterY = (Math.random() * 8 - 4).toFixed(1);
      cellEl.innerHTML = `<div class="search-item ${rotClass}" data-type="target" data-prime-id="prime2" data-orient="${target2Orient}" style="transform: translate(${jitterX}px, ${jitterY}px) ${rotClass === 'rot-270' ? 'rotate(270deg)' : 'rotate(90deg)'};">${SVG_ICONS.T}</div>`;
    } else if (distractorIndices.includes(idx)) {
      const randomRot = distractorRotations[Math.floor(Math.random() * distractorRotations.length)];
      const jitterX = (Math.random() * 8 - 4).toFixed(1);
      const jitterY = (Math.random() * 8 - 4).toFixed(1);
      cellEl.innerHTML = `<div class="search-item" data-type="distractor" style="transform: translate(${jitterX}px, ${jitterY}px) rotate(${randomRot}deg);">${SVG_ICONS.L}</div>`;
    }

    if (State.config.responseMode === 'mouse') {
      cellEl.addEventListener('click', (e) => handleMouseTargetClick(e, idx));
    }

    searchGrid.appendChild(cellEl);
  }

  // Record display onset time
  State.currentTrialStartTime = performance.now();
  State.awaitingTrialResponse = true;
}

// ==========================================
// RESPONSE HANDLING
// ==========================================
function handleGlobalKeydown(e) {
  // If modal is open, don't trigger experiment responses
  if (State.isModalOpen) return;

  // Spacebar 1000ms window intercept
  if (e.code === 'Space' && !State.awaitingTrialResponse && State.postTrialTimeoutId) {
    e.preventDefault();
    openMistakeModal();
    return;
  }

  // Keyboard visual search response
  if (!State.awaitingTrialResponse || State.config.responseMode !== 'keyboard') return;

  let chosenOrientation = null;
  if (e.code === State.keys.leftKey) {
    chosenOrientation = 'left';
  } else if (e.code === State.keys.rightKey) {
    chosenOrientation = 'right';
  }

  if (chosenOrientation) {
    e.preventDefault();
    recordTrialResponse({
      responseType: 'keyboard',
      key: e.code,
      chosenOrientation,
      clickedIndex: null
    });
  }
}

function handleMouseMoveTracking(e) {
  if (!State.awaitingTrialResponse || State.config.responseMode !== 'mouse') return;

  const arenaRect = document.getElementById('experiment-arena').getBoundingClientRect();
  const relX = Math.round(e.clientX - arenaRect.left);
  const relY = Math.round(e.clientY - arenaRect.top);
  const relTime = Math.round(performance.now() - State.currentTrialStartTime);

  State.activeTrialMouseTrack.push({ t: relTime, x: relX, y: relY });
}

function handleMouseTargetClick(e, cellIndex) {
  if (!State.awaitingTrialResponse || State.config.responseMode !== 'mouse') return;

  const trial = State.trialList[State.currentTrialIndex];
  let chosenOrientation = null;

  if (cellIndex === trial.target1Index) {
    chosenOrientation = trial.target1Orientation;
  } else if (cellIndex === trial.target2Index) {
    chosenOrientation = trial.target2Orientation;
  } else {
    chosenOrientation = 'none'; // Clicked distractor or empty
  }

  recordTrialResponse({
    responseType: 'mouse',
    key: 'MouseClick',
    chosenOrientation,
    clickedIndex: cellIndex
  });
}

function recordTrialResponse(responseDetails) {
  const rt = Math.round(performance.now() - State.currentTrialStartTime);
  State.awaitingTrialResponse = false;
  const trial = State.trialList[State.currentTrialIndex];

  // Calculate Accuracy & Double Prime Attribution
  let isCorrect = false;
  let doublePrimeChoice = 'N/A';

  if (trial.trialType === 'double_prime') {
    if (responseDetails.chosenOrientation === trial.target1Orientation) {
      isCorrect = true;
      doublePrimeChoice = 'prime_1';
    } else if (responseDetails.chosenOrientation === trial.target2Orientation) {
      isCorrect = true;
      doublePrimeChoice = 'prime_2';
    } else {
      isCorrect = false;
      doublePrimeChoice = 'incorrect_or_miss';
    }
  } else {
    isCorrect = (responseDetails.chosenOrientation === trial.targetOrientation);
    doublePrimeChoice = 'N/A';
  }

  // Convert cell indices to (Row, Col) where (1,1) is bottom-left
  const p1Cell = getCellFromIndex(State.locations.prime1.index);
  const p2Cell = getCellFromIndex(State.locations.prime2.index);
  const t1Cell = getCellFromIndex(trial.target1Index);
  const t2Cell = trial.target2Index !== null ? getCellFromIndex(trial.target2Index) : null;

  // Construct trial log record
  const trialRecord = {
    trial_number: trial.trialNumber,
    trial_type: trial.trialType,
    set_size: trial.setSize,
    prime1_row: p1Cell.row,
    prime1_col: p1Cell.col,
    prime2_row: p2Cell.row,
    prime2_col: p2Cell.col,
    target_row: t1Cell.row,
    target_col: t1Cell.col,
    target_orientation: trial.target1Orientation,
    target2_row: t2Cell ? t2Cell.row : 'N/A',
    target2_col: t2Cell ? t2Cell.col : 'N/A',
    target2_orientation: trial.target2Orientation !== null ? trial.target2Orientation : 'N/A',
    response_mode: State.config.responseMode,
    response_key: responseDetails.key,
    chosen_orientation: responseDetails.chosenOrientation,
    rt_ms: rt,
    accuracy: isCorrect ? 1 : 0,
    double_prime_target_chosen: doublePrimeChoice,
    space_flagged: 0,
    flag_type: '',
    participant_comment: ''
  };

  State.results.push(trialRecord);

  // Save mouse trajectory if mouse mode was active
  if (State.config.responseMode === 'mouse') {
    State.mouseTrajectories.push({
      trialNumber: trial.trialNumber,
      samples: State.activeTrialMouseTrack
    });
  }

  // Clear display and initiate 1000ms Post-trial spacebar monitoring window
  document.getElementById('search-grid').innerHTML = '';
  document.getElementById('post-trial-flag-prompt').classList.remove('hidden');

  State.postTrialTimeoutId = setTimeout(() => {
    document.getElementById('post-trial-flag-prompt').classList.add('hidden');
    State.postTrialTimeoutId = null;
    startTrial(State.currentTrialIndex + 1);
  }, 1000);
}

// ==========================================
// POST-TRIAL MISTAKE / ANOMALY DIALOG
// ==========================================
function openMistakeModal() {
  clearTimeout(State.postTrialTimeoutId);
  State.postTrialTimeoutId = null;
  State.isModalOpen = true;

  document.getElementById('post-trial-flag-prompt').classList.add('hidden');
  document.getElementById('comment-modal').classList.remove('hidden');
  document.getElementById('trial-comment-input').value = '';
  document.getElementById('trial-comment-input').focus();
}

function setupModalListeners() {
  document.getElementById('btn-submit-comment').addEventListener('click', () => {
    const lastResult = State.results[State.results.length - 1];
    if (lastResult) {
      lastResult.space_flagged = 1;
      const checkedRadio = document.querySelector('input[name="anomaly-type"]:checked');
      lastResult.flag_type = checkedRadio ? checkedRadio.value : 'unspecified';
      lastResult.participant_comment = document.getElementById('trial-comment-input').value.replace(/(\r\n|\n|\r|,)/gm, ' ');
    }

    document.getElementById('comment-modal').classList.add('hidden');
    State.isModalOpen = false;

    // Advance to next trial
    startTrial(State.currentTrialIndex + 1);
  });
}

// ==========================================
// EXPERIMENT COMPLETION & QUESTIONNAIRE CONTROLLER
// ==========================================
function finishExperiment() {
  window.removeEventListener('keydown', handleGlobalKeydown);
  const arena = document.getElementById('experiment-arena');
  arena.removeEventListener('mousemove', handleMouseMoveTracking);

  buildQuestionnaireSequence();
  State.questionnaire.currentStep = 0;
  showSection('section-questionnaire');
  renderCurrentQuestion();
}

function buildQuestionnaireSequence() {
  // Question 1: Always first (open-ended oddities)
  const q1 = {
    id: 'q1_oddities',
    title: 'General Observations',
    prompt: 'Did you notice anything odd, unusual, or patterned during the trials? Please describe below:',
    type: 'open_ended'
  };

  // Pair A: Multi-target questions
  const pairA = [
    {
      id: 'multi_target_noticed',
      title: 'Target Frequency Observation',
      prompt: 'Did you notice any trials in which more than one target was presented?',
      type: 'slider_likert',
      minLabel: 'Definitely No',
      maxLabel: 'Definitely Yes',
      defaultValue: 50
    },
    {
      id: 'multi_target_count',
      title: 'Target Count Estimation',
      prompt: `How many trials do you think had more than one target? (Enter a number between 0 and ${State.config.numTrials}):`,
      type: 'integer_input',
      min: 0,
      max: State.config.numTrials,
      defaultValue: 0
    }
  ];

  // Pair B: Primed locations questions
  const pairB = [
    {
      id: 'prime_location_noticed',
      title: 'Location Distribution Observation',
      prompt: 'Did you notice that the target appeared at some locations more than others?',
      type: 'slider_likert',
      minLabel: 'Definitely No',
      maxLabel: 'Definitely Yes',
      defaultValue: 50
    },
    {
      id: 'prime_location_click',
      title: 'Location Identification',
      prompt: 'Can you click on the location(s) where the target appeared most? Click on them in the order in which you think they contained the target most.',
      type: 'grid_selection'
    }
  ];

  // Randomize the presentation order between Pair A and Pair B
  const randomizedPairs = Math.random() < 0.5 ? [...pairA, ...pairB] : [...pairB, ...pairA];

  State.questionnaire.sequence = [q1, ...randomizedPairs];
  State.questionnaire.answers = {
    q1_oddities: '',
    multi_target_noticed_rating: 50,
    multi_target_count_estimate: 0,
    prime_location_noticed_rating: 50,
    prime_location_clicks_order: []
  };
}

function renderCurrentQuestion() {
  const currentIdx = State.questionnaire.currentStep;
  const total = State.questionnaire.sequence.length;
  const q = State.questionnaire.sequence[currentIdx];

  document.getElementById('questionnaire-step-title').textContent = `Question ${currentIdx + 1} of ${total}`;
  document.getElementById('questionnaire-step-subtitle').textContent = q.title;

  const btnNext = document.getElementById('btn-next-question');
  btnNext.textContent = (currentIdx === total - 1) ? 'Submit & View Results' : 'Next Question';

  const container = document.getElementById('questionnaire-container');
  container.innerHTML = '';

  const promptEl = document.createElement('div');
  promptEl.className = 'question-prompt';
  promptEl.textContent = q.prompt;
  container.appendChild(promptEl);

  if (q.type === 'open_ended') {
    const textarea = document.createElement('textarea');
    textarea.className = 'question-textarea';
    textarea.id = 'q-input-textarea';
    textarea.placeholder = 'Type your observations here (or type "None" if you did not notice anything)...';
    textarea.value = State.questionnaire.answers.q1_oddities;
    container.appendChild(textarea);
    setTimeout(() => textarea.focus(), 100);
  } else if (q.type === 'slider_likert') {
    const sliderBox = document.createElement('div');
    sliderBox.className = 'slider-group';

    const currentValue = (q.id === 'multi_target_noticed') 
      ? State.questionnaire.answers.multi_target_noticed_rating 
      : State.questionnaire.answers.prime_location_noticed_rating;

    sliderBox.innerHTML = `
      <div class="slider-scale-labels">
        <span class="left">${q.minLabel}</span>
        <span class="right">${q.maxLabel}</span>
      </div>
      <input type="range" class="slider-input" id="q-slider" min="0" max="100" value="${currentValue}">
      <div class="slider-current-value" id="q-slider-val">${currentValue}%</div>
    `;
    container.appendChild(sliderBox);

    const slider = sliderBox.querySelector('#q-slider');
    const valDisplay = sliderBox.querySelector('#q-slider-val');
    slider.addEventListener('input', () => {
      valDisplay.textContent = `${slider.value}%`;
    });
  } else if (q.type === 'integer_input') {
    const inputRow = document.createElement('div');
    inputRow.className = 'form-row';
    inputRow.innerHTML = `
      <input type="number" id="q-integer-input" min="${q.min}" max="${q.max}" value="${State.questionnaire.answers.multi_target_count_estimate}" style="max-width: 200px; font-size: 1.1rem;">
      <span class="hint">Allowed range: ${q.min} – ${q.max}</span>
    `;
    container.appendChild(inputRow);
  } else if (q.type === 'grid_selection') {
    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'question-grid-container';

    let selectedCells = [...State.questionnaire.answers.prime_location_clicks_order];

    gridWrapper.innerHTML = `
      <div class="grid-selection-tracker">
        <span>Selected Order:</span>
        <div id="selection-chips" class="selection-order-list"></div>
        <button type="button" id="btn-clear-grid" class="btn btn-outline" style="padding: 0.35rem 0.8rem; font-size: 0.8rem;">Clear Selection</button>
      </div>
      <div class="question-search-grid" id="q-search-grid"></div>
    `;
    container.appendChild(gridWrapper);

    const gridEl = gridWrapper.querySelector('#q-search-grid');
    const chipsEl = gridWrapper.querySelector('#selection-chips');
    const clearBtn = gridWrapper.querySelector('#btn-clear-grid');

    function updateGridDisplay() {
      gridEl.innerHTML = '';
      chipsEl.innerHTML = '';

      if (selectedCells.length === 0) {
        chipsEl.innerHTML = '<span class="hint">None selected yet. Click a cell to make your 1st choice.</span>';
      } else {
        selectedCells.forEach((cellIdx, rank) => {
          const cell = getCellFromIndex(cellIdx);
          const chip = document.createElement('span');
          chip.className = 'selection-chip';
          chip.textContent = `#${rank + 1}: (R${cell.row}, C${cell.col})`;
          chipsEl.appendChild(chip);
        });
      }

      for (let idx = 0; idx < 144; idx++) {
        const cell = document.createElement('div');
        cell.className = 'q-grid-cell';
        const rankIndex = selectedCells.indexOf(idx);
        if (rankIndex !== -1) {
          cell.classList.add('selected');
          cell.textContent = rankIndex + 1;
        }

        cell.addEventListener('click', () => {
          if (selectedCells.includes(idx)) {
            // Already selected; ignore or do nothing
            return;
          }
          if (selectedCells.length < 5) {
            selectedCells.push(idx);
            State.questionnaire.answers.prime_location_clicks_order = selectedCells;
            updateGridDisplay();
          } else {
            alert('You have already selected the maximum of 5 locations. You can clear to re-select.');
          }
        });

        gridEl.appendChild(cell);
      }
    }

    clearBtn.addEventListener('click', () => {
      selectedCells = [];
      State.questionnaire.answers.prime_location_clicks_order = [];
      updateGridDisplay();
    });

    updateGridDisplay();
  }
}

function handleQuestionnaireNext() {
  const currentIdx = State.questionnaire.currentStep;
  const q = State.questionnaire.sequence[currentIdx];

  // Validate and collect answer for current question
  if (q.type === 'open_ended') {
    const val = document.getElementById('q-input-textarea').value.trim();
    State.questionnaire.answers.q1_oddities = val;
  } else if (q.type === 'slider_likert') {
    const val = parseInt(document.getElementById('q-slider').value, 10);
    if (q.id === 'multi_target_noticed') {
      State.questionnaire.answers.multi_target_noticed_rating = val;
    } else {
      State.questionnaire.answers.prime_location_noticed_rating = val;
    }
  } else if (q.type === 'integer_input') {
    const inputEl = document.getElementById('q-integer-input');
    const val = parseInt(inputEl.value, 10);
    if (isNaN(val) || val < q.min || val > q.max) {
      alert(`Please enter a valid integer between ${q.min} and ${q.max}.`);
      inputEl.focus();
      return;
    }
    State.questionnaire.answers.multi_target_count_estimate = val;
  } else if (q.type === 'grid_selection') {
    if (State.questionnaire.answers.prime_location_clicks_order.length < 1) {
      alert('Please select at least 1 location on the grid before proceeding.');
      return;
    }
  }

  // Advance or Finish
  if (currentIdx + 1 < State.questionnaire.sequence.length) {
    State.questionnaire.currentStep++;
    renderCurrentQuestion();
  } else {
    // Append questionnaire answers into trial results metadata for export
    attachQuestionnaireAnswersToResults();
    showSummarySection();
  }
}

function attachQuestionnaireAnswersToResults() {
  const ans = State.questionnaire.answers;
  const clicksCoordsStr = ans.prime_location_clicks_order.map(idx => {
    const c = getCellFromIndex(idx);
    return `R${c.row}_C${c.col}`;
  }).join(';');

  State.results.forEach(record => {
    record.q_oddities = ans.q1_oddities.replace(/(\r\n|\n|\r|,)/gm, ' ');
    record.q_multi_target_rating = ans.multi_target_noticed_rating;
    record.q_multi_target_count_est = ans.multi_target_count_estimate;
    record.q_prime_loc_rating = ans.prime_location_noticed_rating;
    record.q_prime_loc_clicks_order = clicksCoordsStr;
  });
}

// ==========================================
// SECTION 4: SUMMARY & DATA VISUALIZATION
// ==========================================
function showSummarySection() {
  showSection('section-summary');
  calculateAndRenderKPIs();
  renderCharts();

  if (State.config.responseMode === 'mouse') {
    document.getElementById('btn-download-mouse-csv').classList.remove('hidden');
  } else {
    document.getElementById('btn-download-mouse-csv').classList.add('hidden');
  }
}

function calculateAndRenderKPIs() {
  const total = State.results.length;
  const correct = State.results.filter(r => r.accuracy === 1);
  const overallAcc = total > 0 ? Math.round((correct.length / total) * 100) : 0;
  const meanRT = correct.length > 0 ? Math.round(correct.reduce((sum, r) => sum + r.rt_ms, 0) / correct.length) : 0;
  const flaggedCount = State.results.filter(r => r.space_flagged === 1).length;

  document.getElementById('kpi-total-trials').textContent = total;
  document.getElementById('kpi-accuracy').textContent = `${overallAcc}%`;
  document.getElementById('kpi-mean-rt').textContent = `${meanRT} ms`;
  document.getElementById('kpi-flagged').textContent = flaggedCount;
}

// Helper: Calculate Boxplot 5-number summary (min, q1, median, q3, max, outliers)
function computeBoxPlotStats(values) {
  if (!values || values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, items: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const getPercentile = (p) => {
    const pos = (n - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  };

  const min = sorted[0];
  const max = sorted[n - 1];
  const q1 = getPercentile(0.25);
  const median = getPercentile(0.5);
  const q3 = getPercentile(0.75);

  return { min, q1, median, q3, max, items: sorted };
}

function renderCharts() {
  const conditions = ['random', 'prime_1', 'prime_2', 'double_prime'];
  const condLabels = ['Random', 'Prime 1', 'Prime 2', 'Double Prime'];

  // 1. Box and Whisker Data for RT by Condition (Correct trials only)
  const rtConditionBoxes = conditions.map(cond => {
    const trials = State.results.filter(r => r.trial_type === cond && r.accuracy === 1);
    const rts = trials.map(t => t.rt_ms);
    return computeBoxPlotStats(rts);
  });

  // 2. Accuracy by Condition (%)
  const accData = conditions.map(cond => {
    const trials = State.results.filter(r => r.trial_type === cond);
    if (trials.length === 0) return 0;
    const corr = trials.filter(r => r.accuracy === 1).length;
    return Math.round((corr / trials.length) * 100);
  });

  // 3. Line Graph for RT by Set Size (Mean RT Search Slope)
  const uniqueSetSizes = [...new Set(State.results.map(r => r.set_size))].sort((a, b) => a - b);
  const setSizeMeans = uniqueSetSizes.map(sz => {
    const trials = State.results.filter(r => r.set_size === sz && r.accuracy === 1);
    return trials.length > 0 ? Math.round(trials.reduce((sum, r) => sum + r.rt_ms, 0) / trials.length) : 0;
  });

  const chartThemeColors = {
    boxBg: 'rgba(59, 130, 246, 0.35)',
    boxBorder: '#3b82f6',
    median: '#f8fafc',
    lineBorder: '#06b6d4',
    lineBg: 'rgba(6, 182, 212, 0.15)'
  };

  // Render RT by Condition (Boxplot)
  if (State.charts.rtCondition) State.charts.rtCondition.destroy();
  const ctxRtCond = document.getElementById('chart-rt-condition');

  // Check if boxplot controller is registered, otherwise fallback cleanly
  const boxplotType = (window.Chart && Chart.registry && Chart.registry.getController('boxplot')) ? 'boxplot' : 'bar';

  State.charts.rtCondition = new Chart(ctxRtCond, {
    type: boxplotType,
    data: {
      labels: condLabels,
      datasets: [{
        label: 'Reaction Time (ms)',
        data: boxplotType === 'boxplot' ? rtConditionBoxes : rtConditionBoxes.map(b => b.median),
        backgroundColor: chartThemeColors.boxBg,
        borderColor: chartThemeColors.boxBorder,
        borderWidth: 1.5,
        medianColor: chartThemeColors.median,
        itemRadius: 3,
        outlierRadius: 4,
        outlierBackgroundColor: '#ef4444'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const b = ctx.raw;
              if (b && typeof b === 'object' && 'median' in b) {
                return `Min: ${Math.round(b.min)} | Q1: ${Math.round(b.q1)} | Med: ${Math.round(b.median)} | Q3: ${Math.round(b.q3)} | Max: ${Math.round(b.max)}`;
              }
              return `Value: ${ctx.formattedValue}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          title: { display: true, text: 'Reaction Time (ms)', color: '#94a3b8' }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // Render Accuracy by Condition
  if (State.charts.accCondition) State.charts.accCondition.destroy();
  State.charts.accCondition = new Chart(document.getElementById('chart-acc-condition'), {
    type: 'bar',
    data: {
      labels: condLabels,
      datasets: [{
        label: 'Accuracy (%)',
        data: accData,
        backgroundColor: 'rgba(16, 185, 129, 0.75)',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255, 255, 255, 0.06)' } },
        x: { grid: { display: false } }
      }
    }
  });

  // Render RT by Set Size (Line Graph for Search Slope)
  if (State.charts.rtSetSize) State.charts.rtSetSize.destroy();
  const ctxRtSetSize = document.getElementById('chart-rt-setsize');

  State.charts.rtSetSize = new Chart(ctxRtSetSize, {
    type: 'line',
    data: {
      labels: uniqueSetSizes.map(s => `Set Size ${s}`),
      datasets: [{
        label: 'Mean RT (ms)',
        data: setSizeMeans,
        borderColor: chartThemeColors.lineBorder,
        backgroundColor: chartThemeColors.lineBg,
        borderWidth: 2.5,
        fill: true,
        tension: 0.15,
        pointBackgroundColor: chartThemeColors.lineBorder,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Mean RT: ${ctx.parsed.y} ms`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          title: { display: true, text: 'Mean Reaction Time (ms)', color: '#94a3b8' }
        },
        x: {
          grid: { display: false },
          title: { display: true, text: 'Set Size', color: '#94a3b8' }
        }
      }
    }
  });
}

// ==========================================
// CSV EXPORT GENERATOR
// ==========================================
function setupSummaryButtons() {
  document.getElementById('btn-download-csv').addEventListener('click', () => {
    downloadResultsCSV();
  });

  document.getElementById('btn-download-mouse-csv').addEventListener('click', () => {
    downloadMouseTrajectoriesCSV();
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    showSection('section-config');
  });
}

function downloadResultsCSV() {
  if (State.results.length === 0) return;

  const headers = Object.keys(State.results[0]);
  const rows = State.results.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
  const csvContent = [headers.join(','), ...rows].join('\n');

  downloadBlob(csvContent, `visual_search_data_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function downloadMouseTrajectoriesCSV() {
  if (State.mouseTrajectories.length === 0) return;

  const rows = ['trial_number,relative_time_ms,cursor_x,cursor_y'];
  State.mouseTrajectories.forEach(trial => {
    trial.samples.forEach(sample => {
      rows.push(`${trial.trialNumber},${sample.t},${sample.x},${sample.y}`);
    });
  });

  downloadBlob(rows.join('\n'), `visual_search_mouse_trajectories_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
