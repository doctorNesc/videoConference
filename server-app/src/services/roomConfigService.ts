import fs from 'fs';
import path from 'path';
import { RoomConfig, DevicePairingConfig } from '../types';

const ROOMS_DIR = path.join(__dirname, '../../rooms');
const SPLATS_DIR = path.join(ROOMS_DIR, 'splats');

// Ensure directories exist
function ensureDirectories() {
  if (!fs.existsSync(ROOMS_DIR)) {
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SPLATS_DIR)) {
    fs.mkdirSync(SPLATS_DIR, { recursive: true });
  }
}

/**
 * Load all room configs from disk
 */
export function loadAllRoomConfigs(): RoomConfig[] {
  ensureDirectories();
  const configs: RoomConfig[] = [];
  
  try {
    const allFiles = fs.readdirSync(ROOMS_DIR);
    const files = allFiles.filter(f => {
      // Only load room config files (not device pairing configs which contain a dash)
      return f.endsWith('.json') && !f.includes('-');
    });
    
    for (const file of files) {
      try {
        const filePath = path.join(ROOMS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content) as RoomConfig;
        configs.push(config);
      } catch (fileErr) {
        console.error(`[RoomConfigService] Error loading individual room config ${file}:`, fileErr);
        // Continue loading other files instead of failing completely
      }
    }
  } catch (err) {
    console.error('[RoomConfigService] Error reading rooms directory:', err);
  }
  
  return configs;
}

/**
 * Load a single room config by name
 */
export function loadRoomConfig(roomName: string): RoomConfig | null {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${roomName}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as RoomConfig;
    }
  } catch (err) {
    console.error(`[RoomConfigService] Error loading room config for ${roomName}:`, err);
  }
  
  return null;
}

/**
 * Save a room config to disk
 */
export function saveRoomConfig(config: RoomConfig): void {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${config.roomName}.json`);
  
  try {
    config.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[RoomConfigService] Saved room config: ${config.roomName}`);
  } catch (err) {
    console.error(`[RoomConfigService] Error saving room config for ${config.roomName}:`, err);
    throw err;
  }
}

/**
 * Create a new room config
 */
export function createRoomConfig(roomName: string, splatPath: string): RoomConfig {
  const now = new Date().toISOString();
  const config: RoomConfig = {
    roomName,
    splatPath,
    displays: [],
    createdAt: now,
    updatedAt: now,
  };
  saveRoomConfig(config);
  return config;
}

/**
 * Delete a room config
 */
export function deleteRoomConfig(roomName: string): void {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${roomName}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[RoomConfigService] Deleted room config: ${roomName}`);
    }
  } catch (err) {
    console.error(`[RoomConfigService] Error deleting room config for ${roomName}:`, err);
    throw err;
  }
}

/**
 * Get the path to a room's splat file
 */
export function getSplatPath(roomName: string): string {
  return path.join(SPLATS_DIR, `${roomName}.splat`);
}

/**
 * Check if a splat file exists for a room
 */
export function splatExists(roomName: string): boolean {
  return fs.existsSync(getSplatPath(roomName));
}

/**
 * Load device pairing config
 */
export function loadDevicePairingConfig(roomName: string, deviceFingerprint: string): DevicePairingConfig | null {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${roomName}-${deviceFingerprint}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as DevicePairingConfig;
    }
  } catch (err) {
    console.error(`[RoomConfigService] Error loading device pairing for ${roomName}/${deviceFingerprint}:`, err);
  }
  
  return null;
}

/**
 * Save device pairing config
 */
export function saveDevicePairingConfig(config: DevicePairingConfig): void {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${config.roomName}-${config.deviceFingerprint}.json`);
  
  try {
    config.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[RoomConfigService] Saved device pairing: ${config.roomName}/${config.deviceFingerprint}`);
  } catch (err) {
    console.error(`[RoomConfigService] Error saving device pairing:`, err);
    throw err;
  }
}

/**
 * Delete device pairing config
 */
export function deleteDevicePairingConfig(roomName: string, deviceFingerprint: string): void {
  ensureDirectories();
  const filePath = path.join(ROOMS_DIR, `${roomName}-${deviceFingerprint}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[RoomConfigService] Deleted device pairing: ${roomName}/${deviceFingerprint}`);
    }
  } catch (err) {
    console.error(`[RoomConfigService] Error deleting device pairing:`, err);
    throw err;
  }
}
