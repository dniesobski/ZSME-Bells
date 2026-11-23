import React from 'react';
import { Volume2, VolumeX, Bell, Radio, LogOut } from 'lucide-react';
import { AuthStatus, PermissionKey, SystemStatus } from '../types/bell';
import { hasPermission } from '../utils/permissions';

interface TopBarProps {
  status: SystemStatus | null;
  auth: AuthStatus;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenManualBell: () => void;
  onToggleMute: () => void;
  onLogout: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  status,
  auth,
  activeTab,
  onTabChange,
  onOpenManualBell,
  onToggleMute,
  onLogout,
}) => {
  const canManageUsers = hasPermission(auth, 'users_manage');
  const canManualBell = hasPermission(auth, 'manual_bell');

  const allNavItems: { id: string; label: string; requiredPerm?: PermissionKey }[] = [
    { id: 'dashboard', label: 'Pulpit', requiredPerm: 'dashboard_view' },
    { id: 'schedules', label: 'Harmonogram', requiredPerm: 'schedules_edit' },
    { id: 'radio', label: 'Radio', requiredPerm: 'radio_control' },
    { id: 'sounds', label: 'Melodie', requiredPerm: 'sounds_manage' },
    { id: 'calendar', label: 'Kalendarz', requiredPerm: 'calendar_edit' },
    { id: 'volume', label: 'Ustawienia', requiredPerm: 'volume_edit' },
    { id: 'tv', label: 'Ekran TV' },
    { id: 'debian', label: 'Debian 13', requiredPerm: 'debian_view' },
    { id: 'logs', label: 'Dziennik', requiredPerm: 'logs_view' },
    { id: 'account', label: canManageUsers ? 'Konta i Grupy' : 'Moje konto' },
  ];

  const navItems = allNavItems.filter(
    (item) => !item.requiredPerm || hasPermission(auth, item.requiredPerm)
  );

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Radio className="w-4 h-4" />
            </div>
            <a
              href="#dashboard"
              onClick={(e) => {
                e.preventDefault();
                if (navItems.length > 0) {
                  onTabChange(navItems[0].id);
                }
              }}
              className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-amber-400 transition-colors"
            >
              HarmoniaBell <span className="font-mono text-xs font-normal text-slate-400 ml-1">Debian 13</span>
            </a>
          </div>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="hidden xl:flex items-center gap-3.5 text-sm font-medium text-slate-300">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary action group */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Live Clock Badge */}
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 font-mono text-xs tabular-nums text-slate-200">
              <span className="text-slate-400 hidden 2xl:inline">CZAS:</span>
              <span className="font-semibold text-amber-300">
                {status?.currentTimeStr || '--:--:--'}
              </span>
            </div>

            {canManualBell && (
              <>
                {/* Mute Toggle */}
                <button
                  onClick={onToggleMute}
                  title={
                    status?.isMuted
                      ? 'Wyciszenie aktywne - kliknij aby przywrócić dzwonki'
                      : 'Wycisz dzwonki na dziś'
                  }
                  className={`p-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    status?.isMuted
                      ? 'bg-rose-950/60 border-rose-800/70 text-rose-300 hover:bg-rose-900/60'
                      : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {status?.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  <span className="hidden md:inline whitespace-nowrap">
                    {status?.isMuted ? 'Wyciszony' : 'Cisza'}
                  </span>
                </button>

                {/* Manual Bell Button */}
                <button
                  onClick={onOpenManualBell}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
                >
                  <Bell className="w-3.5 h-3.5 fill-current" />
                  <span>Dzwonek Ręczny</span>
                </button>
              </>
            )}

            {/* Logout Button */}
            <button
              onClick={onLogout}
              title={`Wyloguj (${auth.username}${auth.groupName ? ` · ${auth.groupName}` : ''})`}
              className="p-2 rounded-lg border bg-slate-800/80 border-slate-700 text-slate-300 hover:text-rose-300 hover:bg-rose-950/50 hover:border-rose-800/70 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile / Tablet secondary tab strip */}
        <div className="xl:hidden flex items-center gap-2 py-2 overflow-x-auto border-t border-slate-800/60 no-scrollbar">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`px-3 py-1 text-xs rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-amber-400/15 text-amber-300 font-semibold border border-amber-400/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
