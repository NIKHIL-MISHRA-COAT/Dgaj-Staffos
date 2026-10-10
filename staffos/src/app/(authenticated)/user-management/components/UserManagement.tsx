'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Crown, Briefcase, Search, Shield, X, Check, AlertCircle, RefreshCw, KeyRound, Eye, EyeOff, Plane, Edit2, Trash2, ClipboardList, Save, History } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useVisibleFirms } from '@/lib/useVisibleFirms';
import FirmFilterTabs from '@/components/FirmFilterTabs';
import FirmBadge from '@/components/FirmBadge';

interface UserProfile {
  id: string;
  full_name: string;
  employee_id: string | null;
  email: string;
  role: string;
  department: string;
  job_title: string;
  is_active: boolean;
  approval_status: string;
  created_at: string;
  phone: string;
  pin_hash: string;
  travel_approved: boolean;
  firm_id: string | null;
  firms?: { name: string; code: string } | null;
}

interface Firm {
  id: string;
  name: string;
  code: string;
}

interface AccessRequest {
  id: string;
  requester_email: string;
  requester_name: string;
  requested_role: string;
  department: string;
  job_title: string;
  message: string;
  status: string;
  created_at: string;
}

interface AuditLog {
  id: string;
  target_user_id: string;
  performed_by: string;
  action: string;
  old_values: any;
  new_values: any;
  notes: string;
  created_at: string;
  performer?: { full_name: string };
}

const roleConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  director: { label: 'Director', color: 'bg-amber-100 text-amber-700', icon: Crown },
  manager: { label: 'Manager', color: 'bg-purple-100 text-purple-700', icon: Shield },
  employee: { label: 'Employee', color: 'bg-blue-100 text-blue-700', icon: Briefcase },
};

const DEPARTMENTS = ['Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'HR & Operations', 'Finance', 'Customer Support', 'Legal', 'Executive'];
const ROLES = ['employee', 'manager', 'director'];

export default function UserManagement() {
  const { user, pinSession } = useAuth();
  const supabase = createClient();

  const [currentUserRole, setCurrentUserRole] = useState<string>('employee');
  const [currentUserDept, setCurrentUserDept] = useState<string>('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'requests' | 'add' | 'pins' | 'audit'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [firmFilter, setFirmFilter] = useState<'all' | string>('all');
  const { firms: visibleFirms } = useVisibleFirms();
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Add user form
  const [addForm, setAddForm] = useState({ email: '', full_name: '', role: 'employee', department: '', job_title: '', phone: '', firm_id: '' });
  const [addLoading, setAddLoading] = useState(false);
  const [firms, setFirms] = useState<Firm[]>([]);

  // PIN management
  const [pinForm, setPinForm] = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState<Record<string, boolean>>({});
  const [pinLoading, setPinLoading] = useState<string | null>(null);

  // Edit user
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: '', department: '', job_title: '', phone: '', firm_id: '' });
  const [editLoading, setEditLoading] = useState(false);

  // View user details
  const [viewingUser, setViewingUser] = useState<UserProfile | null>(null);

  // Audit log
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditUserId, setAuditUserId] = useState<string>('all');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Helper: get effective user id — reads localStorage directly to avoid async state race
  const getEffectiveUserId = (): string | null => {
    if (user?.id) return user.id;
    if (pinSession?.userId) return pinSession.userId;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.userId || null;
      }
    } catch {}
    return null;
  };

  // Helper: get effective role — reads localStorage directly to avoid async state race
  const getEffectiveRole = (): string | null => {
    if (pinSession?.role) return pinSession.role;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.role || null;
      }
    } catch {}
    return null;
  };

  // Director action helper — routes through API to bypass RLS for PIN-session directors
  const directorAction = async (action: string, targetId: string, updates?: Record<string, any>) => {
    const callerId = getEffectiveUserId();
    if (!callerId) throw new Error('Not authenticated');

    // If we have a real Supabase auth session AND the action is not a write, use direct client
    // For ALL write operations (set_pin, approve, deactivate, etc.) always use API route
    // to ensure RLS is bypassed correctly for PIN-session directors
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token && action === 'read') {
      // Only use direct client for reads with a real auth session
      return null;
    }

    // Always use API route for all write operations — handles both auth and PIN-session directors
    const res = await fetch('/api/director-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId: targetId, callerId, updates }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Action failed');
    return result;
  };

  const logAudit = async (targetUserId: string, action: string, oldValues?: any, newValues?: any, notes?: string) => {
    const performedBy = getEffectiveUserId();
    if (!performedBy) return;
    try {
      await supabase.from('user_audit_log').insert({
        target_user_id: targetUserId,
        performed_by: performedBy,
        action,
        old_values: oldValues || null,
        new_values: newValues || null,
        notes: notes || '',
      });
    } catch {}
  };

  const loadData = useCallback(async (role: string, department: string) => {
    setLoading(true);
    try {
      let usersQuery = supabase.from('user_profiles').select('*, firms!firm_id(name, code)').order('created_at', { ascending: false });
      if (role === 'manager' && department) {
        usersQuery = usersQuery.eq('department', department);
      }
      const [usersRes, requestsRes] = await Promise.all([
        usersQuery,
        supabase.from('user_access_requests').select('*').order('created_at', { ascending: false }),
      ]);
      if (usersRes.error) toast.error(`Failed to load users: ${usersRes.error.message}`);
      else setUsers(usersRes.data || []);
      if (requestsRes.error) toast.error(`Failed to load requests: ${requestsRes.error.message}`);
      else setRequests(requestsRes.data || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const loadAuditLogs = useCallback(async (targetUserId?: string) => {
    setAuditLoading(true);
    try {
      let query = supabase
        .from('user_audit_log')
        .select('*, performer:performed_by(full_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (targetUserId && targetUserId !== 'all') query = query.eq('target_user_id', targetUserId);
      const { data, error } = await query;
      if (error) throw error;
      setAuditLogs((data || []) as AuditLog[]);
    } catch (err: any) {
      toast.error('Failed to load audit logs');
    } finally {
      setAuditLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const init = async () => {
      try {
        // First try: get role from PIN session (localStorage direct read — avoids async state race)
        const sessionRole = getEffectiveRole();
        const sessionUserId = getEffectiveUserId();

        if (sessionRole && sessionUserId) {
          // We have a PIN session — load profile from DB to get department
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role, department')
            .eq('id', sessionUserId)
            .single();

          const role = profile?.role || sessionRole;
          const dept = profile?.department || '';
          setCurrentUserRole(role);
          setCurrentUserDept(dept);
          loadData(role, dept);
          return;
        }

        // Fallback: Supabase auth user
        if (user?.id) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role, department')
            .eq('id', user.id)
            .single();

          if (profile) {
            setCurrentUserRole(profile.role);
            setCurrentUserDept(profile.department || '');
            loadData(profile.role, profile.department || '');
            return;
          }
        }

        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    init();
  }, [user, pinSession]);

  useEffect(() => {
    supabase.from('firms').select('id, name, code').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setFirms(data as Firm[]);
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') loadAuditLogs(auditUserId === 'all' ? undefined : auditUserId);
  }, [activeTab, auditUserId]);

  useEffect(() => {
    const profilesChannel = supabase
      .channel('user_profiles_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, (payload) => {
        if (payload.eventType === 'INSERT') setUsers((prev) => [payload.new as UserProfile, ...prev]);
        else if (payload.eventType === 'UPDATE') setUsers((prev) => prev.map((u) => u.id === (payload.new as UserProfile).id ? payload.new as UserProfile : u));
        else if (payload.eventType === 'DELETE') setUsers((prev) => prev.filter((u) => u.id !== (payload.old as any).id));
      })
      .subscribe();
    const requestsChannel = supabase
      .channel('user_access_requests_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_access_requests' }, (payload) => {
        if (payload.eventType === 'INSERT') setRequests((prev) => [payload.new as AccessRequest, ...prev]);
        else if (payload.eventType === 'UPDATE') setRequests((prev) => prev.map((r) => r.id === (payload.new as AccessRequest).id ? payload.new as AccessRequest : r));
        else if (payload.eventType === 'DELETE') setRequests((prev) => prev.filter((r) => r.id !== (payload.old as any).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(profilesChannel); supabase.removeChannel(requestsChannel); };
  }, [supabase]);

  const handleApproveUser = async (userId: string, userName: string) => {
    setProcessingId(userId);
    try {
      const apiResult = await directorAction('approve_user', userId);
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_profiles').update({ approval_status: 'approved', is_active: true }).eq('id', userId);
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approval_status: 'approved', is_active: true } : u));
      await logAudit(userId, 'approve_user', { approval_status: 'pending' }, { approval_status: 'approved' });
      toast.success(`${userName} approved successfully`);
    } catch (err: any) { toast.error(err?.message || 'Failed to approve user'); }
    finally { setProcessingId(null); }
  };

  const handleDeactivateUser = async (userId: string, userName: string) => {
    const effectiveId = getEffectiveUserId();
    if (userId === effectiveId) { toast.error('You cannot deactivate your own account'); return; }
    setProcessingId(userId);
    try {
      const apiResult = await directorAction('deactivate_user', userId);
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_profiles').update({ is_active: false }).eq('id', userId);
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_active: false } : u));
      await logAudit(userId, 'deactivate_user', { is_active: true }, { is_active: false });
      toast.success(`${userName} deactivated`);
    } catch (err: any) { toast.error(err?.message || 'Failed to deactivate user'); }
    finally { setProcessingId(null); }
  };

  const handleReactivateUser = async (userId: string, userName: string) => {
    setProcessingId(userId);
    try {
      const apiResult = await directorAction('reactivate_user', userId);
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_profiles').update({ is_active: true }).eq('id', userId);
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_active: true } : u));
      await logAudit(userId, 'reactivate_user', { is_active: false }, { is_active: true });
      toast.success(`${userName} reactivated`);
    } catch (err: any) { toast.error(err?.message || 'Failed to reactivate user'); }
    finally { setProcessingId(null); }
  };

  const handleDeleteUser = async () => {
    if (!deleteConfirm) return;
    const { id: userId, name: userName } = deleteConfirm;
    const effectiveId = getEffectiveUserId();
    if (userId === effectiveId) { toast.error('You cannot delete your own account'); return; }
    setDeleteLoading(true);
    try {
      await logAudit(userId, 'delete_user', users.find(u => u.id === userId), null, `User ${userName} deleted`);
      const { error } = await supabase.from('user_profiles').delete().eq('id', userId);
      if (error) throw error;
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setDeleteConfirm(null);
      toast.success(`${userName} has been deleted`);
    } catch (err: any) { toast.error(err?.message || 'Failed to delete user'); }
    finally { setDeleteLoading(false); }
  };

  const openEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({ full_name: u.full_name, role: u.role, department: u.department, job_title: u.job_title, phone: u.phone || '', firm_id: u.firm_id || '' });
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    if (!editForm.full_name.trim() || !editForm.department || !editForm.job_title) {
      toast.error('Please fill in all required fields'); return;
    }
    setEditLoading(true);
    try {
      const oldValues = { full_name: editingUser.full_name, role: editingUser.role, department: editingUser.department, job_title: editingUser.job_title, firm_id: editingUser.firm_id };
      const { error } = await supabase.from('user_profiles').update({
        full_name: editForm.full_name,
        role: editForm.role,
        department: editForm.department,
        job_title: editForm.job_title,
        phone: editForm.phone,
        firm_id: editForm.firm_id || null,
      }).eq('id', editingUser.id);
      if (error) throw error;
      setUsers((prev) => prev.map((u) => u.id === editingUser.id ? { ...u, ...editForm } : u));
      await logAudit(editingUser.id, 'edit_user', oldValues, editForm);
      setEditingUser(null);
      toast.success(`${editForm.full_name} updated successfully`);
    } catch (err: any) { toast.error(err?.message || 'Failed to update user'); }
    finally { setEditLoading(false); }
  };

  const handleChangeRole = async (userId: string, newRole: string, userName: string) => {
    if (currentUserRole !== 'director') { toast.error('Only Directors can change roles'); return; }
    setProcessingId(userId);
    try {
      const oldUser = users.find(u => u.id === userId);
      const apiResult = await directorAction('change_role', userId, { role: newRole });
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
      await logAudit(userId, 'change_role', { role: oldUser?.role }, { role: newRole });
      toast.success(`${userName}'s role updated to ${newRole}`);
    } catch (err: any) { toast.error(err?.message || 'Failed to update role'); }
    finally { setProcessingId(null); }
  };

  const handleApproveRequest = async (reqId: string, reqEmail: string) => {
    setProcessingId(reqId);
    try {
      const effectiveId = getEffectiveUserId();
      const apiResult = await directorAction('approve_request', reqId, { reviewedBy: effectiveId });
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_access_requests').update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reqId);
        if (error) throw error;
      }
      setRequests((prev) => prev.map((r) => r.id === reqId ? { ...r, status: 'approved' } : r));
      toast.success(`Access request from ${reqEmail} approved`);
    } catch (err: any) { toast.error(err?.message || 'Failed to approve request'); }
    finally { setProcessingId(null); }
  };

  const handleRejectRequest = async (reqId: string, reqEmail: string) => {
    setProcessingId(reqId);
    try {
      const effectiveId = getEffectiveUserId();
      const apiResult = await directorAction('reject_request', reqId, { reviewedBy: effectiveId });
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_access_requests').update({ status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', reqId);
        if (error) throw error;
      }
      setRequests((prev) => prev.map((r) => r.id === reqId ? { ...r, status: 'rejected' } : r));
      toast.error(`Request from ${reqEmail} rejected`);
    } catch (err: any) { toast.error(err?.message || 'Failed to reject request'); }
    finally { setProcessingId(null); }
  };

  const handleSetPin = async (userId: string, userName: string) => {
    const pin = pinForm[userId];
    if (!pin || !/^\d{4}$/.test(pin)) { toast.error('PIN must be exactly 4 digits'); return; }
    setPinLoading(userId);
    try {
      const callerId = getEffectiveUserId();
      if (!callerId) throw new Error('Not authenticated — please log in again');

      // Use the dedicated /api/set-pin route (completely new approach)
      // This route uses service role key to bypass RLS entirely
      const res = await fetch('/api/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, callerId, pin }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to set PIN');

      await logAudit(userId, 'set_pin', null, null, 'PIN updated');
      toast.success(`✅ PIN set for ${userName}`);
      setPinForm((prev) => ({ ...prev, [userId]: '' }));
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, pin_hash: pin } : u));
    } catch (err: any) { toast.error(err?.message || 'Failed to set PIN'); }
    finally { setPinLoading(null); }
  };

  const handleAddUser = async () => {
    if (!addForm.email || !addForm.full_name || !addForm.department || !addForm.job_title) {
      toast.error('Please fill in all required fields'); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addForm.email)) {
      toast.error('Please enter a valid email address'); return;
    }
    setAddLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Get effective user ID — read localStorage directly to avoid async state race
      const effectiveUserId = getEffectiveUserId();

      if (!token && !effectiveUserId) {
        toast.error('Not authenticated. Please log in again.');
        setAddLoading(false);
        return;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        // PIN session: pass user ID for server-side verification
        headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`;
        headers['x-user-id'] = effectiveUserId!;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: addForm.email,
          full_name: addForm.full_name,
          role: addForm.role,
          department: addForm.department,
          job_title: addForm.job_title,
          phone: addForm.phone,
          firm_id: addForm.firm_id || null,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || 'Failed to add user');
      } else {
        toast.success(result.message || `Invite sent to ${addForm.email}`);
        setAddForm({ email: '', full_name: '', role: 'employee', department: '', job_title: '', phone: '', firm_id: '' });
        setActiveTab('users');
        loadData(currentUserRole, currentUserDept);
      }
    } catch (err: any) { toast.error(err?.message || 'Failed to add user'); }
    finally { setAddLoading(false); }
  };

  const handleToggleTravelApproval = async (userId: string, userName: string, currentValue: boolean) => {
    if (currentUserRole !== 'director') { toast.error('Only Directors can manage travel approvals'); return; }
    setProcessingId(userId);
    try {
      const apiResult = await directorAction('toggle_travel', userId, { travel_approved: !currentValue });
      if (apiResult === null) {
        // Direct Supabase call for auth-session users
        const { error } = await supabase.from('user_profiles').update({ travel_approved: !currentValue }).eq('id', userId);
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, travel_approved: !currentValue } : u));
      await logAudit(userId, 'toggle_travel', { travel_approved: currentValue }, { travel_approved: !currentValue });
      toast.success(!currentValue ? `✈️ Travel approved for ${userName}` : `Travel approval removed for ${userName}`);
    } catch (err: any) { toast.error(err?.message || 'Failed to update travel approval'); }
    finally { setProcessingId(null); }
  };

  const filteredUsers = users.filter((u) => {
    const matchSearch = !searchQuery || u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchFirm = firmFilter === 'all' || u.firm_id === firmFilter;
    return matchSearch && matchRole && matchFirm;
  });

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDirector = currentUserRole === 'director';
  const isManager = currentUserRole === 'manager';

  if (!isDirector && !isManager) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-center">
          <Shield size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-600">Access Restricted</p>
          <p className="text-sm text-slate-400 mt-1">User management is available to Directors and Managers only</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users size={16} className="text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
            </div>
            <p className="text-sm text-slate-500">
              {isDirector ? 'Full access — manage all users, roles, PINs & approvals' : `Manager access — ${currentUserDept ? `${currentUserDept} department` : 'your team'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadData(currentUserRole, currentUserDept)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${isDirector ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
              {isDirector ? '👑 Director' : '🛡 Manager'}
            </span>
            {pendingRequests.length > 0 && (
              <span className="text-xs font-bold bg-red-500 text-white px-2 py-1 rounded-full">{pendingRequests.length} pending</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total Users', value: users.length, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Active', value: users.filter((u) => u.is_active).length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Pending Approval', value: users.filter((u) => u.approval_status === 'pending').length, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Access Requests', value: pendingRequests.length, color: 'text-red-500', bg: 'bg-red-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
          {([
            { id: 'users', label: 'All Users', count: users.length },
            { id: 'requests', label: 'Access Requests', count: pendingRequests.length },
            { id: 'add', label: 'Add User', count: null },
            ...(isDirector ? [{ id: 'pins', label: 'PIN Management', count: null }, { id: 'audit', label: 'Audit Log', count: null }] : []),
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${
                activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {tab.label}
              {tab.count !== null && tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab.id === 'requests' ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {visibleFirms.length > 1 && (
              <div className="px-5 pt-4">
                <FirmFilterTabs firms={visibleFirms} selectedFirmId={firmFilter} onSelect={setFirmFilter} />
              </div>
            )}
            <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name or email…"
                  className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
              </div>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                <option value="all">All Roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="py-12 text-center">
                  <Users size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No users found</p>
                </div>
              ) : filteredUsers.map((u) => {
                const rc = roleConfig[u.role] || roleConfig.employee;
                const RoleIcon = rc.icon;
                const initials = (u.full_name || 'U').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
                return (
                  <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">{u.full_name || 'Unknown'}</p>
                        {u.employee_id && <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.employee_id}</span>}
                        <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rc.color}`}>
                          <RoleIcon size={9} /> {rc.label}
                        </span>
                        <FirmBadge firmName={u.firms?.name} firmCode={u.firms?.code} />
                        {!u.is_active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>}
                        {u.approval_status === 'pending' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Pending</span>}
                        {u.travel_approved && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                            <Plane size={9} /> Travel Approved
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{u.email} · {u.job_title || '—'} · {u.department || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {/* View Details */}
                      <button onClick={() => setViewingUser(u)} title="View Details"
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                        <Eye size={14} />
                      </button>
                      {/* Edit */}
                      {(isDirector || (isManager && u.role === 'employee')) && (
                        <button onClick={() => openEditUser(u)} title="Edit User"
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors">
                          <Edit2 size={14} />
                        </button>
                      )}
                      {u.approval_status === 'pending' && (
                        <button onClick={() => handleApproveUser(u.id, u.full_name)} disabled={processingId === u.id}
                          className="flex items-center gap-1 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <Check size={11} /> Approve
                        </button>
                      )}
                      {isDirector && u.id !== user?.id && (
                        <>
                          <select value={u.role} onChange={(e) => handleChangeRole(u.id, e.target.value, u.full_name)} disabled={processingId === u.id}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white disabled:opacity-50">
                            {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                          </select>
                          <button
                            onClick={() => handleToggleTravelApproval(u.id, u.full_name, u.travel_approved)}
                            disabled={processingId === u.id}
                            title={u.travel_approved ? 'Remove travel approval' : 'Approve daily travel (no radius restrictions)'}
                            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                              u.travel_approved
                                ? 'bg-sky-100 hover:bg-sky-200 text-sky-700 border border-sky-200' :'bg-slate-50 hover:bg-sky-50 text-slate-500 hover:text-sky-700 border border-slate-200'
                            }`}
                          >
                            <Plane size={11} />
                            {u.travel_approved ? 'Travel ✓' : 'Travel'}
                          </button>
                        </>
                      )}
                      {u.id !== user?.id && u.is_active && (
                        <button onClick={() => handleDeactivateUser(u.id, u.full_name)} disabled={processingId === u.id}
                          className="flex items-center gap-1 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <X size={11} /> Deactivate
                        </button>
                      )}
                      {u.id !== user?.id && !u.is_active && (
                        <button onClick={() => handleReactivateUser(u.id, u.full_name)} disabled={processingId === u.id}
                          className="flex items-center gap-1 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <Check size={11} /> Reactivate
                        </button>
                      )}
                      {/* Delete — Director only */}
                      {isDirector && u.id !== user?.id && (
                        <button onClick={() => setDeleteConfirm({ id: u.id, name: u.full_name })} title="Delete User"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Requests Tab */}
        {activeTab === 'requests' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">Access Requests</h3>
              <p className="text-xs text-slate-500 mt-0.5">{requests.length} total · {pendingRequests.length} pending review</p>
            </div>
            {requests.length === 0 ? (
              <div className="py-12 text-center">
                <AlertCircle size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No access requests yet</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
                {requests.map((req) => (
                  <div key={req.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                        {(req.requester_name || req.requester_email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-semibold text-slate-900">{req.requester_name || 'Unknown'}</p>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                            req.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                            req.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>{req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span>
                        </div>
                        <p className="text-xs text-slate-500">{req.requester_email}</p>
                        <p className="text-xs text-slate-600 mt-1">
                          Requested: <span className="font-semibold capitalize">{req.requested_role}</span>
                          {req.department && ` · ${req.department}`}
                          {req.job_title && ` · ${req.job_title}`}
                        </p>
                        {req.message && <p className="text-xs text-slate-500 mt-1 italic">"{req.message}"</p>}
                        <p className="text-[11px] text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      {req.status === 'pending' && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => handleApproveRequest(req.id, req.requester_email)} disabled={processingId === req.id}
                            className="flex items-center gap-1 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            <Check size={11} /> Approve
                          </button>
                          <button onClick={() => handleRejectRequest(req.id, req.requester_email)} disabled={processingId === req.id}
                            className="flex items-center gap-1 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            <X size={11} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add User Tab */}
        {activeTab === 'add' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 max-w-xl">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><UserPlus size={14} className="text-blue-600" /></div>
              <h3 className="text-sm font-bold text-slate-800">Add New User</h3>
            </div>
            <div className="space-y-4">
              {[
                { label: 'Full Name *', key: 'full_name', placeholder: 'Rohan Kapoor', type: 'text' },
                { label: 'Email Address *', key: 'email', placeholder: 'rohan@company.com', type: 'email' },
                { label: 'Phone', key: 'phone', placeholder: '+91 98765 43210', type: 'tel' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">{label}</label>
                  <input type={type} value={(addForm as any)[key]} onChange={(e) => setAddForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Role * <span className="text-amber-600 font-normal">(Director assigns)</span></label>
                <select value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                  {(isDirector ? ROLES : ['employee']).map((r) => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
                {!isDirector && <p className="text-xs text-slate-400 mt-1">Managers can only add employees</p>}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Department *</label>
                <select value={addForm.department} onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {firms.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Firm</label>
                  <select value={addForm.firm_id} onChange={(e) => setAddForm((f) => ({ ...f, firm_id: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                    <option value="">Default (Main Firm)</option>
                    {firms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                  </select>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400 mb-2">Employee ID is assigned automatically (firm code + number, e.g. MAIN001).</p>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Job Title *</label>
                <input value={addForm.job_title} onChange={(e) => setAddForm((f) => ({ ...f, job_title: e.target.value }))}
                  placeholder="e.g. Software Engineer" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
              </div>
              <div className="bg-amber-50 rounded-xl p-3.5 text-xs text-amber-700 border border-amber-200">
                <p className="font-semibold mb-1">Director assigns roles & PINs</p>
                <p>Employees do not set their own role. After adding the user, go to the PIN Management tab to set their login PIN.</p>
              </div>
              <button onClick={handleAddUser} disabled={addLoading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60">
                <UserPlus size={15} />
                {addLoading ? 'Adding User…' : 'Add User'}
              </button>
            </div>
          </div>
        )}

        {/* PIN Management Tab — Director only */}
        {activeTab === 'pins' && isDirector && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><KeyRound size={14} className="text-amber-600" /></div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">PIN Management</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Set or reset 4-digit login PINs for any employee</p>
                </div>
              </div>
            </div>
            <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto">
              {users.map((u) => {
                const initials = (u.full_name || 'U').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
                const rc = roleConfig[u.role] || roleConfig.employee;
                const hasPin = u.pin_hash && u.pin_hash.length > 0;
                return (
                  <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">{u.full_name || 'Unknown'}</p>
                        {u.employee_id && <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.employee_id}</span>}
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rc.color}`}>{rc.label}</span>
                        {hasPin ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">PIN Set</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">No PIN</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="relative">
                        <input
                          type={showPin[u.id] ? 'text' : 'password'}
                          inputMode="numeric"
                          maxLength={4}
                          value={pinForm[u.id] || ''}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setPinForm((prev) => ({ ...prev, [u.id]: val }));
                          }}
                          placeholder="4-digit PIN"
                          className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-amber-300 text-slate-800 pr-8"
                        />
                        <button
                          onClick={() => setShowPin((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPin[u.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleSetPin(u.id, u.full_name)}
                        disabled={pinLoading === u.id || !pinForm[u.id]}
                        className="flex items-center gap-1 text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <KeyRound size={11} />
                        {pinLoading === u.id ? 'Saving…' : hasPin ? 'Reset PIN' : 'Set PIN'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && isDirector && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
              <History size={16} className="text-slate-500" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-800">User Audit Log</h3>
                <p className="text-xs text-slate-500">All user management actions</p>
              </div>
              <select value={auditUserId} onChange={(e) => setAuditUserId(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                <option value="all">All Users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
              <button onClick={() => loadAuditLogs(auditUserId === 'all' ? undefined : auditUserId)}
                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
                <RefreshCw size={14} />
              </button>
            </div>
            {auditLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="py-12 text-center">
                <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No audit logs yet</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
                {auditLogs.map((log) => {
                  const targetUser = users.find(u => u.id === log.target_user_id);
                  const actionColors: Record<string, string> = {
                    approve_user: 'bg-emerald-100 text-emerald-700',
                    deactivate_user: 'bg-red-100 text-red-700',
                    reactivate_user: 'bg-blue-100 text-blue-700',
                    delete_user: 'bg-red-200 text-red-800',
                    edit_user: 'bg-amber-100 text-amber-700',
                    change_role: 'bg-purple-100 text-purple-700',
                    set_pin: 'bg-slate-100 text-slate-700',
                    toggle_travel: 'bg-sky-100 text-sky-700',
                  };
                  return (
                    <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <History size={14} className="text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${actionColors[log.action] || 'bg-slate-100 text-slate-600'}`}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          {targetUser && <span className="text-xs font-semibold text-slate-700">{targetUser.full_name}</span>}
                        </div>
                        <p className="text-xs text-slate-500">
                          By: {(log.performer as any)?.full_name || 'System'}
                          {log.notes && ` · ${log.notes}`}
                        </p>
                        {log.old_values && log.new_values && (
                          <div className="mt-1 text-[11px] text-slate-400">
                            {Object.keys(log.new_values || {}).map(k => (
                              (log.old_values?.[k] !== log.new_values?.[k]) && (
                                <span key={k} className="mr-2">{k}: <span className="line-through text-red-400">{String(log.old_values?.[k])}</span> → <span className="text-emerald-600">{String(log.new_values?.[k])}</span></span>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 flex-shrink-0">
                        {new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* View User Details Modal */}
      {viewingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-700 text-slate-900">User Details</h3>
              <button onClick={() => setViewingUser(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-blue-700 flex items-center justify-center text-white text-lg font-bold">
                  {(viewingUser.full_name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <p className="text-lg font-700 text-slate-900">{viewingUser.full_name}</p>
                  <p className="text-sm text-slate-500">{viewingUser.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Role', value: viewingUser.role },
                  { label: 'Department', value: viewingUser.department || '—' },
                  { label: 'Job Title', value: viewingUser.job_title || '—' },
                  { label: 'Phone', value: viewingUser.phone || '—' },
                  { label: 'Status', value: viewingUser.is_active ? 'Active' : 'Inactive' },
                  { label: 'Approval', value: viewingUser.approval_status },
                  { label: 'Travel Approved', value: viewingUser.travel_approved ? 'Yes' : 'No' },
                  { label: 'Joined', value: new Date(viewingUser.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[11px] text-slate-400 mb-0.5">{label}</p>
                    <p className="text-sm font-600 text-slate-800 capitalize">{value}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setViewingUser(null); openEditUser(viewingUser); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-600 transition-colors">
                  <Edit2 size={14} /> Edit User
                </button>
                <button onClick={() => { setViewingUser(null); setActiveTab('audit'); setAuditUserId(viewingUser.id); loadAuditLogs(viewingUser.id); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 text-sm font-600 text-slate-600 hover:bg-slate-50 transition-colors">
                  <History size={14} /> View Audit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-700 text-slate-900">Edit User</h3>
              <button onClick={() => setEditingUser(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Employee ID <span className="text-slate-400 font-normal">(assigned by system)</span></label>
                <div className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50 text-slate-700 font-mono">{editingUser?.employee_id || '—'}</div>
              </div>
              {[
                { label: 'Full Name *', key: 'full_name', type: 'text' },
                { label: 'Job Title *', key: 'job_title', type: 'text' },
                { label: 'Phone', key: 'phone', type: 'tel' },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">{label}</label>
                  <input type={type} value={(editForm as any)[key]} onChange={(e) => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Department *</label>
                <select value={editForm.department} onChange={(e) => setEditForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {isDirector && firms.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Firm</label>
                  <select value={editForm.firm_id} onChange={(e) => setEditForm(f => ({ ...f, firm_id: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                    <option value="">Default (Main Firm)</option>
                    {firms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                  </select>
                </div>
              )}
              {isDirector && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Role</label>
                  <select value={editForm.role} onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white">
                    {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setEditingUser(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-600 text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleEditUser} disabled={editLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                <Save size={14} />
                {editLoading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-700 text-slate-900">Delete User</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              Are you sure you want to permanently delete <span className="font-700 text-slate-900">{deleteConfirm.name}</span>? All their data will be removed.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-600 text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDeleteUser} disabled={deleteLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                <Trash2 size={14} />
                {deleteLoading ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}