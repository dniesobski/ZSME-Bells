import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Save,
  Check,
  LogOut,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  Tv,
  Users,
  Shield,
  Plus,
  Trash2,
  Edit3,
  Lock,
  Unlock,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AuthStatus,
  PermissionGroup,
  PermissionKey,
  UserAccountPublic,
} from '../types/bell';
import { apiFetch, setStoredAuthToken } from '../utils/apiClient';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_DEFINITIONS,
  hasPermission,
} from '../utils/permissions';

interface AccountViewProps {
  auth: AuthStatus;
  onCredentialsUpdated: (nextAuth: AuthStatus) => void;
  onRefreshAuth: () => Promise<void>;
  onLogout: () => Promise<void>;
}

type AccountSubTab = 'profile' | 'users' | 'groups';

export const AccountView: React.FC<AccountViewProps> = ({
  auth,
  onCredentialsUpdated,
  onRefreshAuth,
  onLogout,
}) => {
  const canManageUsers = hasPermission(auth, 'users_manage');
  const [subTab, setSubTab] = useState<AccountSubTab>('profile');

  // --- Profile / Password State ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(auth.username || 'admin');
  const [newDisplayName, setNewDisplayName] = useState(auth.displayName || auth.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // --- RBAC State (Users & Groups) ---
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [users, setUsers] = useState<UserAccountPublic[]>([]);
  const [rbacLoading, setRbacLoading] = useState(false);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [rbacSuccess, setRbacSuccess] = useState<string | null>(null);

  // Create User Form
  const [newUserLogin, setNewUserLogin] = useState('');
  const [newUserDisplayName, setNewUserDisplayName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserGroupId, setNewUserGroupId] = useState('');
  const [newUserMustChange, setNewUserMustChange] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Inline password reset for user
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  // Create / Edit Group Form
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupPermissions, setGroupPermissions] = useState<PermissionKey[]>([
    'dashboard_view',
  ]);
  const [isSavingGroup, setIsSavingGroup] = useState(false);

  useEffect(() => {
    setNewUsername(auth.username || 'admin');
    setNewDisplayName(auth.displayName || auth.username || '');
  }, [auth.username, auth.displayName]);

  const showRbacSuccess = (msg: string) => {
    setRbacError(null);
    setRbacSuccess(msg);
    setTimeout(() => setRbacSuccess(null), 4000);
  };

  const fetchRbacData = useCallback(async () => {
    if (!canManageUsers) return;
    setRbacLoading(true);
    setRbacError(null);
    try {
      const res = await apiFetch('/api/admin/rbac');
      const data = await res.json();
      if (!res.ok) {
        setRbacError(data.error || 'Błąd pobierania użytkowników i grup');
        return;
      }
      setGroups(data.groups || []);
      setUsers(data.users || []);
      if (!newUserGroupId && data.groups && data.groups.length > 0) {
        const nonAdmin = data.groups.find((g: PermissionGroup) => g.id !== 'grp_admin');
        setNewUserGroupId(nonAdmin ? nonAdmin.id : data.groups[0].id);
      }
    } catch {
      setRbacError('Błąd połączenia z serwerem przy pobieraniu grup i użytkowników.');
    } finally {
      setRbacLoading(false);
    }
  }, [canManageUsers, newUserGroupId]);

  useEffect(() => {
    if (canManageUsers) {
      fetchRbacData();
    }
  }, [canManageUsers, fetchRbacData]);

  // --- Profile Submit ---
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (newUsername.trim().length < 3) {
      setProfileError('Nowy login musi mieć co najmniej 3 znaki.');
      return;
    }

    if (newPassword || auth.mustChangePassword) {
      if (newPassword.length < 4) {
        setProfileError('Nowe hasło musi mieć co najmniej 4 znaki.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setProfileError('Nowe hasło i jego powtórzenie nie są identyczne.');
        return;
      }
    }

    setIsSavingProfile(true);
    try {
      const res = await apiFetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newUsername: newUsername.trim(),
          newDisplayName: newDisplayName.trim() || undefined,
          newPassword: newPassword || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setProfileError(data.error || 'Nie udało się zmienić danych logowania.');
        return;
      }

      if (data.token) {
        setStoredAuthToken(data.token);
      }

      onCredentialsUpdated({
        authenticated: true,
        userId: data.userId ?? auth.userId,
        username: data.username,
        displayName: data.displayName ?? data.username,
        groupId: data.groupId ?? auth.groupId,
        groupName: data.groupName ?? auth.groupName,
        permissions: data.permissions ?? auth.permissions,
        mustChangePassword: Boolean(data.mustChangePassword),
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setProfileSuccess('Login i hasło zostały zaktualizowane!');
      if (canManageUsers) {
        await fetchRbacData();
      }
    } catch {
      setProfileError('Błąd połączenia z serwerem podczas zapisywania zmian.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // --- Users Handlers ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setRbacError(null);
    setIsCreatingUser(true);
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUserLogin.trim(),
          displayName: newUserDisplayName.trim() || newUserLogin.trim(),
          password: newUserPassword,
          groupId: newUserGroupId,
          mustChangePassword: newUserMustChange,
          active: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRbacError(data.error || 'Nie udało się utworzyć użytkownika.');
        return;
      }

      setNewUserLogin('');
      setNewUserDisplayName('');
      setNewUserPassword('');
      setNewUserMustChange(false);
      await fetchRbacData();
      showRbacSuccess(`Utworzono użytkownika „${data.user.username}”.`);
    } catch {
      setRbacError('Błąd połączenia podczas tworzenia użytkownika.');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleUpdateUser = async (
    userId: string,
    payload: { groupId?: string; active?: boolean; password?: string }
  ) => {
    setRbacError(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRbacError(data.error || 'Nie udało się zaktualizować użytkownika.');
        return;
      }
      await fetchRbacData();
      await onRefreshAuth();
      showRbacSuccess('Zaktualizowano uprawnienia / stan użytkownika.');
    } catch {
      setRbacError('Błąd komunikacji z serwerem.');
    }
  };

  const handleResetUserPasswordSubmit = async (userId: string) => {
    if (resetPasswordValue.length < 4) {
      setRbacError('Nowe hasło musi mieć co najmniej 4 znaki.');
      return;
    }
    await handleUpdateUser(userId, { password: resetPasswordValue });
    setResetUserId(null);
    setResetPasswordValue('');
  };

  const handleDeleteUser = async (u: UserAccountPublic) => {
    if (!confirm(`Czy na pewno chcesz usunąć konto użytkownika „${u.username}”?`)) return;
    setRbacError(null);
    try {
      const res = await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRbacError(data.error || 'Nie udało się usunąć użytkownika.');
        return;
      }
      await fetchRbacData();
      showRbacSuccess(`Usunięto konto „${u.username}”.`);
    } catch {
      setRbacError('Błąd komunikacji z serwerem.');
    }
  };

  // --- Groups Handlers ---
  const resetGroupForm = () => {
    setEditingGroupId(null);
    setGroupName('');
    setGroupDescription('');
    setGroupPermissions(['dashboard_view']);
  };

  const startEditGroup = (group: PermissionGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupDescription(group.description);
    setGroupPermissions([...group.permissions]);
    setRbacError(null);
  };

  const toggleGroupPermission = (perm: PermissionKey) => {
    if (editingGroupId === 'grp_admin' && perm === 'users_manage') {
      return; // Built-in Administrators group always keeps users_manage
    }
    setGroupPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setRbacError(null);
    setIsSavingGroup(true);
    try {
      const url = editingGroupId
        ? `/api/admin/groups/${editingGroupId}`
        : '/api/admin/groups';
      const method = editingGroupId ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim(),
          permissions: groupPermissions,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setRbacError(data.error || 'Nie udało się zapisać grupy uprawnień.');
        return;
      }

      const wasEditing = Boolean(editingGroupId);
      resetGroupForm();
      await fetchRbacData();
      await onRefreshAuth();
      showRbacSuccess(
        wasEditing
          ? `Zaktualizowano uprawnienia grupy „${data.group.name}”.`
          : `Utworzono nową grupę „${data.group.name}”.`
      );
    } catch {
      setRbacError('Błąd połączenia podczas zapisywania grupy.');
    } finally {
      setIsSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (group: PermissionGroup) => {
    if (!confirm(`Czy na pewno chcesz usunąć grupę „${group.name}”?`)) return;
    setRbacError(null);
    try {
      const res = await apiFetch(`/api/admin/groups/${group.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRbacError(data.error || 'Nie udało się usunąć grupy.');
        return;
      }
      if (editingGroupId === group.id) {
        resetGroupForm();
      }
      await fetchRbacData();
      showRbacSuccess(`Usunięto grupę „${group.name}”.`);
    } catch {
      setRbacError('Błąd komunikacji z serwerem.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-400" />
            {canManageUsers
              ? 'Konta Użytkowników, Grupy Uprawnień i Zabezpieczenia'
              : 'Moje Konto i Zabezpieczenia Dostępu'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Zalogowano jako <span className="text-slate-200 font-semibold">{auth.displayName || auth.username}</span>{' '}
            (<code className="font-mono text-amber-300">{auth.username}</code>) · Grupa:{' '}
            <span className="text-emerald-300 font-medium">{auth.groupName || 'Domyślna'}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="px-4 py-2 text-xs font-semibold text-rose-200 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Wyloguj się</span>
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      {canManageUsers && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setSubTab('profile')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'profile'
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Moje konto i hasło</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('users')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'users'
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Użytkownicy ({users.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('groups')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              subTab === 'groups'
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Grupy uprawnień ({groups.length})</span>
          </button>
        </div>
      )}

      {/* Global RBAC Feedback Alerts */}
      {subTab !== 'profile' && rbacError && (
        <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{rbacError}</span>
        </div>
      )}

      {subTab !== 'profile' && rbacSuccess && (
        <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{rbacSuccess}</span>
        </div>
      )}

      {/* ==================== TAB 1: MOJE KONTO ==================== */}
      {subTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Zmiana Loginu i Hasła
              </h3>
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPasswords ? 'Ukryj znaki' : 'Pokaż znaki'}</span>
              </button>
            </div>

            {profileError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{profileError}</span>
              </div>
            )}

            {profileSuccess && (
              <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{profileSuccess}</span>
              </div>
            )}

            <form onSubmit={handleProfileSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Obecne hasło *</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Wpisz aktualne hasło"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Login *</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="np. admin lub radiowezel"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Nazwa wyświetlana
                  </label>
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="np. Jan Kowalski"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Nowe hasło {auth.mustChangePassword ? '*' : '(opcjonalnie)'}
                  </label>
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required={auth.mustChangePassword}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 4 znaki"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Powtórz nowe hasło</label>
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required={auth.mustChangePassword || newPassword.length > 0}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Powtórz nowe hasło"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingProfile ? 'Zapisywanie...' : 'Zapisz zmiany konta'}</span>
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-3 text-xs">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Twoja Grupa i Uprawnienia
                </h3>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between py-1 border-b border-slate-700/40">
                  <span className="text-slate-400">Użytkownik</span>
                  <span className="font-mono font-bold text-white">{auth.username}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-slate-700/40">
                  <span className="text-slate-400">Przypisana grupa</span>
                  <span className="text-emerald-300 font-semibold">{auth.groupName}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-slate-700/40">
                  <span className="text-slate-400">Stan hasła</span>
                  {auth.mustChangePassword ? (
                    <span className="text-amber-300 font-semibold">Wymagana zmiana hasła</span>
                  ) : (
                    <span className="text-emerald-400 font-semibold">Własne hasło ustawione</span>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block mb-2">
                  Aktywne uprawnienia ({auth.permissions.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PERMISSION_DEFINITIONS.filter((p) => auth.permissions.includes(p.key)).map(
                    (perm) => (
                      <span
                        key={perm.key}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200"
                      >
                        {perm.label}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-5 shadow-sm space-y-2 text-xs">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Tv className="w-4 h-4 text-amber-400" />
                <span>Publiczny Ekran TV (/tv) bez hasła</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                Podstrona <code className="font-mono text-amber-300">/tv</code> pozostaje publicznie dostępna bez logowania, aby wyświetlacze na korytarzach mogły działać automatycznie.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: UŻYTKOWNICY ==================== */}
      {subTab === 'users' && canManageUsers && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Create User Card (4 cols) */}
          <div className="lg:col-span-4 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4 h-fit">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-700/60">
              <UserPlus className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Nowy Użytkownik
              </h3>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Login (min. 3 znaki) *</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={newUserLogin}
                  onChange={(e) => setNewUserLogin(e.target.value)}
                  placeholder="np. radiowezel1 lub sekretariat"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Imię / opis stanowiska</label>
                <input
                  type="text"
                  value={newUserDisplayName}
                  onChange={(e) => setNewUserDisplayName(e.target.value)}
                  placeholder="np. Opiekun Radiowęzła"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Hasło startowe (min. 4 znaki) *</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="Hasło dla użytkownika"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Grupa uprawnień *</label>
                <select
                  value={newUserGroupId}
                  onChange={(e) => setNewUserGroupId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                >
                  {groups.map((grp) => (
                    <option key={grp.id} value={grp.id}>
                      {grp.name} ({grp.permissions.length} upr.)
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={newUserMustChange}
                  onChange={(e) => setNewUserMustChange(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-900 text-amber-400 focus:ring-0"
                />
                <span>Wymuś zmianę hasła przy pierwszym logowaniu</span>
              </label>

              <button
                type="submit"
                disabled={isCreatingUser || groups.length === 0}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{isCreatingUser ? 'Tworzenie...' : 'Dodaj użytkownika'}</span>
              </button>
            </form>
          </div>

          {/* Users Table Card (8 cols) */}
          <div className="lg:col-span-8 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                Lista Użytkowników Systemu
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {rbacLoading ? 'Ładowanie...' : `${users.length} kont`}
              </span>
            </div>

            <div className="space-y-3">
              {users.map((u) => {
                const isSelf = u.id === auth.userId;
                return (
                  <div
                    key={u.id}
                    className={`p-3.5 rounded-lg border text-xs transition-colors ${
                      u.active
                        ? 'bg-slate-900/70 border-slate-700/70'
                        : 'bg-slate-950/60 border-rose-900/50 opacity-80'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-sm">{u.displayName}</span>
                          <code className="font-mono text-amber-300 bg-slate-800 px-1.5 py-0.5 rounded">
                            {u.username}
                          </code>
                          {isSelf && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">
                              Zalogowany
                            </span>
                          )}
                          {!u.active && (
                            <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-semibold">
                              Zablokowany
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Utworzono: {new Date(u.createdAt).toLocaleDateString('pl-PL')}
                          {u.mustChangePassword && (
                            <span className="text-amber-300 ml-2">· Oczekuje na zmianę hasła</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Group reassignment dropdown */}
                        <select
                          aria-label={`Grupa użytkownika ${u.username}`}
                          value={u.groupId}
                          onChange={(e) => handleUpdateUser(u.id, { groupId: e.target.value })}
                          className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-amber-400 cursor-pointer"
                        >
                          {groups.map((grp) => (
                            <option key={grp.id} value={grp.id}>
                              {grp.name}
                            </option>
                          ))}
                        </select>

                        {/* Reset password toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            setResetUserId(resetUserId === u.id ? null : u.id);
                            setResetPasswordValue('');
                          }}
                          title="Ustaw nowe hasło dla tego użytkownika"
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                          <span>Hasło</span>
                        </button>

                        {/* Lock/Unlock user */}
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => handleUpdateUser(u.id, { active: !u.active })}
                            title={u.active ? 'Zablokuj konto' : 'Odblokuj konto'}
                            className={`p-1.5 rounded-lg border cursor-pointer ${
                              u.active
                                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                                : 'bg-emerald-950/60 hover:bg-emerald-900/60 border-emerald-800 text-emerald-300'
                            }`}
                          >
                            {u.active ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Delete user */}
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            title="Usuń użytkownika"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Password Reset Form */}
                    {resetUserId === u.id && (
                      <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          value={resetPasswordValue}
                          onChange={(e) => setResetPasswordValue(e.target.value)}
                          placeholder="Nowe hasło (min. 4 znaki)"
                          className="flex-1 min-w-[180px] px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                        />
                        <button
                          type="button"
                          onClick={() => handleResetUserPasswordSubmit(u.id)}
                          className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold cursor-pointer"
                        >
                          Zapisz hasło
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetUserId(null)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                        >
                          Anuluj
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: GRUPY UPRAWNIEŃ ==================== */}
      {subTab === 'groups' && canManageUsers && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Group Editor Card (6 cols) */}
          <div className="lg:col-span-6 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4 h-fit">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                {editingGroupId ? 'Edycja Grupy Uprawnień' : 'Utwórz Nową Grupę'}
              </h3>
              {editingGroupId && (
                <button
                  type="button"
                  onClick={resetGroupForm}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Anuluj edycję</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveGroup} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nazwa grupy *</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="np. Dyżurni Radiowęzła lub Nauczyciele"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Opis grupy</label>
                <input
                  type="text"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Krótki opis za co odpowiada ta grupa"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">
                    Uprawnienia modułów ({groupPermissions.length}/{ALL_PERMISSION_KEYS.length})
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setGroupPermissions([...ALL_PERMISSION_KEYS])}
                      className="text-amber-300 hover:underline cursor-pointer"
                    >
                      Zaznacz wszystkie
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        setGroupPermissions(
                          editingGroupId === 'grp_admin' ? ['users_manage'] : ['dashboard_view']
                        )
                      }
                      className="text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Minimalne
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {PERMISSION_DEFINITIONS.map((perm) => {
                    const checked = groupPermissions.includes(perm.key);
                    const locked = editingGroupId === 'grp_admin' && perm.key === 'users_manage';
                    return (
                      <label
                        key={perm.key}
                        className={`p-2.5 rounded-lg border transition-colors flex items-start gap-2.5 ${
                          locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                        } ${
                          checked
                            ? 'bg-amber-500/10 border-amber-500/40 text-white'
                            : 'bg-slate-900/70 border-slate-700/70 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => toggleGroupPermission(perm.key)}
                          className="mt-0.5 rounded border-slate-600 bg-slate-950 text-amber-400 focus:ring-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-[11px] leading-tight">
                            {perm.label}
                          </div>
                          <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                            {perm.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="submit"
                  disabled={isSavingGroup}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {isSavingGroup
                      ? 'Zapisywanie...'
                      : editingGroupId
                      ? 'Zapisz zmiany grupy'
                      : 'Utwórz grupę uprawnień'}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {/* Groups List Card (6 cols) */}
          <div className="lg:col-span-6 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Zdefiniowane Grupy
              </h3>
              <span className="text-xs text-slate-400 font-mono">{groups.length} grup</span>
            </div>

            <div className="space-y-3">
              {groups.map((grp) => {
                const memberCount = users.filter((u) => u.groupId === grp.id).length;
                const isEditingThis = editingGroupId === grp.id;

                return (
                  <div
                    key={grp.id}
                    className={`p-4 rounded-lg border text-xs space-y-2.5 transition-colors ${
                      isEditingThis
                        ? 'bg-amber-500/10 border-amber-500/50'
                        : 'bg-slate-900/70 border-slate-700/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-sm">{grp.name}</span>
                          {grp.isSystem && (
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-amber-300 font-semibold">
                              Systemowa
                            </span>
                          )}
                          <span className="text-[11px] font-mono text-slate-400">
                            {memberCount} {memberCount === 1 ? 'użytkownik' : 'użytkowników'}
                          </span>
                        </div>
                        {grp.description && (
                          <p className="text-[11px] text-slate-400 mt-1">{grp.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditGroup(grp)}
                          title="Edytuj nazwę i uprawnienia grupy"
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                          <span>Edytuj</span>
                        </button>

                        {!grp.isSystem && (
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(grp)}
                            title="Usuń grupę"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {grp.permissions.length === 0 ? (
                        <span className="text-[11px] text-rose-300">Brak przypisanych uprawnień</span>
                      ) : (
                        PERMISSION_DEFINITIONS.filter((p) => grp.permissions.includes(p.key)).map(
                          (perm) => (
                            <span
                              key={perm.key}
                              className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/80 text-[11px] text-slate-300"
                            >
                              {perm.label}
                            </span>
                          )
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
