export type BellType =
  | 'lesson_start'
  | 'lesson_end'
  | 'warning'
  | 'manual'
  | 'emergency'
  | 'radio_start'
  | 'radio_stop'
  | 'amplifier_on'
  | 'amplifier_off';

export interface RadioStation {
  id: string;
  name: string;
  streamUrl: string;
  genre: string;
  description?: string;
}

export interface BellItem {
  id: string;
  lessonNumber: number;
  name: string; // np. "Lekcja 1"
  startTime: string; // "08:00"
  endTime: string; // "08:45"
  warningMinutesBefore: number; // np. 1 (dzwonek przywoławczy 1 min przed końcem przerwy)
  startSoundId: string;
  endSoundId: string;
  warningSoundId?: string;
  enabled: boolean;
  playRadioOnBreak?: boolean; // czy włączać radio na przerwie po tej lekcji
  radioStationId?: string; // opcjonalna stacja dla tej konkretnej przerwy
}

export interface ScheduleProfile {
  id: string;
  name: string; // "Standardowy (45 min)", "Skrócone lekcje (30 min)", "Egzaminacyjny"
  description: string;
  isDefault?: boolean;
  lessonDurationMinutes: number;
  items: BellItem[];
}

export interface WeekDayScheduleMapping {
  // 1 = Poniedziałek, 2 = Wtorek, ..., 5 = Piątek, 6 = Sobota, 0 = Niedziela
  [dayOfWeek: number]: string; // profileId or '__silent__'
}

export interface SoundTrack {
  id: string;
  name: string;
  category: 'preset' | 'custom';
  description: string;
  musicalKey: string;
  durationSeconds: number;
  tags: string[];
  filename?: string;
  isCustom?: boolean;
  fileUrl?: string;
  audioData?: string; // base64 if custom
}

export interface SchoolHoliday {
  id: string;
  name: string; // "Ferie zimowe", "Święto Niepodległości"
  startDate: string; // "2026-11-11"
  endDate: string; // "2026-11-11"
  type: 'holiday' | 'special_schedule' | 'silent_day';
  overrideProfileId?: string;
}

export interface VolumeRule {
  id: string;
  name: string;
  timeFrom: string; // "07:30"
  timeTo: string; // "09:00"
  volumePercent: number; // 60
}

export interface BellHistoryEntry {
  id: string;
  timestamp: string; // ISO
  timeStr: string; // "08:00:00"
  bellType: BellType;
  title: string;
  soundName: string;
  status: 'played_linux' | 'simulated' | 'error';
  details?: string;
}

export interface AppConfig {
  schoolName: string;
  schoolSubtitle: string;
  activeProfileId: string;
  schedules: ScheduleProfile[];
  weekMapping: WeekDayScheduleMapping;
  weekMappingVersion?: number;
  defaultStartSoundId: string;
  defaultEndSoundId: string;
  defaultWarningSoundId: string;
  warningBellEnabled: boolean;
  defaultWarningMinutes: number;
  holidays: SchoolHoliday[];
  masterVolume: number; // 0 - 100
  volumeSchedule: VolumeRule[];
  audioEngine: 'auto' | 'mpv' | 'paplay' | 'aplay' | 'ffplay';
  audioDevice: string; // default or hw:0,0
  muteUntil?: string | null; // ISO string for temporary mute
  soundFadeInMs: number;
  playWarningOnBreakEnd: boolean;
  // Radio internetowe na przerwach
  radioEnabled: boolean;
  radioStations: RadioStation[];
  defaultRadioStationId: string;
  radioVolume: number; // 0 - 100
  radioStartDelaySeconds: number; // opóźnienie po dzwonku na przerwę
  radioStopBeforeBellSeconds: number; // wyłączenie przed dzwonkiem na lekcję
  // Sterowanie zasilaniem wzmacniacza (np. /dev/tty1: 1 = włącz, 0 = wyłącz)
  amplifierControlEnabled?: boolean;
  amplifierDevicePath?: string;
  amplifierAppendNewline?: boolean;
  amplifierRespectHolidays?: boolean;
  amplifierSchedule?: AmplifierRule[];
}

export interface AmplifierRule {
  id: string;
  name: string;
  enabled: boolean;
  daysOfWeek: number[]; // 1 = Pn .. 6 = Sb, 0 = Nd
  powerOnTime: string; // "07:45" -> wysyła 1
  powerOffTime: string; // "15:30" -> wysyła 0
}

export interface AmplifierStatus {
  enabled: boolean;
  devicePath: string;
  powerState: 'on' | 'off' | 'unknown';
  mode: 'auto' | 'manual';
  lastSignal: '1' | '0' | null;
  lastUpdatedAt: string | null;
  lastResult: string | null;
  hardwareAvailable: boolean;
}

export interface RadioPlaybackStatus {
  isPlaying: boolean;
  stationId: string | null;
  stationName: string | null;
  streamUrl: string | null;
  mode: 'auto_break' | 'manual' | 'none';
  startedAt?: string | null;
  tool?: string;
}

export interface SystemMetricsPoint {
  timestamp: string;
  timeLabel: string;
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  loadAvg1m: number;
  cpuCores: number;
}

export interface SystemStatus {
  serverTime: string; // ISO
  currentTimeStr: string; // "09:42:15"
  currentDayOfWeek: number; // 1-7
  currentDateStr: string; // "2026-11-03"
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isMuted: boolean;
  activeProfileName: string;
  activeProfileId: string;
  currentPeriod: {
    type: 'lesson' | 'break' | 'before_school' | 'after_school';
    label: string; // "Lekcja 2", "Przerwa obiadowa"
    timeRange: string; // "08:55 - 09:40"
    remainingSeconds: number;
    totalSeconds: number;
    progressPercent: number;
  };
  nextBell: {
    timeStr: string;
    type: BellType;
    label: string;
    secondsRemaining: number;
    soundName: string;
  } | null;
  radioStatus: RadioPlaybackStatus;
  amplifierStatus?: AmplifierStatus;
  telemetry?: SystemMetricsPoint;
  detectedAudioTool: string;
  platform: string;
  uptimeSeconds: number;
}

export type PermissionKey =
  | 'dashboard_view'
  | 'manual_bell'
  | 'schedules_edit'
  | 'radio_control'
  | 'sounds_manage'
  | 'calendar_edit'
  | 'volume_edit'
  | 'logs_view'
  | 'debian_view'
  | 'users_manage';

export interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  isSystem?: boolean;
  permissions: PermissionKey[];
}

export interface UserAccountPublic {
  id: string;
  username: string;
  displayName: string;
  groupId: string;
  groupName?: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  groupId: string | null;
  groupName: string | null;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
}

export interface TvPublicData {
  schoolName: string;
  schoolSubtitle: string;
  activeProfile: ScheduleProfile;
  radioEnabled: boolean;
  radioStations: Pick<RadioStation, 'id' | 'name' | 'genre'>[];
  defaultRadioStationId: string;
}

export interface DebianGitConfig {
  repoUrl: string;
  branch: string;
  updatedAt: string;
}

export interface DebianUpdateCheckResult {
  checkedAt: string;
  appVersion: string;
  osName: string;
  nodeVersion: string;
  isRoot: boolean;
  git: {
    available: boolean;
    hasRemote: boolean;
    repoUrl: string | null;
    branch: string | null;
    currentCommit: string | null;
    remoteCommit: string | null;
    commitsBehind: number;
    latestMessage: string | null;
    updateAvailable: boolean;
    note: string;
  };
  apt: {
    available: boolean;
    upgradableCount: number;
    upgradablePackages: string[];
    note: string;
  };
}

export interface DebianUpdateJobStatus {
  state: 'idle' | 'running' | 'completed' | 'error';
  target: 'all' | 'app' | 'system' | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  restartScheduled: boolean;
  error?: string;
}
