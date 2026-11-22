import { AuthStatus, PermissionKey } from '../types/bell';

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  description: string;
  tabId?: string;
}

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'dashboard_view',
  'manual_bell',
  'schedules_edit',
  'radio_control',
  'sounds_manage',
  'calendar_edit',
  'volume_edit',
  'logs_view',
  'debian_view',
  'users_manage',
];

export const PERMISSION_DEFINITIONS: PermissionMeta[] = [
  {
    key: 'dashboard_view',
    label: 'Pulpit i status na żywo',
    description: 'Dostęp do ekranu głównego, zegara i planu dnia',
    tabId: 'dashboard',
  },
  {
    key: 'manual_bell',
    label: 'Dzwonek ręczny i wyciszenie',
    description: 'Ręczne wyzwalanie dzwonków, test audio oraz wyciszanie (Cisza)',
  },
  {
    key: 'schedules_edit',
    label: 'Harmonogram dzwonków',
    description: 'Edycja lekcji, przerw, profili czasowych i planu tygodnia',
    tabId: 'schedules',
  },
  {
    key: 'radio_control',
    label: 'Radio internetowe',
    description: 'Włączanie/wyłączanie radia i zarządzanie stacjami radiowymi',
    tabId: 'radio',
  },
  {
    key: 'sounds_manage',
    label: 'Melodie i własne audio',
    description: 'Wgrywanie, usuwanie plików audio oraz wybór domyślnych melodii',
    tabId: 'sounds',
  },
  {
    key: 'calendar_edit',
    label: 'Kalendarz dni wolnych',
    description: 'Dodawanie świąt, ferii i wyjątków harmonogramu',
    tabId: 'calendar',
  },
  {
    key: 'volume_edit',
    label: 'Głośność i karta dźwiękowa',
    description: 'Regulacja głośności, harmonogram ciszy i ustawienia ALSA/PulseAudio',
    tabId: 'volume',
  },
  {
    key: 'logs_view',
    label: 'Dziennik zdarzeń',
    description: 'Przeglądanie i czyszczenie historii dzwonków oraz radia',
    tabId: 'logs',
  },
  {
    key: 'debian_view',
    label: 'Konfiguracja Debian 13',
    description: 'Pobieranie skryptów systemd, eksport i import pełnej konfiguracji',
    tabId: 'debian',
  },
  {
    key: 'users_manage',
    label: 'Użytkownicy i grupy uprawnień',
    description: 'Tworzenie grup, konfiguracja uprawnień oraz zarządzanie kontami użytkowników',
  },
];

export function hasPermission(
  auth: Pick<AuthStatus, 'authenticated' | 'permissions'> | null | undefined,
  permission: PermissionKey
): boolean {
  if (!auth || !auth.authenticated) return false;
  return Array.isArray(auth.permissions) && auth.permissions.includes(permission);
}

export function hasAnyPermission(
  auth: Pick<AuthStatus, 'authenticated' | 'permissions'> | null | undefined,
  permissions: PermissionKey[]
): boolean {
  return permissions.some((p) => hasPermission(auth, p));
}

export function getDefaultTabForPermissions(permissions: PermissionKey[]): string {
  if (permissions.includes('dashboard_view')) return 'dashboard';
  if (permissions.includes('schedules_edit')) return 'schedules';
  if (permissions.includes('radio_control')) return 'radio';
  if (permissions.includes('sounds_manage')) return 'sounds';
  if (permissions.includes('calendar_edit')) return 'calendar';
  if (permissions.includes('volume_edit')) return 'volume';
  if (permissions.includes('logs_view')) return 'logs';
  if (permissions.includes('debian_view')) return 'debian';
  return 'account';
}
