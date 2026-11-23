import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { ChildProcess, exec, execFile, execSync, spawn } from 'child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import {
  DEFAULT_BELL_RANDOMIZER_CONFIG,
  DEFAULT_REMOTE_BELLS_URL,
  DEFAULT_TV_DISPLAY_CONFIG,
  INITIAL_CONFIG,
} from './src/data/defaultConfig';
import { PRESET_SOUNDS, getPresetWavBytes } from './src/utils/wavGenerator';
import {
  AmplifierRule,
  AmplifierStatus,
  AppConfig,
  AuthStatus,
  BellHistoryEntry,
  BellItem,
  BellRandomizerConfig,
  BellType,
  DebianGitConfig,
  DebianUpdateCheckResult,
  DebianUpdateJobStatus,
  DetectedSerialPort,
  PermissionGroup,
  PermissionKey,
  RadioPlaybackStatus,
  RadioStation,
  RemoteBellFile,
  RemoteBellScanResult,
  SoundTrack,
  SystemMetricsPoint,
  SystemStatus,
  TvDisplayConfig,
  TvPublicData,
  UserAccountPublic,
} from './src/types/bell';
import { ALL_PERMISSION_KEYS } from './src/utils/permissions';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Support JSON payload up to 25MB for audio uploads
app.use(express.json({ limit: '25mb' }));

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SOUNDS_DIR = path.resolve(DATA_DIR, 'sounds');
const CONFIG_FILE = path.resolve(DATA_DIR, 'config.json');
const HISTORY_FILE = path.resolve(DATA_DIR, 'history.json');
const CUSTOM_SOUNDS_FILE = path.resolve(DATA_DIR, 'custom_sounds.json');
const AUTH_FILE = path.resolve(DATA_DIR, 'auth.json');
const GIT_CONFIG_FILE = path.resolve(DATA_DIR, 'git_repo.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SOUNDS_DIR)) {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

// Ensure preset WAV files are written to disk for Linux audio players
console.log('[HarmoniaBell] Sprawdzanie i generowanie plików WAV dla Debiana...');
for (const preset of PRESET_SOUNDS) {
  const wavPath = path.join(SOUNDS_DIR, `${preset.id}.wav`);
  if (!fs.existsSync(wavPath)) {
    try {
      const bytes = getPresetWavBytes(preset.id);
      fs.writeFileSync(wavPath, Buffer.from(bytes));
      console.log(`[HarmoniaBell] Wygenerowano dźwięk: ${preset.id}.wav`);
    } catch (err) {
      console.error(`Błąd generowania dźwięku ${preset.id}:`, err);
    }
  }
}

// Serve audio files statically
app.use('/sounds', express.static(SOUNDS_DIR));

// Load or initialize config
let config: AppConfig = INITIAL_CONFIG;
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    config = { ...INITIAL_CONFIG, ...parsed };
    if (!config.radioStations || config.radioStations.length === 0) {
      config.radioStations = INITIAL_CONFIG.radioStations;
    }
    if (!config.amplifierDevicePath) {
      config.amplifierDevicePath = INITIAL_CONFIG.amplifierDevicePath;
    }
    if (!Array.isArray(config.amplifierSchedule)) {
      config.amplifierSchedule = INITIAL_CONFIG.amplifierSchedule;
    }
    config.tvDisplay = {
      ...DEFAULT_TV_DISPLAY_CONFIG,
      ...(parsed.tvDisplay && typeof parsed.tvDisplay === 'object' ? parsed.tvDisplay : {}),
    };
    config.remoteBellsUrl =
      typeof parsed.remoteBellsUrl === 'string' && parsed.remoteBellsUrl.trim()
        ? parsed.remoteBellsUrl.trim()
        : DEFAULT_REMOTE_BELLS_URL;
    config.bellRandomizer = {
      ...DEFAULT_BELL_RANDOMIZER_CONFIG,
      ...(parsed.bellRandomizer && typeof parsed.bellRandomizer === 'object' ? parsed.bellRandomizer : {}),
      activeDays: Array.isArray(parsed.bellRandomizer?.activeDays)
        ? parsed.bellRandomizer.activeDays
        : DEFAULT_BELL_RANDOMIZER_CONFIG.activeDays,
      selectedSoundIds: Array.isArray(parsed.bellRandomizer?.selectedSoundIds)
        ? parsed.bellRandomizer.selectedSoundIds
        : DEFAULT_BELL_RANDOMIZER_CONFIG.selectedSoundIds,
      weekAssignments:
        parsed.bellRandomizer?.weekAssignments &&
        typeof parsed.bellRandomizer.weekAssignments === 'object' &&
        !Array.isArray(parsed.bellRandomizer.weekAssignments)
          ? parsed.bellRandomizer.weekAssignments
          : {},
    };
    // Migrate pre-Saturday weekMapping so Sunday stays silent while Saturday is configurable/active
    if (typeof parsed.weekMappingVersion !== 'number') {
      config.weekMapping = {
        ...INITIAL_CONFIG.weekMapping,
        ...(parsed.weekMapping || {}),
        0: '__silent__',
      };
      config.weekMappingVersion = 2;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
  } catch (e) {
    console.error('Błąd odczytu config.json, używam domyślnej konfiguracji:', e);
  }
} else {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Load custom sounds
let customSounds: SoundTrack[] = [];
if (fs.existsSync(CUSTOM_SOUNDS_FILE)) {
  try {
    customSounds = JSON.parse(fs.readFileSync(CUSTOM_SOUNDS_FILE, 'utf-8'));
  } catch {
    customSounds = [];
  }
}

// Load history
let history: BellHistoryEntry[] = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    history = [];
  }
}

function saveHistory() {
  try {
    // Keep last 150 entries
    if (history.length > 150) {
      history = history.slice(0, 150);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('Błąd zapisu historii:', err);
  }
}

// ==================== AUTHENTICATION, GROUPS & RBAC ====================
interface UserAccountRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string; // salt:scryptHex
  groupId: string;
  active: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
  createdAt: string;
}

interface AuthStore {
  sessionSecret: string;
  groups: PermissionGroup[];
  users: UserAccountRecord[];
}

interface AuthenticatedContext {
  user: UserAccountRecord;
  group: PermissionGroup;
  permissions: PermissionKey[];
}

interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedContext;
}

const SESSION_COOKIE_NAME = 'harmonia_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function createDefaultGroups(): PermissionGroup[] {
  return [
    {
      id: 'grp_admin',
      name: 'Administratorzy',
      description: 'Pełny dostęp do całego systemu, harmonogramów, radia oraz zarządzania użytkownikami i grupami.',
      isSystem: true,
      permissions: [...ALL_PERMISSION_KEYS],
    },
    {
      id: 'grp_radiowezel',
      name: 'Obsługa Radiowęzła',
      description: 'Zarządzanie stacjami radiowymi, puszczanie muzyki, dodawanie melodii i dzwonek ręczny.',
      isSystem: false,
      permissions: ['dashboard_view', 'manual_bell', 'radio_control', 'sounds_manage', 'logs_view'],
    },
    {
      id: 'grp_sekretariat',
      name: 'Sekretariat / Dyrekcja',
      description: 'Edycja harmonogramów lekcji, kalendarza dni wolnych, wyciszenie i podgląd dziennika.',
      isSystem: false,
      permissions: ['dashboard_view', 'manual_bell', 'schedules_edit', 'calendar_edit', 'logs_view'],
    },
  ];
}

function createInitialAuthStore(): AuthStore {
  return {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    groups: createDefaultGroups(),
    users: [
      {
        id: 'usr_admin',
        username: 'admin',
        displayName: 'Administrator',
        passwordHash: hashPassword('admin'),
        groupId: 'grp_admin',
        active: true,
        mustChangePassword: true,
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

let authStore: AuthStore;
if (fs.existsSync(AUTH_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (Array.isArray(raw.users) && Array.isArray(raw.groups)) {
      authStore = {
        sessionSecret: raw.sessionSecret || crypto.randomBytes(32).toString('hex'),
        groups: raw.groups.length > 0 ? raw.groups : createDefaultGroups(),
        users: raw.users,
      };
    } else {
      // Migrate legacy single-admin auth.json seamlessly
      authStore = {
        sessionSecret: raw.sessionSecret || crypto.randomBytes(32).toString('hex'),
        groups: createDefaultGroups(),
        users: [
          {
            id: 'usr_admin',
            username: raw.username || 'admin',
            displayName: 'Administrator',
            passwordHash: raw.passwordHash || hashPassword('admin'),
            groupId: 'grp_admin',
            active: true,
            mustChangePassword: Boolean(raw.mustChangePassword),
            tokenVersion: typeof raw.tokenVersion === 'number' ? raw.tokenVersion : 1,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
    }
  } catch {
    authStore = createInitialAuthStore();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
  }
} else {
  authStore = createInitialAuthStore();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
}

function saveAuthStore() {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
}

function sanitizePermissions(raw: unknown): PermissionKey[] {
  if (!Array.isArray(raw)) return [];
  const validSet = new Set<string>(ALL_PERMISSION_KEYS);
  const unique = new Set<PermissionKey>();
  for (const item of raw) {
    if (typeof item === 'string' && validSet.has(item)) {
      unique.add(item as PermissionKey);
    }
  }
  return Array.from(unique);
}

function resolveUserContext(user: UserAccountRecord): AuthenticatedContext {
  const group =
    authStore.groups.find((g) => g.id === user.groupId) ||
    ({
      id: user.groupId,
      name: 'Brak grupy',
      description: '',
      permissions: [],
    } as PermissionGroup);
  return {
    user,
    group,
    permissions: sanitizePermissions(group.permissions),
  };
}

function toPublicUser(user: UserAccountRecord): UserAccountPublic {
  const group = authStore.groups.find((g) => g.id === user.groupId);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    groupId: user.groupId,
    groupName: group ? group.name : 'Nieznana grupa',
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

function buildAuthStatus(ctx: AuthenticatedContext | null): AuthStatus {
  const defaultAdmin = authStore.users.find((u) => u.username === 'admin' || u.id === 'usr_admin');
  if (!ctx) {
    return {
      authenticated: false,
      userId: null,
      username: null,
      displayName: null,
      groupId: null,
      groupName: null,
      permissions: [],
      mustChangePassword: Boolean(defaultAdmin?.mustChangePassword),
    };
  }
  return {
    authenticated: true,
    userId: ctx.user.id,
    username: ctx.user.username,
    displayName: ctx.user.displayName,
    groupId: ctx.group.id,
    groupName: ctx.group.name,
    permissions: ctx.permissions,
    mustChangePassword: ctx.user.mustChangePassword,
  };
}

function createSessionToken(user: UserAccountRecord): string {
  const payload = {
    uid: user.id,
    v: user.tokenVersion,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', authStore.sessionSecret)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token: string | undefined): AuthenticatedContext | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', authStore.sessionSecret)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() || typeof payload.uid !== 'string') {
      return null;
    }
    const user = authStore.users.find((u) => u.id === payload.uid);
    if (!user || !user.active || payload.v !== user.tokenVersion) {
      return null;
    }
    return resolveUserContext(user);
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function extractRequestToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const ctx = verifySessionToken(extractRequestToken(req));
  if (!ctx) {
    return res.status(401).json({ error: 'Wymagane zalogowanie do panelu administratora' });
  }
  req.auth = ctx;
  next();
}

function requireAnyPermission(allowed: PermissionKey[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const ctx = verifySessionToken(extractRequestToken(req));
    if (!ctx) {
      return res.status(401).json({ error: 'Wymagane zalogowanie do panelu administratora' });
    }
    req.auth = ctx;
    const ok = allowed.some((p) => ctx.permissions.includes(p));
    if (!ok) {
      return res.status(403).json({ error: 'Brak wymaganych uprawnień do wykonania tej operacji' });
    }
    next();
  };
}

function countActiveUsersWithPermission(perm: PermissionKey): number {
  return authStore.users.filter((u) => {
    if (!u.active) return false;
    const grp = authStore.groups.find((g) => g.id === u.groupId);
    return Boolean(grp && grp.permissions.includes(perm));
  }).length;
}

// Detect installed Linux audio player
function detectLinuxAudioPlayer(): string {
  const tools = ['mpv', 'paplay', 'aplay', 'ffplay', 'mpg123'];
  for (const tool of tools) {
    try {
      execSync(`which ${tool} 2>/dev/null`);
      return tool;
    } catch {
      // not found
    }
  }
  return 'simulation_mode';
}

const detectedAudioTool = detectLinuxAudioPlayer();
console.log(`[HarmoniaBell] Wykryty silnik audio Linux: ${detectedAudioTool}`);

// Audio playback on Linux
function playSoundOnLinux(
  soundId: string,
  volumePercent: number = 80
): Promise<{ success: boolean; tool: string; error?: string }> {
  return new Promise((resolve) => {
    // Find file path safely inside SOUNDS_DIR
    let filePath = path.resolve(SOUNDS_DIR, `${path.basename(soundId)}.wav`);
    if (!filePath.startsWith(SOUNDS_DIR + path.sep) || !fs.existsSync(filePath)) {
      // Check custom sounds
      const custom = customSounds.find((s) => s.id === soundId);
      if (custom && custom.filename) {
        const candidate = path.resolve(SOUNDS_DIR, path.basename(custom.filename));
        if (candidate.startsWith(SOUNDS_DIR + path.sep)) {
          filePath = candidate;
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      // Fallback to first preset
      filePath = path.join(SOUNDS_DIR, `${PRESET_SOUNDS[0].id}.wav`);
    }

    if (!fs.existsSync(filePath)) {
      return resolve({ success: false, tool: 'none', error: 'Brak pliku audio' });
    }

    const tool = config.audioEngine !== 'auto' ? config.audioEngine : detectedAudioTool;

    if (tool === 'simulation_mode' || process.platform === 'win32' || process.platform === 'darwin') {
      // Emulate playback on platforms without linux PA or in container without hardware card
      console.log(`[HarmoniaBell - Audio Simulation] Odtwarzanie dźwięku: ${filePath} (Głośność: ${volumePercent}%)`);
      return resolve({ success: true, tool: 'simulation_mode' });
    }

    let cmd = '';
    const volFloat = Math.max(0.1, Math.min(1.0, volumePercent / 100));

    if (tool === 'mpv') {
      cmd = `mpv --no-video --volume=${Math.round(volFloat * 100)} "${filePath}" >/dev/null 2>&1`;
    } else if (tool === 'paplay') {
      const paVol = Math.round(volFloat * 65536);
      cmd = `paplay --volume=${paVol} "${filePath}" >/dev/null 2>&1`;
    } else if (tool === 'aplay') {
      const dev = config.audioDevice && config.audioDevice !== 'default' ? `-D ${config.audioDevice}` : '';
      cmd = `aplay -q ${dev} "${filePath}" >/dev/null 2>&1`;
    } else if (tool === 'ffplay') {
      cmd = `ffplay -nodisp -autoexit -volume ${Math.round(volFloat * 100)} "${filePath}" >/dev/null 2>&1`;
    } else {
      cmd = `play -v ${volFloat} "${filePath}" >/dev/null 2>&1`;
    }

    exec(cmd, (error) => {
      if (error) {
        console.warn(`[HarmoniaBell] Odtwarzacz ${tool} zwrócił kod wyjścia:`, error.message);
        resolve({ success: false, tool, error: error.message });
      } else {
        resolve({ success: true, tool });
      }
    });
  });
}

// ==================== INTERNET RADIO STREAM ENGINE ====================
let radioProcess: ChildProcess | null = null;
let radioStatus: RadioPlaybackStatus = {
  isPlaying: false,
  stationId: null,
  stationName: null,
  streamUrl: null,
  mode: 'none',
  startedAt: null,
  tool: undefined,
};
let activeBreakRadioKey: string | null = null;
let manuallyStoppedBreakKey: string | null = null;

function detectRadioPlayer(): string {
  const tools = ['mpv', 'ffplay', 'mpg123'];
  for (const tool of tools) {
    try {
      execSync(`which ${tool} 2>/dev/null`);
      return tool;
    } catch {
      // not found
    }
  }
  return 'simulation_mode';
}

const detectedRadioTool = detectRadioPlayer();

function logRadioEvent(type: 'radio_start' | 'radio_stop', title: string, stationName: string, status: 'played_linux' | 'simulated' | 'error', details: string) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  history.unshift({
    id: `radio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.toISOString(),
    timeStr,
    bellType: type,
    title,
    soundName: stationName,
    status,
    details,
  });
  saveHistory();
}

function stopRadioStream(reason?: string, logStop: boolean = true): void {
  const wasPlaying = radioStatus.isPlaying;
  const prevStationName = radioStatus.stationName || 'Radio internetowe';
  const prevMode = radioStatus.mode;
  const prevTool = radioStatus.tool;

  if (radioProcess) {
    try {
      radioProcess.kill('SIGTERM');
      setTimeout(() => {
        if (radioProcess && !radioProcess.killed) {
          try {
            radioProcess.kill('SIGKILL');
          } catch {}
        }
      }, 800);
    } catch {}
    radioProcess = null;
  }

  radioStatus = {
    isPlaying: false,
    stationId: null,
    stationName: null,
    streamUrl: null,
    mode: 'none',
    startedAt: null,
    tool: undefined,
  };

  if (wasPlaying && logStop) {
    console.log(`[HarmoniaBell - Radio] Zatrzymano: ${prevStationName} (${reason || 'stop'})`);
    logRadioEvent(
      'radio_stop',
      prevMode === 'auto_break' ? 'Zakończenie radia na przerwie' : 'Zatrzymanie radia',
      prevStationName,
      prevTool === 'simulation_mode' ? 'simulated' : 'played_linux',
      reason || 'Zatrzymano odtwarzanie strumienia'
    );
  }
}

function startRadioStream(
  station: RadioStation,
  mode: 'auto_break' | 'manual',
  volumePercent?: number
): { success: boolean; tool: string; error?: string } {
  // Stop any existing stream quietly before starting new one
  if (radioStatus.isPlaying) {
    stopRadioStream('Zmiana stacji', false);
  }

  const vol = Math.max(5, Math.min(100, volumePercent ?? config.radioVolume ?? 45));
  const tool =
    config.audioEngine === 'mpv' || config.audioEngine === 'ffplay'
      ? config.audioEngine
      : detectedRadioTool;

  if (tool === 'simulation_mode' || process.platform === 'win32' || process.platform === 'darwin') {
    console.log(`[HarmoniaBell - Radio Simulation] Start strumienia: ${station.name} (${station.streamUrl}) Głośność: ${vol}%`);
    radioStatus = {
      isPlaying: true,
      stationId: station.id,
      stationName: station.name,
      streamUrl: station.streamUrl,
      mode,
      startedAt: new Date().toISOString(),
      tool: 'simulation_mode',
    };
    logRadioEvent(
      'radio_start',
      mode === 'auto_break' ? 'Radio na przerwie (auto)' : 'Radio uruchomione ręcznie',
      station.name,
      'simulated',
      `Głośność: ${vol}%, Tryb: symulacja Web/Linux`
    );
    return { success: true, tool: 'simulation_mode' };
  }

  try {
    let args: string[] = [];
    if (tool === 'mpv') {
      args = [
        '--no-video',
        '--no-terminal',
        `--volume=${vol}`,
        '--network-timeout=10',
        station.streamUrl,
      ];
    } else if (tool === 'ffplay') {
      args = ['-nodisp', '-loglevel', 'quiet', '-volume', String(vol), station.streamUrl];
    } else {
      args = ['-q', station.streamUrl];
    }

    const child = spawn(tool, args, { stdio: 'ignore', detached: false });
    radioProcess = child;

    child.on('exit', (code) => {
      if (radioProcess === child) {
        radioProcess = null;
        if (radioStatus.isPlaying) {
          radioStatus = {
            isPlaying: false,
            stationId: null,
            stationName: null,
            streamUrl: null,
            mode: 'none',
            startedAt: null,
            tool: undefined,
          };
        }
      }
      if (code && code !== 0 && code !== 143) {
        console.warn(`[HarmoniaBell - Radio] Proces ${tool} zakończony kodem ${code}`);
      }
    });

    child.on('error', (err) => {
      console.error(`[HarmoniaBell - Radio] Błąd uruchomienia ${tool}:`, err.message);
      if (radioProcess === child) {
        radioProcess = null;
      }
      stopRadioStream(`Błąd: ${err.message}`, false);
    });

    radioStatus = {
      isPlaying: true,
      stationId: station.id,
      stationName: station.name,
      streamUrl: station.streamUrl,
      mode,
      startedAt: new Date().toISOString(),
      tool,
    };

    console.log(`[HarmoniaBell - Radio] Odtwarzanie (${tool}): ${station.name} -> ${station.streamUrl} (${vol}%)`);
    logRadioEvent(
      'radio_start',
      mode === 'auto_break' ? 'Radio na przerwie (auto)' : 'Radio uruchomione ręcznie',
      station.name,
      'played_linux',
      `Głośność: ${vol}%, Silnik: ${tool}`
    );

    return { success: true, tool };
  } catch (err: any) {
    return { success: false, tool, error: err.message };
  }
}

// Active Profile Resolver for current moment
function getActiveProfileForNow(now: Date): {
  profile: any;
  isHoliday: boolean;
  isNonWorkingDay: boolean;
  holidayName?: string;
} {
  const dateStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

  // Check holiday
  const holiday = config.holidays.find((h) => dateStr >= h.startDate && dateStr <= h.endDate);
  if (holiday) {
    if (holiday.type === 'special_schedule' && holiday.overrideProfileId) {
      const override = config.schedules.find((s) => s.id === holiday.overrideProfileId);
      if (override) {
        return { profile: override, isHoliday: false, isNonWorkingDay: false, holidayName: holiday.name };
      }
    }
    return { profile: null, isHoliday: true, isNonWorkingDay: false, holidayName: holiday.name };
  }

  // Weekday mapping (1 = Pn .. 6 = Sb, 0 = Nd; '__silent__' disables bells for that day)
  const mappedProfileId = config.weekMapping[dayOfWeek];
  if (mappedProfileId === '__silent__') {
    return { profile: null, isHoliday: false, isNonWorkingDay: true };
  }

  const profileId = mappedProfileId || config.activeProfileId;
  const profile = config.schedules.find((s) => s.id === profileId) || config.schedules[0];
  return { profile, isHoliday: false, isNonWorkingDay: false };
}

// Compute current system status for dashboard
function computeSystemStatus(): SystemStatus {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const currentTimeStr = `${hours}:${minutes}:${seconds}`;
  const currentDateStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday

  const isMuted = config.muteUntil ? new Date(config.muteUntil) > now : false;
  const { profile, isHoliday, isNonWorkingDay, holidayName } = getActiveProfileForNow(now);
  const isWeekend = isNonWorkingDay;

  const activeProfile = profile || config.schedules.find((s) => s.id === config.activeProfileId) || config.schedules[0];

  // Evaluate current period and next bell
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  let currentPeriod: SystemStatus['currentPeriod'] = {
    type: 'before_school',
    label: 'Przed lekcjami',
    timeRange: 'Przed 08:00',
    remainingSeconds: 0,
    totalSeconds: 0,
    progressPercent: 0,
  };

  let nextBell: SystemStatus['nextBell'] = null;

  if (activeProfile && activeProfile.items && activeProfile.items.length > 0) {
    const sortedItems: BellItem[] = [...activeProfile.items]
      .filter((i) => i.enabled)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    if (sortedItems.length > 0) {
      const firstItem = sortedItems[0];
      const lastItem = sortedItems[sortedItems.length - 1];

      const [firstH, firstM] = firstItem.startTime.split(':').map(Number);
      const firstStartMin = firstH * 60 + firstM;

      const [lastH, lastM] = lastItem.endTime.split(':').map(Number);
      const lastEndMin = lastH * 60 + lastM;

      if (nowMinutes < firstStartMin) {
        const remainingSec = Math.max(0, Math.round((firstStartMin - nowMinutes) * 60));
        currentPeriod = {
          type: 'before_school',
          label: 'Przed rozpoczęciem zajęć',
          timeRange: `Do ${firstItem.startTime}`,
          remainingSeconds: remainingSec,
          totalSeconds: 3600,
          progressPercent: Math.min(100, Math.round((1 - remainingSec / 3600) * 100)),
        };

        const { soundName } = resolveEffectiveBellSound('start', firstItem.startSoundId, config.defaultStartSoundId, now);
        nextBell = {
          timeStr: firstItem.startTime,
          type: 'lesson_start',
          label: `Rozpoczęcie: ${firstItem.name}`,
          secondsRemaining: remainingSec,
          soundName,
        };
      } else if (nowMinutes >= lastEndMin) {
        currentPeriod = {
          type: 'after_school',
          label: 'Koniec zajęć na dziś',
          timeRange: `Po ${lastItem.endTime}`,
          remainingSeconds: 0,
          totalSeconds: 0,
          progressPercent: 100,
        };
      } else {
        // Iterate through items
        let matched = false;
        for (let i = 0; i < sortedItems.length; i++) {
          const item = sortedItems[i];
          const [sH, sM] = item.startTime.split(':').map(Number);
          const [eH, eM] = item.endTime.split(':').map(Number);
          const startMin = sH * 60 + sM;
          const endMin = eH * 60 + eM;

          if (nowMinutes >= startMin && nowMinutes < endMin) {
            // We are IN this lesson!
            const totalSec = (endMin - startMin) * 60;
            const remainingSec = Math.max(0, Math.round((endMin - nowMinutes) * 60));
            const progress = Math.min(100, Math.round(((totalSec - remainingSec) / totalSec) * 100));

            currentPeriod = {
              type: 'lesson',
              label: item.name,
              timeRange: `${item.startTime} - ${item.endTime}`,
              remainingSeconds: remainingSec,
              totalSeconds: totalSec,
              progressPercent: progress,
            };

            const { soundName: endSoundName } = resolveEffectiveBellSound(
              'end',
              item.endSoundId,
              config.defaultEndSoundId,
              now
            );
            nextBell = {
              timeStr: item.endTime,
              type: 'lesson_end',
              label: `Koniec: ${item.name}`,
              secondsRemaining: remainingSec,
              soundName: endSoundName,
            };
            matched = true;
            break;
          }

          // Check if we are in break between this item and next item
          if (i < sortedItems.length - 1) {
            const nextItem = sortedItems[i + 1];
            const [nextSH, nextSM] = nextItem.startTime.split(':').map(Number);
            const nextStartMin = nextSH * 60 + nextSM;

            if (nowMinutes >= endMin && nowMinutes < nextStartMin) {
              const breakTotalSec = (nextStartMin - endMin) * 60;
              const breakRemSec = Math.max(0, Math.round((nextStartMin - nowMinutes) * 60));
              const breakProgress = Math.min(100, Math.round(((breakTotalSec - breakRemSec) / breakTotalSec) * 100));

              // Check if warning bell occurs soon
              const warnMinutes = nextItem.warningMinutesBefore ?? 1;
              const warnTimeMin = nextStartMin - warnMinutes;

              let nextBellType: BellType = 'lesson_start';
              let nextBellTimeStr = nextItem.startTime;
              let nextBellLabel = `Koniec przerwy: ${nextItem.name}`;
              let nextBellSeconds = breakRemSec;
              let nextBellSound = resolveEffectiveBellSound(
                'start',
                nextItem.startSoundId,
                config.defaultStartSoundId,
                now
              ).soundName;

              if (config.warningBellEnabled && warnMinutes > 0 && nowMinutes < warnTimeMin) {
                const warnRemSec = Math.max(0, Math.round((warnTimeMin - nowMinutes) * 60));
                nextBellType = 'warning';
                const warnH = Math.floor(warnTimeMin / 60);
                const warnM = Math.floor(warnTimeMin % 60);
                nextBellTimeStr = `${String(warnH).padStart(2, '0')}:${String(warnM).padStart(2, '0')}`;
                nextBellLabel = `Dzwonek przywoławczy (1 min)`;
                nextBellSeconds = warnRemSec;
                nextBellSound = resolveEffectiveBellSound(
                  'warning',
                  nextItem.warningSoundId,
                  config.defaultWarningSoundId,
                  now
                ).soundName;
              }

              currentPeriod = {
                type: 'break',
                label: `Przerwa (${Math.round(breakTotalSec / 60)} min)`,
                timeRange: `${item.endTime} - ${nextItem.startTime}`,
                remainingSeconds: breakRemSec,
                totalSeconds: breakTotalSec,
                progressPercent: breakProgress,
              };

              nextBell = {
                timeStr: nextBellTimeStr,
                type: nextBellType,
                label: nextBellLabel,
                secondsRemaining: nextBellSeconds,
                soundName: nextBellSound,
              };
              matched = true;
              break;
            }
          }
        }
      }
    }
  }

  return {
    serverTime: now.toISOString(),
    currentTimeStr,
    currentDayOfWeek: dayOfWeek === 0 ? 7 : dayOfWeek, // 1 = Pn, 7 = Nd
    currentDateStr,
    isWeekend,
    isHoliday,
    holidayName,
    isMuted,
    activeProfileName: activeProfile ? activeProfile.name : 'Domyślny',
    activeProfileId: activeProfile ? activeProfile.id : 'standard_45min',
    currentPeriod,
    nextBell,
    radioStatus,
    amplifierStatus: getAmplifierStatus(),
    telemetry: latestSystemMetric || undefined,
    detectedAudioTool,
    platform: process.platform,
    uptimeSeconds: Math.floor(process.uptime()),
    dailyRandomBell: getDailyRandomBellStatus(now),
  };
}

// Compute volume based on volume schedule
function getCurrentVolume(): number {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  for (const rule of config.volumeSchedule) {
    if (timeStr >= rule.timeFrom && timeStr <= rule.timeTo) {
      return rule.volumePercent;
    }
  }
  return config.masterVolume;
}

/* ==================== BELL RANDOMIZER (WEEKLY DRAW / DAILY BELL) ==================== */
const RANDOMIZER_DAY_NAMES: Record<number, string> = {
  1: 'Poniedziałek',
  2: 'Wtorek',
  3: 'Środa',
  4: 'Czwartek',
  5: 'Piątek',
  6: 'Sobota',
  0: 'Niedziela',
};

function formatLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekMondayDateStr(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const offsetToMonday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offsetToMonday);
  return formatLocalDateStr(copy);
}

function getNextWeekMondayDateStr(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const offsetToMonday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offsetToMonday + 7);
  return formatLocalDateStr(copy);
}

function parseLocalDateStr(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addWeeksToMondayStr(mondayStr: string, offsetWeeks: number): string {
  const parsed = parseLocalDateStr(mondayStr);
  if (!parsed) return mondayStr;
  parsed.setDate(parsed.getDate() + offsetWeeks * 7);
  return formatLocalDateStr(parsed);
}

function diffWeeksBetween(wkA: string, wkB: string): number {
  const a = parseLocalDateStr(wkA);
  const b = parseLocalDateStr(wkB);
  if (!a || !b) return 999;
  return Math.round((b.getTime() - a.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function getNoRepeatWeeks(randCfg: Partial<BellRandomizerConfig> | undefined): number {
  const raw = Number(randCfg?.noRepeatWeeks);
  if (!Number.isFinite(raw)) return 4;
  return Math.min(52, Math.max(1, Math.round(raw)));
}

function getAllAvailableTracks(): SoundTrack[] {
  const presets: SoundTrack[] = PRESET_SOUNDS.map((p) => ({
    id: p.id,
    name: p.name,
    category: 'preset',
    description: p.description,
    musicalKey: p.musicalKey,
    durationSeconds: p.durationSeconds,
    tags: p.tags,
    filename: `${p.id}.wav`,
    fileUrl: `/sounds/${p.id}.wav`,
  }));
  return [...presets, ...customSounds];
}

function soundExistsById(soundId: string | undefined | null): boolean {
  if (!soundId) return false;
  return (
    PRESET_SOUNDS.some((p) => p.id === soundId) ||
    customSounds.some((s) => s.id === soundId)
  );
}

function findSoundNameById(soundId: string | undefined | null): string {
  if (!soundId) return 'Dzwonek';
  const preset = PRESET_SOUNDS.find((p) => p.id === soundId);
  if (preset) return preset.name;
  const custom = customSounds.find((s) => s.id === soundId);
  if (custom) return custom.name;
  return soundId;
}

function getBellRandomizerConfig(): BellRandomizerConfig {
  const raw = config.bellRandomizer;
  return {
    ...DEFAULT_BELL_RANDOMIZER_CONFIG,
    ...(raw || {}),
    noRepeatWeeks: getNoRepeatWeeks(raw),
    activeDays:
      Array.isArray(raw?.activeDays) && raw.activeDays.length > 0
        ? raw.activeDays
        : DEFAULT_BELL_RANDOMIZER_CONFIG.activeDays,
    selectedSoundIds: Array.isArray(raw?.selectedSoundIds) ? raw.selectedSoundIds : [],
    weekAssignments:
      raw?.weekAssignments && typeof raw.weekAssignments === 'object' ? raw.weekAssignments : {},
  };
}

function getSoundPoolForRandomizer(randCfg: BellRandomizerConfig): SoundTrack[] {
  const allTracks = getAllAvailableTracks();
  if (randCfg.sourceMode === 'all_custom') {
    const customOnly = customSounds.filter((s) => Boolean(s.id));
    if (customOnly.length > 0) return customOnly;
    return allTracks;
  }
  if (randCfg.sourceMode === 'selected_ids') {
    const selectedSet = new Set(randCfg.selectedSoundIds || []);
    const selected = allTracks.filter((s) => selectedSet.has(s.id));
    if (selected.length > 0) return selected;
    return allTracks;
  }
  return allTracks;
}

function pickSoundWithNoRepeatWindow(
  pool: SoundTrack[],
  randCfg: BellRandomizerConfig,
  targetWeekKey: string,
  allAssignments: Record<string, Record<number, string>>,
  usedInTargetWeek: Set<string>,
  lastPickedSoundId?: string | null,
  excludeSoundId?: string | null
): SoundTrack {
  const baseCandidates =
    excludeSoundId && pool.some((s) => s.id !== excludeSoundId)
      ? pool.filter((s) => s.id !== excludeSoundId)
      : pool;

  if (!randCfg.avoidRepeatsInWeek || baseCandidates.length <= 1) {
    return baseCandidates[crypto.randomInt(0, baseCandidates.length)];
  }

  const noRepeatWeeks = getNoRepeatWeeks(randCfg);
  const usageMap = new Map<string, { count: number; minWeekDist: number }>();

  if (noRepeatWeeks > 1) {
    for (const [wk, dayMap] of Object.entries(allAssignments || {})) {
      if (wk === targetWeekKey || !dayMap) continue;
      const dist = Math.abs(diffWeeksBetween(targetWeekKey, wk));
      if (dist < 1 || dist >= noRepeatWeeks) continue;
      for (const sid of Object.values(dayMap)) {
        if (!sid) continue;
        const prev = usageMap.get(sid);
        usageMap.set(sid, {
          count: (prev?.count || 0) + 1,
          minWeekDist: prev ? Math.min(prev.minWeekDist, dist) : dist,
        });
      }
    }
  }

  const notUsedThisWeek = baseCandidates.filter((s) => !usedInTargetWeek.has(s.id));
  const stage1 = notUsedThisWeek.length > 0 ? notUsedThisWeek : baseCandidates;

  let minWindowCount = Infinity;
  for (const s of stage1) {
    const c = usageMap.get(s.id)?.count ?? 0;
    if (c < minWindowCount) minWindowCount = c;
  }
  const stage2 = stage1.filter((s) => (usageMap.get(s.id)?.count ?? 0) === minWindowCount);

  let maxDist = -1;
  for (const s of stage2) {
    const d = usageMap.get(s.id)?.minWeekDist ?? 9999;
    if (d > maxDist) maxDist = d;
  }
  const stage3 = stage2.filter((s) => (usageMap.get(s.id)?.minWeekDist ?? 9999) === maxDist);

  const stage4 =
    lastPickedSoundId && stage3.some((s) => s.id !== lastPickedSoundId)
      ? stage3.filter((s) => s.id !== lastPickedSoundId)
      : stage3;

  return stage4[crypto.randomInt(0, stage4.length)];
}

function drawWeekAssignments(
  randCfg: BellRandomizerConfig,
  existingMap?: Record<number, string>,
  targetWeekKey?: string,
  allAssignments?: Record<string, Record<number, string>>
): Record<number, string> {
  const pool = getSoundPoolForRandomizer(randCfg);
  if (pool.length === 0) return {};

  const order = [1, 2, 3, 4, 5, 6, 0];
  const sortedDays = [...new Set(randCfg.activeDays)]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const effectiveWeekKey = targetWeekKey || getWeekMondayDateStr(new Date());
  const assignmentsContext = allAssignments || randCfg.weekAssignments || {};

  const result: Record<number, string> = {};
  const usedInTargetWeek = new Set<string>();

  for (const day of sortedDays) {
    if (existingMap && existingMap[day] && soundExistsById(existingMap[day])) {
      result[day] = existingMap[day];
      usedInTargetWeek.add(existingMap[day]);
    }
  }

  let lastPickedSoundId: string | null = null;
  const prevWeekKey = addWeeksToMondayStr(effectiveWeekKey, -1);
  const prevWeekMap = assignmentsContext[prevWeekKey];
  if (prevWeekMap) {
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      const prevSid = prevWeekMap[sortedDays[i]];
      if (prevSid) {
        lastPickedSoundId = prevSid;
        break;
      }
    }
  }

  for (const day of sortedDays) {
    if (result[day]) {
      lastPickedSoundId = result[day];
      continue;
    }

    const picked = pickSoundWithNoRepeatWindow(
      pool,
      randCfg,
      effectiveWeekKey,
      assignmentsContext,
      usedInTargetWeek,
      lastPickedSoundId
    );
    result[day] = picked.id;
    usedInTargetWeek.add(picked.id);
    lastPickedSoundId = picked.id;
  }
  return result;
}

function drawCycleAssignments(
  randCfg: BellRandomizerConfig,
  startMondayKey: string,
  weeksCount: number
): {
  workingAssignments: Record<string, Record<number, string>>;
  drawnWeekKeys: string[];
} {
  const safeWeeks = Math.min(52, Math.max(1, Math.round(weeksCount)));
  const workingAssignments: Record<string, Record<number, string>> = {
    ...(randCfg.weekAssignments || {}),
  };
  const drawnWeekKeys: string[] = [];

  for (let i = 0; i < safeWeeks; i++) {
    const wkKey = addWeeksToMondayStr(startMondayKey, i);
    delete workingAssignments[wkKey];
    drawnWeekKeys.push(wkKey);
  }

  for (const wkKey of drawnWeekKeys) {
    const weekMap = drawWeekAssignments(randCfg, undefined, wkKey, workingAssignments);
    workingAssignments[wkKey] = weekMap;
  }

  return { workingAssignments, drawnWeekKeys };
}

function pruneOldWeekAssignments(
  assignments: Record<string, Record<number, string>>,
  referenceCurrentMonday: string,
  noRepeatWeeks: number = 4
): Record<string, Record<number, string>> {
  const keepPastWeeks = Math.max(noRepeatWeeks + 2, 6);
  const next: Record<string, Record<number, string>> = {};
  for (const k of Object.keys(assignments)) {
    const diff = diffWeeksBetween(referenceCurrentMonday, k);
    if (diff >= -keepPastWeeks && diff <= 60) {
      next[k] = assignments[k];
    }
  }
  return next;
}

function sanitizeBellRandomizerConfig(raw: unknown): BellRandomizerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const base = getBellRandomizerConfig();

  const drawDayOfWeek =
    typeof src.drawDayOfWeek === 'number' && Number.isInteger(src.drawDayOfWeek) && src.drawDayOfWeek >= 0 && src.drawDayOfWeek <= 6
      ? src.drawDayOfWeek
      : base.drawDayOfWeek;

  const drawTimeRaw = typeof src.drawTime === 'string' ? src.drawTime.trim() : base.drawTime;
  const drawTime = /^\d{2}:\d{2}$/.test(drawTimeRaw) ? drawTimeRaw : base.drawTime;

  const activeDays = Array.isArray(src.activeDays)
    ? [...new Set(src.activeDays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
    : base.activeDays;

  const sourceMode =
    src.sourceMode === 'all_custom' || src.sourceMode === 'all_sounds' || src.sourceMode === 'selected_ids'
      ? src.sourceMode
      : base.sourceMode;

  const selectedSoundIds = Array.isArray(src.selectedSoundIds)
    ? src.selectedSoundIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 500)
    : base.selectedSoundIds;

  const noRepeatWeeksRaw = Number(src.noRepeatWeeks);
  const noRepeatWeeks = Number.isFinite(noRepeatWeeksRaw)
    ? Math.min(52, Math.max(1, Math.round(noRepeatWeeksRaw)))
    : getNoRepeatWeeks(base);

  const weekAssignments: Record<string, Record<number, string>> = {};
  if (src.weekAssignments && typeof src.weekAssignments === 'object' && !Array.isArray(src.weekAssignments)) {
    for (const [wk, dayMap] of Object.entries(src.weekAssignments as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) continue;
      if (!dayMap || typeof dayMap !== 'object' || Array.isArray(dayMap)) continue;
      const cleanMap: Record<number, string> = {};
      for (const [dayKey, soundId] of Object.entries(dayMap as Record<string, unknown>)) {
        const dayNum = Number(dayKey);
        if (Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 6 && typeof soundId === 'string' && soundId.trim()) {
          cleanMap[dayNum] = soundId.trim();
        }
      }
      weekAssignments[wk] = cleanMap;
    }
  } else {
    Object.assign(weekAssignments, base.weekAssignments);
  }

  return {
    enabled: 'enabled' in src ? Boolean(src.enabled) : base.enabled,
    drawDayOfWeek,
    drawTime,
    activeDays: activeDays.length > 0 ? activeDays : [1, 2, 3, 4, 5],
    sourceMode,
    selectedSoundIds,
    avoidRepeatsInWeek: 'avoidRepeatsInWeek' in src ? Boolean(src.avoidRepeatsInWeek) : base.avoidRepeatsInWeek,
    noRepeatWeeks,
    applyToWarningBell: 'applyToWarningBell' in src ? Boolean(src.applyToWarningBell) : base.applyToWarningBell,
    lastDrawnAt:
      typeof src.lastDrawnAt === 'string' ? src.lastDrawnAt : src.lastDrawnAt === null ? null : base.lastDrawnAt,
    lastAutoDrawMarker:
      typeof src.lastAutoDrawMarker === 'string'
        ? src.lastAutoDrawMarker
        : src.lastAutoDrawMarker === null
        ? null
        : base.lastAutoDrawMarker,
    weekAssignments,
  };
}

function cleanupInvalidRandomizerAssignments(): boolean {
  const randCfg = getBellRandomizerConfig();
  let changed = false;

  const filteredSelected = randCfg.selectedSoundIds.filter((id) => soundExistsById(id));
  if (filteredSelected.length !== randCfg.selectedSoundIds.length) {
    randCfg.selectedSoundIds = filteredSelected;
    changed = true;
  }

  for (const [wk, dayMap] of Object.entries(randCfg.weekAssignments)) {
    for (const [dayStr, soundId] of Object.entries(dayMap)) {
      if (!soundExistsById(soundId)) {
        delete dayMap[Number(dayStr)];
        changed = true;
      }
    }
    if (Object.keys(dayMap).length === 0) {
      delete randCfg.weekAssignments[wk];
      changed = true;
    }
  }

  if (changed) {
    config.bellRandomizer = randCfg;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }
  return changed;
}

function resolveEffectiveBellSound(
  kind: 'start' | 'end' | 'warning',
  itemSoundId: string | undefined,
  fallbackSoundId: string,
  now: Date = new Date()
): { soundId: string; soundName: string; isRandomized: boolean } {
  const randCfg = getBellRandomizerConfig();
  const dayOfWeek = now.getDay();

  if (
    randCfg.enabled &&
    randCfg.activeDays.includes(dayOfWeek) &&
    (kind !== 'warning' || randCfg.applyToWarningBell)
  ) {
    const weekKey = getWeekMondayDateStr(now);
    const drawnId = randCfg.weekAssignments[weekKey]?.[dayOfWeek];
    if (drawnId && soundExistsById(drawnId)) {
      return {
        soundId: drawnId,
        soundName: findSoundNameById(drawnId),
        isRandomized: true,
      };
    }
  }

  const normalId = itemSoundId || fallbackSoundId;
  return {
    soundId: normalId,
    soundName: findSoundNameById(normalId),
    isRandomized: false,
  };
}

function getDailyRandomBellStatus(now: Date = new Date()): SystemStatus['dailyRandomBell'] {
  const randCfg = getBellRandomizerConfig();
  if (!randCfg.enabled) return null;
  const weekKey = getWeekMondayDateStr(now);
  const dayOfWeek = now.getDay();
  const soundId = randCfg.weekAssignments[weekKey]?.[dayOfWeek] || null;
  const validId = soundId && soundExistsById(soundId) ? soundId : null;
  return {
    enabled: true,
    soundId: validId,
    soundName: validId ? findSoundNameById(validId) : null,
    weekKey,
    dayOfWeek,
  };
}

let lastRandomizerCheckMinute = '';
function evaluateBellRandomizer(now: Date, forceCheck: boolean = false): void {
  const randCfg = getBellRandomizerConfig();
  if (!randCfg.enabled) return;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowHHMM = `${hh}:${mm}`;
  const minuteKey = `${formatLocalDateStr(now)}_${nowHHMM}`;
  if (!forceCheck && lastRandomizerCheckMinute === minuteKey) return;
  lastRandomizerCheckMinute = minuteKey;

  const currentWeekKey = getWeekMondayDateStr(now);
  const nextWeekKey = getNextWeekMondayDateStr(now);
  let changed = false;

  // 1. Ensure current week has valid assignments for all configured activeDays
  const existingCurrent = randCfg.weekAssignments[currentWeekKey] || {};
  const needsCurrentFill = randCfg.activeDays.some(
    (d) => !existingCurrent[d] || !soundExistsById(existingCurrent[d])
  );
  if (needsCurrentFill) {
    const filled = drawWeekAssignments(randCfg, existingCurrent, currentWeekKey, randCfg.weekAssignments);
    randCfg.weekAssignments = {
      ...randCfg.weekAssignments,
      [currentWeekKey]: filled,
    };
    randCfg.lastDrawnAt = now.toISOString();
    changed = true;
    const summary = Object.entries(filled)
      .map(([d, sid]) => `${RANDOMIZER_DAY_NAMES[Number(d)] || d}: ${findSoundNameById(sid)}`)
      .join(', ');
    history.unshift({
      id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now.toISOString(),
      timeStr: `${nowHHMM}:${String(now.getSeconds()).padStart(2, '0')}`,
      bellType: 'bell_draw',
      title: `Wylosowano dzwonki na bieżący tydzień (${currentWeekKey})`,
      soundName: `${Object.keys(filled).length} dni`,
      status: 'simulated',
      details: summary,
    });
    saveHistory();
  }

  // 2. Scheduled weekly draw (e.g. Sunday evening draws for upcoming week without repeating last N weeks)
  const drawDay = randCfg.drawDayOfWeek;
  const drawTime = randCfg.drawTime || '18:00';
  if (now.getDay() === drawDay && nowHHMM >= drawTime) {
    const targetWeekKey = drawDay === 0 ? nextWeekKey : currentWeekKey;
    const marker = `${formatLocalDateStr(now)}_${targetWeekKey}`;
    const alreadyDrawnThisRun = randCfg.lastAutoDrawMarker === marker;
    const existingTarget = randCfg.weekAssignments[targetWeekKey] || {};
    const targetComplete = randCfg.activeDays.every(
      (d) => Boolean(existingTarget[d] && soundExistsById(existingTarget[d]))
    );

    if (!alreadyDrawnThisRun && !targetComplete) {
      const freshDraw = drawWeekAssignments(randCfg, undefined, targetWeekKey, randCfg.weekAssignments);
      randCfg.weekAssignments = {
        ...randCfg.weekAssignments,
        [targetWeekKey]: freshDraw,
      };
      randCfg.lastDrawnAt = now.toISOString();
      randCfg.lastAutoDrawMarker = marker;
      changed = true;
      const summary = Object.entries(freshDraw)
        .map(([d, sid]) => `${RANDOMIZER_DAY_NAMES[Number(d)] || d}: ${findSoundNameById(sid)}`)
        .join(', ');
      history.unshift({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now.toISOString(),
        timeStr: `${nowHHMM}:${String(now.getSeconds()).padStart(2, '0')}`,
        bellType: 'bell_draw',
        title:
          drawDay === 0
            ? `Niedzielne losowanie dzwonków na tydzień od ${targetWeekKey}`
            : `Automatyczne losowanie dzwonków na tydzień od ${targetWeekKey}`,
        soundName: `${Object.keys(freshDraw).length} dni`,
        status: 'simulated',
        details: summary,
      });
      saveHistory();
    }
  }

  if (changed) {
    randCfg.weekAssignments = pruneOldWeekAssignments(
      randCfg.weekAssignments,
      currentWeekKey,
      getNoRepeatWeeks(randCfg)
    );
    config.bellRandomizer = randCfg;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }
}

// Background scheduler interval - runs every second
let lastTriggeredMinute = '';

// Break-time radio automation handler (runs every second)
function handleBreakRadioTick(now: Date) {
  // Never interrupt a manually started broadcast unless system is muted
  if (config.muteUntil && new Date(config.muteUntil) > now) {
    if (radioStatus.isPlaying) {
      stopRadioStream('System wyciszony');
    }
    return;
  }

  if (radioStatus.isPlaying && radioStatus.mode === 'manual') {
    return;
  }

  const { profile, isHoliday, isNonWorkingDay } = getActiveProfileForNow(now);

  if (!config.radioEnabled || isNonWorkingDay || isHoliday || !profile) {
    if (radioStatus.isPlaying && radioStatus.mode === 'auto_break') {
      stopRadioStream('Poza czasem przerw szkolnych');
    }
    activeBreakRadioKey = null;
    return;
  }

  const sortedItems: BellItem[] = [...(profile.items || [])]
    .filter((i: BellItem) => i.enabled)
    .sort((a: BellItem, b: BellItem) => a.startTime.localeCompare(b.startTime));

  const nowTotalSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const startDelay = Math.max(0, config.radioStartDelaySeconds ?? 5);
  const stopBefore = Math.max(0, config.radioStopBeforeBellSeconds ?? 3);

  let matchedBreakKey: string | null = null;
  let matchedStationId: string | null = null;
  let shouldBePlayingNow = false;

  for (let i = 0; i < sortedItems.length - 1; i++) {
    const curr = sortedItems[i];
    const next = sortedItems[i + 1];
    const [eH, eM] = curr.endTime.split(':').map(Number);
    const [nH, nM] = next.startTime.split(':').map(Number);

    const breakStartSec = eH * 3600 + eM * 60;
    const nextLessonStartSec = nH * 3600 + nM * 60;

    if (nowTotalSec >= breakStartSec && nowTotalSec < nextLessonStartSec) {
      const warnMin = config.warningBellEnabled ? (next.warningMinutesBefore ?? 0) : 0;
      const targetBellSec = warnMin > 0 ? nextLessonStartSec - warnMin * 60 : nextLessonStartSec;
      const playWindowStart = breakStartSec + startDelay;
      const playWindowEnd = targetBellSec - stopBefore;

      if (curr.playRadioOnBreak && playWindowEnd > playWindowStart) {
        matchedBreakKey = `${now.toISOString().split('T')[0]}_${curr.id}`;
        matchedStationId = curr.radioStationId || config.defaultRadioStationId;
        if (nowTotalSec >= playWindowStart && nowTotalSec < playWindowEnd) {
          shouldBePlayingNow = true;
        }
      }
      break;
    }
  }

  if (shouldBePlayingNow && matchedBreakKey && matchedStationId) {
    // Do not auto-restart if the operator manually stopped it during this same break
    if (manuallyStoppedBreakKey === matchedBreakKey) {
      return;
    }
    const station =
      config.radioStations?.find((s) => s.id === matchedStationId) || config.radioStations?.[0];
    if (station && (!radioStatus.isPlaying || radioStatus.stationId !== station.id)) {
      activeBreakRadioKey = matchedBreakKey;
      startRadioStream(station, 'auto_break', config.radioVolume);
    }
  } else {
    if (radioStatus.isPlaying && radioStatus.mode === 'auto_break') {
      stopRadioStream('Koniec przerwy / zbliża się dzwonek');
    }
    if (!matchedBreakKey) {
      activeBreakRadioKey = null;
    }
  }
}

/* ===================== AMPLIFIER CONTROLLER (/dev/tty* 1/0) ===================== */
let amplifierRuntime: Omit<AmplifierStatus, 'enabled' | 'devicePath' | 'hardwareAvailable'> = {
  powerState: 'unknown',
  mode: 'auto',
  lastSignal: null,
  lastUpdatedAt: null,
  lastResult: null,
};
let amplifierManualOverrideWindowKey: string | null = null;
let amplifierLastAutoWindowKey: string | null = null;

function validateAmplifierDevicePath(
  rawPath: unknown
): { ok: true; devicePath: string } | { ok: false; error: string } {
  if (typeof rawPath !== 'string') {
    return { ok: false, error: 'Ścieżka urządzenia wzmacniacza musi być tekstem (np. /dev/tty1).' };
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 128) {
    return { ok: false, error: 'Podaj ścieżkę urządzenia sterownika (np. /dev/tty1).' };
  }
  if (/\s/.test(trimmed) || trimmed.includes('..') || !trimmed.startsWith('/dev/')) {
    return {
      ok: false,
      error: 'Ścieżka sterownika musi wskazywać urządzenie w katalogu /dev/ (np. /dev/tty1, /dev/ttyUSB0, /dev/ttyS0).',
    };
  }
  const normalized = path.posix.normalize(trimmed);
  if (
    normalized !== trimmed ||
    !/^\/dev\/(tty[a-zA-Z0-9_-]*|serial\/by-(?:id|path)\/[a-zA-Z0-9._:-]+|pts\/\d+|cu\.[a-zA-Z0-9._-]+|gpiochip\d+|spidev\d+\.\d+|hidraw\d+|usblp\d+|relay[a-zA-Z0-9_-]*|ampl?[a-zA-Z0-9_-]*)$/.test(
      normalized
    )
  ) {
    return {
      ok: false,
      error: 'Dozwolone są wyłącznie urządzenia znakowe/szeregowe w /dev/ (np. /dev/tty1, /dev/ttyS0, /dev/ttyUSB0, /dev/ttyACM0).',
    };
  }
  return { ok: true, devicePath: normalized };
}

function isAmplifierHardwarePresent(devicePath: string): boolean {
  try {
    const validated = validateAmplifierDevicePath(devicePath);
    if (!validated.ok) return false;
    if (!fs.existsSync(validated.devicePath)) return false;
    const stat = fs.statSync(validated.devicePath);
    return stat.isCharacterDevice() || stat.isFIFO();
  } catch {
    return false;
  }
}

function getAmplifierStatus(): AmplifierStatus {
  const devicePath = config.amplifierDevicePath || '/dev/tty1';
  return {
    enabled: Boolean(config.amplifierControlEnabled),
    devicePath,
    powerState: amplifierRuntime.powerState,
    mode: amplifierRuntime.mode,
    lastSignal: amplifierRuntime.lastSignal,
    lastUpdatedAt: amplifierRuntime.lastUpdatedAt,
    lastResult: amplifierRuntime.lastResult,
    hardwareAvailable: isAmplifierHardwarePresent(devicePath),
  };
}

function isDeviceWritable(devPath: string): boolean {
  try {
    fs.accessSync(devPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readSysfsSerialMeta(devName: string): string | null {
  const candidateFiles = [
    `/sys/class/tty/${devName}/device/../product`,
    `/sys/class/tty/${devName}/device/../../product`,
    `/sys/class/tty/${devName}/device/../interface`,
  ];
  let product: string | null = null;
  for (const filePath of candidateFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const val = fs.readFileSync(filePath, 'utf-8').trim();
        if (val) {
          product = val;
          break;
        }
      }
    } catch {}
  }

  let manufacturer: string | null = null;
  for (const mfgPath of [
    `/sys/class/tty/${devName}/device/../manufacturer`,
    `/sys/class/tty/${devName}/device/../../manufacturer`,
  ]) {
    try {
      if (fs.existsSync(mfgPath)) {
        const val = fs.readFileSync(mfgPath, 'utf-8').trim();
        if (val) {
          manufacturer = val;
          break;
        }
      }
    } catch {}
  }

  if (manufacturer && product && !product.toLowerCase().includes(manufacturer.toLowerCase())) {
    return `${manufacturer} ${product}`;
  }
  return product || manufacturer || null;
}

function parseProcSerialActivePorts(): Set<string> {
  const active = new Set<string>();
  try {
    if (fs.existsSync('/proc/tty/driver/serial')) {
      const content = fs.readFileSync('/proc/tty/driver/serial', 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^(\d+):\s+uart:([^\s]+)/);
        if (match && match[2] && match[2].toLowerCase() !== 'unknown') {
          active.add(`ttyS${match[1]}`);
        }
      }
    }
  } catch {}
  return active;
}

function detectSystemSerialPorts(): DetectedSerialPort[] {
  const ports: DetectedSerialPort[] = [];
  const byIdMap = new Map<string, { byIdPath: string; label: string }>();

  // 1. Inspect /dev/serial/by-id/* symlinks for human-readable USB serial adapters
  try {
    const byIdDir = '/dev/serial/by-id';
    if (fs.existsSync(byIdDir)) {
      for (const entry of fs.readdirSync(byIdDir)) {
        const byIdPath = `${byIdDir}/${entry}`;
        const validatedById = validateAmplifierDevicePath(byIdPath);
        if (!validatedById.ok) continue;
        try {
          const resolved = fs.realpathSync(validatedById.devicePath);
          if (!resolved.startsWith('/dev/')) continue;
          const cleanLabel = entry
            .replace(/^usb-/, '')
            .replace(/-if\d+(?:-port\d+)?$/, '')
            .replace(/_/g, ' ')
            .trim();
          if (!byIdMap.has(resolved)) {
            byIdMap.set(resolved, {
              byIdPath: validatedById.devicePath,
              label: cleanLabel || entry,
            });
          }
        } catch {}
      }
    }
  } catch {}

  const activeProcSerial = parseProcSerialActivePorts();

  // 2. Scan /dev for active serial / USB-serial / UART character devices
  try {
    if (fs.existsSync('/dev')) {
      for (const entry of fs.readdirSync('/dev')) {
        let kind: DetectedSerialPort['kind'] | null = null;
        let baseDesc = '';

        if (/^ttyUSB\d+$/.test(entry) || /^ttyXRUSB\d+$/.test(entry) || /^ttyMXUSB\d+$/.test(entry)) {
          kind = 'usb_serial';
          baseDesc = 'Adapter USB-Serial';
        } else if (/^ttyACM\d+$/.test(entry)) {
          kind = 'usb_acm';
          baseDesc = 'Urządzenie USB CDC/ACM';
        } else if (/^ttyAMA\d+$/.test(entry) || /^ttyTHS\d+$/.test(entry) || /^ttymxc\d+$/.test(entry) || /^ttyO\d+$/.test(entry)) {
          kind = 'serial_uart';
          baseDesc = 'Wbudowany port UART';
        } else if (/^ttyS\d+$/.test(entry)) {
          const hasSysDevice = fs.existsSync(`/sys/class/tty/${entry}/device`);
          if (!hasSysDevice && !activeProcSerial.has(entry)) {
            continue;
          }
          kind = 'serial_uart';
          baseDesc = 'Port szeregowy RS-232';
        } else if (/^cu\.[a-zA-Z0-9._-]+$/.test(entry) && !entry.includes('Bluetooth')) {
          kind = 'serial_uart';
          baseDesc = 'Port szeregowy';
        }

        if (!kind) continue;

        const devPath = `/dev/${entry}`;
        const validated = validateAmplifierDevicePath(devPath);
        if (!validated.ok) continue;

        try {
          const stat = fs.statSync(validated.devicePath);
          if (!stat.isCharacterDevice()) continue;
        } catch {
          continue;
        }

        const byIdInfo = byIdMap.get(validated.devicePath);
        const sysMeta = readSysfsSerialMeta(entry);
        const detail = sysMeta || byIdInfo?.label || null;
        const description = detail ? `${baseDesc} (${detail})` : baseDesc;

        ports.push({
          path: validated.devicePath,
          name: entry,
          description,
          kind,
          byIdPath: byIdInfo?.byIdPath || null,
          writable: isDeviceWritable(validated.devicePath),
        });
      }
    }
  } catch {}

  const kindOrder: Record<DetectedSerialPort['kind'], number> = {
    usb_serial: 0,
    usb_acm: 1,
    by_id: 2,
    serial_uart: 3,
  };

  ports.sort((a, b) => {
    const orderDiff = kindOrder[a.kind] - kindOrder[b.kind];
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return ports;
}

function writeAmplifierSignal(
  signal: '1' | '0',
  mode: 'auto' | 'manual',
  reason: string,
  overrideDevicePath?: string,
  overrideAppendNewline?: boolean
): { success: boolean; status: 'played_linux' | 'simulated' | 'error'; message: string } {
  const targetPathRaw = overrideDevicePath ?? config.amplifierDevicePath ?? '/dev/tty1';
  const validated = validateAmplifierDevicePath(targetPathRaw);
  if (!validated.ok) {
    amplifierRuntime = {
      ...amplifierRuntime,
      mode,
      lastUpdatedAt: new Date().toISOString(),
      lastResult: validated.error,
    };
    return { success: false, status: 'error', message: validated.error };
  }

  const devicePath = validated.devicePath;
  const appendNewline =
    typeof overrideAppendNewline === 'boolean'
      ? overrideAppendNewline
      : Boolean(config.amplifierAppendNewline);
  const payload = appendNewline ? `${signal}\n` : signal;

  let writeStatus: 'played_linux' | 'simulated' | 'error' = 'simulated';
  let resultMsg = '';

  try {
    if (!fs.existsSync(devicePath)) {
      writeStatus = 'simulated';
      resultMsg = `Symulacja: wysłano "${signal}" (urządzenie ${devicePath} nie istnieje w tym środowisku)`;
    } else {
      const stat = fs.statSync(devicePath);
      if (stat.isDirectory() || stat.isBlockDevice() || (!stat.isCharacterDevice() && !stat.isFIFO())) {
        writeStatus = 'error';
        resultMsg = `Ścieżka ${devicePath} nie jest urządzeniem znakowym/szeregowym (chr/FIFO).`;
      } else {
        let fd: number | null = null;
        try {
          fd = fs.openSync(devicePath, fs.constants.O_WRONLY | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK);
        } catch (openErr: any) {
          if (openErr?.code === 'ENXIO') {
            fd = fs.openSync(devicePath, fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
          } else {
            throw openErr;
          }
        }
        try {
          fs.writeSync(fd, payload, null, 'utf-8');
        } finally {
          if (fd !== null) {
            try {
              fs.closeSync(fd);
            } catch {}
          }
        }
        writeStatus = 'played_linux';
        resultMsg = `Wysłano sygnał "${signal}" do ${devicePath}`;
      }
    }
  } catch (err: any) {
    writeStatus = 'error';
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      resultMsg = `Brak uprawnień zapisu do ${devicePath} (dodaj użytkownika do grupy tty/dialout lub uruchom jako root).`;
    } else {
      resultMsg = `Błąd zapisu do ${devicePath}: ${err?.message || 'nieznany błąd'}`;
    }
  }

  const now = new Date();
  if (writeStatus !== 'error') {
    amplifierRuntime = {
      powerState: signal === '1' ? 'on' : 'off',
      mode,
      lastSignal: signal,
      lastUpdatedAt: now.toISOString(),
      lastResult: resultMsg,
    };
  } else {
    amplifierRuntime = {
      ...amplifierRuntime,
      mode,
      lastUpdatedAt: now.toISOString(),
      lastResult: resultMsg,
    };
  }

  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  history.unshift({
    id: `amp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.toISOString(),
    timeStr,
    bellType: signal === '1' ? 'amplifier_on' : 'amplifier_off',
    title: signal === '1' ? `Wzmacniacz WŁĄCZONY (sygnał 1)` : `Wzmacniacz WYŁĄCZONY (sygnał 0)`,
    soundName: devicePath,
    status: writeStatus,
    details: `${reason}. ${resultMsg}`,
  });
  saveHistory();

  return {
    success: writeStatus !== 'error',
    status: writeStatus,
    message: resultMsg,
  };
}

function evaluateAmplifierWindowForNow(now: Date): {
  shouldBeOn: boolean;
  windowKey: string;
  reason: string;
} {
  const dateKey = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay();

  if (config.amplifierRespectHolidays !== false) {
    const { isHoliday, isNonWorkingDay, holidayName } = getActiveProfileForNow(now);
    if (isHoliday) {
      return {
        shouldBeOn: false,
        windowKey: `${dateKey}_HOLIDAY`,
        reason: `Dzień wolny (${holidayName || 'Święto'})`,
      };
    }
    if (isNonWorkingDay) {
      return {
        shouldBeOn: false,
        windowKey: `${dateKey}_NONWORKING`,
        reason: 'Dzień bez zajęć w planie tygodnia',
      };
    }
  }

  const rules: AmplifierRule[] = (config.amplifierSchedule || []).filter(
    (r) => r.enabled && Array.isArray(r.daysOfWeek) && r.daysOfWeek.includes(dayOfWeek)
  );

  const nowTotalMin = now.getHours() * 60 + now.getMinutes();

  for (const rule of rules) {
    const [onH, onM] = (rule.powerOnTime || '').split(':').map(Number);
    const [offH, offM] = (rule.powerOffTime || '').split(':').map(Number);
    if (Number.isNaN(onH) || Number.isNaN(onM) || Number.isNaN(offH) || Number.isNaN(offM)) {
      continue;
    }
    const onMin = onH * 60 + onM;
    const offMin = offH * 60 + offM;
    if (onMin === offMin) continue;

    const isActive =
      onMin < offMin
        ? nowTotalMin >= onMin && nowTotalMin < offMin
        : nowTotalMin >= onMin || nowTotalMin < offMin;

    if (isActive) {
      return {
        shouldBeOn: true,
        windowKey: `${dateKey}_ON_${rule.id}_${rule.powerOnTime}_${rule.powerOffTime}`,
        reason: `Harmonogram wzmacniacza: ${rule.name} (${rule.powerOnTime}–${rule.powerOffTime})`,
      };
    }
  }

  return {
    shouldBeOn: false,
    windowKey: `${dateKey}_OFF`,
    reason: 'Poza godzinami pracy wzmacniacza',
  };
}

function handleAmplifierScheduleTick(now: Date) {
  if (!config.amplifierControlEnabled) return;

  const evalResult = evaluateAmplifierWindowForNow(now);

  // If operator manually changed state inside this exact window, do not override until window transitions
  if (amplifierManualOverrideWindowKey === evalResult.windowKey) {
    return;
  }

  // Window transitioned away from manual override
  if (amplifierManualOverrideWindowKey && amplifierManualOverrideWindowKey !== evalResult.windowKey) {
    amplifierManualOverrideWindowKey = null;
  }

  const targetPowerState = evalResult.shouldBeOn ? 'on' : 'off';
  const targetSignal: '1' | '0' = evalResult.shouldBeOn ? '1' : '0';

  if (
    amplifierLastAutoWindowKey === evalResult.windowKey &&
    amplifierRuntime.powerState === targetPowerState
  ) {
    return;
  }

  // Avoid repeatedly sending '0' on boot if no rule was ever active yet and powerState is unknown,
  // unless transitioning or explicitly inside/exiting a rule window — sending '0' once on boot when
  // outside schedule ensures amp starts safely OFF!
  amplifierLastAutoWindowKey = evalResult.windowKey;
  if (amplifierRuntime.powerState !== targetPowerState) {
    writeAmplifierSignal(targetSignal, 'auto', evalResult.reason);
  }
}

/* ===================== DEBIAN CPU, RAM & TEMPERATURE TELEMETRY SAMPLER ===================== */
const MAX_TELEMETRY_POINTS = 60;
const systemMetricsHistory: SystemMetricsPoint[] = [];
let latestSystemMetric: SystemMetricsPoint | null = null;
let prevCpuTotals: { idle: number; total: number } | null = null;
let latestCpuTemp: { tempC: number | null; source: string | null } = {
  tempC: null,
  source: null,
};
let isRefreshingCpuTemp = false;
let lastCpuTempPollMs = 0;

function scoreTempCandidate(chipName: string, labelName: string): number {
  const chip = chipName.toLowerCase();
  const label = labelName.toLowerCase();
  let score = 0;

  if (
    chip.includes('coretemp') ||
    chip.includes('k10temp') ||
    chip.includes('zenpower') ||
    chip.includes('fam15h') ||
    chip.includes('cpu_thermal') ||
    chip.includes('cpu-thermal') ||
    chip.includes('soc_thermal') ||
    chip.includes('x86_pkg_temp')
  ) {
    score += 120;
  } else if (
    chip.includes('acpitz') ||
    chip.includes('thinkpad') ||
    chip.includes('dell') ||
    chip.includes('asus') ||
    chip.includes('it87') ||
    chip.includes('nct')
  ) {
    score += 40;
  } else if (
    chip.includes('nvme') ||
    chip.includes('iwlwifi') ||
    chip.includes('amdgpu') ||
    chip.includes('radeon') ||
    chip.includes('nouveau') ||
    chip.includes('drivetemp') ||
    chip.includes('spd')
  ) {
    score -= 80;
  }

  if (
    label.includes('package id') ||
    label === 'tctl' ||
    label === 'tdie' ||
    label.includes('cpu') ||
    label.includes('x86_pkg_temp')
  ) {
    score += 70;
  } else if (label.startsWith('core 0') || label.includes('peci') || label === 'soc') {
    score += 45;
  } else if (label.startsWith('core') || label === 'temp1') {
    score += 25;
  } else if (label.includes('composite') || label.includes('sensor') || label.includes('gpu') || label.includes('edge')) {
    score -= 40;
  }

  return score;
}

function parseSensorsJsonOutput(rawJson: string): { tempC: number; source: string } | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return null;

    let best: { score: number; tempC: number; source: string } | null = null;

    for (const [chipName, chipData] of Object.entries(parsed)) {
      if (!chipData || typeof chipData !== 'object') continue;
      for (const [featureName, featureData] of Object.entries(chipData as Record<string, unknown>)) {
        if (featureName === 'Adapter' || !featureData || typeof featureData !== 'object') continue;
        for (const [metricKey, metricVal] of Object.entries(featureData as Record<string, unknown>)) {
          if (!/^temp\d*_input$/i.test(metricKey)) continue;
          const tempVal = typeof metricVal === 'number' ? metricVal : Number(metricVal);
          if (!Number.isFinite(tempVal) || tempVal <= -40 || tempVal >= 150) continue;

          const score = scoreTempCandidate(chipName, featureName);
          if (score < 0) continue;

          const rounded = Number(tempVal.toFixed(1));
          const shortChip = chipName.split('-')[0] || chipName;
          const source = `sensors (${shortChip}: ${featureName})`;
          if (!best || score > best.score) {
            best = { score, tempC: rounded, source };
          }
        }
      }
    }

    return best ? { tempC: best.tempC, source: best.source } : null;
  } catch {
    return null;
  }
}

function parseSensorsTextOutput(rawText: string): { tempC: number; source: string } | null {
  try {
    const lines = rawText.split('\n');
    let currentChip = '';
    let best: { score: number; tempC: number; source: string } | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        currentChip = '';
        continue;
      }
      if (!currentChip && !line.includes(':') && !line.startsWith(' ')) {
        currentChip = line.trim();
        continue;
      }
      if (line.startsWith('Adapter:')) continue;

      const tempMatch = line.match(/^([^:]+):\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*C/i);
      if (tempMatch && currentChip) {
        const label = tempMatch[1].trim();
        const tempVal = parseFloat(tempMatch[2]);
        if (!Number.isFinite(tempVal) || tempVal <= -40 || tempVal >= 150) continue;

        const score = scoreTempCandidate(currentChip, label);
        if (score < 0) continue;

        const shortChip = currentChip.split('-')[0] || currentChip;
        const rounded = Number(tempVal.toFixed(1));
        const source = `sensors (${shortChip}: ${label})`;
        if (!best || score > best.score) {
          best = { score, tempC: rounded, source };
        }
      }
    }

    return best ? { tempC: best.tempC, source: best.source } : null;
  } catch {
    return null;
  }
}

function readLinuxSysfsCpuTemp(): { tempC: number; source: string } | null {
  let best: { score: number; tempC: number; source: string } | null = null;

  try {
    const hwmonRoot = '/sys/class/hwmon';
    if (fs.existsSync(hwmonRoot)) {
      const hwdirs = fs.readdirSync(hwmonRoot);
      for (const dir of hwdirs) {
        const dirPath = path.join(hwmonRoot, dir);
        let chipName = dir;
        try {
          const namePath = path.join(dirPath, 'name');
          if (fs.existsSync(namePath)) {
            chipName = fs.readFileSync(namePath, 'utf-8').trim();
          }
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            const inputMatch = entry.match(/^temp(\d+)_input$/);
            if (!inputMatch) continue;
            const idx = inputMatch[1];
            const rawMilli = fs.readFileSync(path.join(dirPath, entry), 'utf-8').trim();
            const milliVal = parseInt(rawMilli, 10);
            if (!Number.isFinite(milliVal)) continue;
            const tempC = Number((milliVal / 1000).toFixed(1));
            if (tempC <= -40 || tempC >= 150) continue;

            let label = `temp${idx}`;
            const labelPath = path.join(dirPath, `temp${idx}_label`);
            if (fs.existsSync(labelPath)) {
              label = fs.readFileSync(labelPath, 'utf-8').trim() || label;
            }
            const score = scoreTempCandidate(chipName, label);
            if (score < 0) continue;
            if (!best || score > best.score) {
              best = { score, tempC, source: `sysfs (${chipName}: ${label})` };
            }
          }
        } catch {}
      }
    }
  } catch {}

  try {
    const thermalRoot = '/sys/class/thermal';
    if (fs.existsSync(thermalRoot)) {
      const zones = fs.readdirSync(thermalRoot).filter((z) => z.startsWith('thermal_zone'));
      for (const zone of zones) {
        try {
          const zonePath = path.join(thermalRoot, zone);
          const tempPath = path.join(zonePath, 'temp');
          if (!fs.existsSync(tempPath)) continue;
          const rawMilli = fs.readFileSync(tempPath, 'utf-8').trim();
          const milliVal = parseInt(rawMilli, 10);
          if (!Number.isFinite(milliVal)) continue;
          const tempC = Number((milliVal / 1000).toFixed(1));
          if (tempC <= -40 || tempC >= 150) continue;

          let zoneType = zone;
          const typePath = path.join(zonePath, 'type');
          if (fs.existsSync(typePath)) {
            zoneType = fs.readFileSync(typePath, 'utf-8').trim() || zone;
          }
          const score = scoreTempCandidate(zoneType, zoneType);
          if (score < 0) continue;
          if (!best || score > best.score) {
            best = { score, tempC, source: `thermal (${zoneType})` };
          }
        } catch {}
      }
    }
  } catch {}

  return best ? { tempC: best.tempC, source: best.source } : null;
}

async function refreshCpuTemperature(): Promise<void> {
  if (isRefreshingCpuTemp) return;
  const nowMs = Date.now();
  if (nowMs - lastCpuTempPollMs < 1800) return;

  isRefreshingCpuTemp = true;
  lastCpuTempPollMs = nowMs;

  try {
    const jsonRes = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
      execFile('sensors', ['-j'], { timeout: 2000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        resolve({ ok: !err && Boolean(stdout), stdout: stdout || '' });
      });
    });

    if (jsonRes.ok) {
      const parsed = parseSensorsJsonOutput(jsonRes.stdout);
      if (parsed) {
        latestCpuTemp = { tempC: parsed.tempC, source: parsed.source };
        return;
      }
    }

    const textRes = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
      execFile('sensors', [], { timeout: 2000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        resolve({ ok: !err && Boolean(stdout), stdout: stdout || '' });
      });
    });

    if (textRes.ok) {
      const parsed = parseSensorsTextOutput(textRes.stdout);
      if (parsed) {
        latestCpuTemp = { tempC: parsed.tempC, source: parsed.source };
        return;
      }
    }

    const sysfsTemp = readLinuxSysfsCpuTemp();
    if (sysfsTemp) {
      latestCpuTemp = { tempC: sysfsTemp.tempC, source: sysfsTemp.source };
      return;
    }

    latestCpuTemp = { tempC: null, source: null };
  } finally {
    isRefreshingCpuTemp = false;
  }
}

function readCpuTotals(): { idle: number; total: number; cores: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total, cores: cpus.length || 1 };
}

function readLinuxMemoryMb(): { usedMb: number; totalMb: number; percent: number } {
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
      const totalMatch = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m);
      const availMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (totalMatch && availMatch) {
        const totalKb = parseInt(totalMatch[1], 10);
        const availKb = parseInt(availMatch[1], 10);
        if (totalKb > 0) {
          const usedKb = Math.max(0, totalKb - availKb);
          const totalMb = Math.round(totalKb / 1024);
          const usedMb = Math.round(usedKb / 1024);
          const percent = Number(((usedKb / totalKb) * 100).toFixed(1));
          return { usedMb, totalMb, percent };
        }
      }
    }
  } catch {}

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    usedMb: Math.round(usedBytes / (1024 * 1024)),
    totalMb: Math.round(totalBytes / (1024 * 1024)),
    percent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
  };
}

function sampleSystemTelemetry(now: Date = new Date()): SystemMetricsPoint {
  const currCpu = readCpuTotals();
  let cpuPercent = 0;

  if (prevCpuTotals) {
    const idleDelta = currCpu.idle - prevCpuTotals.idle;
    const totalDelta = currCpu.total - prevCpuTotals.total;
    if (totalDelta > 0) {
      cpuPercent = Number((Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))).toFixed(1));
    }
  } else {
    const load1m = os.loadavg()[0] || 0;
    cpuPercent = Number(Math.min(100, (load1m / currCpu.cores) * 100).toFixed(1));
  }
  prevCpuTotals = { idle: currCpu.idle, total: currCpu.total };

  const mem = readLinuxMemoryMb();
  const loadAvg1m = Number((os.loadavg()[0] || 0).toFixed(2));
  const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const point: SystemMetricsPoint = {
    timestamp: now.toISOString(),
    timeLabel,
    cpuPercent,
    ramPercent: mem.percent,
    ramUsedMb: mem.usedMb,
    ramTotalMb: mem.totalMb,
    loadAvg1m,
    cpuCores: currCpu.cores,
    cpuTempC: latestCpuTemp.tempC,
    cpuTempSource: latestCpuTemp.source,
  };

  latestSystemMetric = point;
  systemMetricsHistory.push(point);
  if (systemMetricsHistory.length > MAX_TELEMETRY_POINTS) {
    systemMetricsHistory.shift();
  }
  return point;
}

// Initial boot sample (prime sensor reading asynchronously, fallback synchronously from sysfs)
const initialSysfsTemp = readLinuxSysfsCpuTemp();
if (initialSysfsTemp) {
  latestCpuTemp = { tempC: initialSysfsTemp.tempC, source: initialSysfsTemp.source };
}
sampleSystemTelemetry(new Date());
void refreshCpuTemperature();
evaluateBellRandomizer(new Date(), true);

setInterval(async () => {
  const now = new Date();
  const currentSec = now.getSeconds();

  // Refresh CPU temperature via sensors / sysfs non-blockingly and sample metrics every second
  void refreshCpuTemperature();
  sampleSystemTelemetry(now);

  // Check amplifier power schedule every second
  handleAmplifierScheduleTick(now);

  // Check break-time radio every second
  handleBreakRadioTick(now);

  // Check weekly/daily bell randomizer schedule
  evaluateBellRandomizer(now);

  // Only trigger bells on second 00 of each minute
  if (currentSec !== 0) return;

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeKey = `${hours}:${minutes}`;

  if (lastTriggeredMinute === timeKey) return;
  lastTriggeredMinute = timeKey;

  if (config.muteUntil && new Date(config.muteUntil) > now) {
    return; // System is temporarily muted
  }

  const { profile, isHoliday, isNonWorkingDay } = getActiveProfileForNow(now);
  if (isHoliday || isNonWorkingDay || !profile) return; // Silent on holiday or non-working day

  const items: BellItem[] = (profile.items || []).filter((i: BellItem) => i.enabled);
  const currentVolume = getCurrentVolume();

  for (const item of items) {
    // 1. Check start bell
    if (item.startTime === timeKey) {
      if (radioStatus.isPlaying && radioStatus.mode === 'auto_break') {
        stopRadioStream('Dzwonek na lekcję');
      }
      const resolvedStart = resolveEffectiveBellSound('start', item.startSoundId, config.defaultStartSoundId, now);
      console.log(`[HarmoniaBell] DZWONEK START: ${item.name} o ${timeKey} (${resolvedStart.soundName})`);
      const res = await playSoundOnLinux(resolvedStart.soundId, currentVolume);

      history.unshift({
        id: `bell_${Date.now()}`,
        timestamp: now.toISOString(),
        timeStr: `${timeKey}:00`,
        bellType: 'lesson_start',
        title: `Rozpoczęcie: ${item.name}`,
        soundName: resolvedStart.soundName,
        status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
        details:
          res.error ||
          `Głośność: ${currentVolume}%, Silnik: ${res.tool}${resolvedStart.isRandomized ? ' (wylosowany na dzień)' : ''}`,
      });
      saveHistory();
    }

    // 2. Check end bell
    if (item.endTime === timeKey) {
      const resolvedEnd = resolveEffectiveBellSound('end', item.endSoundId, config.defaultEndSoundId, now);
      console.log(`[HarmoniaBell] DZWONEK KONIEC: ${item.name} o ${timeKey} (${resolvedEnd.soundName})`);
      const res = await playSoundOnLinux(resolvedEnd.soundId, currentVolume);

      history.unshift({
        id: `bell_${Date.now()}`,
        timestamp: now.toISOString(),
        timeStr: `${timeKey}:00`,
        bellType: 'lesson_end',
        title: `Koniec: ${item.name}`,
        soundName: resolvedEnd.soundName,
        status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
        details:
          res.error ||
          `Głośność: ${currentVolume}%, Silnik: ${res.tool}${resolvedEnd.isRandomized ? ' (wylosowany na dzień)' : ''}`,
      });
      saveHistory();
    }

    // 3. Check warning pre-bell
    if (config.warningBellEnabled && item.warningMinutesBefore > 0) {
      const [startH, startM] = item.startTime.split(':').map(Number);
      const startTotal = startH * 60 + startM;
      const warnTotal = startTotal - item.warningMinutesBefore;
      if (warnTotal >= 0) {
        const warnH = String(Math.floor(warnTotal / 60)).padStart(2, '0');
        const warnM = String(warnTotal % 60).padStart(2, '0');
        const warnKey = `${warnH}:${warnM}`;

        if (warnKey === timeKey) {
          if (radioStatus.isPlaying && radioStatus.mode === 'auto_break') {
            stopRadioStream('Dzwonek przywoławczy');
          }
          const resolvedWarn = resolveEffectiveBellSound(
            'warning',
            item.warningSoundId,
            config.defaultWarningSoundId,
            now
          );
          console.log(`[HarmoniaBell] DZWONEK PRZYWOŁAWCZY przed: ${item.name} o ${timeKey}`);
          const res = await playSoundOnLinux(resolvedWarn.soundId, Math.max(50, currentVolume - 10));

          history.unshift({
            id: `bell_${Date.now()}`,
            timestamp: now.toISOString(),
            timeStr: `${timeKey}:00`,
            bellType: 'warning',
            title: `Przywoławczy (1 min): ${item.name}`,
            soundName: resolvedWarn.soundName,
            status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
            details:
              res.error ||
              `Głośność: ${currentVolume - 10}%, Silnik: ${res.tool}${resolvedWarn.isRandomized ? ' (wylosowany na dzień)' : ''}`,
          });
          saveHistory();
        }
      }
    }
  }
}, 1000);

/* =========================== REST API ROUTES =========================== */

// 0. Public Auth & TV Display Routes
app.get('/api/auth/me', (req: Request, res: Response) => {
  const ctx = verifySessionToken(extractRequestToken(req));
  res.json(buildAuthStatus(ctx));
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Podaj login i hasło' });
  }

  const trimmedUser = username.trim();
  const user = authStore.users.find((u) => u.username.toLowerCase() === trimmedUser.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowy login lub hasło' });
  }

  if (!user.active) {
    return res.status(403).json({ success: false, error: 'To konto użytkownika zostało zablokowane przez administratora' });
  }

  const ctx = resolveUserContext(user);
  const token = createSessionToken(user);
  setSessionCookie(req, res, token);

  res.json({
    success: true,
    ...buildAuthStatus(ctx),
    token,
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  clearSessionCookie(req, res);
  res.json({ success: true });
});

app.post('/api/auth/change-credentials', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const ctx = req.auth!;
  const { currentPassword, newUsername, newDisplayName, newPassword } = req.body || {};

  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, ctx.user.passwordHash)) {
    return res.status(403).json({ success: false, error: 'Obecne hasło jest nieprawidłowe' });
  }

  const cleanUser = typeof newUsername === 'string' ? newUsername.trim() : '';
  if (cleanUser.length < 3) {
    return res.status(400).json({ success: false, error: 'Login musi mieć co najmniej 3 znaki' });
  }

  const duplicate = authStore.users.find(
    (u) => u.id !== ctx.user.id && u.username.toLowerCase() === cleanUser.toLowerCase()
  );
  if (duplicate) {
    return res.status(409).json({ success: false, error: 'Podany login jest już zajęty przez innego użytkownika' });
  }

  if (newPassword !== undefined && newPassword !== '') {
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      return res.status(400).json({ success: false, error: 'Nowe hasło musi mieć co najmniej 4 znaki' });
    }
    ctx.user.passwordHash = hashPassword(newPassword);
    ctx.user.mustChangePassword = false;
  } else if (ctx.user.mustChangePassword) {
    return res.status(400).json({
      success: false,
      error: 'Przy pierwszym logowaniu ustaw nowe hasło (min. 4 znaki)',
    });
  }

  ctx.user.username = cleanUser;
  if (typeof newDisplayName === 'string' && newDisplayName.trim().length > 0) {
    ctx.user.displayName = newDisplayName.trim();
  }
  ctx.user.tokenVersion += 1;
  saveAuthStore();

  const updatedCtx = resolveUserContext(ctx.user);
  const token = createSessionToken(ctx.user);
  setSessionCookie(req, res, token);

  res.json({
    success: true,
    ...buildAuthStatus(updatedCtx),
    token,
    message: 'Dane logowania zostały zaktualizowane',
  });
});

// 0b. RBAC Admin Routes (Groups & Users Management - requires users_manage)
app.get('/api/admin/rbac', requireAnyPermission(['users_manage']), (_req: Request, res: Response) => {
  res.json({
    groups: authStore.groups,
    users: authStore.users.map(toPublicUser),
  });
});

app.post('/api/admin/groups', requireAnyPermission(['users_manage']), (req: Request, res: Response) => {
  const { name, description = '', permissions } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName.length < 2) {
    return res.status(400).json({ success: false, error: 'Nazwa grupy musi mieć co najmniej 2 znaki' });
  }

  const duplicate = authStore.groups.find((g) => g.name.toLowerCase() === cleanName.toLowerCase());
  if (duplicate) {
    return res.status(409).json({ success: false, error: 'Grupa o tej nazwie już istnieje' });
  }

  const newGroup: PermissionGroup = {
    id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    description: typeof description === 'string' ? description.trim() : '',
    isSystem: false,
    permissions: sanitizePermissions(permissions),
  };

  authStore.groups.push(newGroup);
  saveAuthStore();
  res.json({ success: true, group: newGroup });
});

app.put('/api/admin/groups/:id', requireAnyPermission(['users_manage']), (req: Request, res: Response) => {
  const { id } = req.params;
  const group = authStore.groups.find((g) => g.id === id);
  if (!group) {
    return res.status(404).json({ success: false, error: 'Nie znaleziono grupy' });
  }

  const { name, description, permissions } = req.body || {};
  if (typeof name === 'string') {
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      return res.status(400).json({ success: false, error: 'Nazwa grupy musi mieć co najmniej 2 znaki' });
    }
    const duplicate = authStore.groups.find(
      (g) => g.id !== id && g.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ success: false, error: 'Inna grupa ma już taką nazwę' });
    }
    group.name = cleanName;
  }

  if (typeof description === 'string') {
    group.description = description.trim();
  }

  if (permissions !== undefined) {
    let nextPerms = sanitizePermissions(permissions);
    if (group.id === 'grp_admin' && !nextPerms.includes('users_manage')) {
      nextPerms = ['users_manage', ...nextPerms];
    }
    // Check we do not remove users_manage from the only active admin group
    const prevHadManage = group.permissions.includes('users_manage');
    const nextHasManage = nextPerms.includes('users_manage');
    if (prevHadManage && !nextHasManage) {
      const otherAdmins = authStore.users.filter((u) => {
        if (!u.active || u.groupId === group.id) return false;
        const g = authStore.groups.find((gr) => gr.id === u.groupId);
        return Boolean(g && g.permissions.includes('users_manage'));
      });
      if (otherAdmins.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Nie można odebrać uprawnienia zarządzania użytkownikami ostatniej aktywnej grupie administratorów',
        });
      }
    }
    group.permissions = nextPerms;
  }

  saveAuthStore();
  res.json({ success: true, group });
});

app.delete('/api/admin/groups/:id', requireAnyPermission(['users_manage']), (req: Request, res: Response) => {
  const { id } = req.params;
  const idx = authStore.groups.findIndex((g) => g.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Nie znaleziono grupy' });
  }
  const group = authStore.groups[idx];
  if (group.isSystem) {
    return res.status(400).json({ success: false, error: 'Nie można usunąć wbudowanej grupy systemowej' });
  }

  const assignedCount = authStore.users.filter((u) => u.groupId === id).length;
  if (assignedCount > 0) {
    return res.status(400).json({
      success: false,
      error: `Nie można usunąć grupy, ponieważ przypisano do niej użytkowników (${assignedCount}). Najpierw przenieś ich do innej grupy.`,
    });
  }

  authStore.groups.splice(idx, 1);
  saveAuthStore();
  res.json({ success: true });
});

app.post('/api/admin/users', requireAnyPermission(['users_manage']), (req: Request, res: Response) => {
  const { username, displayName = '', password, groupId, active = true, mustChangePassword = false } = req.body || {};
  const cleanUser = typeof username === 'string' ? username.trim() : '';
  if (cleanUser.length < 3) {
    return res.status(400).json({ success: false, error: 'Login użytkownika musi mieć co najmniej 3 znaki' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ success: false, error: 'Hasło użytkownika musi mieć co najmniej 4 znaki' });
  }

  const group = authStore.groups.find((g) => g.id === groupId);
  if (!group) {
    return res.status(400).json({ success: false, error: 'Wybrana grupa uprawnień nie istnieje' });
  }

  const duplicate = authStore.users.find((u) => u.username.toLowerCase() === cleanUser.toLowerCase());
  if (duplicate) {
    return res.status(409).json({ success: false, error: 'Użytkownik o takim loginie już istnieje' });
  }

  const newUser: UserAccountRecord = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    username: cleanUser,
    displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : cleanUser,
    passwordHash: hashPassword(password),
    groupId: group.id,
    active: Boolean(active),
    mustChangePassword: Boolean(mustChangePassword),
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
  };

  authStore.users.push(newUser);
  saveAuthStore();
  res.json({ success: true, user: toPublicUser(newUser) });
});

app.put('/api/admin/users/:id', requireAnyPermission(['users_manage']), (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = authStore.users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Nie znaleziono użytkownika' });
  }

  const { username, displayName, groupId, active, password, mustChangePassword } = req.body || {};

  if (typeof username === 'string') {
    const cleanUser = username.trim();
    if (cleanUser.length < 3) {
      return res.status(400).json({ success: false, error: 'Login musi mieć co najmniej 3 znaki' });
    }
    const dup = authStore.users.find(
      (u) => u.id !== id && u.username.toLowerCase() === cleanUser.toLowerCase()
    );
    if (dup) {
      return res.status(409).json({ success: false, error: 'Ten login jest już używany' });
    }
    user.username = cleanUser;
  }

  if (typeof displayName === 'string' && displayName.trim()) {
    user.displayName = displayName.trim();
  }

  if (typeof groupId === 'string') {
    const targetGroup = authStore.groups.find((g) => g.id === groupId);
    if (!targetGroup) {
      return res.status(400).json({ success: false, error: 'Wybrana grupa uprawnień nie istnieje' });
    }
    if (req.auth?.user.id === user.id && !targetGroup.permissions.includes('users_manage')) {
      return res.status(400).json({
        success: false,
        error: 'Nie możesz przenieść własnego konta do grupy bez uprawnień zarządzania użytkownikami',
      });
    }
    const currGrp = authStore.groups.find((g) => g.id === user.groupId);
    if (
      user.active &&
      currGrp?.permissions.includes('users_manage') &&
      !targetGroup.permissions.includes('users_manage') &&
      countActiveUsersWithPermission('users_manage') <= 1
    ) {
      return res.status(400).json({
        success: false,
        error: 'W systemie musi pozostać co najmniej jeden aktywny administrator użytkowników',
      });
    }
    user.groupId = targetGroup.id;
  }

  if (typeof active === 'boolean') {
    if (!active && req.auth?.user.id === user.id) {
      return res.status(400).json({ success: false, error: 'Nie możesz zablokować własnego aktywnego konta' });
    }
    const grp = authStore.groups.find((g) => g.id === user.groupId);
    if (!active && user.active && grp?.permissions.includes('users_manage') && countActiveUsersWithPermission('users_manage') <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Nie można zablokować ostatniego administratora w systemie',
      });
    }
    if (user.active && !active) {
      user.tokenVersion += 1;
    }
    user.active = active;
  }

  if (typeof password === 'string' && password.length > 0) {
    if (password.length < 4) {
      return res.status(400).json({ success: false, error: 'Hasło musi mieć co najmniej 4 znaki' });
    }
    user.passwordHash = hashPassword(password);
    user.tokenVersion += 1;
  }

  if (typeof mustChangePassword === 'boolean') {
    user.mustChangePassword = mustChangePassword;
  }

  saveAuthStore();
  res.json({ success: true, user: toPublicUser(user) });
});

app.delete('/api/admin/users/:id', requireAnyPermission(['users_manage']), (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  if (req.auth?.user.id === id) {
    return res.status(400).json({ success: false, error: 'Nie możesz usunąć aktualnie zalogowanego konta' });
  }
  const idx = authStore.users.findIndex((u) => u.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Nie znaleziono użytkownika' });
  }

  const target = authStore.users[idx];
  const grp = authStore.groups.find((g) => g.id === target.groupId);
  if (target.active && grp?.permissions.includes('users_manage') && countActiveUsersWithPermission('users_manage') <= 1) {
    return res.status(400).json({
      success: false,
      error: 'Nie można usunąć ostatniego administratora w systemie',
    });
  }

  authStore.users.splice(idx, 1);
  saveAuthStore();
  res.json({ success: true });
});

// Public read-only status & TV display data (no auth required for /tv kiosk screens)
app.get('/api/status', (_req: Request, res: Response) => {
  res.json(computeSystemStatus());
});

app.get('/api/tv-data', (_req: Request, res: Response) => {
  const now = new Date();
  const { profile } = getActiveProfileForNow(now);
  const activeProfile =
    profile || config.schedules.find((s) => s.id === config.activeProfileId) || config.schedules[0];

  const payload: TvPublicData = {
    schoolName: config.schoolName,
    schoolSubtitle: config.schoolSubtitle,
    activeProfile,
    radioEnabled: config.radioEnabled,
    radioStations: (config.radioStations || []).map((s) => ({
      id: s.id,
      name: s.name,
      genre: s.genre,
    })),
    defaultRadioStationId: config.defaultRadioStationId,
    tvDisplay: {
      ...DEFAULT_TV_DISPLAY_CONFIG,
      ...(config.tvDisplay || {}),
    },
  };
  res.json(payload);
});

function sanitizeHexColor(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function sanitizeTvText(val: unknown, fallback: string, maxLen: number = 140): string {
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned.slice(0, maxLen);
}

function sanitizeTvDisplayConfig(raw: unknown): TvDisplayConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const base = {
    ...DEFAULT_TV_DISPLAY_CONFIG,
    ...(config.tvDisplay || {}),
  };

  return {
    headerTitle:
      'headerTitle' in src
        ? sanitizeTvText(src.headerTitle, base.headerTitle, 140) || DEFAULT_TV_DISPLAY_CONFIG.headerTitle
        : base.headerTitle,
    headerSubtitlePrefix:
      'headerSubtitlePrefix' in src
        ? sanitizeTvText(src.headerSubtitlePrefix, base.headerSubtitlePrefix, 80)
        : base.headerSubtitlePrefix,
    nextBellTitle:
      'nextBellTitle' in src
        ? sanitizeTvText(src.nextBellTitle, base.nextBellTitle, 80) || DEFAULT_TV_DISPLAY_CONFIG.nextBellTitle
        : base.nextBellTitle,
    radioBlockTitle:
      'radioBlockTitle' in src
        ? sanitizeTvText(src.radioBlockTitle, base.radioBlockTitle, 80) || DEFAULT_TV_DISPLAY_CONFIG.radioBlockTitle
        : base.radioBlockTitle,
    scheduleStripTitle:
      'scheduleStripTitle' in src
        ? sanitizeTvText(src.scheduleStripTitle, base.scheduleStripTitle, 100) || DEFAULT_TV_DISPLAY_CONFIG.scheduleStripTitle
        : base.scheduleStripTitle,
    footerModeText:
      'footerModeText' in src
        ? sanitizeTvText(src.footerModeText, base.footerModeText, 120)
        : base.footerModeText,
    announcementText:
      'announcementText' in src
        ? sanitizeTvText(src.announcementText, '', 260)
        : base.announcementText,
    showHeader: 'showHeader' in src ? Boolean(src.showHeader) : base.showHeader,
    showDate: 'showDate' in src ? Boolean(src.showDate) : base.showDate,
    showClockSeconds: 'showClockSeconds' in src ? Boolean(src.showClockSeconds) : base.showClockSeconds,
    showProgressBar: 'showProgressBar' in src ? Boolean(src.showProgressBar) : base.showProgressBar,
    showNextBellBlock: 'showNextBellBlock' in src ? Boolean(src.showNextBellBlock) : base.showNextBellBlock,
    showRadioBlock: 'showRadioBlock' in src ? Boolean(src.showRadioBlock) : base.showRadioBlock,
    showScheduleStrip: 'showScheduleStrip' in src ? Boolean(src.showScheduleStrip) : base.showScheduleStrip,
    backgroundColor: sanitizeHexColor(src.backgroundColor, base.backgroundColor),
    panelColor: sanitizeHexColor(src.panelColor, base.panelColor),
    textColor: sanitizeHexColor(src.textColor, base.textColor),
    mutedTextColor: sanitizeHexColor(src.mutedTextColor, base.mutedTextColor),
    accentColor: sanitizeHexColor(src.accentColor, base.accentColor),
    lessonColor: sanitizeHexColor(src.lessonColor, base.lessonColor),
    breakColor: sanitizeHexColor(src.breakColor, base.breakColor),
  };
}

// 2. Config API (Protected + Section-level RBAC verification)
app.get('/api/config', requireAuth, (_req: Request, res: Response) => {
  res.json(config);
});

const CONFIG_KEY_PERMISSIONS: Record<string, PermissionKey[]> = {
  schoolName: ['schedules_edit', 'debian_view', 'users_manage'],
  schoolSubtitle: ['schedules_edit', 'debian_view', 'users_manage'],
  activeProfileId: ['schedules_edit'],
  schedules: ['schedules_edit', 'radio_control'],
  weekMapping: ['schedules_edit', 'calendar_edit'],
  weekMappingVersion: ['schedules_edit', 'calendar_edit'],
  warningBellEnabled: ['schedules_edit'],
  defaultWarningMinutes: ['schedules_edit'],
  playWarningOnBreakEnd: ['schedules_edit'],
  defaultStartSoundId: ['sounds_manage', 'schedules_edit'],
  defaultEndSoundId: ['sounds_manage', 'schedules_edit'],
  defaultWarningSoundId: ['sounds_manage', 'schedules_edit'],
  holidays: ['calendar_edit'],
  masterVolume: ['volume_edit'],
  volumeSchedule: ['volume_edit'],
  audioEngine: ['volume_edit'],
  audioDevice: ['volume_edit'],
  soundFadeInMs: ['volume_edit'],
  muteUntil: ['manual_bell'],
  radioEnabled: ['radio_control'],
  radioStations: ['radio_control'],
  defaultRadioStationId: ['radio_control'],
  radioVolume: ['radio_control'],
  radioStartDelaySeconds: ['radio_control'],
  radioStopBeforeBellSeconds: ['radio_control'],
  amplifierControlEnabled: ['volume_edit', 'schedules_edit'],
  amplifierDevicePath: ['volume_edit'],
  amplifierAppendNewline: ['volume_edit'],
  amplifierRespectHolidays: ['schedules_edit', 'volume_edit'],
  amplifierSchedule: ['schedules_edit', 'volume_edit'],
  tvDisplay: ['volume_edit', 'schedules_edit', 'users_manage'],
  remoteBellsUrl: ['sounds_manage', 'schedules_edit'],
  bellRandomizer: ['sounds_manage', 'schedules_edit'],
};

app.post('/api/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = req.auth!;
    const incoming = (req.body || {}) as Record<string, unknown>;

    for (const [key, nextVal] of Object.entries(incoming)) {
      const prevVal = (config as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(prevVal) === JSON.stringify(nextVal)) {
        continue;
      }
      const allowedPerms = CONFIG_KEY_PERMISSIONS[key];
      if (allowedPerms && !allowedPerms.some((p) => ctx.permissions.includes(p))) {
        return res.status(403).json({
          success: false,
          error: `Brak uprawnień do modyfikacji sekcji konfiguracji (${key})`,
        });
      }
    }

    if ('amplifierDevicePath' in incoming && incoming.amplifierDevicePath !== undefined) {
      const validated = validateAmplifierDevicePath(incoming.amplifierDevicePath);
      if (!validated.ok) {
        return res.status(400).json({ success: false, error: validated.error });
      }
      incoming.amplifierDevicePath = validated.devicePath;
    }

    if ('amplifierSchedule' in incoming && incoming.amplifierSchedule !== undefined) {
      if (!Array.isArray(incoming.amplifierSchedule)) {
        return res.status(400).json({ success: false, error: 'Nieprawidłowy format harmonogramu wzmacniacza.' });
      }
    }

    if ('tvDisplay' in incoming && incoming.tvDisplay !== undefined) {
      const sanitizedTv = sanitizeTvDisplayConfig(incoming.tvDisplay);
      if (!sanitizedTv) {
        return res.status(400).json({ success: false, error: 'Nieprawidłowy format ustawień ekranu TV.' });
      }
      incoming.tvDisplay = sanitizedTv;
    }

    if ('remoteBellsUrl' in incoming && incoming.remoteBellsUrl !== undefined) {
      if (typeof incoming.remoteBellsUrl !== 'string' || !/^https?:\/\//i.test(incoming.remoteBellsUrl.trim())) {
        return res.status(400).json({ success: false, error: 'Adres katalogu dzwonków musi zaczynać się od http:// lub https://.' });
      }
      incoming.remoteBellsUrl = incoming.remoteBellsUrl.trim().slice(0, 500);
    }

    if ('bellRandomizer' in incoming && incoming.bellRandomizer !== undefined) {
      const sanitizedRand = sanitizeBellRandomizerConfig(incoming.bellRandomizer);
      if (!sanitizedRand) {
        return res.status(400).json({ success: false, error: 'Nieprawidłowy format konfiguracji losowania dzwonków.' });
      }
      incoming.bellRandomizer = sanitizedRand;
    }

    config = { ...config, ...incoming } as AppConfig;
    // Allow immediate schedule re-evaluation if amplifier config/schedule changed
    amplifierLastAutoWindowKey = null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    if ('bellRandomizer' in incoming) {
      evaluateBellRandomizer(new Date(), true);
    }
    res.json({ success: true, message: 'Konfiguracja zapisana pomyślnie' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Manual bell trigger (Protected)
app.post('/api/trigger-bell', requireAnyPermission(['manual_bell']), async (req: Request, res: Response) => {
  const { soundId, type = 'manual', title = 'Dzwonek ręczny', customVolume } = req.body;
  const vol = typeof customVolume === 'number' ? customVolume : getCurrentVolume();
  const soundObj = PRESET_SOUNDS.find((p) => p.id === soundId) || customSounds.find((s) => s.id === soundId);
  const soundName = soundObj ? soundObj.name : soundId;

  const result = await playSoundOnLinux(soundId, vol);

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  history.unshift({
    id: `bell_${Date.now()}`,
    timestamp: now.toISOString(),
    timeStr,
    bellType: type as BellType,
    title,
    soundName,
    status: result.success ? (result.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
    details: result.error || `Ręczne wyzwolenie. Głośność: ${vol}%, Silnik: ${result.tool}`,
  });
  saveHistory();

  res.json({
    success: result.success,
    tool: result.tool,
    error: result.error,
    message: `Wyzwolono dzwonek: ${soundName}`,
  });
});

// 4. Test speaker audio output (Protected)
app.post('/api/test-audio', requireAnyPermission(['manual_bell', 'volume_edit']), async (req: Request, res: Response) => {
  const { soundId = 'marimba_sunshine', volume = 75 } = req.body;
  const result = await playSoundOnLinux(soundId, volume);
  res.json({
    success: result.success,
    tool: result.tool,
    error: result.error,
    message: result.success
      ? 'Dźwięk testowy został wysłany do karty dźwiękowej Linux'
      : `Błąd odtwarzania: ${result.error}`,
  });
});

// 5. Sound tracks catalogue (Protected)
app.get('/api/sounds', requireAuth, (_req: Request, res: Response) => {
  const presets: SoundTrack[] = PRESET_SOUNDS.map((p) => ({
    id: p.id,
    name: p.name,
    category: 'preset',
    description: p.description,
    musicalKey: p.musicalKey,
    durationSeconds: p.durationSeconds,
    tags: p.tags,
    filename: `${p.id}.wav`,
    fileUrl: `/sounds/${p.id}.wav`,
  }));

  res.json({
    presets,
    custom: customSounds,
  });
});

// 6. Upload custom sound (Protected)
app.post('/api/sounds/upload', requireAnyPermission(['sounds_manage']), (req: Request, res: Response) => {
  try {
    const { name, musicalKey = 'Własny', description = 'Własne nagranie szkolne', base64Data, filename } = req.body;
    if (!name || !base64Data) {
      return res.status(400).json({ error: 'Brak nazwy lub danych pliku' });
    }

    const ext = path.extname(filename || '.mp3') || '.mp3';
    const safeExt = ['.mp3', '.wav', '.ogg'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.mp3';
    const id = `custom_${Date.now()}`;
    const targetFileName = `${id}${safeExt}`;
    const targetPath = path.join(SOUNDS_DIR, targetFileName);

    // Remove data:audio/...;base64, header if present
    const cleanBase64 = base64Data.replace(/^data:audio\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(targetPath, buffer);

    const newSound: SoundTrack = {
      id,
      name,
      category: 'custom',
      description,
      musicalKey,
      durationSeconds: 4.0,
      tags: ['własny', 'plik szkolny'],
      filename: targetFileName,
      fileUrl: `/sounds/${targetFileName}`,
      isCustom: true,
    };

    customSounds.push(newSound);
    fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));

    res.json({ success: true, sound: newSound });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Delete custom sound (Protected)
app.delete('/api/sounds/:id', requireAnyPermission(['sounds_manage']), (req: Request, res: Response) => {
  const { id } = req.params;
  const idx = customSounds.findIndex((s) => s.id === id);
  if (idx !== -1) {
    const sound = customSounds[idx];
    if (sound.filename) {
      const p = path.resolve(SOUNDS_DIR, path.basename(sound.filename));
      if (p.startsWith(SOUNDS_DIR + path.sep) && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
    customSounds.splice(idx, 1);
    fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));
    cleanupInvalidRandomizerAssignments();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Nie znaleziono pliku' });
});

// 7b. Remote Web Directory Browser, Downloader & Sync (Protected + SSRF/Path hardened)
const ALLOWED_REMOTE_AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const MAX_REMOTE_AUDIO_BYTES = 25 * 1024 * 1024;

function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(ip.slice(7));
    }
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('ff')) {
      return true;
    }
    return false;
  }
  return true;
}

async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Podaj poprawny adres URL katalogu.');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Nieprawidłowy format adresu URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Dozwolone są wyłącznie adresy http:// oraz https://.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Adres URL nie może zawierać wbudowanych danych logowania.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Lokalne i wewnętrzne adresy sieciowe są zablokowane.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Prywatne lub lokalne adresy IP są zablokowane.');
    }
    return parsed;
  }

  let resolved: { address: string; family: number }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Nie udało się rozpoznać nazwy domeny: ${host}`);
  }
  if (!resolved || resolved.length === 0) {
    throw new Error(`Brak rekordów DNS dla domeny: ${host}`);
  }
  for (const entry of resolved) {
    if (isPrivateOrReservedIp(entry.address)) {
      throw new Error('Domena wskazuje na adres lokalny lub prywatny, co jest zablokowane.');
    }
  }
  return parsed;
}

async function fetchWithSafeRedirects(
  urlStr: string,
  timeoutMs: number,
  maxRedirects: number = 3
): Promise<{ response: globalThis.Response; finalUrl: string }> {
  let currentUrl = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safeUrl = await assertSafePublicHttpUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'HarmoniaBell-Controller/1.0',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Serwer zwrócił przekierowanie (${response.status}) bez docelowego adresu.`);
        }
        currentUrl = new URL(location, safeUrl.toString()).toString();
        continue;
      }
      return { response, finalUrl: safeUrl.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Zbyt wiele przekierowań HTTP.');
}

function buildLocalRemoteFilename(remoteFilename: string): string {
  const baseOnly = path.basename(remoteFilename);
  const ext = path.extname(baseOnly).toLowerCase();
  const safeExt = ALLOWED_REMOTE_AUDIO_EXTS.has(ext) ? ext : '.mp3';
  const rawStem = baseOnly.slice(0, baseOnly.length - ext.length);
  const safeStem = rawStem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'bell';
  const shortHash = crypto.createHash('sha1').update(remoteFilename).digest('hex').slice(0, 6);
  return `remote_${safeStem}_${shortHash}${safeExt}`;
}

function formatRemoteFriendlyName(filename: string): string {
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  return stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || filename;
}

function parseRemoteBellsHtml(
  html: string,
  baseUrl: string
): Omit<RemoteBellFile, 'alreadyOnController' | 'localSoundId'>[] {
  const parsedBase = new URL(baseUrl);
  const results: Omit<RemoteBellFile, 'alreadyOnController' | 'localSoundId'>[] = [];
  const seenUrls = new Set<string>();

  const anchorRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    const afterStart = match.index + match[0].length;
    const rawSlice = html.slice(afterStart, afterStart + 260);
    const stopIdx = rawSlice.search(/<a\b|<\/tr>|\r?\n/i);
    const trailingRaw = stopIdx >= 0 ? rawSlice.slice(0, stopIdx) : rawSlice;
    const trailingText = trailingRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rawHref) continue;
    if (
      rawHref.startsWith('#') ||
      rawHref.startsWith('?') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('javascript:') ||
      rawHref.endsWith('/') ||
      rawHref === '..' ||
      rawHref === '../'
    ) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(rawHref, parsedBase);
    } catch {
      continue;
    }

    if (resolved.hostname.toLowerCase() !== parsedBase.hostname.toLowerCase()) {
      continue;
    }

    const lastSeg = resolved.pathname.split('/').filter(Boolean).pop();
    if (!lastSeg) continue;

    let decodedFilename = lastSeg;
    try {
      decodedFilename = decodeURIComponent(lastSeg);
    } catch {}

    const ext = path.extname(decodedFilename).toLowerCase();
    if (!ALLOWED_REMOTE_AUDIO_EXTS.has(ext)) {
      continue;
    }

    const resolvedStr = resolved.toString();
    if (seenUrls.has(resolvedStr)) continue;
    seenUrls.add(resolvedStr);

    const dateMatch = trailingText.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}-[A-Za-z]{3}-\d{4})\b/);
    const withoutDateAndTime = trailingText
      .replace(/\b\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b/g, ' ')
      .replace(/\b\d{2}-[A-Za-z]{3}-\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b/g, ' ')
      .replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, ' ');
    const sizeMatch = withoutDateAndTime.match(/\b(\d+(?:[.,]\d+)?\s*[KMG]i?B?|\d{4,})\b/i);

    results.push({
      filename: decodedFilename,
      name: formatRemoteFriendlyName(decodedFilename),
      url: resolvedStr,
      ext: ext.slice(1).toUpperCase(),
      sizeLabel: sizeMatch ? sizeMatch[1] : undefined,
      modifiedAt: dateMatch ? dateMatch[1] : undefined,
    });
  }

  return results.sort((a, b) => a.filename.localeCompare(b.filename, 'pl'));
}

function normalizeRemoteDirectoryUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const parsed = new URL(trimmed);
  if (!parsed.pathname.endsWith('/') && !parsed.search && !parsed.hash) {
    const lastSeg = parsed.pathname.split('/').filter(Boolean).pop() || '';
    if (!lastSeg.includes('.')) {
      parsed.pathname = `${parsed.pathname}/`;
    }
  }
  return parsed.toString();
}

async function scanRemoteBellsDirectory(rawUrl: string): Promise<RemoteBellScanResult> {
  const normalizedInput = normalizeRemoteDirectoryUrl(rawUrl);
  const { response, finalUrl } = await fetchWithSafeRedirects(normalizedInput, 15000);
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'Serwer zdalny zwrócił kod HTTP 403 (brak uprawnień do listowania katalogu – włącz autoindex np. Options +Indexes na serwerze WWW lub utwórz plik index.html / index.json).'
      );
    }
    throw new Error(`Serwer zdalny zwrócił kod HTTP ${response.status}.`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
    throw new Error(`Podany adres nie zwraca listy katalogu (${contentType || 'nieznany typ'}).`);
  }

  const bodyText = await response.text();
  if (bodyText.length > 2 * 1024 * 1024) {
    throw new Error('Odpowiedź katalogu internetowego jest zbyt duża.');
  }

  let parsedFiles: Omit<RemoteBellFile, 'alreadyOnController' | 'localSoundId'>[] = [];
  if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(bodyText);
      const list = Array.isArray(json) ? json : Array.isArray(json?.files) ? json.files : [];
      for (const entry of list) {
        const fname = typeof entry === 'string' ? entry : typeof entry?.filename === 'string' ? entry.filename : entry?.name;
        if (typeof fname !== 'string') continue;
        const ext = path.extname(fname).toLowerCase();
        if (!ALLOWED_REMOTE_AUDIO_EXTS.has(ext)) continue;
        const absUrl = new URL(fname, finalUrl).toString();
        parsedFiles.push({
          filename: path.basename(fname),
          name: formatRemoteFriendlyName(path.basename(fname)),
          url: absUrl,
          ext: ext.slice(1).toUpperCase(),
          sizeLabel: typeof entry?.size === 'string' ? entry.size : undefined,
        });
      }
    } catch {
      parsedFiles = [];
    }
  } else {
    parsedFiles = parseRemoteBellsHtml(bodyText, finalUrl);
  }

  const remoteFilenameSet = new Set(parsedFiles.map((f) => f.filename.toLowerCase()));
  const files: RemoteBellFile[] = parsedFiles.map((f) => {
    const targetLocalFilename = buildLocalRemoteFilename(f.filename);
    const localMatch = customSounds.find(
      (s) =>
        s.remoteFilename?.toLowerCase() === f.filename.toLowerCase() ||
        s.remoteUrl === f.url ||
        s.filename?.toLowerCase() === targetLocalFilename.toLowerCase()
    );
    return {
      ...f,
      alreadyOnController: Boolean(localMatch),
      localSoundId: localMatch?.id,
    };
  });

  const staleLocalSynced = customSounds
    .filter((s) => {
      if (!s.syncedFromRemote) return false;
      const key = (s.remoteFilename || s.filename || '').toLowerCase();
      return !remoteFilenameSet.has(key);
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      filename: s.filename || '',
      remoteFilename: s.remoteFilename,
    }));

  return {
    directoryUrl: finalUrl,
    scannedAt: new Date().toISOString(),
    files,
    staleLocalSynced,
  };
}

async function downloadSingleRemoteBell(
  fileUrl: string,
  remoteFilenameInput?: string
): Promise<{ status: 'added' | 'updated'; sound: SoundTrack }> {
  const safeUrlObj = await assertSafePublicHttpUrl(fileUrl);
  const rawName = remoteFilenameInput
    ? path.basename(remoteFilenameInput)
    : decodeURIComponent(safeUrlObj.pathname.split('/').filter(Boolean).pop() || 'bell.mp3');
  const ext = path.extname(rawName).toLowerCase();
  if (!ALLOWED_REMOTE_AUDIO_EXTS.has(ext)) {
    throw new Error(`Nieobsługiwane rozszerzenie pliku audio: ${rawName}`);
  }

  const { response } = await fetchWithSafeRedirects(safeUrlObj.toString(), 25000);
  if (!response.ok) {
    throw new Error(`Błąd pobierania ${rawName}: HTTP ${response.status}`);
  }
  const respContentType = (response.headers.get('content-type') || '').toLowerCase();
  if (respContentType.includes('text/html')) {
    throw new Error(`Plik ${rawName} zwrócił stronę HTML zamiast strumienia audio.`);
  }

  const contentLen = Number(response.headers.get('content-length') || 0);
  if (contentLen > MAX_REMOTE_AUDIO_BYTES) {
    throw new Error(`Plik ${rawName} przekracza limit 25 MB.`);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length === 0) {
    throw new Error(`Pobrany plik ${rawName} jest pusty.`);
  }
  if (buf.length > MAX_REMOTE_AUDIO_BYTES) {
    throw new Error(`Plik ${rawName} przekracza limit 25 MB.`);
  }

  const targetFileName = buildLocalRemoteFilename(rawName);
  const targetPath = path.resolve(SOUNDS_DIR, targetFileName);
  if (!targetPath.startsWith(SOUNDS_DIR + path.sep)) {
    throw new Error('Nieprawidłowa docelowa ścieżka pliku.');
  }

  fs.writeFileSync(targetPath, buf);

  const existingIdx = customSounds.findIndex(
    (s) =>
      s.remoteFilename?.toLowerCase() === rawName.toLowerCase() ||
      s.filename?.toLowerCase() === targetFileName.toLowerCase()
  );

  if (existingIdx !== -1) {
    const existing = customSounds[existingIdx];
    const updatedSound: SoundTrack = {
      ...existing,
      name: existing.name || formatRemoteFriendlyName(rawName),
      filename: targetFileName,
      fileUrl: `/sounds/${targetFileName}`,
      remoteUrl: safeUrlObj.toString(),
      remoteFilename: rawName,
      syncedFromRemote: true,
      sizeBytes: buf.length,
    };
    customSounds[existingIdx] = updatedSound;
    fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));
    return { status: 'updated', sound: updatedSound };
  }

  const id = `remote_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const newSound: SoundTrack = {
    id,
    name: formatRemoteFriendlyName(rawName),
    category: 'custom',
    description: `Pobrany z katalogu WWW (${safeUrlObj.hostname})`,
    musicalKey: `Katalog WWW (${ext.slice(1).toUpperCase()})`,
    durationSeconds: 4.0,
    tags: ['katalog WWW', ext.slice(1).toUpperCase()],
    filename: targetFileName,
    fileUrl: `/sounds/${targetFileName}`,
    isCustom: true,
    syncedFromRemote: true,
    remoteUrl: safeUrlObj.toString(),
    remoteFilename: rawName,
    sizeBytes: buf.length,
  };
  customSounds.push(newSound);
  fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));
  return { status: 'added', sound: newSound };
}

app.post('/api/sounds/remote/scan', requireAnyPermission(['sounds_manage']), async (req: Request, res: Response) => {
  try {
    const rawUrl =
      typeof req.body?.url === 'string' && req.body.url.trim()
        ? req.body.url.trim()
        : config.remoteBellsUrl || DEFAULT_REMOTE_BELLS_URL;

    const safeNormalized = normalizeRemoteDirectoryUrl(rawUrl);
    await assertSafePublicHttpUrl(safeNormalized);
    if (config.remoteBellsUrl !== safeNormalized) {
      config.remoteBellsUrl = safeNormalized;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }

    const result = await scanRemoteBellsDirectory(safeNormalized);
    if (config.remoteBellsUrl !== result.directoryUrl) {
      config.remoteBellsUrl = result.directoryUrl;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Nie udało się odczytać katalogu internetowego.' });
  }
});

app.get('/api/sounds/remote/preview', requireAnyPermission(['sounds_manage']), async (req: Request, res: Response) => {
  try {
    const rawUrl = typeof req.query?.url === 'string' ? req.query.url : '';
    const safeUrl = await assertSafePublicHttpUrl(rawUrl);
    const ext = path.extname(safeUrl.pathname).toLowerCase();
    if (!ALLOWED_REMOTE_AUDIO_EXTS.has(ext)) {
      return res.status(400).json({ error: 'Nieobsługiwany typ pliku audio.' });
    }
    const { response } = await fetchWithSafeRedirects(safeUrl.toString(), 15000);
    if (!response.ok) {
      return res.status(502).json({ error: `Błąd pobierania podglądu: HTTP ${response.status}` });
    }
    const contentLen = Number(response.headers.get('content-length') || 0);
    if (contentLen > MAX_REMOTE_AUDIO_BYTES) {
      return res.status(413).json({ error: 'Plik przekracza limit 25 MB.' });
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_REMOTE_AUDIO_BYTES) {
      return res.status(413).json({ error: 'Plik przekracza limit 25 MB.' });
    }
    const mimeMap: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Nie udało się odsłuchać pliku zdalnego.' });
  }
});

app.post('/api/sounds/remote/download', requireAnyPermission(['sounds_manage']), async (req: Request, res: Response) => {
  try {
    const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    if (rawFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'Nie zaznaczono żadnego pliku do pobrania.' });
    }
    if (rawFiles.length > 200) {
      return res.status(400).json({ success: false, error: 'Jednorazowo można pobrać maksymalnie 200 plików.' });
    }

    let added = 0;
    let updated = 0;
    const failed: { filename: string; error: string }[] = [];

    for (const item of rawFiles) {
      const fileUrl = typeof item?.url === 'string' ? item.url : '';
      const filename = typeof item?.filename === 'string' ? item.filename : fileUrl;
      try {
        const outcome = await downloadSingleRemoteBell(fileUrl, filename);
        if (outcome.status === 'added') added++;
        else updated++;
      } catch (err: any) {
        failed.push({ filename: String(filename), error: err.message || 'Błąd pobierania' });
      }
    }

    const scanUrl =
      typeof req.body?.directoryUrl === 'string' && req.body.directoryUrl.trim()
        ? req.body.directoryUrl.trim()
        : config.remoteBellsUrl || DEFAULT_REMOTE_BELLS_URL;
    let scanResult: RemoteBellScanResult | null = null;
    try {
      scanResult = await scanRemoteBellsDirectory(scanUrl);
    } catch {}

    res.json({
      success: added > 0 || updated > 0 || failed.length === 0,
      added,
      updated,
      failed,
      scanResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Błąd pobierania dzwonków.' });
  }
});

app.post('/api/sounds/remote/sync', requireAnyPermission(['sounds_manage']), async (req: Request, res: Response) => {
  try {
    const rawUrl =
      typeof req.body?.directoryUrl === 'string' && req.body.directoryUrl.trim()
        ? req.body.directoryUrl.trim()
        : config.remoteBellsUrl || DEFAULT_REMOTE_BELLS_URL;
    const removeStale = req.body?.removeStale !== false;

    const safeNormalized = normalizeRemoteDirectoryUrl(rawUrl);
    await assertSafePublicHttpUrl(safeNormalized);
    if (config.remoteBellsUrl !== safeNormalized) {
      config.remoteBellsUrl = safeNormalized;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }

    const initialScan = await scanRemoteBellsDirectory(safeNormalized);
    if (config.remoteBellsUrl !== initialScan.directoryUrl) {
      config.remoteBellsUrl = initialScan.directoryUrl;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }

    let added = 0;
    let skippedExisting = 0;
    let removed = 0;
    const failed: { filename: string; error: string }[] = [];

    for (const file of initialScan.files) {
      if (file.alreadyOnController) {
        skippedExisting++;
        continue;
      }
      try {
        await downloadSingleRemoteBell(file.url, file.filename);
        added++;
      } catch (err: any) {
        failed.push({ filename: file.filename, error: err.message || 'Błąd pobierania' });
      }
    }

    if (removeStale && initialScan.staleLocalSynced.length > 0) {
      const staleIds = new Set(initialScan.staleLocalSynced.map((s) => s.id));
      for (const stale of initialScan.staleLocalSynced) {
        if (stale.filename) {
          const p = path.resolve(SOUNDS_DIR, path.basename(stale.filename));
          if (p.startsWith(SOUNDS_DIR + path.sep) && fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {}
          }
        }
      }
      const beforeCount = customSounds.length;
      customSounds = customSounds.filter((s) => !staleIds.has(s.id));
      removed = beforeCount - customSounds.length;
      fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));
      cleanupInvalidRandomizerAssignments();
    }

    const updatedScan = await scanRemoteBellsDirectory(initialScan.directoryUrl);

    res.json({
      success: true,
      added,
      skippedExisting,
      removed,
      failed,
      result: updatedScan,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Błąd synchronizacji z katalogiem WWW.' });
  }
});

// 7c. Weekly / Multi-Week Bell Randomizer Draw (Protected)
app.post(
  '/api/sounds/randomizer/draw',
  requireAnyPermission(['sounds_manage', 'schedules_edit']),
  (req: Request, res: Response) => {
    try {
      const randCfg = getBellRandomizerConfig();
      const rawScope = req.body?.scope;
      const scope: 'current' | 'next' | 'cycle' =
        rawScope === 'cycle' ? 'cycle' : rawScope === 'next' ? 'next' : 'current';
      const customWeekKey =
        typeof req.body?.weekKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.weekKey)
          ? req.body.weekKey
          : null;
      const singleDay =
        typeof req.body?.dayOfWeek === 'number' &&
        Number.isInteger(req.body.dayOfWeek) &&
        req.body.dayOfWeek >= 0 &&
        req.body.dayOfWeek <= 6
          ? req.body.dayOfWeek
          : null;

      const now = new Date();
      const currentWeekKey = getWeekMondayDateStr(now);
      const nextWeekKey = getNextWeekMondayDateStr(now);
      const noRepeatWeeks = getNoRepeatWeeks(randCfg);

      const pool = getSoundPoolForRandomizer(randCfg);
      if (pool.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Brak dostępnych dzwonków w wybranej puli losowania.',
        });
      }

      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');

      if (scope === 'cycle' && singleDay === null) {
        const startMondayKey = req.body?.startFrom === 'next' ? nextWeekKey : currentWeekKey;
        const { workingAssignments, drawnWeekKeys } = drawCycleAssignments(
          randCfg,
          startMondayKey,
          noRepeatWeeks
        );
        randCfg.weekAssignments = pruneOldWeekAssignments(
          workingAssignments,
          currentWeekKey,
          noRepeatWeeks
        );
        randCfg.lastDrawnAt = now.toISOString();
        config.bellRandomizer = randCfg;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

        const totalSlots = drawnWeekKeys.reduce(
          (acc, wk) => acc + Object.keys(randCfg.weekAssignments[wk] || {}).length,
          0
        );
        const firstWeekSummary = Object.entries(randCfg.weekAssignments[drawnWeekKeys[0]] || {})
          .map(([d, sid]) => `${RANDOMIZER_DAY_NAMES[Number(d)] || d}: ${findSoundNameById(sid)}`)
          .join(', ');

        history.unshift({
          id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now.toISOString(),
          timeStr: `${hh}:${mm}:${ss}`,
          bellType: 'bell_draw',
          title: `Wylosowano harmonogram na ${noRepeatWeeks} tyg. bez powtórzeń (od ${startMondayKey})`,
          soundName: `${drawnWeekKeys.length} tyg. (${totalSlots} dni)`,
          status: 'simulated',
          details: `Pierwszy tydzień (${drawnWeekKeys[0]}): ${firstWeekSummary}`,
        });
        saveHistory();

        return res.json({
          success: true,
          scope: 'cycle',
          weeksCount: drawnWeekKeys.length,
          drawnWeekKeys,
          targetWeekKey: startMondayKey,
          bellRandomizer: randCfg,
        });
      }

      const targetWeekKey = customWeekKey || (scope === 'next' ? nextWeekKey : currentWeekKey);

      if (singleDay !== null) {
        const prevMap = { ...(randCfg.weekAssignments[targetWeekKey] || {}) };
        const usedOthersInWeek = new Set(
          Object.entries(prevMap)
            .filter(([d]) => Number(d) !== singleDay)
            .map(([, id]) => id)
        );
        const previousId = prevMap[singleDay] || null;
        const picked = pickSoundWithNoRepeatWindow(
          pool,
          randCfg,
          targetWeekKey,
          randCfg.weekAssignments,
          usedOthersInWeek,
          previousId,
          previousId
        );
        prevMap[singleDay] = picked.id;
        randCfg.weekAssignments = {
          ...randCfg.weekAssignments,
          [targetWeekKey]: prevMap,
        };
      } else {
        const freshMap = drawWeekAssignments(
          randCfg,
          undefined,
          targetWeekKey,
          randCfg.weekAssignments
        );
        randCfg.weekAssignments = {
          ...randCfg.weekAssignments,
          [targetWeekKey]: freshMap,
        };
      }

      randCfg.lastDrawnAt = now.toISOString();
      randCfg.weekAssignments = pruneOldWeekAssignments(
        randCfg.weekAssignments,
        currentWeekKey,
        noRepeatWeeks
      );
      config.bellRandomizer = randCfg;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

      const drawnMap = randCfg.weekAssignments[targetWeekKey] || {};
      const summary = Object.entries(drawnMap)
        .map(([d, sid]) => `${RANDOMIZER_DAY_NAMES[Number(d)] || d}: ${findSoundNameById(sid)}`)
        .join(', ');

      history.unshift({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now.toISOString(),
        timeStr: `${hh}:${mm}:${ss}`,
        bellType: 'bell_draw',
        title:
          singleDay !== null
            ? `Ponowne losowanie na dzień: ${RANDOMIZER_DAY_NAMES[singleDay]} (${targetWeekKey})`
            : `Ręczne losowanie dzwonków (${scope === 'next' ? 'przyszły tydzień' : 'bieżący tydzień'} ${targetWeekKey})`,
        soundName:
          singleDay !== null
            ? findSoundNameById(drawnMap[singleDay])
            : `${Object.keys(drawnMap).length} dni`,
        status: 'simulated',
        details: summary,
      });
      saveHistory();

      res.json({
        success: true,
        scope,
        targetWeekKey,
        bellRandomizer: randCfg,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Błąd losowania dzwonków.' });
    }
  }
);

// 7d. Manual assignment / replacement of a drawn bell for a specific week and day (Protected)
app.post(
  '/api/sounds/randomizer/assign',
  requireAnyPermission(['sounds_manage', 'schedules_edit']),
  (req: Request, res: Response) => {
    try {
      const weekKey =
        typeof req.body?.weekKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.weekKey.trim())
          ? req.body.weekKey.trim()
          : '';
      const dayOfWeek = req.body?.dayOfWeek;
      const soundId =
        typeof req.body?.soundId === 'string' ? req.body.soundId.trim() : '';

      if (!weekKey) {
        return res.status(400).json({ success: false, error: 'Nieprawidłowy klucz tygodnia (YYYY-MM-DD).' });
      }
      if (
        typeof dayOfWeek !== 'number' ||
        !Number.isInteger(dayOfWeek) ||
        dayOfWeek < 0 ||
        dayOfWeek > 6
      ) {
        return res.status(400).json({ success: false, error: 'Nieprawidłowy dzień tygodnia (0-6).' });
      }
      if (!soundId || !soundExistsById(soundId)) {
        return res.status(400).json({ success: false, error: 'Wybrana melodia nie istnieje w bazie kontrolera.' });
      }

      const randCfg = getBellRandomizerConfig();
      const prevMap = { ...(randCfg.weekAssignments[weekKey] || {}) };
      const oldSoundId = prevMap[dayOfWeek];
      prevMap[dayOfWeek] = soundId;

      const now = new Date();
      const currentWeekKey = getWeekMondayDateStr(now);
      const noRepeatWeeks = getNoRepeatWeeks(randCfg);

      randCfg.weekAssignments = pruneOldWeekAssignments(
        {
          ...randCfg.weekAssignments,
          [weekKey]: prevMap,
        },
        currentWeekKey,
        noRepeatWeeks
      );
      config.bellRandomizer = randCfg;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const newSoundName = findSoundNameById(soundId);
      const oldSoundName = oldSoundId ? findSoundNameById(oldSoundId) : 'brak';

      history.unshift({
        id: `assign_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now.toISOString(),
        timeStr: `${hh}:${mm}:${ss}`,
        bellType: 'bell_draw',
        title: `Ręczna podmiana dzwonka: ${RANDOMIZER_DAY_NAMES[dayOfWeek] || dayOfWeek} (${weekKey})`,
        soundName: newSoundName,
        status: 'simulated',
        details: `${oldSoundName} → ${newSoundName}`,
      });
      saveHistory();

      res.json({
        success: true,
        weekKey,
        dayOfWeek,
        soundId,
        soundName: newSoundName,
        bellRandomizer: randCfg,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Błąd podmiany melodii.' });
    }
  }
);

// 8. History log (Protected)
app.get('/api/history', requireAnyPermission(['logs_view', 'dashboard_view']), (_req: Request, res: Response) => {
  res.json(history);
});

app.post('/api/history/clear', requireAnyPermission(['logs_view']), (_req: Request, res: Response) => {
  history = [];
  saveHistory();
  res.json({ success: true });
});

// 9. Temporary mute toggle (Protected)
app.post('/api/set-mute', requireAnyPermission(['manual_bell']), (req: Request, res: Response) => {
  const { muteUntil } = req.body; // ISO string or null
  config.muteUntil = muteUntil;
  if (muteUntil && radioStatus.isPlaying) {
    stopRadioStream('Wyciszenie systemu');
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ success: true, muteUntil: config.muteUntil });
});

// 9b. Internet Radio Control Endpoints (Protected)
app.post('/api/radio/play', requireAnyPermission(['radio_control']), (req: Request, res: Response) => {
  const { stationId, volume } = req.body;
  const station =
    config.radioStations?.find((s) => s.id === stationId) ||
    config.radioStations?.find((s) => s.id === config.defaultRadioStationId) ||
    config.radioStations?.[0];

  if (!station) {
    return res.status(404).json({ success: false, error: 'Brak skonfigurowanej stacji radiowej' });
  }

  manuallyStoppedBreakKey = null;
  const result = startRadioStream(station, 'manual', typeof volume === 'number' ? volume : config.radioVolume);
  res.json({
    success: result.success,
    tool: result.tool,
    error: result.error,
    radioStatus,
    message: result.success ? `Uruchomiono stację: ${station.name}` : `Błąd: ${result.error}`,
  });
});

app.post('/api/radio/stop', requireAnyPermission(['radio_control']), (_req: Request, res: Response) => {
  if (activeBreakRadioKey) {
    manuallyStoppedBreakKey = activeBreakRadioKey;
  }
  stopRadioStream('Zatrzymano ręcznie przez operatora');
  res.json({ success: true, radioStatus });
});

app.post('/api/radio/check-stream', requireAnyPermission(['radio_control']), async (req: Request, res: Response) => {
  const { streamUrl } = req.body;
  if (!streamUrl || typeof streamUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'Brak adresu URL strumienia' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'HarmoniaBell/1.0 (Debian 13)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || 'nieznany';
    const icyName = response.headers.get('icy-name') || response.headers.get('ice-name') || null;
    const icyBr = response.headers.get('icy-br') || null;

    // Close stream body immediately so we don't keep downloading
    try {
      await response.body?.cancel();
    } catch {}

    res.json({
      ok: response.ok,
      status: response.status,
      contentType,
      icyName,
      bitrate: icyBr,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    res.json({
      ok: false,
      error: err.name === 'AbortError' ? 'Przekroczono czas oczekiwania (4.5s)' : err.message,
    });
  }
});

// 10. List Linux audio cards/sinks (Protected)
app.get('/api/audio-devices', requireAnyPermission(['volume_edit', 'debian_view', 'manual_bell']), (_req: Request, res: Response) => {
  let devices: { id: string; name: string }[] = [{ id: 'default', name: 'Domyślne wyjście systemowe (Pulse/ALSA default)' }];

  try {
    const aplayOut = execSync('aplay -l 2>/dev/null', { encoding: 'utf-8' });
    const lines = aplayOut.split('\n');
    lines.forEach((line) => {
      const match = line.match(/card (\d+): ([^,]+), device (\d+): ([^\[]+)/);
      if (match) {
        devices.push({
          id: `hw:${match[1]},${match[3]}`,
          name: `ALSA Karta ${match[1]}: ${match[2].trim()} (${match[4].trim()})`,
        });
      }
    });
  } catch {
    // not available on some environments
  }

  res.json({
    current: config.audioDevice,
    engine: config.audioEngine,
    detectedTool: detectedAudioTool,
    devices,
  });
});

// 10a. List detected Linux serial ports for Amplifier Controller (Protected)
app.get(
  '/api/amplifier/ports',
  requireAnyPermission(['volume_edit', 'schedules_edit', 'manual_bell']),
  (_req: Request, res: Response) => {
    const ports = detectSystemSerialPorts();
    res.json({
      ports,
      currentPath: config.amplifierDevicePath || '/dev/tty1',
      scannedAt: new Date().toISOString(),
    });
  }
);

// 10b. Amplifier Power Controller (1 = ON, 0 = OFF, auto = clear manual override) (Protected)
app.post(
  '/api/amplifier/control',
  requireAnyPermission(['volume_edit', 'schedules_edit', 'manual_bell']),
  (req: Request, res: Response) => {
    const { action, devicePath, appendNewline } = req.body || {};

    if (devicePath !== undefined) {
      const validated = validateAmplifierDevicePath(devicePath);
      if (!validated.ok) {
        return res.status(400).json({ success: false, error: validated.error });
      }
    }

    if (action === 'auto') {
      amplifierManualOverrideWindowKey = null;
      amplifierLastAutoWindowKey = null;
      if (config.amplifierControlEnabled) {
        handleAmplifierScheduleTick(new Date());
      }
      return res.json({
        success: true,
        message: 'Przywrócono automatyczny harmonogram pracy wzmacniacza.',
        amplifierStatus: getAmplifierStatus(),
      });
    }

    if (action !== 'on' && action !== 'off') {
      return res.status(400).json({
        success: false,
        error: 'Nieprawidłowa akcja sterownika wzmacniacza (użyj on, off lub auto).',
      });
    }

    const signal: '1' | '0' = action === 'on' ? '1' : '0';
    const currentEval = evaluateAmplifierWindowForNow(new Date());
    amplifierManualOverrideWindowKey = currentEval.windowKey;

    const result = writeAmplifierSignal(
      signal,
      'manual',
      action === 'on' ? 'Ręczne uruchomienie wzmacniacza' : 'Ręczne wyłączenie wzmacniacza',
      typeof devicePath === 'string' ? devicePath : undefined,
      typeof appendNewline === 'boolean' ? appendNewline : undefined
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.message,
        amplifierStatus: getAmplifierStatus(),
      });
    }

    res.json({
      success: true,
      status: result.status,
      message: result.message,
      amplifierStatus: getAmplifierStatus(),
    });
  }
);

// 10c. Real-time Debian CPU & RAM telemetry history (Protected)
app.get('/api/system-metrics', requireAnyPermission(['dashboard_view']), (_req: Request, res: Response) => {
  res.json({
    history: systemMetricsHistory,
    current: latestSystemMetric,
  });
});

// 11. Debian 13 configuration exporter (Protected)
app.get('/api/debian/systemd', requireAnyPermission(['debian_view']), (_req: Request, res: Response) => {
  const systemdService = `[Unit]
Description=HarmoniaBell - System Bezstresowych Dzwonkow Szkolnych
After=network.target sound.target pulseaudio.service
Wants=sound.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/harmonia-bell
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
`;
  res.type('text/plain').send(systemdService);
});

app.get('/api/debian/install-script', requireAnyPermission(['debian_view']), (_req: Request, res: Response) => {
  const bashScript = `#!/usr/bin/env bash
# ==============================================================================
# HarmoniaBell - Skrypt instalacyjny dla Linux Debian 13 (Trixie)
# Automatyczna instalacja Node.js, bibliotek audio i uslugi systemd
# ==============================================================================
set -e

echo "=== [1/5] Aktualizacja repozytoriow Debian 13 i instalacja zaleznosci ==="
apt-get update
apt-get install -y curl wget git alsa-utils mpv pulseaudio libasound2-dev

echo "=== [2/5] Instalacja srodowiska Node.js LTS ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "=== [3/5] Tworzenie katalogu aplikacji /opt/harmonia-bell ==="
mkdir -p /opt/harmonia-bell
cd /opt/harmonia-bell

echo "Instalacja pakietow npm i budowanie aplikacji..."
npm install --no-audit --no-fund
npm run build

echo "=== [4/5] Konfiguracja autostartu systemd ==="
cat << 'EOF' > /etc/systemd/system/harmonia-bell.service
[Unit]
Description=HarmoniaBell - System Bezstresowych Dzwonkow Szkolnych
After=network.target sound.target pulseaudio.service
Wants=sound.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/harmonia-bell
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable harmonia-bell.service
systemctl restart harmonia-bell.service

echo "=== [5/5] Sukces! HarmoniaBell dziala pod adresem: ==="
IP=$(hostname -I | awk '{print $1}')
echo "http://$IP:3000"
echo "Status uslugi: systemctl status harmonia-bell"
`;
  res.type('text/x-shellscript').send(bashScript);
});

// 12. Debian 13 Update Check, Git Repository Config & Automatic Updater (Protected)
let lastDebianUpdateCheck: DebianUpdateCheckResult | null = null;
let debianUpdateJob: DebianUpdateJobStatus = {
  state: 'idle',
  target: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  restartScheduled: false,
};

function runShellAsync(
  command: string,
  timeoutMs: number = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string; errorMessage: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: process.cwd(), timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const timedOut = Boolean((error as any)?.killed && (error as any)?.signal === 'SIGTERM');
        const errorMessage = timedOut
          ? `Przekroczono limit czasu (${Math.round(timeoutMs / 1000)} s).`
          : error?.message || '';
        resolve({
          ok: !error,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          errorMessage,
          timedOut,
        });
      }
    );
  });
}

function runStreamingUpdateCommand(
  file: string,
  args: string[],
  timeoutMs: number = 600000
): Promise<{ ok: boolean; code: number | null; timedOut: boolean; tailOutput: string; errorMessage: string }> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CI: 'true',
      npm_config_progress: 'false',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_omit: '',
    };
    delete childEnv.NODE_ENV;

    const child = spawn(file, args, {
      cwd: process.cwd(),
      shell: false,
      env: childEnv,
    });

    const tailLines: string[] = [];
    let settled = false;
    let timedOut = false;

    const pushLine = (line: string) => {
      const cleaned = line.replace(/\r/g, '').trim();
      if (!cleaned) return;
      const truncated = cleaned.length > 260 ? `${cleaned.slice(0, 260)}...` : cleaned;
      tailLines.push(truncated);
      if (tailLines.length > 25) tailLines.shift();
      appendUpdateLog(truncated);
    };

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      const parts = stdoutBuf.split('\n');
      stdoutBuf = parts.pop() ?? '';
      for (const part of parts) pushLine(part);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
      const parts = stderrBuf.split('\n');
      stderrBuf = parts.pop() ?? '';
      for (const part of parts) pushLine(part);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        timedOut: false,
        tailOutput: tailLines.join('\n'),
        errorMessage: err.message,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuf) pushLine(stdoutBuf);
      if (stderrBuf) pushLine(stderrBuf);
      const ok = !timedOut && code === 0;
      const errorMessage = timedOut
        ? `Przekroczono limit czasu (${Math.round(timeoutMs / 1000)} s) — sprawdź połączenie z internetem lub zasoby RAM/CPU.`
        : code !== 0
        ? `Kod wyjścia: ${code ?? 'nieznany'}`
        : '';
      resolve({
        ok,
        code,
        timedOut,
        tailOutput: tailLines.join('\n'),
        errorMessage,
      });
    });
  });
}

function getFileSha256IfExists(relPath: string): string | null {
  try {
    const absPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

function runCommandFile(
  file: string,
  args: string[],
  timeoutMs: number = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
        });
      }
    );
  });
}
function runGitCommand(
  args: string[],
  timeoutMs: number = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return runCommandFile('git', ['-c', `safe.directory=${process.cwd()}`, ...args], timeoutMs);
}

const DEFAULT_GIT_REPO_URL = 'https://github.com/dniesobski/ZSME-Bells.git';
const DEFAULT_GIT_BRANCH = 'main';

function loadDebianGitConfig(): DebianGitConfig | null {
  try {
    if (!fs.existsSync(GIT_CONFIG_FILE)) {
      return {
        repoUrl: DEFAULT_GIT_REPO_URL,
        branch: DEFAULT_GIT_BRANCH,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const parsed = JSON.parse(fs.readFileSync(GIT_CONFIG_FILE, 'utf-8'));
    if (parsed?.disconnected === true) {
      return null;
    }
    if (typeof parsed?.repoUrl === 'string' && parsed.repoUrl.trim()) {
      return {
        repoUrl: parsed.repoUrl.trim(),
        branch: typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : DEFAULT_GIT_BRANCH,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    }
  } catch {}
  return {
    repoUrl: DEFAULT_GIT_REPO_URL,
    branch: DEFAULT_GIT_BRANCH,
    updatedAt: new Date(0).toISOString(),
  };
}

function saveDebianGitConfig(cfg: DebianGitConfig | null) {
  if (!cfg) {
    fs.writeFileSync(
      GIT_CONFIG_FILE,
      JSON.stringify({ disconnected: true, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    return;
  }
  fs.writeFileSync(GIT_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function isDisallowedGitHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function validateGitRepoInput(
  rawUrl: unknown,
  rawBranch: unknown
): { ok: true; repoUrl: string; branch: string | null } | { ok: false; error: string } {
  if (typeof rawUrl !== 'string') {
    return { ok: false, error: 'Podaj poprawny adres URL repozytorium Git.' };
  }
  let repoUrl = rawUrl.trim();
  if (!repoUrl || repoUrl.length > 500) {
    return { ok: false, error: 'Adres URL repozytorium jest wymagany (maks. 500 znaków).' };
  }
  if (repoUrl.startsWith('-') || /[\s"'`$;|&<>\\]/.test(repoUrl)) {
    return { ok: false, error: 'Adres repozytorium zawiera niedozwolone znaki.' };
  }

  // Allow GitHub shorthand like "dniesobski/ZSME-Bells"
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoUrl) && !repoUrl.includes('..')) {
    const cleanRepo = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;
    repoUrl = `https://github.com/${cleanRepo}`;
  }

  const scpMatch = repoUrl.match(/^git@([a-zA-Z0-9.-]+):([a-zA-Z0-9._\/-]+)$/);
  if (scpMatch) {
    const [, host, repoPath] = scpMatch;
    if (isDisallowedGitHost(host) || repoPath.includes('..') || repoPath.startsWith('/')) {
      return { ok: false, error: 'Podany host lub ścieżka SSH repozytorium jest niedozwolona.' };
    }
  } else {
    let parsed: URL;
    try {
      parsed = new URL(repoUrl);
    } catch {
      return {
        ok: false,
        error: 'Nieprawidłowy format URL. Użyj adresu HTTPS (np. https://github.com/dniesobski/ZSME-Bells.git) lub ścieżki użytkownik/repozytorium.',
      };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'ssh:') {
      return { ok: false, error: 'Obsługiwane są wyłącznie protokoły HTTPS, HTTP oraz SSH.' };
    }
    if (isDisallowedGitHost(parsed.hostname)) {
      return {
        ok: false,
        error: 'Adresy lokalne i prywatne (localhost, 127.0.0.1, sieci wewnętrzne) są zablokowane ze względów bezpieczeństwa.',
      };
    }
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname.includes('..')) {
      return { ok: false, error: 'Adres URL musi wskazywać konkretne repozytorium (np. /dniesobski/ZSME-Bells.git).' };
    }
  }

  let branch: string | null = null;
  if (typeof rawBranch === 'string' && rawBranch.trim().length > 0) {
    const trimmedBranch = rawBranch.trim();
    if (
      !/^[a-zA-Z0-9._\/-]{1,100}$/.test(trimmedBranch) ||
      trimmedBranch.includes('..') ||
      trimmedBranch.startsWith('-') ||
      trimmedBranch.startsWith('/') ||
      trimmedBranch.endsWith('/') ||
      trimmedBranch.endsWith('.lock')
    ) {
      return { ok: false, error: 'Nieprawidłowa nazwa gałęzi Git.' };
    }
    branch = trimmedBranch;
  }

  return { ok: true, repoUrl, branch };
}

function ensureDataExcludedFromGit() {
  try {
    const infoDir = path.resolve(process.cwd(), '.git', 'info');
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }
    const excludeFile = path.resolve(infoDir, 'exclude');
    const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf-8') : '';
    const lines = existing.split('\n').map((l) => l.trim());
    if (!lines.includes('data/') && !lines.includes('/data/')) {
      const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(excludeFile, `${prefix}data/\n`, 'utf-8');
    }
  } catch {}
}

function getDebianOsName(): string {
  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const match = content.match(/^PRETTY_NAME="?(.*?)"?$/m);
      if (match && match[1]) return match[1];
    }
  } catch {}
  return `${process.platform} (${process.arch})`;
}

function getAppVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version && pkg.version !== '0.0.0') return pkg.version;
    }
  } catch {}
  return '1.0.0 (Debian 13)';
}

async function hasAptPrivilege(): Promise<{ available: boolean; isRoot: boolean }> {
  const aptCheck = await runCommandFile('which', ['apt-get'], 3000);
  if (!aptCheck.ok) return { available: false, isRoot: false };
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return { available: true, isRoot };
}

async function inspectGitUpdateStatus(savedConfig: DebianGitConfig | null): Promise<DebianUpdateCheckResult['git']> {
  const gitBin = await runCommandFile('git', ['--version'], 3000);
  if (!gitBin.ok) {
    return {
      available: false,
      hasRemote: false,
      repoUrl: savedConfig?.repoUrl || null,
      branch: savedConfig?.branch || null,
      currentCommit: null,
      remoteCommit: null,
      commitsBehind: 0,
      latestMessage: null,
      updateAvailable: false,
      note: 'Narzędzie Git nie jest zainstalowane w systemie Debian.',
    };
  }

  let gitInfo: DebianUpdateCheckResult['git'] = {
    available: false,
    hasRemote: false,
    repoUrl: savedConfig?.repoUrl || null,
    branch: savedConfig?.branch || null,
    currentCommit: null,
    remoteCommit: null,
    commitsBehind: 0,
    latestMessage: null,
    updateAvailable: false,
    note: savedConfig
      ? `Skonfigurowano link repozytorium (${savedConfig.repoUrl}), ale katalog nie jest jeszcze zainicjowany.`
      : 'Brak skonfigurowanego repozytorium Git. Wklej link do repozytorium powyżej, aby włączyć aktualizacje aplikacji.',
  };

  const gitInside = await runGitCommand(['rev-parse', '--is-inside-work-tree'], 4000);
  if (!gitInside.ok || gitInside.stdout !== 'true') {
    if (savedConfig?.repoUrl) {
      const symrefRes = await runGitCommand(['ls-remote', '--symref', savedConfig.repoUrl, 'HEAD'], 12000);
      if (symrefRes.ok) {
        const symMatch = symrefRes.stdout.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD/m);
        const detectedBranch = symMatch?.[1] || savedConfig.branch || DEFAULT_GIT_BRANCH;
        const headShaMatch = symrefRes.stdout.match(/^([0-9a-f]{7,40})\s+HEAD/m);
        const remoteCommit = headShaMatch ? headShaMatch[1].slice(0, 7) : null;
        return {
          available: true,
          hasRemote: true,
          repoUrl: savedConfig.repoUrl,
          branch: detectedBranch,
          currentCommit: null,
          remoteCommit,
          commitsBehind: 1,
          latestMessage: null,
          updateAvailable: true,
          note: `Połączono ze zdalnym repozytorium (${savedConfig.repoUrl}, gałąź ${detectedBranch}). Gotowe do pobrania i synchronizacji.`,
        };
      }
      return {
        available: true,
        hasRemote: true,
        repoUrl: savedConfig.repoUrl,
        branch: savedConfig.branch,
        currentCommit: null,
        remoteCommit: null,
        commitsBehind: 0,
        latestMessage: null,
        updateAvailable: false,
        note: `Nie udało się pobrać informacji ze zdalnego repozytorium (${savedConfig.repoUrl}): ${symrefRes.stderr || 'brak dostępu lub repozytorium nie istnieje'}`,
      };
    }
    return gitInfo;
  }

  const remoteListRes = await runGitCommand(['remote'], 4000);
  const remotes = remoteListRes.ok
    ? remoteListRes.stdout.split('\n').map((r) => r.trim()).filter(Boolean)
    : [];
  const remoteName = remotes.includes('origin') ? 'origin' : remotes[0] || null;
  const hasRemote = Boolean(remoteName);

  let repoUrl: string | null = savedConfig?.repoUrl || null;
  if (remoteName) {
    const urlRes = await runGitCommand(['remote', 'get-url', remoteName], 4000);
    if (urlRes.ok && urlRes.stdout) {
      repoUrl = urlRes.stdout;
    }
  }

  const headExistsRes = await runGitCommand(['rev-parse', '--verify', 'HEAD'], 4000);
  const headExists = headExistsRes.ok;

  let currentBranch: string | null = savedConfig?.branch || null;
  let currentCommit: string | null = null;
  if (headExists) {
    const branchRes = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], 4000);
    const headRes = await runGitCommand(['rev-parse', '--short', 'HEAD'], 4000);
    if (branchRes.ok && branchRes.stdout && branchRes.stdout !== 'HEAD') {
      currentBranch = savedConfig?.branch || branchRes.stdout;
    }
    currentCommit = headRes.ok ? headRes.stdout : null;
  } else {
    const symRes = await runGitCommand(['symbolic-ref', '--short', 'HEAD'], 4000);
    if (symRes.ok && symRes.stdout) {
      currentBranch = savedConfig?.branch || symRes.stdout;
    }
  }

  gitInfo = {
    available: true,
    hasRemote,
    repoUrl,
    branch: currentBranch,
    currentCommit,
    remoteCommit: null,
    commitsBehind: 0,
    latestMessage: null,
    updateAvailable: false,
    note: hasRemote
      ? 'Połączono ze zdalnym repozytorium Git.'
      : 'Lokalne repozytorium bez skonfigurowanego zdalnego źródła (wklej link powyżej).',
  };

  if (hasRemote && remoteName) {
    const fetchArgs = currentBranch ? ['fetch', '--quiet', remoteName, currentBranch] : ['fetch', '--quiet'];
    const fetchRes = await runGitCommand(fetchArgs, 15000);
    if (fetchRes.ok) {
      const targetRef = currentBranch ? `${remoteName}/${currentBranch}` : '@{u}';
      const upstreamRes = await runGitCommand(['rev-parse', '--short', targetRef], 4000);
      const msgRes = await runGitCommand(['log', '-1', '--pretty=%s', targetRef], 4000);

      if (headExists && upstreamRes.ok) {
        const behindRes = await runGitCommand(['rev-list', '--count', `HEAD..${targetRef}`], 4000);
        const commitsBehind = behindRes.ok ? parseInt(behindRes.stdout, 10) || 0 : 0;

        gitInfo.remoteCommit = upstreamRes.stdout;
        gitInfo.commitsBehind = commitsBehind;
        gitInfo.latestMessage = msgRes.ok ? msgRes.stdout : null;
        gitInfo.updateAvailable = commitsBehind > 0;
        gitInfo.note =
          commitsBehind > 0
            ? `Dostępna nowa wersja aplikacji (${commitsBehind} nowych zmian).`
            : 'Aplikacja HarmoniaBell jest aktualna względem repozytorium.';
      } else if (!headExists && upstreamRes.ok) {
        gitInfo.remoteCommit = upstreamRes.stdout;
        gitInfo.commitsBehind = 1;
        gitInfo.latestMessage = msgRes.ok ? msgRes.stdout : null;
        gitInfo.updateAvailable = true;
        gitInfo.note = `Repozytorium połączone (gałąź ${currentBranch || 'main'}). Gotowe do pobrania i synchronizacji aplikacji.`;
      } else {
        gitInfo.note = `Połączono ze zdalnym repozytorium, ale nie znaleziono gałęzi śledzącej (${targetRef}).`;
      }
    } else {
      gitInfo.note = `Nie udało się pobrać informacji ze zdalnego repozytorium: ${fetchRes.stderr || 'brak połączenia'}`;
    }
  }

  return gitInfo;
}

function parseAptUpgradableLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^(listing|wypisywanie|wyświetlanie|warning|uwaga)\b/i.test(l)) return false;
      // Real `apt list --upgradable` entries follow: "<pkg>/<suite> <version> <arch> [upgradable from: ...]"
      return /^[a-z0-9][a-z0-9+.:_-]*\/[^\s]+\s+\S+/i.test(l);
    });
}

async function performDebianUpdateCheck(options?: { checkApt?: boolean }): Promise<DebianUpdateCheckResult> {
  const checkApt = options?.checkApt !== false;
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const appVersion = getAppVersion();
  const osName = getDebianOsName();
  const savedGitConfig = loadDebianGitConfig();

  // 1. Check Git / Application repository
  const gitInfo = await inspectGitUpdateStatus(savedGitConfig);

  // 2. Check Debian APT packages
  let aptInfo: DebianUpdateCheckResult['apt'] = lastDebianUpdateCheck?.apt || {
    available: false,
    upgradableCount: 0,
    upgradablePackages: [],
    note: 'Menedżer pakietów APT nie jest dostępny w tym środowisku.',
  };

  if (checkApt) {
    aptInfo = {
      available: false,
      upgradableCount: 0,
      upgradablePackages: [],
      note: 'Menedżer pakietów APT nie jest dostępny w tym środowisku.',
    };
    const aptPriv = await hasAptPrivilege();
    if (aptPriv.available) {
      aptInfo.available = true;
      if (aptPriv.isRoot) {
        await runCommandFile('apt-get', ['update', '-qq'], 25000);
      }
      const listRes = await runCommandFile('apt', ['list', '--upgradable'], 10000);
      if (listRes.ok) {
        const lines = parseAptUpgradableLines(listRes.stdout);
        aptInfo.upgradableCount = lines.length;
        aptInfo.upgradablePackages = lines.slice(0, 15).map((l) => l.split('/')[0]);
        aptInfo.note = !aptPriv.isRoot
          ? `Wykryto ${lines.length} pakietów (odczyt bez uprawnień root — odświeżenie list wymaga uruchomienia usługi jako root).`
          : lines.length > 0
          ? `Dostępne aktualizacje pakietów Debian (${lines.length}).`
          : 'Wszystkie pakiety systemu Debian 13 są aktualne.';
      } else {
        aptInfo.note = !aptPriv.isRoot
          ? 'Brak uprawnień root do odświeżenia list APT.'
          : 'Nie udało się odczytać listy pakietów APT.';
      }
    }
  }

  const result: DebianUpdateCheckResult = {
    checkedAt: new Date().toISOString(),
    appVersion,
    osName,
    nodeVersion: process.version,
    isRoot,
    git: gitInfo,
    apt: aptInfo,
  };

  lastDebianUpdateCheck = result;
  return result;
}

function appendUpdateLog(msg: string) {
  const ts = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  debianUpdateJob.logs.push(`[${ts}] ${msg}`);
  if (debianUpdateJob.logs.length > 150) {
    debianUpdateJob.logs = debianUpdateJob.logs.slice(-150);
  }
}

async function startDebianUpdateJob(target: 'all' | 'app' | 'system') {
  debianUpdateJob = {
    state: 'running',
    target,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    restartScheduled: false,
  };

  appendUpdateLog(`Rozpoczęto automatyczną aktualizację (tryb: ${target})...`);

  try {
    let appFilesChanged = false;

    if (target === 'all' || target === 'app') {
      appendUpdateLog('Sprawdzanie repozytorium aplikacji HarmoniaBell...');
      const savedGitConfig = loadDebianGitConfig();
      const gitInsidePre = await runGitCommand(['rev-parse', '--is-inside-work-tree'], 4000);
      if ((!gitInsidePre.ok || gitInsidePre.stdout !== 'true') && savedGitConfig?.repoUrl) {
        appendUpdateLog(`Inicjowanie lokalnego repozytorium dla źródła: ${savedGitConfig.repoUrl}...`);
        const initRes = await runGitCommand(['init'], 5000);
        if (!initRes.ok) {
          throw new Error(`Błąd inicjalizacji Git: ${initRes.stderr}`);
        }
        await runGitCommand(['symbolic-ref', 'HEAD', `refs/heads/${savedGitConfig.branch || DEFAULT_GIT_BRANCH}`], 4000);
        ensureDataExcludedFromGit();
        await runGitCommand(['remote', 'add', 'origin', savedGitConfig.repoUrl], 4000);
      }

      const check = await performDebianUpdateCheck({ checkApt: false });

      if (check.git.available && check.git.hasRemote) {
        const targetBranch = check.git.branch || 'main';
        const headExistsRes = await runGitCommand(['rev-parse', '--verify', 'HEAD'], 4000);
        const prevPkgHash = getFileSha256IfExists('package.json');
        const prevLockHash = getFileSha256IfExists('package-lock.json');

        if (!headExistsRes.ok) {
          ensureDataExcludedFromGit();
          appendUpdateLog(`Pierwsza synchronizacja aplikacji z gałęzi ${targetBranch}...`);
          const fetchRes = await runGitCommand(['fetch', 'origin', targetBranch], 60000);
          if (!fetchRes.ok) {
            throw new Error(`Błąd pobierania repozytorium: ${fetchRes.stderr || fetchRes.stdout}`);
          }
          const checkoutRes = await runGitCommand(
            ['checkout', '-f', '-B', targetBranch, `origin/${targetBranch}`],
            60000
          );
          appendUpdateLog(checkoutRes.stdout || checkoutRes.stderr || 'Pobrano pliki aplikacji.');
          if (!checkoutRes.ok) {
            throw new Error(`Błąd synchronizacji gałęzi: ${checkoutRes.stderr || checkoutRes.stdout}`);
          }
          appFilesChanged = true;
        } else if (check.git.updateAvailable) {
          appendUpdateLog(`Pobieranie zmian z Git (${check.git.commitsBehind} nowych commitów)...`);
          const pull = await runGitCommand(['pull', '--ff-only', 'origin', targetBranch], 60000);
          appendUpdateLog(pull.stdout || pull.stderr || 'git pull zakończony.');
          if (!pull.ok) {
            throw new Error(`Błąd git pull: ${pull.stderr || pull.stdout}`);
          }
          appFilesChanged = true;
        } else {
          appendUpdateLog('Kod aplikacji jest już w najnowszej wersji.');
        }

        const nextPkgHash = getFileSha256IfExists('package.json');
        const nextLockHash = getFileSha256IfExists('package-lock.json');
        const missingCoreRuntime =
          !fs.existsSync(path.resolve(process.cwd(), 'node_modules', 'tsx')) ||
          !fs.existsSync(path.resolve(process.cwd(), 'node_modules', 'vite'));
        const depsChanged =
          missingCoreRuntime || prevPkgHash !== nextPkgHash || prevLockHash !== nextLockHash;

        if (appFilesChanged && depsChanged) {
          appendUpdateLog('Aktualizacja zależności npm (pełna synchronizacja pakietów)...');
          const npmInst = await runStreamingUpdateCommand(
            'npm',
            ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'],
            600000
          );
          if (!npmInst.ok) {
            const details = npmInst.errorMessage || npmInst.tailOutput || 'nieznany błąd';
            throw new Error(`Błąd npm install: ${details}`);
          }
          appendUpdateLog('Zależności npm zaktualizowane pomyślnie.');
        } else if (appFilesChanged) {
          appendUpdateLog('Pliki zależności (package.json) nie uległy zmianie — pomijam npm install.');
        }

        appendUpdateLog('Przebudowywanie panelu produkcyjnego (npm run build)...');
        const buildRes = await runStreamingUpdateCommand('npm', ['run', 'build'], 300000);
        if (!buildRes.ok) {
          const details = buildRes.errorMessage || buildRes.tailOutput || 'nieznany błąd';
          throw new Error(`Błąd budowania aplikacji: ${details}`);
        }
        appendUpdateLog('Panel WWW zbudowany pomyślnie.');
      } else {
        appendUpdateLog('Brak skonfigurowanego zdalnego repozytorium Git — wklej link repozytorium w sekcji konfiguracji powyżej.');
      }
    }

    if (target === 'all' || target === 'system') {
      const aptPriv = await hasAptPrivilege();
      if (!aptPriv.available) {
        appendUpdateLog('Menedżer pakietów APT nie jest dostępny w tym środowisku.');
      } else if (!aptPriv.isRoot) {
        appendUpdateLog(
          'Pominięto apt-get upgrade: usługa nie działa z uprawnieniami root. Na serwerze Debian uruchom usługę jako root lub wykonaj jako root: apt update && apt upgrade -y'
        );
      } else {
        appendUpdateLog('Odświeżanie repozytoriów Debian 13 (apt-get update)...');
        const aptUpd = await runShellAsync('apt-get update -y 2>&1', 120000);
        if (!aptUpd.ok) {
          throw new Error(`Błąd apt-get update: ${aptUpd.stderr || aptUpd.stdout || aptUpd.errorMessage}`);
        }
        appendUpdateLog('Instalowanie aktualizacji pakietów systemowych (apt-get upgrade -y)...');
        const aptUpg = await runShellAsync(
          'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1',
          600000
        );
        if (!aptUpg.ok) {
          throw new Error(`Błąd apt-get upgrade: ${aptUpg.stderr || aptUpg.stdout || aptUpg.errorMessage}`);
        }
        appendUpdateLog('Pakiety systemu Debian 13 zostały pomyślnie zaktualizowane.');
      }
    }

    await performDebianUpdateCheck({ checkApt: target !== 'app' });

    const runningUnderSystemd = Boolean(process.env.INVOCATION_ID);
    if (appFilesChanged && runningUnderSystemd) {
      const unitName = fs.existsSync('/etc/systemd/system/harmoniabell.service')
        ? 'harmoniabell.service'
        : 'harmonia-bell.service';
      debianUpdateJob.restartScheduled = true;
      appendUpdateLog(`Wykryto usługę systemd — zaplanowano automatyczny restart ${unitName} za 2s...`);
      setTimeout(() => {
        execFile('systemctl', ['restart', unitName], () => {});
      }, 2000);
    }

    debianUpdateJob.state = 'completed';
    debianUpdateJob.finishedAt = new Date().toISOString();
    appendUpdateLog('Proces sprawdzania i aktualizacji został zakończony.');
  } catch (err: any) {
    debianUpdateJob.state = 'error';
    debianUpdateJob.finishedAt = new Date().toISOString();
    debianUpdateJob.error = err.message;
    appendUpdateLog(`BŁĄD: ${err.message}`);
  }
}

app.get('/api/debian/update-status', requireAnyPermission(['debian_view']), (_req: Request, res: Response) => {
  res.json({
    job: debianUpdateJob,
    lastCheck: lastDebianUpdateCheck,
    gitConfig: loadDebianGitConfig(),
  });
});

app.post('/api/debian/git-config', requireAnyPermission(['debian_view']), async (req: Request, res: Response) => {
  try {
    const validated = validateGitRepoInput(req.body?.repoUrl, req.body?.branch);
    if (!validated.ok) {
      return res.status(400).json({ success: false, error: validated.error });
    }

    const gitBin = await runCommandFile('git', ['--version'], 3000);
    if (!gitBin.ok) {
      return res.status(500).json({
        success: false,
        error: 'Narzędzie Git nie jest zainstalowane w systemie Debian (zainstaluj pakiet jako root: apt install -y git).',
      });
    }

    const { repoUrl } = validated;
    let resolvedBranch = validated.branch;

    // Verify remote repository accessibility and detect default branch if omitted
    const symrefRes = await runGitCommand(['ls-remote', '--symref', repoUrl, 'HEAD'], 15000);
    if (!symrefRes.ok) {
      return res.status(400).json({
        success: false,
        error: `Nie udało się połączyć z repozytorium Git: ${symrefRes.stderr || 'sprawdź poprawność adresu URL oraz dostęp do sieci/repozytorium.'}`,
      });
    }

    if (!resolvedBranch) {
      const symMatch = symrefRes.stdout.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD/m);
      resolvedBranch = symMatch?.[1] || 'main';
    } else {
      const branchCheck = await runGitCommand(['ls-remote', '--heads', repoUrl, resolvedBranch], 12000);
      if (!branchCheck.ok || !branchCheck.stdout) {
        return res.status(400).json({
          success: false,
          error: `Nie znaleziono gałęzi "${resolvedBranch}" w podanym repozytorium.`,
        });
      }
    }

    const gitInside = await runGitCommand(['rev-parse', '--is-inside-work-tree'], 4000);
    if (!gitInside.ok || gitInside.stdout !== 'true') {
      const initRes = await runGitCommand(['init'], 5000);
      if (!initRes.ok) {
        return res.status(500).json({
          success: false,
          error: `Nie udało się zainicjalizować repozytorium Git: ${initRes.stderr}`,
        });
      }
      await runGitCommand(['symbolic-ref', 'HEAD', `refs/heads/${resolvedBranch}`], 4000);
    }

    ensureDataExcludedFromGit();

    const remotesRes = await runGitCommand(['remote'], 4000);
    const remotes = remotesRes.ok ? remotesRes.stdout.split('\n').map((r) => r.trim()) : [];
    const remoteCmd = remotes.includes('origin')
      ? ['remote', 'set-url', 'origin', repoUrl]
      : ['remote', 'add', 'origin', repoUrl];
    const setRemoteRes = await runGitCommand(remoteCmd, 4000);
    if (!setRemoteRes.ok) {
      return res.status(500).json({
        success: false,
        error: `Nie udało się zapisać zdalnego źródła origin: ${setRemoteRes.stderr}`,
      });
    }

    await runGitCommand(['fetch', '--depth=1', 'origin', resolvedBranch], 20000);

    const newConfig: DebianGitConfig = {
      repoUrl,
      branch: resolvedBranch,
      updatedAt: new Date().toISOString(),
    };
    saveDebianGitConfig(newConfig);

    const checkResult = await performDebianUpdateCheck({ checkApt: false });

    res.json({
      success: true,
      gitConfig: newConfig,
      result: checkResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Błąd konfiguracji repozytorium Git.' });
  }
});

app.delete('/api/debian/git-config', requireAnyPermission(['debian_view']), async (_req: Request, res: Response) => {
  try {
    saveDebianGitConfig(null);
    const gitInside = await runGitCommand(['rev-parse', '--is-inside-work-tree'], 4000);
    if (gitInside.ok && gitInside.stdout === 'true') {
      const remotesRes = await runGitCommand(['remote'], 4000);
      const remotes = remotesRes.ok ? remotesRes.stdout.split('\n').map((r) => r.trim()) : [];
      if (remotes.includes('origin')) {
        await runGitCommand(['remote', 'remove', 'origin'], 4000);
      }
    }
    const checkResult = await performDebianUpdateCheck({ checkApt: false });
    res.json({
      success: true,
      gitConfig: null,
      result: checkResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Nie udało się odłączyć repozytorium.' });
  }
});

app.post('/api/debian/check-update', requireAnyPermission(['debian_view']), async (_req: Request, res: Response) => {
  try {
    const result = await performDebianUpdateCheck({ checkApt: true });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/debian/run-update', requireAnyPermission(['debian_view']), (req: Request, res: Response) => {
  if (debianUpdateJob.state === 'running') {
    return res.status(409).json({
      success: false,
      error: 'Aktualizacja jest już w trakcie wykonywania.',
      job: debianUpdateJob,
    });
  }

  const rawTarget = req.body?.target;
  const target: 'all' | 'app' | 'system' =
    rawTarget === 'app' || rawTarget === 'system' ? rawTarget : 'all';

  // Run asynchronously so client can poll live logs immediately
  void startDebianUpdateJob(target);

  res.json({
    success: true,
    job: debianUpdateJob,
  });
});

/* ===================== FRONTEND SERVING & DEV MODE ===================== */
async function startServer() {
  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const useProdDist = isProduction && fs.existsSync(distIndex);

  if (!useProdDist) {
    if (isProduction) {
      console.warn('[HarmoniaBell] Brak zbudowanego pliku dist/index.html — uruchamiam tymczasowo tryb Vite. Wykonaj: npm run build');
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(distIndex);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HarmoniaBell] Serwer WWW i dzwonków aktywny na http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Błąd startu serwera:', err);
});
