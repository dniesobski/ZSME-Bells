import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { ChildProcess, exec, execFile, execSync, spawn } from 'child_process';
import { INITIAL_CONFIG } from './src/data/defaultConfig';
import { PRESET_SOUNDS, getPresetWavBytes } from './src/utils/wavGenerator';
import {
  AmplifierRule,
  AmplifierStatus,
  AppConfig,
  AuthStatus,
  BellHistoryEntry,
  BellItem,
  BellType,
  DebianGitConfig,
  DebianUpdateCheckResult,
  DebianUpdateJobStatus,
  PermissionGroup,
  PermissionKey,
  RadioPlaybackStatus,
  RadioStation,
  SoundTrack,
  SystemMetricsPoint,
  SystemStatus,
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
    // Find file path
    let filePath = path.join(SOUNDS_DIR, `${soundId}.wav`);
    if (!fs.existsSync(filePath)) {
      // Check custom sounds
      const custom = customSounds.find((s) => s.id === soundId);
      if (custom && custom.filename) {
        filePath = path.join(SOUNDS_DIR, custom.filename);
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

        const soundObj = PRESET_SOUNDS.find((p) => p.id === firstItem.startSoundId);
        nextBell = {
          timeStr: firstItem.startTime,
          type: 'lesson_start',
          label: `Rozpoczęcie: ${firstItem.name}`,
          secondsRemaining: remainingSec,
          soundName: soundObj ? soundObj.name : 'Dzwonek',
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

            const endSound = PRESET_SOUNDS.find((p) => p.id === item.endSoundId);
            nextBell = {
              timeStr: item.endTime,
              type: 'lesson_end',
              label: `Koniec: ${item.name}`,
              secondsRemaining: remainingSec,
              soundName: endSound ? endSound.name : 'Dzwonek na przerwę',
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
              let nextBellSound = PRESET_SOUNDS.find((p) => p.id === nextItem.startSoundId)?.name || 'Dzwonek';

              if (config.warningBellEnabled && warnMinutes > 0 && nowMinutes < warnTimeMin) {
                const warnRemSec = Math.max(0, Math.round((warnTimeMin - nowMinutes) * 60));
                const warnSound = PRESET_SOUNDS.find((p) => p.id === (nextItem.warningSoundId || config.defaultWarningSoundId));
                nextBellType = 'warning';
                const warnH = Math.floor(warnTimeMin / 60);
                const warnM = Math.floor(warnTimeMin % 60);
                nextBellTimeStr = `${String(warnH).padStart(2, '0')}:${String(warnM).padStart(2, '0')}`;
                nextBellLabel = `Dzwonek przywoławczy (1 min)`;
                nextBellSeconds = warnRemSec;
                nextBellSound = warnSound ? warnSound.name : 'Sygnał przywoławczy';
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

/* ===================== DEBIAN CPU & RAM TELEMETRY SAMPLER ===================== */
const MAX_TELEMETRY_POINTS = 60;
const systemMetricsHistory: SystemMetricsPoint[] = [];
let latestSystemMetric: SystemMetricsPoint | null = null;
let prevCpuTotals: { idle: number; total: number } | null = null;

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
  };

  latestSystemMetric = point;
  systemMetricsHistory.push(point);
  if (systemMetricsHistory.length > MAX_TELEMETRY_POINTS) {
    systemMetricsHistory.shift();
  }
  return point;
}

// Initial boot sample
sampleSystemTelemetry(new Date());

setInterval(async () => {
  const now = new Date();
  const currentSec = now.getSeconds();

  // Sample real-time CPU & RAM metrics every second
  sampleSystemTelemetry(now);

  // Check amplifier power schedule every second
  handleAmplifierScheduleTick(now);

  // Check break-time radio every second
  handleBreakRadioTick(now);

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
      const soundId = item.startSoundId || config.defaultStartSoundId;
      const sound = PRESET_SOUNDS.find((p) => p.id === soundId);
      console.log(`[HarmoniaBell] DZWONEK START: ${item.name} o ${timeKey}`);
      const res = await playSoundOnLinux(soundId, currentVolume);

      history.unshift({
        id: `bell_${Date.now()}`,
        timestamp: now.toISOString(),
        timeStr: `${timeKey}:00`,
        bellType: 'lesson_start',
        title: `Rozpoczęcie: ${item.name}`,
        soundName: sound ? sound.name : soundId,
        status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
        details: res.error || `Głośność: ${currentVolume}%, Silnik: ${res.tool}`,
      });
      saveHistory();
    }

    // 2. Check end bell
    if (item.endTime === timeKey) {
      const soundId = item.endSoundId || config.defaultEndSoundId;
      const sound = PRESET_SOUNDS.find((p) => p.id === soundId);
      console.log(`[HarmoniaBell] DZWONEK KONIEC: ${item.name} o ${timeKey}`);
      const res = await playSoundOnLinux(soundId, currentVolume);

      history.unshift({
        id: `bell_${Date.now()}`,
        timestamp: now.toISOString(),
        timeStr: `${timeKey}:00`,
        bellType: 'lesson_end',
        title: `Koniec: ${item.name}`,
        soundName: sound ? sound.name : soundId,
        status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
        details: res.error || `Głośność: ${currentVolume}%, Silnik: ${res.tool}`,
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
          const soundId = item.warningSoundId || config.defaultWarningSoundId;
          const sound = PRESET_SOUNDS.find((p) => p.id === soundId);
          console.log(`[HarmoniaBell] DZWONEK PRZYWOŁAWCZY przed: ${item.name} o ${timeKey}`);
          const res = await playSoundOnLinux(soundId, Math.max(50, currentVolume - 10));

          history.unshift({
            id: `bell_${Date.now()}`,
            timestamp: now.toISOString(),
            timeStr: `${timeKey}:00`,
            bellType: 'warning',
            title: `Przywoławczy (1 min): ${item.name}`,
            soundName: sound ? sound.name : soundId,
            status: res.success ? (res.tool === 'simulation_mode' ? 'simulated' : 'played_linux') : 'error',
            details: res.error || `Głośność: ${currentVolume - 10}%, Silnik: ${res.tool}`,
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
  };
  res.json(payload);
});

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

    config = { ...config, ...incoming } as AppConfig;
    // Allow immediate schedule re-evaluation if amplifier config/schedule changed
    amplifierLastAutoWindowKey = null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
      const p = path.join(SOUNDS_DIR, sound.filename);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
    customSounds.splice(idx, 1);
    fs.writeFileSync(CUSTOM_SOUNDS_FILE, JSON.stringify(customSounds, null, 2));
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Nie znaleziono pliku' });
});

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

# Rozpakowanie lub pobranie zrodla
echo "Instalacja pakietow npm..."
npm install --production

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
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: process.cwd(), timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
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

async function hasAptPrivilege(): Promise<{ available: boolean; prefix: string }> {
  const aptCheck = await runCommandFile('which', ['apt-get'], 3000);
  if (!aptCheck.ok) return { available: false, prefix: '' };
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) return { available: true, prefix: '' };
  const sudoCheck = await runCommandFile('sudo', ['-n', 'true'], 3000);
  if (sudoCheck.ok) return { available: true, prefix: 'sudo -n ' };
  return { available: true, prefix: 'NO_ROOT' };
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
      if (aptPriv.prefix !== 'NO_ROOT') {
        await runShellAsync(`${aptPriv.prefix}apt-get update -qq 2>/dev/null`, 25000);
      }
      const listRes = await runCommandFile('apt', ['list', '--upgradable'], 10000);
      if (listRes.ok) {
        const lines = listRes.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('Listing...') && !l.startsWith('Wyświetlanie'));
        aptInfo.upgradableCount = lines.length;
        aptInfo.upgradablePackages = lines.slice(0, 15).map((l) => l.split('/')[0]);
        aptInfo.note =
          aptPriv.prefix === 'NO_ROOT'
            ? `Wykryto ${lines.length} pakietów (odczyt bez uprawnień root — odświeżenie list wymaga sudo/root).`
            : lines.length > 0
            ? `Dostępne aktualizacje pakietów Debian (${lines.length}).`
            : 'Wszystkie pakiety systemu Debian 13 są aktualne.';
      } else {
        aptInfo.note =
          aptPriv.prefix === 'NO_ROOT'
            ? 'Brak uprawnień root/sudo do odświeżenia list APT.'
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

        if (appFilesChanged) {
          appendUpdateLog('Aktualizacja zależności npm...');
          const npmInst = await runShellAsync('npm install --omit=dev 2>&1', 120000);
          if (!npmInst.ok) {
            throw new Error(`Błąd npm install: ${npmInst.stderr || npmInst.stdout}`);
          }
          appendUpdateLog('Zależności npm zaktualizowane.');
        }

        appendUpdateLog('Przebudowywanie panelu produkcyjnego (npm run build)...');
        const buildRes = await runShellAsync('npm run build 2>&1', 120000);
        if (!buildRes.ok) {
          throw new Error(`Błąd budowania aplikacji: ${buildRes.stderr || buildRes.stdout}`);
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
      } else if (aptPriv.prefix === 'NO_ROOT') {
        appendUpdateLog(
          'Pominięto apt-get upgrade: serwer nie działa z uprawnieniami root ani bezhasłowego sudo. Na serwerze Debian uruchom jako root lub wykonaj: sudo apt update && sudo apt upgrade -y'
        );
      } else {
        appendUpdateLog('Odświeżanie repozytoriów Debian 13 (apt-get update)...');
        const aptUpd = await runShellAsync(`${aptPriv.prefix}apt-get update -y 2>&1`, 60000);
        if (!aptUpd.ok) {
          throw new Error(`Błąd apt-get update: ${aptUpd.stderr || aptUpd.stdout}`);
        }
        appendUpdateLog('Instalowanie aktualizacji pakietów systemowych (apt-get upgrade -y)...');
        const aptUpg = await runShellAsync(
          `DEBIAN_FRONTEND=noninteractive ${aptPriv.prefix}apt-get upgrade -y 2>&1`,
          300000
        );
        if (!aptUpg.ok) {
          throw new Error(`Błąd apt-get upgrade: ${aptUpg.stderr || aptUpg.stdout}`);
        }
        appendUpdateLog('Pakiety systemu Debian 13 zostały pomyślnie zaktualizowane.');
      }
    }

    await performDebianUpdateCheck({ checkApt: target !== 'app' });

    const runningUnderSystemd = Boolean(process.env.INVOCATION_ID);
    if (appFilesChanged && runningUnderSystemd) {
      debianUpdateJob.restartScheduled = true;
      appendUpdateLog('Wykryto usługę systemd — zaplanowano automatyczny restart harmonia-bell.service za 2s...');
      setTimeout(() => {
        exec('systemctl restart harmonia-bell.service >/dev/null 2>&1');
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
        error: 'Narzędzie Git nie jest zainstalowane w systemie Debian (zainstaluj pakiet: sudo apt install -y git).',
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
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HarmoniaBell] Serwer WWW i dzwonków aktywny na http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Błąd startu serwera:', err);
});
