// Path Tracker Backend - server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (use MongoDB/PostgreSQL for production)
const trackingSessions = new Map();
const locationData = new Map();

// Utility: Generate session ID
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// Utility: Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Utility: Optimize path by removing redundant points
function optimizePath(locations, minDistance = 10) {
  if (locations.length <= 2) return locations;
  
  const optimized = [locations[0]];
  
  for (let i = 1; i < locations.length - 1; i++) {
    const prev = optimized[optimized.length - 1];
    const curr = locations[i];
    const distance = calculateDistance(
      prev.latitude, prev.longitude,
      curr.latitude, curr.longitude
    );
    
    // Only keep point if it's far enough from the last kept point
    if (distance >= minDistance) {
      optimized.push(curr);
    }
  }
  
  // Always keep the last point
  optimized.push(locations[locations.length - 1]);
  
  return optimized;
}

// Utility: Calculate path statistics
function calculatePathStats(locations) {
  if (locations.length < 2) {
    return {
      totalDistance: 0,
      averageSpeed: 0,
      duration: 0,
      points: locations.length
    };
  }
  
  let totalDistance = 0;
  
  for (let i = 1; i < locations.length; i++) {
    const distance = calculateDistance(
      locations[i-1].latitude, locations[i-1].longitude,
      locations[i].latitude, locations[i].longitude
    );
    totalDistance += distance;
  }
  
  const startTime = new Date(locations[0].timestamp);
  const endTime = new Date(locations[locations.length - 1].timestamp);
  const duration = (endTime - startTime) / 1000; // seconds
  
  const averageSpeed = duration > 0 ? (totalDistance / duration) * 3.6 : 0; // km/h
  
  return {
    totalDistance: totalDistance.toFixed(2),
    averageSpeed: averageSpeed.toFixed(2),
    duration: Math.round(duration),
    points: locations.length
  };
}

// API Routes

// Create new tracking session
app.post('/api/session/start', (req, res) => {
  const { userId, duration } = req.body;
  
  if (!userId || !duration) {
    return res.status(400).json({ error: 'userId and duration are required' });
  }
  
  const sessionId = generateSessionId();
  const session = {
    sessionId,
    userId,
    duration,
    startTime: new Date(),
    endTime: new Date(Date.now() + duration * 60 * 1000),
    active: true,
    locationCount: 0
  };
  
  trackingSessions.set(sessionId, session);
  locationData.set(sessionId, []);
  
  res.json({
    success: true,
    sessionId,
    message: 'Tracking session started',
    session
  });
});

// Receive location update
app.post('/api/location/update', (req, res) => {
  const { sessionId, latitude, longitude, accuracy, timestamp } = req.body;
  
  if (!sessionId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const session = trackingSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (!session.active) {
    return res.status(400).json({ error: 'Session is not active' });
  }
  
  // Check if session has expired
  if (new Date() > session.endTime) {
    session.active = false;
    trackingSessions.set(sessionId, session);
    return res.status(400).json({ error: 'Session has expired' });
  }
  
  const location = {
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    accuracy: accuracy ? parseFloat(accuracy) : null,
    timestamp: timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString()
  };
  
  const locations = locationData.get(sessionId);
  locations.push(location);
  locationData.set(sessionId, locations);
  
  session.locationCount = locations.length;
  trackingSessions.set(sessionId, session);
  
  res.json({
    success: true,
    message: 'Location updated',
    locationCount: locations.length
  });
});

// Get session path (optimized)
app.get('/api/session/:sessionId/path', (req, res) => {
  const { sessionId } = req.params;
  const { optimize } = req.query;
  
  const session = trackingSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  let locations = locationData.get(sessionId) || [];
  
  if (optimize === 'true' && locations.length > 0) {
    locations = optimizePath(locations, 10); // Remove points closer than 10m
  }
  
  const stats = calculatePathStats(locationData.get(sessionId) || []);
  
  res.json({
    success: true,
    session,
    locations,
    stats,
    optimized: optimize === 'true'
  });
});

// Get session statistics
app.get('/api/session/:sessionId/stats', (req, res) => {
  const { sessionId } = req.params;
  
  const session = trackingSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const locations = locationData.get(sessionId) || [];
  const stats = calculatePathStats(locations);
  
  res.json({
    success: true,
    session,
    stats
  });
});

// Stop tracking session
app.post('/api/session/:sessionId/stop', (req, res) => {
  const { sessionId } = req.params;
  
  const session = trackingSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  session.active = false;
  session.actualEndTime = new Date();
  trackingSessions.set(sessionId, session);
  
  const locations = locationData.get(sessionId) || [];
  const stats = calculatePathStats(locations);
  
  res.json({
    success: true,
    message: 'Session stopped',
    session,
    stats
  });
});

// Get all sessions for a user
app.get('/api/user/:userId/sessions', (req, res) => {
  const { userId } = req.params;
  
  const userSessions = [];
  
  for (const [sessionId, session] of trackingSessions) {
    if (session.userId === userId) {
      const locations = locationData.get(sessionId) || [];
      const stats = calculatePathStats(locations);
      userSessions.push({
        ...session,
        stats
      });
    }
  }
  
  res.json({
    success: true,
    userId,
    sessions: userSessions
  });
});

// Export session data (for backup/analysis)
app.get('/api/session/:sessionId/export', (req, res) => {
  const { sessionId } = req.params;
  const { format } = req.query;
  
  const session = trackingSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const locations = locationData.get(sessionId) || [];
  
  if (format === 'gpx') {
    // Generate GPX format
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PathTracker">
  <trk>
    <name>Track ${sessionId}</name>
    <trkseg>`;
    
    locations.forEach(loc => {
      gpx += `
      <trkpt lat="${loc.latitude}" lon="${loc.longitude}">
        <time>${loc.timestamp}</time>
      </trkpt>`;
    });
    
    gpx += `
    </trkseg>
  </trk>
</gpx>`;
    
    res.set('Content-Type', 'application/gpx+xml');
    res.set('Content-Disposition', `attachment; filename="track_${sessionId}.gpx"`);
    res.send(gpx);
  } else {
    // JSON format
    res.json({
      session,
      locations,
      stats: calculatePathStats(locations)
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeSessions: Array.from(trackingSessions.values()).filter(s => s.active).length,
    totalSessions: trackingSessions.size
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Path Tracker Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;