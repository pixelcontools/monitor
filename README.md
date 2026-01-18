# GeoPixels Static Monitor

A fully client-side GeoPixels canvas monitoring tool that runs entirely in your browser.

## Features

- ✅ **100% Static** - No backend required, runs entirely in browser
- ✅ **Local Storage** - All data saved to browser (regions, logs, leaderboard)
- ✅ **Real-time Monitoring** - Detects pixel changes in defined regions
- ✅ **Activity Tracking** - Logs all pixel placements with user details
- ✅ **Leaderboard** - Tracks top contributors
- ✅ **Offline Ready** - Works without internet once loaded (for monitoring only)

## Usage

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the static site:**
   ```bash
   npm run build
   ```

3. **Test locally:**
   ```bash
   npm run dev
   ```

4. **Deploy:**
   - Copy `index.html` to your GitHub Pages repository
   - Access at `https://pixelcontools.github.io/monitor/`

### Configuration

The test region is:
```json
[
  {
    "id": 1768709418936,
    "name": "Taiga (corrected)",
    "x": -434645,
    "y": 136000,
    "width": 3276,
    "height": 4902
  }
]
```

### Important Notes

⚠️ **Browser Must Stay Open**: Since this is a client-side app, monitoring will stop if you close the browser tab. All data is still saved locally.

⚠️ **Local Storage**: Data is stored in your browser's localStorage. Clearing browser data will reset the monitor.

## Development

- `src/index.html` - HTML template
- `src/monitor.js` - Main monitoring logic
- `build.js` - Build script that bundles everything

## Features

### Region Manager
- Diamond layout for intuitive border definition
- Visual width/height calculation
- Input validation
- Import/Export regions as JSON

### Monitoring
- Configurable polling interval (5s - 5min)
- 5-minute timeout protection
- No overlap guarantee (waits for sync to complete before next poll)
- Checksum-based change detection

### Activity Views
- **Activity Log**: Real-time event stream
- **Leaderboard**: Top contributors by pixel count
- **User View**: Recent user activity with links

## Technical Details

- Uses Canvas API for WebP decoding (no native modules needed)
- Implements recursive setTimeout for reliable polling
- LocalStorage + in-memory caching for performance
- CORS-friendly (runs on any domain)

## License

MIT
