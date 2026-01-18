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

// Filter state
let filters = {
  leaderboard: { region: '', guild: '', username: '' },
  users: { region: '', guild: '', username: '', startTime: null, endTime: null },
  graph: { region: '', guild: '', username: '', startTime: null, endTime: null }
};

// Graph settings
let graphLinesLimit = 100;

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  initializeTimeFilters();
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
  
  const savedGraphLimit = localStorage.getItem('gp_monitor_graph_limit');
  if (savedGraphLimit) {
    graphLinesLimit = parseInt(savedGraphLimit);
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

function clearAllData() {
  if (!confirm('Clear all monitoring data (leaderboard, user activity, graphs)? This will NOT affect your monitored regions.')) {
    return;
  }
  
  activityLog = [];
  leaderboard.clear();
  userActivity = [];
  
  saveToStorage();
  renderLog();
  renderLeaderboard();
  renderUserActivity();
  
  log('All monitoring data cleared', 'log-info');
}

function exportLog(event) {
  const json = JSON.stringify(activityLog, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
  });
}

function exportData(event) {
  const data = {
    leaderboard: [...leaderboard],
    user_activity: userActivity,
    activity_log: activityLog
  };
  const json = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    log('Data exported to clipboard', 'log-info');
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
  });
}

function importData() {
  const json = prompt('Paste your exported data JSON:');
  if (!json) return;
  
  try {
    const data = JSON.parse(json);
    
    if (!data || typeof data !== 'object') {
      alert('Invalid data format');
      return;
    }
    
    // Import leaderboard
    if (Array.isArray(data.leaderboard)) {
      leaderboard = new Map(data.leaderboard);
    }
    
    // Import user activity
    if (Array.isArray(data.user_activity)) {
      userActivity = data.user_activity;
    }
    
    // Import activity log
    if (Array.isArray(data.activity_log)) {
      activityLog = data.activity_log;
    }
    
    saveToStorage();
    renderLog();
    renderLeaderboard();
    renderUserActivity();
    updateGraph();
    
    log('Data imported successfully', 'log-info');
  } catch (e) {
    alert('Failed to parse JSON: ' + e.message);
  }
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

function exportRegions(event) {
  const json = JSON.stringify(regions, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
  });
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

// Filter helper functions
function extractGuildText(guildTag) {
  // Extract text content from complex guild tag HTML
  if (!guildTag) return '';
  const temp = document.createElement('div');
  temp.innerHTML = guildTag;
  return temp.textContent || temp.innerText || '';
}

function getUniqueGuilds() {
  const guilds = new Set();
  userProfileCache.forEach(cached => {
    if (cached?.profile?.guildTag) {
      const guildText = extractGuildText(cached.profile.guildTag);
      if (guildText) guilds.add(guildText);
    }
  });
  return Array.from(guilds).sort();
}

function populateGuildFilter(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  const currentValue = select.value;
  const guilds = getUniqueGuilds();
  
  // Keep 'All Guilds' option and rebuild list
  const allOption = select.querySelector('option[value=""]');
  select.innerHTML = '';
  if (allOption) select.appendChild(allOption);
  
  guilds.forEach(guild => {
    const option = document.createElement('option');
    option.value = guild;
    option.textContent = guild;
    if (guild === currentValue) option.selected = true;
    select.appendChild(option);
  });
}

function matchesFilters(entry, filterSet) {
  const cached = userProfileCache.get(entry.userId);
  const username = cached ? cached.username.toLowerCase() : `user${entry.userId}`;
  const guildText = cached?.profile?.guildTag ? extractGuildText(cached.profile.guildTag).toLowerCase() : '';
  const region = entry.region || '';
  
  if (filterSet.region && region !== filterSet.region) return false;
  if (filterSet.guild && guildText !== filterSet.guild.toLowerCase()) return false;
  if (filterSet.username && !username.includes(filterSet.username.toLowerCase())) return false;
  
  // Time filtering
  if (filterSet.startTime || filterSet.endTime) {
    const entryTime = new Date(entry.timestamp || entry.lastSeen).getTime();
    if (filterSet.startTime && entryTime < filterSet.startTime) return false;
    if (filterSet.endTime && entryTime > filterSet.endTime) return false;
  }
  
  return true;
}

function initializeTimeFilters() {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Set default time range (1 week ago to now)
  filters.users.startTime = oneWeekAgo.getTime();
  filters.users.endTime = now.getTime();
  filters.graph.startTime = oneWeekAgo.getTime();
  filters.graph.endTime = now.getTime();
  
  // Set datetime inputs if they exist
  setDateTimeInput('usersStartTime', oneWeekAgo);
  setDateTimeInput('usersEndTime', now);
  setDateTimeInput('graphStartTime', oneWeekAgo);
  setDateTimeInput('graphEndTime', now);
}

function setDateTimeInput(id, date) {
  const input = document.getElementById(id);
  if (input) {
    input.value = formatDateTimeLocal(date);
  }
}

function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setTimePreset(view, hours) {
  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
  
  filters[view].startTime = startTime.getTime();
  filters[view].endTime = now.getTime();
  
  setDateTimeInput(`${view}StartTime`, startTime);
  setDateTimeInput(`${view}EndTime`, now);
  
  if (view === 'users') {
    renderUserActivity();
  } else if (view === 'graph') {
    updateGraph();
  }
}

function clearTimeFilter(view) {
  filters[view].startTime = null;
  filters[view].endTime = null;
  
  document.getElementById(`${view}StartTime`).value = '';
  document.getElementById(`${view}EndTime`).value = '';
  
  if (view === 'users') {
    renderUserActivity();
  } else if (view === 'graph') {
    updateGraph();
  }
}

function updateTimeFilter(view, type, value) {
  if (value) {
    filters[view][type] = new Date(value).getTime();
  } else {
    filters[view][type] = null;
  }
  
  if (view === 'users') {
    renderUserActivity();
  } else if (view === 'graph') {
    updateGraph();
  }
}

async function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  const regionFilter = document.getElementById('leaderboardRegionFilter');
  const guildFilter = document.getElementById('leaderboardGuildFilter');
  const usernameFilter = document.getElementById('leaderboardUsernameFilter');
  
  // Update filter state
  filters.leaderboard.region = regionFilter ? regionFilter.value : '';
  filters.leaderboard.guild = guildFilter ? guildFilter.value : '';
  filters.leaderboard.username = usernameFilter ? usernameFilter.value : '';
  
  // Populate region dropdown
  if (regionFilter && regionFilter.children.length === 1) {
    regions.forEach(r => {
      if (!regionFilter.querySelector(`option[value="${r.name}"]`)) {
        const option = document.createElement('option');
        option.value = r.name;
        option.textContent = r.name;
        regionFilter.appendChild(option);
      }
    });
  }
  
  // Populate guild dropdown
  populateGuildFilter('leaderboardGuildFilter');
  
  // Fetch all usernames first
  const allEntries = [...leaderboard.values()];
  const userIds = allEntries.map(e => e.userId);
  await Promise.all(userIds.map(id => resolveUsername(id)));
  
  // Apply filters
  const filtered = allEntries.filter(entry => matchesFilters(entry, filters.leaderboard));
  const sorted = filtered.sort((a, b) => b.pixels - a.pixels);
  
  tbody.innerHTML = sorted.map((entry, index) => {
    const cached = userProfileCache.get(entry.userId);
    const username = cached ? escapeHtml(cached.username) : `User${entry.userId}`;
    const discordUser = cached?.profile?.discordUser || '';
    const guildTag = cached?.profile?.guildTag || '';
    const userClickable = discordUser 
      ? `<span class="user-link" onclick="copyDiscordId('${escapeHtml(discordUser)}', event)" style="cursor: pointer; text-decoration: underline;" title="Click to copy Discord ID">${username}</span>`
      : username;
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${userClickable}</td>
        <td><span style="font-size: 10px; line-height: 1; display: inline-block; transform: scale(0.4); transform-origin: left center;">${guildTag}</span></td>
        <td>${entry.pixels}</td>
        <td>${new Date(entry.lastSeen).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

function addUserActivity(userId, pixelCount, region, chunk) {
  const timestamp = new Date().toISOString();
  
  // Add single consolidated entry per user/chunk/interval
  userActivity.unshift({
    userId,
    pixels: pixelCount,
    region,
    chunk,
    timestamp
  });
  
  // No limit - cache ALL activity until manually cleared
  
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
  const regionFilter = document.getElementById('usersRegionFilter');
  const guildFilter = document.getElementById('usersGuildFilter');
  const usernameFilter = document.getElementById('usersUsernameFilter');
  
  // Update filter state
  filters.users.region = regionFilter ? regionFilter.value : '';
  filters.users.guild = guildFilter ? guildFilter.value : '';
  filters.users.username = usernameFilter ? usernameFilter.value : '';
  
  // Populate region dropdown
  if (regionFilter && regionFilter.children.length === 1) {
    regions.forEach(r => {
      if (!regionFilter.querySelector(`option[value="${r.name}"]`)) {
        const option = document.createElement('option');
        option.value = r.name;
        option.textContent = r.name;
        regionFilter.appendChild(option);
      }
    });
  }
  
  // Populate guild dropdown
  populateGuildFilter('usersGuildFilter');
  
  // Group by user for display (consolidate multiple pixels)
  const grouped = {};
  userActivity.forEach(entry => {
    const key = `${entry.userId}-${entry.region}-${entry.chunk}-${entry.timestamp}`;
    if (!grouped[key]) {
      grouped[key] = { ...entry, pixels: 0 };
    }
    grouped[key].pixels += entry.pixels;
  });
  
  const consolidated = Object.values(grouped);
  
  // Fetch all usernames first
  const userIds = consolidated.map(e => e.userId);
  await Promise.all(userIds.map(id => resolveUsername(id)));
  
  // Apply filters
  const filtered = consolidated.filter(entry => matchesFilters(entry, filters.users));
  
  tbody.innerHTML = filtered.map(entry => {
    const cached = userProfileCache.get(entry.userId);
    const username = cached ? escapeHtml(cached.username) : `User${entry.userId}`;
    const discordUser = cached?.profile?.discordUser || '';
    const guildTag = cached?.profile?.guildTag || '';
    const userClickable = discordUser 
      ? `<span class="user-link" onclick="copyDiscordId('${escapeHtml(discordUser)}', event)" style="cursor: pointer; text-decoration: underline;" title="Click to copy Discord ID">${username}</span>`
      : username;
    return `
      <tr>
        <td>${entry.userId}</td>
        <td>${userClickable}</td>
        <td><span style="font-size: 10px; line-height: 1; display: inline-block; transform: scale(0.4); transform-origin: left center;">${guildTag}</span></td>
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
    // Initialize the input value
    const graphLinesInput = document.getElementById('graphLinesLimit');
    if (graphLinesInput && !graphLinesInput.value) {
      graphLinesInput.value = graphLinesLimit;
    }
    updateGraph();
  }
}

function updateGraphLinesLimit(value) {
  const limit = parseInt(value);
  if (limit >= 1 && limit <= 200) {
    graphLinesLimit = limit;
    localStorage.setItem('gp_monitor_graph_limit', limit.toString());
    updateGraph();
  }
}

function updateGraph() {
  const groupBy = document.getElementById('graphGroupBy').value;
  const regionFilter = document.getElementById('graphRegionFilter');
  const guildFilter = document.getElementById('graphGuildFilter');
  const usernameFilter = document.getElementById('graphUsernameFilter');
  const ctx = document.getElementById('activityChart').getContext('2d');
  
  // Update filter state
  filters.graph.region = regionFilter ? regionFilter.value : '';
  filters.graph.guild = guildFilter ? guildFilter.value : '';
  filters.graph.username = usernameFilter ? usernameFilter.value : '';
  
  // Populate region dropdown
  if (regionFilter && regionFilter.children.length === 1) {
    regions.forEach(r => {
      if (!regionFilter.querySelector(`option[value="${r.name}"]`)) {
        const option = document.createElement('option');
        option.value = r.name;
        option.textContent = r.name;
        regionFilter.appendChild(option);
      }
    });
  }
  
  // Populate guild dropdown
  populateGuildFilter('graphGuildFilter');
  
  // Apply filters to userActivity
  const filteredActivity = userActivity.filter(entry => matchesFilters(entry, filters.graph));
  
  if (filteredActivity.length === 0) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }
  
  // Group data by time intervals (1 minute)
  const timeGroups = {};
  filteredActivity.forEach(activity => {
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
  const datasets = Array.from(allGroups).slice(0, graphLinesLimit).map((group, i) => {
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

function copyDiscordId(discordUser, event) {
  if (event) event.preventDefault();
  navigator.clipboard.writeText(discordUser).then(() => {
    log(`Copied Discord ID: ${discordUser}`);
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
