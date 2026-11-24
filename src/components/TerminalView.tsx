import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Terminal as TerminalIcon,
  Lock,
  Unlock,
  ShieldAlert,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Clock,
  Send,
  AlertTriangle,
  KeyRound,
  FolderOpen,
} from 'lucide-react';
import { TerminalStatusInfo } from '../types/bell';
import { apiFetch } from '../utils/apiClient';

interface TerminalEntry {
  id: string;
  prompt: string;
  command: string;
  output: string;
  done: boolean;
  exitCode: number | null;
  signal: string | null;
  truncated?: boolean;
}

interface TerminalViewProps {
  terminalToken: string | null;
  terminalExpiresAt: number | null;
  onTerminalAuthChange: (token: string | null, expiresAt: number | null) => void;
}

const QUICK_COMMANDS: { label: string; cmd: string }[] = [
  { label: 'Status usługi', cmd: 'systemctl status harmoniabell.service --no-pager' },
  { label: 'Logi (40 linii)', cmd: 'journalctl -u harmoniabell.service -n 40 --no-pager' },
  { label: 'Karty audio', cmd: 'aplay -l' },
  { label: 'Dysk (df -h)', cmd: 'df -h' },
  { label: 'Pamięć (free -h)', cmd: 'free -h' },
  { label: 'Sieć (ip a)', cmd: 'ip -brief a' },
];

export const TerminalView: React.FC<TerminalViewProps> = ({
  terminalToken,
  terminalExpiresAt,
  onTerminalAuthChange,
}) => {
  const [termStatus, setTermStatus] = useState<TerminalStatusInfo | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [rootPassword, setRootPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [commandInput, setCommandInput] = useState('');
  const [stdinInput, setStdinInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number>(-1);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string>('/opt/harmonia-bell');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [tabSuggestions, setTabSuggestions] = useState<{ label: string; kind: 'command' | 'dir' | 'file' | 'service' }[]>([]);
  const [tabTotalMatches, setTabTotalMatches] = useState<number>(0);
  const [tabSpan, setTabSpan] = useState<{ start: number; end: number } | null>(null);
  const [isCompleting, setIsCompleting] = useState<boolean>(false);

  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const cmdInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const headers: Record<string, string> = {};
      if (terminalToken) {
        headers['X-Terminal-Token'] = terminalToken;
      }
      const res = await apiFetch('/api/terminal/status', { headers });
      if (!res.ok) return;
      const data: TerminalStatusInfo = await res.json();
      setTermStatus(data);
      if (data.cwd) setCwd(data.cwd);
      if (!data.unlocked && terminalToken) {
        onTerminalAuthChange(null, null);
      } else if (data.unlocked && data.expiresAt) {
        onTerminalAuthChange(terminalToken, data.expiresAt);
      }
    } catch {
      // ignore transient error
    } finally {
      setIsLoadingStatus(false);
    }
  }, [terminalToken, onTerminalAuthChange]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Live session TTL countdown
  useEffect(() => {
    if (!terminalToken || !terminalExpiresAt) {
      setRemainingSeconds(0);
      return;
    }
    const updateCountdown = () => {
      const rem = Math.max(0, Math.floor((terminalExpiresAt - Date.now()) / 1000));
      setRemainingSeconds(rem);
      if (rem === 0) {
        stopPolling();
        setRunningJobId(null);
        onTerminalAuthChange(null, null);
        setUnlockError('Sesja terminala root wygasła po 15 minutach bezczynności. Podaj hasło ponownie.');
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [terminalToken, terminalExpiresAt, onTerminalAuthChange, stopPolling]);

  // Auto-scroll terminal output
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [entries]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rootPassword) {
      setUnlockError('Podaj hasło użytkownika root.');
      return;
    }
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const res = await apiFetch('/api/terminal/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: rootPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.terminalToken) {
        throw new Error(data?.error || 'Nie udało się odblokować terminala root.');
      }
      setRootPassword('');
      if (data.cwd) setCwd(data.cwd);
      onTerminalAuthChange(data.terminalToken, data.expiresAt || null);
      setTimeout(() => cmdInputRef.current?.focus(), 60);
    } catch (err: any) {
      setUnlockError(err?.message || 'Błąd weryfikacji hasła root.');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleLock = async () => {
    stopPolling();
    setRunningJobId(null);
    try {
      if (terminalToken) {
        await apiFetch('/api/terminal/lock', {
          method: 'POST',
          headers: { 'X-Terminal-Token': terminalToken },
        });
      }
    } catch {}
    onTerminalAuthChange(null, null);
    setUnlockError(null);
  };

  const pollJob = useCallback(
    (jobId: string, entryId: string, initialOffset: number, activeTok: string) => {
      stopPolling();
      let offset = initialOffset;
      let latestTok = activeTok;

      pollTimerRef.current = window.setInterval(async () => {
        try {
          const res = await apiFetch(`/api/terminal/job/${encodeURIComponent(jobId)}?offset=${offset}`, {
            headers: { 'X-Terminal-Token': latestTok },
          });
          if (res.status === 403 || res.status === 401) {
            stopPolling();
            setRunningJobId(null);
            onTerminalAuthChange(null, null);
            setUnlockError('Sesja terminala wygasła lub została zablokowana.');
            return;
          }
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success || !data.job) {
            stopPolling();
            setRunningJobId(null);
            return;
          }
          if (data.terminalToken) {
            latestTok = data.terminalToken;
            onTerminalAuthChange(data.terminalToken, data.expiresAt || null);
          }
          if (data.cwd) setCwd(data.cwd);

          const job = data.job;
          offset = typeof job.nextOffset === 'number' ? job.nextOffset : offset;

          setEntries((prev) =>
            prev.map((ent) =>
              ent.id === entryId
                ? {
                    ...ent,
                    output: ent.output + (job.outputDelta || ''),
                    done: Boolean(job.done),
                    exitCode: job.exitCode ?? null,
                    signal: job.signal ?? null,
                    truncated: Boolean(job.truncated),
                  }
                : ent
            )
          );

          if (job.done) {
            stopPolling();
            setRunningJobId(null);
            setTimeout(() => cmdInputRef.current?.focus(), 40);
          }
        } catch {
          // keep polling briefly if transient hiccup
        }
      }, 200);
    },
    [onTerminalAuthChange, stopPolling]
  );

  const executeCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd || !terminalToken) return;

    if (cmd === 'clear' || cmd === 'cls') {
      setEntries([]);
      setCommandInput('');
      return;
    }

    if (runningJobId) return;

    const hostLabel = termStatus?.hostname || 'debian';
    const userLabel = termStatus?.activeUser || 'root';
    const promptStr = `${userLabel}@${hostLabel}:${cwd}#`;
    const entryId = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    setEntries((prev) => [
      ...prev.slice(-99),
      {
        id: entryId,
        prompt: promptStr,
        command: cmd,
        output: '',
        done: false,
        exitCode: null,
        signal: null,
      },
    ]);
    setCmdHistory((prev) => (prev[0] === cmd ? prev : [cmd, ...prev.slice(0, 49)]));
    setHistoryCursor(-1);
    setTabSuggestions([]);
    setTabSpan(null);
    setCommandInput('');

    try {
      const res = await apiFetch('/api/terminal/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': terminalToken,
        },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data?.locked) {
        onTerminalAuthChange(null, null);
        setUnlockError(data?.error || 'Sesja terminala wygasła.');
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
        return;
      }
      if (!res.ok || !data.success || !data.job) {
        setEntries((prev) =>
          prev.map((ent) =>
            ent.id === entryId
              ? {
                  ...ent,
                  output: data?.error || 'Błąd wykonywania polecenia.',
                  done: true,
                  exitCode: 1,
                }
              : ent
          )
        );
        return;
      }

      const nextToken = data.terminalToken || terminalToken;
      if (data.terminalToken) {
        onTerminalAuthChange(data.terminalToken, data.expiresAt || null);
      }
      if (data.cwd) setCwd(data.cwd);

      const job = data.job;
      setEntries((prev) =>
        prev.map((ent) =>
          ent.id === entryId
            ? {
                ...ent,
                output: job.outputDelta || '',
                done: Boolean(job.done),
                exitCode: job.exitCode ?? null,
                signal: job.signal ?? null,
                truncated: Boolean(job.truncated),
              }
            : ent
        )
      );

      if (!job.done) {
        setRunningJobId(job.id);
        pollJob(job.id, entryId, job.nextOffset || 0, nextToken);
      } else {
        setTimeout(() => cmdInputRef.current?.focus(), 30);
      }
    } catch (err: any) {
      setEntries((prev) =>
        prev.map((ent) =>
          ent.id === entryId
            ? {
                ...ent,
                output: err?.message || 'Błąd komunikacji z serwerem.',
                done: true,
                exitCode: 1,
              }
            : ent
        )
      );
    }
  };

  const handleInterrupt = async (force: boolean = false) => {
    if (!terminalToken || !runningJobId) return;
    try {
      await apiFetch('/api/terminal/interrupt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': terminalToken,
        },
        body: JSON.stringify({ jobId: runningJobId, force }),
      });
    } catch {}
  };

  const handleSendStdin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalToken || !runningJobId) return;
    try {
      await apiFetch('/api/terminal/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': terminalToken,
        },
        body: JSON.stringify({ jobId: runningJobId, input: stdinInput }),
      });
      setStdinInput('');
    } catch {}
  };

  const handleTabComplete = async () => {
    if (!terminalToken || runningJobId || isCompleting) return;
    const inputEl = cmdInputRef.current;
    const cursorPos = inputEl?.selectionStart ?? commandInput.length;
    setIsCompleting(true);
    try {
      const res = await apiFetch('/api/terminal/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': terminalToken,
        },
        body: JSON.stringify({
          line: commandInput,
          cursor: cursorPos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data?.locked) {
        onTerminalAuthChange(null, null);
        setUnlockError(data?.error || 'Sesja terminala wygasła.');
        return;
      }
      if (!res.ok || !data.success) return;

      const start = typeof data.tokenStart === 'number' ? data.tokenStart : cursorPos;
      const end = typeof data.tokenEnd === 'number' ? data.tokenEnd : cursorPos;
      const replacement = typeof data.replacement === 'string' ? data.replacement : '';
      const nextLine = commandInput.slice(0, start) + replacement + commandInput.slice(end);
      const nextCursor = start + replacement.length;

      setCommandInput(nextLine);
      if (data.exact || !Array.isArray(data.suggestions) || data.suggestions.length === 0) {
        setTabSuggestions([]);
        setTabTotalMatches(0);
        setTabSpan(null);
      } else {
        setTabSuggestions(data.suggestions);
        setTabTotalMatches(typeof data.totalMatches === 'number' ? data.totalMatches : data.suggestions.length);
        setTabSpan({ start, end: nextCursor });
      }

      window.requestAnimationFrame(() => {
        if (cmdInputRef.current) {
          cmdInputRef.current.focus();
          cmdInputRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      });
    } catch {
      // ignore completion network error
    } finally {
      setIsCompleting(false);
    }
  };

  const applyTabSuggestion = (item: { label: string; kind: 'command' | 'dir' | 'file' | 'service' }) => {
    if (!tabSpan) return;
    const currentToken = commandInput.slice(tabSpan.start, tabSpan.end);
    const slashIdx = currentToken.lastIndexOf('/');
    const prefixDir = slashIdx >= 0 ? currentToken.slice(0, slashIdx + 1) : '';
    const appendTrailingSpace = item.kind !== 'dir' && commandInput.slice(tabSpan.end, tabSpan.end + 1) !== ' ';
    const inserted = prefixDir + item.label + (appendTrailingSpace ? ' ' : '');
    const nextLine = commandInput.slice(0, tabSpan.start) + inserted + commandInput.slice(tabSpan.end);
    const nextCursor = tabSpan.start + inserted.length;
    setCommandInput(nextLine);
    setTabSuggestions([]);
    setTabSpan(null);
    window.requestAnimationFrame(() => {
      if (cmdInputRef.current) {
        cmdInputRef.current.focus();
        cmdInputRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      void handleTabComplete();
      return;
    }
    if (e.key === 'Escape' && tabSuggestions.length > 0) {
      e.preventDefault();
      setTabSuggestions([]);
      setTabSpan(null);
      return;
    }
    if (e.key === 'c' && e.ctrlKey && runningJobId) {
      e.preventDefault();
      void handleInterrupt(false);
      return;
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
      setTabSuggestions([]);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      setTabSuggestions([]);
      const nextIdx = Math.min(cmdHistory.length - 1, historyCursor + 1);
      setHistoryCursor(nextIdx);
      setCommandInput(cmdHistory[nextIdx] || '');
      return;
    }
    if (e.key === 'ArrowDown') {
      if (historyCursor <= -1) return;
      e.preventDefault();
      setTabSuggestions([]);
      const nextIdx = historyCursor - 1;
      setHistoryCursor(nextIdx);
      setCommandInput(nextIdx >= 0 ? cmdHistory[nextIdx] || '' : '');
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const hostLabel = termStatus?.hostname || 'debian';
  const userLabel = termStatus?.activeUser || 'root';

  // LOCKED VIEW — requires root password from /etc/shadow
  if (!terminalToken) {
    const shadowUnavailable = termStatus && !termStatus.rootHasPassword;

    return (
      <div className="max-w-2xl mx-auto py-4 space-y-5">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-6 shadow-lg space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-slate-700/60 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Terminal Root (Debian 13)</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dostęp chroniony hasłem systemowego użytkownika <code className="text-amber-300 font-mono">root</code> z <code className="text-slate-300 font-mono">/etc/shadow</code>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={fetchStatus}
              disabled={isLoadingStatus}
              className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 cursor-pointer disabled:opacity-50"
              title="Odśwież status systemu"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingStatus ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* System Diagnostics Strip */}
          {termStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/60">
                <div className="text-slate-400 text-[11px]">Host / System</div>
                <div className="font-mono text-slate-100 font-semibold truncate mt-0.5">
                  {termStatus.hostname}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/60">
                <div className="text-slate-400 text-[11px]">Uprawnienia procesu</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    termStatus.isRootProcess ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {termStatus.isRootProcess ? 'root (UID 0)' : `użytkownik ${termStatus.activeUser}`}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/60">
                <div className="text-slate-400 text-[11px]">Weryfikacja /etc/shadow</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    termStatus.rootHasPassword ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {termStatus.rootHasPassword
                    ? 'Aktywna (hasło ustawione)'
                    : termStatus.shadowReason === 'unreadable'
                    ? 'Brak odczytu pliku'
                    : 'Brak hasła root'}
                </div>
              </div>
            </div>
          )}

          {shadowUnavailable && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-700/60 text-xs text-amber-100 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {termStatus?.shadowReason === 'unreadable'
                    ? 'Serwer WWW nie ma uprawnień odczytu /etc/shadow'
                    : 'Konto root w /etc/shadow nie ma ustawionego hasła'}
                </span>
              </div>
              <p className="text-amber-200/90 leading-relaxed">
                {termStatus?.shadowReason === 'unreadable'
                  ? 'Aby weryfikować hasło root z /etc/shadow i wykonywać polecenia jako root, usługa systemd HarmoniaBell musi być uruchomiona jako użytkownik root.'
                  : 'W pliku /etc/shadow konto root jest oznaczone jako zablokowane (* lub !). Aby odblokować logowanie hasłem root przez stronę WWW, ustaw hasło root w konsoli serwera:'}
              </p>
              {termStatus?.shadowReason !== 'unreadable' && (
                <pre className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-emerald-300 select-all">
                  passwd root
                </pre>
              )}
            </div>
          )}

          {unlockError && (
            <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{unlockError}</span>
            </div>
          )}

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Hasło systemowe użytkownika <code className="text-amber-300 font-mono">root</code>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={rootPassword}
                  onChange={(e) => setRootPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={isUnlocking || Boolean(shadowUnavailable)}
                  placeholder="Wpisz hasło root z serwera Debian..."
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-400">
                Sesja odblokowania wygasa automatycznie po 15 minutach bezczynności lub po zamknięciu karty.
              </span>
              <button
                type="submit"
                disabled={isUnlocking || !rootPassword || Boolean(shadowUnavailable)}
                className="px-4 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Unlock className="w-4 h-4" />
                <span>{isUnlocking ? 'Weryfikacja /etc/shadow...' : 'Odblokuj Terminal Root'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // UNLOCKED INTERACTIVE TERMINAL
  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <TerminalIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Terminal Root
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/70 text-emerald-300 font-mono text-[10px] font-bold">
                {userLabel}@{hostLabel}
              </span>
            </div>
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5 truncate">
              <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{cwd}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-300 flex items-center gap-1.5"
            title="Czas do automatycznej blokady sesji terminala"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{formatDuration(remainingSeconds)}</span>
          </div>

          <button
            type="button"
            onClick={() => setEntries([])}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Wyczyść</span>
          </button>

          <button
            type="button"
            onClick={handleLock}
            className="px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 border border-rose-800/80 text-rose-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Zablokuj</span>
          </button>
        </div>
      </div>

      {/* Quick Administrative Shortcuts */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
          Szybkie komendy:
        </span>
        {QUICK_COMMANDS.map((item) => (
          <button
            key={item.cmd}
            type="button"
            disabled={Boolean(runningJobId)}
            onClick={() => executeCommand(item.cmd)}
            title={item.cmd}
            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono transition-colors cursor-pointer disabled:opacity-40"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Console Output Viewport */}
      <div
        ref={terminalBodyRef}
        onClick={() => {
          const selection = window.getSelection()?.toString();
          if (!selection) {
            cmdInputRef.current?.focus();
          }
        }}
        className="bg-slate-950 border border-slate-800 rounded-xl p-4 h-[460px] overflow-y-auto font-mono text-xs sm:text-[13px] leading-relaxed shadow-inner space-y-3"
      >
        {entries.length === 0 ? (
          <div className="text-slate-500 space-y-1">
            <div>HarmoniaBell Debian 13 Root Shell — sesja zweryfikowana przez /etc/shadow.</div>
            <div>Wpisz polecenie poniżej (Tab = autouzupełnianie, strzałki ↑/↓ = historia, Ctrl+L = wyczyść, Ctrl+C = przerwij).</div>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-emerald-400 font-bold shrink-0">{entry.prompt}</span>
                <span className="text-white break-all">{entry.command}</span>
                {!entry.done && (
                  <span className="text-amber-400 text-[11px] animate-pulse ml-1">[wykonywanie...]</span>
                )}
              </div>

              {entry.output && (
                <pre className="text-slate-200 whitespace-pre-wrap break-words pl-0 m-0 font-mono">
                  {entry.output}
                </pre>
              )}

              {entry.done && entry.exitCode !== null && entry.exitCode !== 0 && (
                <div className="text-rose-400 text-[11px]">
                  [zakończono kodem: {entry.exitCode}{entry.signal ? `, sygnał: ${entry.signal}` : ''}]
                </div>
              )}
              {entry.done && entry.exitCode === null && entry.signal && (
                <div className="text-amber-400 text-[11px]">
                  [przerwano sygnałem: {entry.signal}]
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Active Process Interactive Controls (SIGINT / Stdin) */}
      {runningJobId && (
        <form
          onSubmit={handleSendStdin}
          className="bg-amber-950/30 border border-amber-700/60 rounded-xl p-3 flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-semibold text-amber-300 shrink-0">
            Proces aktywny — wyślij dane (stdin):
          </span>
          <input
            type="text"
            value={stdinInput}
            onChange={(e) => setStdinInput(e.target.value)}
            placeholder="Wpisz odpowiedź (np. y) i Enter..."
            className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Wyślij</span>
          </button>
          <button
            type="button"
            onClick={() => handleInterrupt(false)}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Przerwij (Ctrl+C)</span>
          </button>
        </form>
      )}

      {/* Tab Completion Suggestions */}
      {tabSuggestions.length > 0 && (
        <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Podpowiedzi Tab ({tabSuggestions.length}
              {tabTotalMatches > tabSuggestions.length ? ` z ${tabTotalMatches}` : ''}) — kliknij aby wstawić:
            </span>
            <button
              type="button"
              onClick={() => {
                setTabSuggestions([]);
                setTabSpan(null);
              }}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              Zamknij (Esc)
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
            {tabSuggestions.map((s) => (
              <button
                key={`${s.kind}:${s.label}`}
                type="button"
                onClick={() => applyTabSuggestion(s)}
                className={`px-2 py-0.5 rounded border text-xs font-mono cursor-pointer transition-colors ${
                  s.kind === 'dir'
                    ? 'bg-sky-950/60 border-sky-800/70 text-sky-300 hover:bg-sky-900/70'
                    : s.kind === 'service'
                    ? 'bg-emerald-950/60 border-emerald-800/70 text-emerald-300 hover:bg-emerald-900/70'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Command Input Prompt */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void executeCommand(commandInput);
        }}
        className="bg-slate-950 border border-slate-700/90 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 focus-within:border-amber-400 transition-colors"
      >
        <span className="font-mono text-xs sm:text-sm font-bold text-emerald-400 shrink-0 max-w-[45%] truncate">
          {userLabel}@{hostLabel}:{cwd}#
        </span>
        <input
          ref={cmdInputRef}
          type="text"
          value={commandInput}
          onChange={(e) => {
            setCommandInput(e.target.value);
            if (tabSuggestions.length > 0) {
              setTabSuggestions([]);
              setTabSpan(null);
            }
          }}
          onKeyDown={handleInputKeyDown}
          disabled={Boolean(runningJobId)}
          placeholder={
            runningJobId
              ? 'Polecenie w toku... Użyj Ctrl+C lub przycisku Przerwij'
              : 'Wpisz polecenie Linux (Tab uzupełnia, np. systemctl status harmoniabell.service)...'
          }
          className="flex-1 bg-transparent font-mono text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={Boolean(runningJobId) || !commandInput.trim()}
          className="px-3.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Wykonaj</span>
        </button>
      </form>
    </div>
  );
};
