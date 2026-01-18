/**
 * GeoPixels Static Monitor
 * Fully client-side implementation with browser storage
 */

const SYNC_TILE_SIZE = 1000;
const API_URL = 'https://geopixels.net/GetPixelsCached';
const MAX_LOG_ENTRIES = 1000;

// Global state
let regions = [];
let isMonitoring = false;
let pollTimer = null;
let editingRegionId = null;
let activityLog = [];
let leaderboard = new Map();
let userActivity = [];
let chart = null;

// Tile cache and state
let tileCache = new Map();
let tileChecksums = new Map();
let changedPixels = new Map();

// User profile cache
let userProfileCache = new Map();
let pendingUserRequests = new Map();

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  renderRegions();
  renderLog();
  renderLeaderboard();
  renderUserActivity();
});

// Storage functions
function saveToStorage() {
  localStorage.setItem('gp_monitor_regions', JSON.stringify(regions));
  localStorage.setItem('gp_monitor_log', JSON.stringify(activityLog));
  localStorage.setItem('gp_monitor_leaderboard', JSON.stringify([...leaderboard]));
  localStorage.setItem('gp_monitor_users', JSON.stringify(userActivity));
  localStorage.setItem('gp_monitor_interval', document.getElementById('pollingInterval').value);
}

function loadFromStorage() {
  const savedRegions = localStorage.getItem('gp_monitor_regions');
  if (savedRegions) {
    regions = JSON.parse(savedRegions);
  }
  
  const savedLog = localStorage.getItem('gp_monitor_log');
  if (savedLog) {
    activityLog = JSON.parse(savedLog);
  }
  
  const savedLeaderboard = localStorage.getItem('gp_monitor_leaderboard');
  if (savedLeaderboard) {
    leaderboard = new Map(JSON.parse(savedLeaderboard));
  }
  
  const savedUsers = localStorage.getItem('gp_monitor_users');
  if (savedUsers) {
    userActivity = JSON.parse(savedUsers);
  }
  
  const savedInterval = localStorage.getItem('gp_monitor_interval');
  if (savedInterval) {
    document.getElementById('pollingInterval').value = savedInterval;
  }
  
  const savedProfiles = localStorage.getItem('gp_monitor_profiles');
  if (savedProfiles) {
    userProfileCache = new Map(JSON.parse(savedProfiles));
  }
}

// User profile resolution
async function resolveUsername(userId) {
  if (!userId || userId === 0) {
    return '[No User]';
  }
  
  // Check cache first
  const cached = userProfileCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < 3600000) { // 1 hour TTL
    return cached.username;
  }
  
  // Check if already fetching
  if (pendingUserRequests.has(userId)) {
    return pendingUserRequests.get(userId);
  }
  
  // Fetch new profile
  const fetchPromise = fetchUserProfile(userId);
  pendingUserRequests.set(userId, fetchPromise);
  
  try {
    const username = await fetchPromise;
    return username;
  } catch (err) {
    return `User${userId}`;
  } finally {
    pendingUserRequests.delete(userId);
  }
}

async function fetchUserProfile(userId) {
  try {
    const response = await fetch('https://geopixels.net/GetUserProfile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: userId })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const profile = await response.json();
    const username = profile.name || `User${userId}`;
    
    // Cache the profile
    userProfileCache.set(userId, {
      username,
      profile,
      fetchedAt: Date.now()
    });
    
    // Save to localStorage
    localStorage.setItem('gp_monitor_profiles', JSON.stringify([...userProfileCache]));
    
    return username;
  } catch (err) {
    log(`Failed to fetch profile for user ${userId}: ${err.message}`, 'log-error');
    return `User${userId}`;
  }
}

// Logging
function log(message, className = 'log-info') {
  const entry = {
    message,
    className,
    timestamp: new Date().toISOString()
  };
  
  activityLog.push(entry);
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog = activityLog.slice(-MAX_LOG_ENTRIES);
  }
  
  saveToStorage();
  renderLog();
}

function renderLog() {
  const container = document.getElementById('activityLog');
  container.innerHTML = activityLog.slice().reverse().map(entry => `
    <div class="log-entry ${entry.className}">
      <small>${new Date(entry.timestamp).toLocaleTimeString()}</small> ${escapeHtml(entry.message)}
    </div>
  `).join('');
  
  // Scroll to top (newest first)
  if (container.firstElementChild) {
    container.firstElementChild.scrollIntoView({ behavior: 'smooth' });
  }
}

function clearLog() {
  activityLog = [];
  saveToStorage();
  renderLog();
}

function exportLog() {
  const blob = new Blob([JSON.stringify(activityLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `geopixels-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Region management
function updateDimensions() {
  const leftX = parseInt(document.getElementById('regionLeftX').value);
  const rightX = parseInt(document.getElementById('regionRightX').value);
  const topY = parseInt(document.getElementById('regionTopY').value);
  const bottomY = parseInt(document.getElementById('regionBottomY').value);
  const errorDiv = document.getElementById('regionValidationError');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

  if (isNaN(leftX) || isNaN(rightX) || isNaN(topY) || isNaN(bottomY)) {
    document.getElementById('regionWidthDisplay').textContent = '-';
    document.getElementById('regionHeightDisplay').textContent = '-';
    return;
  }

  if (leftX === rightX) {
    errorDiv.textContent = 'Right X must differ from Left X';
    errorDiv.style.display = 'block';
  }
  if (topY === bottomY) {
    errorDiv.textContent = 'Bottom Y must differ from Top Y';
    errorDiv.style.display = 'block';
  }

  const width = Math.abs(rightX - leftX);
  const height = Math.abs(bottomY - topY);

  document.getElementById('regionWidthDisplay').textContent = width.toString();
  document.getElementById('regionHeightDisplay').textContent = height.toString();
}

function addRegion() {
  const name = document.getElementById('regionName').value.trim();
  const leftX = parseInt(document.getElementById('regionLeftX').value);
  const rightX = parseInt(document.getElementById('regionRightX').value);
  const topY = parseInt(document.getElementById('regionTopY').value);
  const bottomY = parseInt(document.getElementById('regionBottomY').value);
  const errorDiv = document.getElementById('regionValidationError');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

  if (!name || isNaN(leftX) || isNaN(rightX) || isNaN(topY) || isNaN(bottomY)) {
    alert('Please fill in all fields');
    return;
  }

  if (leftX === rightX) {
    errorDiv.textContent = 'Right X must differ from Left X';
    errorDiv.style.display = 'block';
    return;
  }
  if (topY === bottomY) {
    errorDiv.textContent = 'Bottom Y must differ from Top Y';
    errorDiv.style.display = 'block';
    return;
  }

  const minX = Math.min(leftX, rightX);
  const maxX = Math.max(leftX, rightX);
  const minY = Math.min(topY, bottomY);
  const maxY = Math.max(topY, bottomY);

  const width = maxX - minX;
  const height = maxY - minY;

  if (editingRegionId !== null) {
    const region = regions.find(r => r.id === editingRegionId);
    if (region) {
      region.name = name;
      region.x = minX;
      region.y = minY;
      region.width = width;
      region.height = height;
    }
    editingRegionId = null;
    document.getElementById('addRegionBtn').textContent = 'Add Region';
  } else {
    regions.push({ id: Date.now(), name, x: minX, y: minY, width, height });
  }
  
  saveToStorage();
  renderRegions();
  
  document.getElementById('regionName').value = '';
  document.getElementById('regionLeftX').value = '';
  document.getElementById('regionRightX').value = '';
  document.getElementById('regionTopY').value = '';
  document.getElementById('regionBottomY').value = '';
  updateDimensions();
}

function editRegion(id) {
  const region = regions.find(r => r.id === id);
  if (!region) return;

  editingRegionId = id;
  document.getElementById('regionName').value = region.name;
  document.getElementById('regionLeftX').value = region.x;
  document.getElementById('regionRightX').value = region.x + region.width;
  document.getElementById('regionTopY').value = region.y;
  document.getElementById('regionBottomY').value = region.y + region.height;
  updateDimensions();
  document.getElementById('addRegionBtn').textContent = 'Update Region';
}

function removeRegion(id) {
  regions = regions.filter(r => r.id !== id);
  saveToStorage();
  renderRegions();
}

function renderRegions() {
  const list = document.getElementById('regionsList');
  list.innerHTML = regions.map(r => `
    <li class="region-item">
      <div>
        <div class="region-item-name">${escapeHtml(r.name)}</div>
        <div class="region-item-coords">(${r.x}, ${r.y}) ${r.width}×${r.height}</div>
      </div>
      <div class="region-item-buttons">
        <button class="btn btn-secondary btn-small" onclick="editRegion(${r.id})">Edit</button>
        <button class="btn btn-secondary btn-small" onclick="removeRegion(${r.id})">Remove</button>
      </div>
    </li>
  `).join('');
}

function exportRegions() {
  const blob = new Blob([JSON.stringify(regions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `geopixels-regions-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importRegions() {
  const json = prompt('Paste your regions JSON:');
  if (!json) return;
  
  try {
    const imported = JSON.parse(json);
    if (Array.isArray(imported)) {
      regions = imported;
      saveToStorage();
      renderRegions();
      log('Imported regions successfully');
    } else {
      alert('Invalid JSON format');
    }
  } catch (e) {
    alert('Failed to parse JSON: ' + e.message);
  }
}

// Monitoring
async function startMonitoring() {
  if (isMonitoring) return;
  if (regions.length === 0) {
    alert('Please add at least one region to monitor');
    return;
  }
  
  isMonitoring = true;
  document.getElementById('statusIndicator').classList.add('monitoring');
  document.getElementById('statusText').textContent = 'Monitoring';
  document.getElementById('startBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'inline-block';
  
  const pollingInterval = parseInt(document.getElementById('pollingInterval').value);
  log(`Starting monitoring of ${regions.length} region(s) with ${pollingInterval}s interval`);
  
  // Initial sync
  await performSync();
  
  // Schedule next sync
  scheduleNextSync(pollingInterval);
}

function stopMonitoring() {
  isMonitoring = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  
  document.getElementById('statusIndicator').classList.remove('monitoring');
  document.getElementById('statusText').textContent = 'Stopped';
  document.getElementById('startBtn').style.display = 'inline-block';
  document.getElementById('stopBtn').style.display = 'none';
  
  log('Monitoring stopped');
}

function scheduleNextSync(pollingInterval) {
  if (!isMonitoring) return;
  
  pollTimer = setTimeout(async () => {
    const SYNC_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Sync timeout: exceeded 5 minutes')), SYNC_TIMEOUT)
    );

    try {
      await Promise.race([performSync(), timeoutPromise]);
      scheduleNextSync(pollingInterval);
    } catch (err) {
      if (err.message === 'Sync timeout: exceeded 5 minutes') {
        log(`Sync timeout (5 minutes exceeded): terminating and resuming in ${pollingInterval}s`, 'log-error');
      } else {
        log(`Sync error: ${err.message}`, 'log-error');
      }
      scheduleNextSync(pollingInterval);
    }
  }, pollingInterval * 1000);
}

async function performSync() {
  try {
    changedPixels.clear();
    
    const tileKeys = calculateRequiredTiles();
    if (tileKeys.length === 0) {
      log('No tiles to fetch');
      return;
    }

    const tiles = tileKeys.map(key => {
      const [x, y] = key.split(',').map(Number);
      const cached = tileCache.get(key);
      const timestamp = cached ? cached.timestamp : 0;
      return { x, y, timestamp };
    });

    const BATCH_SIZE = 4;
    const batches = [];
    for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
      batches.push(tiles.slice(i, i + BATCH_SIZE));
    }

    let hasAnyChanges = false;
    const tilesWithChanges = new Set();

    for (const batch of batches) {
      const batchInfo = batch.map(t => `(${t.x},${t.y},ts:${t.timestamp})`).join(' ');
      log(`Fetching ${batch.length} tile(s): ${batchInfo}`);
      
      const response = await fetchTiles(batch);
      const serverTimestamp = response.ServerTimestamp;
      
      if (!serverTimestamp) {
        log('Missing ServerTimestamp in API response', 'log-error');
        continue;
      }

      if (!response.Tiles || Object.keys(response.Tiles).length === 0) {
        log('No tile data returned (no changes)');
        continue;
      }

      for (const [tileKey, tileData] of Object.entries(response.Tiles)) {
        const hadChanges = await processTile(tileKey, tileData, tilesWithChanges, serverTimestamp);
        if (hadChanges) {
          hasAnyChanges = true;
        }
      }
    }

    if (!hasAnyChanges) {
      log('No changes detected in any tiles');
      return;
    }

    detectChanges(tilesWithChanges);
  } catch (err) {
    log(`Sync error: ${err.message}`, 'log-error');
  }
}

function calculateRequiredTiles() {
  const tileSet = new Set();

  for (const region of regions) {
    const { x, y, width, height } = region;

    const minTileX = Math.floor(x / SYNC_TILE_SIZE) * SYNC_TILE_SIZE;
    const maxTileX = Math.floor((x + width) / SYNC_TILE_SIZE) * SYNC_TILE_SIZE;
    const minTileY = Math.floor(y / SYNC_TILE_SIZE) * SYNC_TILE_SIZE;
    const maxTileY = Math.floor((y + height) / SYNC_TILE_SIZE) * SYNC_TILE_SIZE;

    for (let tx = minTileX; tx <= maxTileX; tx += SYNC_TILE_SIZE) {
      for (let ty = minTileY; ty <= maxTileY; ty += SYNC_TILE_SIZE) {
        tileSet.add(`${tx},${ty}`);
      }
    }
  }

  return Array.from(tileSet);
}

async function fetchTiles(tiles) {
  const payload = { Tiles: tiles, userId: 0, tokenUser: '' };
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}

async function processTile(tileKeyName, tileData, tilesWithChanges, serverTimestamp) {
  const match = tileKeyName.match(/tile_(-?\d+)_(-?\d+)/);
  if (!match) {
    log(`Invalid tile key format: ${tileKeyName}`, 'log-error');
    return false;
  }

  const x = parseInt(match[1]);
  const y = parseInt(match[2]);
  const tileKey = `${x},${y}`;
  let hasChanges = false;

  if (tileData.Type === 'full') {
    const colorBitmap = await decodeWebP(tileData.ColorWebP);
    const userBitmap = await decodeWebP(tileData.UserWebP);

    const newUserChecksum = computeTileChecksum(userBitmap);
    const oldUserChecksum = tileChecksums.get(tileKey);

    tileCache.set(tileKey, {
      colorBitmap,
      userBitmap,
      timestamp: serverTimestamp
    });
    tileChecksums.set(tileKey, newUserChecksum);

    log(`Loaded full tile ${tileKey} (serverTs: ${serverTimestamp})`);
    
    if (oldUserChecksum && oldUserChecksum !== newUserChecksum) {
      hasChanges = true;
      tilesWithChanges.add(tileKey);
      log(`Tile ${tileKey} has CHANGED (checksum updated)`);
    } else if (!oldUserChecksum) {
      log(`Tile ${tileKey} is new baseline`);
    }
  } else if (tileData.Type === 'delta') {
    if (tileCache.has(tileKey)) {
      const cached = tileCache.get(tileKey);
      
      if (tileData.Pixels && tileData.Pixels.length > 0) {
        if (!changedPixels.has(tileKey)) {
          changedPixels.set(tileKey, new Set());
        }
        const changedSet = changedPixels.get(tileKey);
        
        let newPixelCount = 0;
        for (const [gridX, gridY] of tileData.Pixels) {
          const pixelKey = `${gridX},${gridY}`;
          if (!changedSet.has(pixelKey)) {
            newPixelCount++;
          }
          changedSet.add(pixelKey);
        }
        
        applyDeltas(cached.colorBitmap, cached.userBitmap, tileData.Pixels, x, y);
        const oldTs = cached.timestamp;
        cached.timestamp = serverTimestamp;
        
        const newChecksum = computeTileChecksum(cached.userBitmap);
        tileChecksums.set(tileKey, newChecksum);
        
        log(`Applied ${tileData.Pixels.length} delta(s) to tile ${tileKey} (${newPixelCount} new, ts: ${oldTs} -> ${serverTimestamp})`);
        hasChanges = true;
        tilesWithChanges.add(tileKey);
      } else {
        const oldTs = cached.timestamp;
        cached.timestamp = serverTimestamp;
        log(`Delta for ${tileKey}: no new pixels (ts: ${oldTs} -> ${serverTimestamp})`);
      }
    }
  }

  return hasChanges;
}

async function decodeWebP(base64Data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        width: img.width,
        height: img.height,
        data: imageData.data
      });
    };
    img.onerror = () => reject(new Error('Failed to decode WebP'));
    img.src = 'data:image/webp;base64,' + base64Data;
  });
}

function computeTileChecksum(bitmap) {
  let checksum = 0;
  for (let i = 0; i < bitmap.data.length; i++) {
    checksum ^= bitmap.data[i];
    checksum = (checksum * 31) & 0xffffffff;
  }
  return checksum.toString(16);
}

function applyDeltas(colorBitmap, userBitmap, pixels, tileX, tileY) {
  for (const pixel of pixels) {
    const [gridX, gridY, colorIdx, userId] = pixel;
    const localX = gridX - tileX;
    const localY = gridY - tileY;
    
    if (localX < 0 || localX >= colorBitmap.width || localY < 0 || localY >= colorBitmap.height) {
      continue;
    }
    
    const idx = (localY * colorBitmap.width + localX) * 4;
    colorBitmap.data[idx] = colorIdx;
    
    const userBytes = new Uint8Array(new Uint32Array([userId]).buffer);
    userBitmap.data[idx] = userBytes[0];
    userBitmap.data[idx + 1] = userBytes[1];
    userBitmap.data[idx + 2] = userBytes[2];
    userBitmap.data[idx + 3] = userBytes[3];
  }
}

function detectChanges(tilesWithChanges) {
  const userChanges = new Map();
  
  for (const tileKey of tilesWithChanges) {
    const cached = tileCache.get(tileKey);
    if (!cached) continue;
    
    const [tileX, tileY] = tileKey.split(',').map(Number);
    const changedSet = changedPixels.get(tileKey);
    if (!changedSet) continue;
    
    for (const pixelKey of changedSet) {
      const [gridX, gridY] = pixelKey.split(',').map(Number);
      const localX = gridX - tileX;
      const localY = gridY - tileY;
      
      if (localX < 0 || localX >= cached.userBitmap.width || 
          localY < 0 || localY >= cached.userBitmap.height) {
        continue;
      }
      
      const idx = (localY * cached.userBitmap.width + localX) * 4;
      const userId = new Uint32Array(cached.userBitmap.data.slice(idx, idx + 4).buffer)[0];
      
      if (userId === 0) continue;
      
      // Find which region this pixel belongs to
      let regionName = 'Unknown';
      for (const region of regions) {
        if (gridX >= region.x && gridX < region.x + region.width &&
            gridY >= region.y && gridY < region.y + region.height) {
          regionName = region.name;
          break;
        }
      }
      
      if (!userChanges.has(userId)) {
        userChanges.set(userId, {
          userId,
          pixels: [],
          region: regionName,
          chunk: tileKey
        });
      }
      userChanges.get(userId).pixels.push([gridX, gridY]);
    }
  }
  
  for (const [userId, data] of userChanges) {
    updateLeaderboard(userId, data.pixels.length, data.region);
    addUserActivity(userId, data.pixels.length, data.region, data.chunk);
    log(`User ${userId} placed ${data.pixels.length} pixel(s) in ${data.region}`, 'log-success');
  }
  
  if (userChanges.size > 0) {
    log(`Detected changes from ${userChanges.size} user(s)`, 'log-info');
  }
}

function updateLeaderboard(userId, pixelCount, region) {
  const key = `${userId}-${region}`;
  const existing = leaderboard.get(key) || { userId, region, pixels: 0, lastSeen: null };
  existing.pixels += pixelCount;
  existing.lastSeen = new Date().toISOString();
  leaderboard.set(key, existing);
  saveToStorage();
  
  // Fetch username asynchronously and update display
  resolveUsername(userId).then(() => renderLeaderboard());
}

async function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  const filterSelect = document.getElementById('leaderboardRegionFilter');
  const selectedRegion = filterSelect ? filterSelect.value : '';
  
  // Get unique regions from regions array
  if (filterSelect && filterSelect.children.length === 1) {
    regions.forEach(r => {
      if (!filterSelect.querySelector(`option[value="${r.name}"]`)) {
        const option = document.createElement('option');
        option.value = r.name;
        option.textContent = r.name;
        filterSelect.appendChild(option);
      }
    });
  }
  
  // Filter leaderboard by region if selected
  let filtered = [...leaderboard.values()];
  if (selectedRegion) {
    filtered = filtered.filter(entry => entry.region === selectedRegion);
  }
  const sorted = filtered.sort((a, b) => b.pixels - a.pixels);
  
  // Fetch all usernames first
  const userIds = sorted.map(e => e.userId);
  await Promise.all(userIds.map(id => resolveUsername(id)));
  
  tbody.innerHTML = sorted.map((entry, index) => {
    const cached = userProfileCache.get(entry.userId);
    const username = cached ? escapeHtml(cached.username) : `User${entry.userId}`;
    return `
      <tr>
        <td>${index + 1}</td>
        <td><a href="https://geopixels.net/?profile=${entry.userId}" target="_blank" class="user-link">${username}</a></td>
        <td>${entry.pixels}</td>
        <td>${new Date(entry.lastSeen).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

function addUserActivity(userId, pixelCount, region, chunk) {
  const timestamp = new Date().toISOString();
  
  // Add individual pixel events for graphing
  for (let i = 0; i < pixelCount; i++) {
    userActivity.unshift({
      userId,
      pixels: 1,
      region,
      chunk,
      timestamp
    });
  }
  
  // Keep only last 500 events (increased for better graphs)
  if (userActivity.length > 500) {
    userActivity = userActivity.slice(0, 500);
  }
  
  saveToStorage();
  
  // Fetch username asynchronously and update display
  resolveUsername(userId).then(() => {
    renderUserActivity();
    if (document.getElementById('graphTab').classList.contains('active')) {
      updateGraph();
    }
  });
}

async function renderUserActivity() {
  const tbody = document.getElementById('usersBody');
  
  // Group by user for display (consolidate multiple pixels)
  const grouped = {};
  userActivity.forEach(entry => {
    const key = `${entry.userId}-${entry.region}-${entry.chunk}-${entry.timestamp}`;
    if (!grouped[key]) {
      grouped[key] = { ...entry, pixels: 0 };
    }
    grouped[key].pixels += entry.pixels;
  });
  
  const consolidated = Object.values(grouped).slice(0, 100);
  
  // Fetch all usernames first
  const userIds = consolidated.map(e => e.userId);
  await Promise.all(userIds.map(id => resolveUsername(id)));
  
  tbody.innerHTML = consolidated.map(entry => {
    const cached = userProfileCache.get(entry.userId);
    const username = cached ? escapeHtml(cached.username) : `User${entry.userId}`;
    return `
      <tr>
        <td>${entry.userId}</td>
        <td><a href="https://geopixels.net/?profile=${entry.userId}" target="_blank" class="user-link">${username}</a></td>
        <td>${entry.pixels}</td>
        <td>${escapeHtml(entry.region)}</td>
        <td><a href="https://geopixels.net/?coords=${entry.chunk.replace(',', ',')}" target="_blank" class="coords-link">${entry.chunk}</a></td>
        <td>${new Date(entry.timestamp).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

// UI functions
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
  
  event.target.classList.add('active');
  document.getElementById(tabName + 'Tab').classList.add('active');
  
  if (tabName === 'graph') {
    updateGraph();
  }
}

function updateGraph() {
  const groupBy = document.getElementById('graphGroupBy').value;
  const ctx = document.getElementById('activityChart').getContext('2d');
  
  if (userActivity.length === 0) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }
  
  // Group data by time intervals (1 minute)
  const timeGroups = {};
  userActivity.forEach(activity => {
    const minute = new Date(activity.timestamp);
    minute.setSeconds(0, 0);
    const timeKey = minute.toISOString();
    
    if (!timeGroups[timeKey]) {
      timeGroups[timeKey] = {};
    }
    
    let groupKey;
    if (groupBy === 'region') {
      groupKey = activity.region;
    } else if (groupBy === 'user') {
      const cached = userProfileCache.get(activity.userId);
      groupKey = cached ? cached.username : `User${activity.userId}`;
    } else {
      groupKey = activity.chunk;
    }
    
    if (!timeGroups[timeKey][groupKey]) {
      timeGroups[timeKey][groupKey] = 0;
    }
    timeGroups[timeKey][groupKey] += activity.pixels;
  });
  
  // Convert to Chart.js format
  const times = Object.keys(timeGroups).sort();
  if (times.length === 0) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }
  
  // Get all unique groups
  const allGroups = new Set();
  times.forEach(time => {
    Object.keys(timeGroups[time]).forEach(g => allGroups.add(g));
  });
  
  // Create datasets (one line per group)
  const colors = ['#4ec9b0', '#0e639c', '#d16969', '#ffd700', '#c0c0c0', '#cd7f32', '#569cd6', '#dcdcaa'];
  const datasets = Array.from(allGroups).slice(0, 8).map((group, i) => {
    return {
      label: group,
      data: times.map(time => timeGroups[time][group] || 0),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '33',
      tension: 0.1,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2
    };
  });
  
  // Format time labels
  const labels = times.map(t => {
    const date = new Date(t);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });
  
  // Destroy old chart
  if (chart) {
    chart.destroy();
  }
  
  // Create new chart
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            color: '#e0e0e0',
            font: {
              size: 11
            }
          }
        },
        tooltip: {
          backgroundColor: '#252526',
          titleColor: '#e0e0e0',
          bodyColor: '#a0a0a0',
          borderColor: '#3e3e42',
          borderWidth: 1
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: '#a0a0a0',
            precision: 0
          },
          grid: {
            color: '#3e3e42'
          },
          title: {
            display: true,
            text: 'Pixels Placed',
            color: '#a0a0a0'
          }
        },
        x: {
          ticks: {
            color: '#a0a0a0',
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            color: '#3e3e42'
          },
          title: {
            display: true,
            text: 'Time',
            color: '#a0a0a0'
          }
        }
      }
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
