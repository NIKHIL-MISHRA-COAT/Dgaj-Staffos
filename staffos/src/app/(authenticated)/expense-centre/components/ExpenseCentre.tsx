'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Receipt, Plus, Search, X, Loader2, IndianRupee, Upload, FileText, Paperclip, ExternalLink, CheckCircle2, XCircle, Clock, MessageSquare, RefreshCw } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Expense {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  expense_date: string;
  receipt_url: string;
  status: 'draft' | 'pending' | 'under_review' | 'approved' | 'rejected' | 'reimbursed';
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string;
  manager_remarks: string;
  clarification_requested: boolean;
  clarification_notes: string;
  reimbursed_at: string | null;
  created_at: string;
  user_profiles?: { full_name: string; department: string };
}

const CATEGORIES = ['Travel', 'Meals & Entertainment', 'Office Supplies', 'Software & Tools', 'Training', 'Client Entertainment', 'Equipment', 'Utilities', 'Other'];

const statusConfig: Record<string, { label: string; color: string; dot: string; icon: React.ElementType }> = {
  draft:        { label: 'Draft',        color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400',   icon: Clock },
  pending:      { label: 'Pending',      color: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500',   icon: Clock },
  under_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',    icon: RefreshCw },
  approved:     { label: 'Approved',     color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', icon: CheckCircle2 },
  rejected:     { label: 'Rejected',     color: 'bg-red-100 text-red-700',       dot: 'bg-red-500',     icon: XCircle },
  reimbursed:   { label: 'Reimbursed',   color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',  icon: CheckCircle2 },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ExpenseCentre() {
  const { user, getUserProfile, effectiveUserId } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('employee');
  const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [managerRemarks, setManagerRemarks] = useState('');
  const [clarificationNotes, setClarificationNotes] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [showActionMenu, setShowActionMenu] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Travel',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
  });
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingClarificationNote, setEditingClarificationNote] = useState('');

  const fetchExpenses = useCallback(async (role: string) => {
    const uid = effectiveUserId;
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    try {
      let query = supabase.from('expenses').select('*, user_profiles!expenses_user_id_fkey(full_name, department)').order('created_at', { ascending: false });
      if (role === 'employee') {
        query = query.eq('user_id', uid);
      } else {
        // Manager/director: restrict to firms they're actually allowed to
        // see (own firm, plus subsidiaries only if theirs is a holding firm)
        // — without this, any manager at any firm saw every firm's expenses.
        const { data: visibleFirmIds } = await supabase.rpc('get_visible_firm_ids', { p_user_id: uid, p_module: 'all' });
        if (visibleFirmIds) query = query.in('firm_id', visibleFirmIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      setExpenses(data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, supabase]);

  useEffect(() => {
    const init = async () => {
      if (!effectiveUserId) { setLoading(false); return; }
      try {
        const { data } = await supabase.from('user_profiles').select('role').eq('id', effectiveUserId).single();
        const role = data?.role || 'employee';
        setUserRole(role);
        fetchExpenses(role);
      } catch { fetchExpenses('employee'); }
    };
    init();
  }, [effectiveUserId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) { toast.error('File size must be under 10MB'); return; }
    setUploadingFile(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `expense-${effectiveUserId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('documents').upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(fileName);
      setUploadedFileUrl(urlData.publicUrl);
      setUploadedFileName(file.name);
      toast.success('Document uploaded successfully');
    } catch {
      try {
        const ext = file.name.split('.').pop();
        const fileName = `receipt-${effectiveUserId}-${Date.now()}.${ext}`;
        const { error: err2 } = await supabase.storage.from('receipts').upload(fileName, file, { upsert: true });
        if (err2) throw err2;
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName);
        setUploadedFileUrl(urlData.publicUrl);
        setUploadedFileName(file.name);
        toast.success('Document uploaded successfully');
      } catch {
        toast.error('Upload failed. Please try again.');
      }
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openEditExpense = (expense: any) => {
    setEditingExpenseId(expense.id);
    setEditingClarificationNote(expense.clarification_notes || '');
    setForm({
      title: expense.title || '',
      description: expense.description || '',
      category: expense.category || 'Travel',
      amount: String(expense.amount ?? ''),
      expense_date: expense.expense_date || new Date().toISOString().split('T')[0],
    });
    setUploadedFileUrl(expense.receipt_url || '');
    setShowForm(true);
  };

  const closeExpenseForm = () => {
    setShowForm(false);
    setEditingExpenseId(null);
    setEditingClarificationNote('');
    setForm({ title: '', description: '', category: 'Travel', amount: '', expense_date: new Date().toISOString().split('T')[0] });
    setUploadedFileUrl('');
    setUploadedFileName('');
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Please fill in title and a valid amount'); return;
    }
    const uid = effectiveUserId;
    if (!uid) { toast.error('Please log in to submit expenses'); return; }
    setSubmitting(true);
    try {
      if (editingExpenseId) {
        // Edit-and-resubmit: send it back into the review queue, keep the
        // clarification note on the row (visible in history) but clear the
        // "waiting on employee" flag now that they've responded.
        const { error } = await supabase.from('expenses').update({
          title: form.title,
          description: form.description,
          category: form.category,
          amount: parseFloat(form.amount),
          expense_date: form.expense_date,
          receipt_url: uploadedFileUrl || null,
          status: 'pending',
          clarification_requested: false,
        }).eq('id', editingExpenseId);
        if (error) throw error;
        toast.success('Expense resubmitted for approval');
        closeExpenseForm();
        fetchExpenses(userRole);
        return;
      }

      const { data: submitterProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', uid).single();
      const insertData: Record<string, any> = {
        user_id: uid,
        firm_id: submitterProfile?.firm_id || null,
        title: form.title,
        description: form.description,
        category: form.category,
        amount: parseFloat(form.amount),
        expense_date: form.expense_date,
        receipt_url: uploadedFileUrl || null,
        status: 'pending',
        currency: 'INR',
      };
      const { error } = await supabase.from('expenses').insert(insertData);
      if (error) {
        if (error.message?.includes('currency')) {
          const { currency: _c, ...withoutCurrency } = insertData;
          const { error: err2 } = await supabase.from('expenses').insert(withoutCurrency);
          if (err2) throw err2;
        } else {
          throw error;
        }
      }
      toast.success('Expense submitted for approval');
      closeExpenseForm();
      fetchExpenses(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (expenseId: string) => {
    setProcessingId(expenseId);
    try {
      const { error } = await supabase.from('expenses').update({
        status: 'approved',
        reviewed_by: effectiveUserId,
        reviewed_at: new Date().toISOString(),
        manager_remarks: managerRemarks || null,
      }).eq('id', expenseId);
      if (error) throw error;
      toast.success('Expense approved');
      setSelectedExpense(null);
      setManagerRemarks('');
      fetchExpenses(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve expense');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (expenseId: string) => {
    setProcessingId(expenseId);
    try {
      const { error } = await supabase.from('expenses').update({
        status: 'rejected',
        reviewed_by: effectiveUserId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectionReason,
        manager_remarks: managerRemarks || null,
      }).eq('id', expenseId);
      if (error) throw error;
      toast.error('Expense rejected');
      setSelectedExpense(null);
      setRejectionReason('');
      setManagerRemarks('');
      fetchExpenses(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject expense');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRequestClarification = async (expenseId: string) => {
    if (!clarificationNotes.trim()) { toast.error('Please enter clarification notes'); return; }
    setProcessingId(expenseId);
    try {
      const { error } = await supabase.from('expenses').update({
        status: 'under_review',
        clarification_requested: true,
        clarification_notes: clarificationNotes,
        reviewed_by: effectiveUserId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', expenseId);
      if (error) throw error;
      toast.success('Clarification requested');
      setSelectedExpense(null);
      setClarificationNotes('');
      fetchExpenses(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to request clarification');
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkReimbursed = async (expenseId: string) => {
    setProcessingId(expenseId);
    try {
      const { error } = await supabase.from('expenses').update({
        status: 'reimbursed',
        reimbursed_at: new Date().toISOString(),
      }).eq('id', expenseId);
      if (error) throw error;
      toast.success('Expense marked as reimbursed');
      setSelectedExpense(null);
      fetchExpenses(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update expense');
    } finally {
      setProcessingId(null);
    }
  };

  const isDirectorOrManager = userRole === 'director' || userRole === 'manager' || userRole === 'executive';

  const displayExpenses = expenses.filter((e) => {
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    const matchSearch = !searchQuery || e.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchTab = activeTab === 'my' ? e.user_id === effectiveUserId : true;
    return matchStatus && matchSearch && matchTab;
  });

  const totalPending = expenses.filter((e) => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0);
  const totalApproved = expenses.filter((e) => e.status === 'approved').reduce((sum, e) => sum + e.amount, 0);
  const totalReimbursed = expenses.filter((e) => e.status === 'reimbursed').reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Receipt size={16} className="text-emerald-600" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Expense Centre</h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Submit and track expense reimbursements</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={16} /> New Expense
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-700 font-semibold mb-1">Pending Reimbursement</p>
            <p className="text-xl font-bold text-amber-800">₹{totalPending.toLocaleString('en-IN')}</p>
            <p className="text-xs text-amber-600 mt-0.5">{expenses.filter(e => e.status === 'pending').length} expenses</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-xs text-emerald-700 font-semibold mb-1">Approved Total</p>
            <p className="text-xl font-bold text-emerald-800">₹{totalApproved.toLocaleString('en-IN')}</p>
            <p className="text-xs text-emerald-600 mt-0.5">{expenses.filter(e => e.status === 'approved').length} expenses</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <p className="text-xs text-purple-700 font-semibold mb-1">Reimbursed</p>
            <p className="text-xl font-bold text-purple-800">₹{totalReimbursed.toLocaleString('en-IN')}</p>
            <p className="text-xs text-purple-600 mt-0.5">{expenses.filter(e => e.status === 'reimbursed').length} expenses</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {isDirectorOrManager && (
            <div className="flex gap-2">
              {(['my', 'all'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-colors capitalize ${activeTab === tab ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-300'}`}>
                  {tab === 'my' ? 'My Expenses' : 'All Expenses'}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search expenses…" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="reimbursed">Reimbursed</option>
          </select>
        </div>

        {/* Expense List */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-emerald-500" />
            </div>
          ) : displayExpenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Receipt size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-semibold">No expenses found</p>
              <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-emerald-600 font-semibold hover:underline">
                Submit your first expense
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {displayExpenses.map((expense) => {
                const sc = statusConfig[expense.status] || statusConfig.pending;
                const StatusIcon = sc.icon;
                return (
                  <div key={expense.id} onClick={() => setSelectedExpense(expense)}
                    className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                      <IndianRupee size={15} className="text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{expense.title}</p>
                        <span className="text-xs text-slate-400">{expense.category}</span>
                        {expense.receipt_url && (
                          <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-full">
                            <Paperclip size={9} /> Doc
                          </span>
                        )}
                        {expense.clarification_requested && expense.status === 'under_review' && (
                          <span className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                            <MessageSquare size={9} /> Clarification Needed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {expense.user_profiles && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">{expense.user_profiles.full_name}</span>
                        )}
                        <span className="text-xs text-slate-400">{timeAgo(expense.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">₹{expense.amount.toLocaleString('en-IN')}</p>
                      <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${sc.color}`}>
                        <StatusIcon size={10} />
                        <span className="hidden sm:inline">{sc.label}</span>
                      </span>
                      {expense.clarification_requested && expense.status === 'under_review' && expense.user_id === effectiveUserId && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditExpense(expense); }}
                          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0"
                        >
                          Edit & Resubmit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New Expense Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{editingExpenseId ? 'Edit & Resubmit Expense' : 'New Expense'}</h3>
              <button onClick={closeExpenseForm}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            {editingExpenseId && editingClarificationNote && (
              <div className="mx-6 mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <MessageSquare size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Reviewer asked for clarification</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{editingClarificationNote}</p>
                </div>
              </div>
            )}
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Title *</label>
                <input type="text" placeholder="Expense title" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Amount (₹) *</label>
                  <input type="number" placeholder="0.00" min="0" step="0.01" value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Expense Date</label>
                <input type="date" value={form.expense_date}
                  onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea placeholder="Add details about this expense…" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2} className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  <Paperclip size={12} className="inline mr-1" />Receipt / Invoice / Document
                </label>
                {uploadedFileUrl ? (
                  <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                    <FileText size={16} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium flex-1 truncate">{uploadedFileName}</span>
                    <a href={uploadedFileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700" onClick={(e) => e.stopPropagation()}>
                      <ExternalLink size={14} />
                    </a>
                    <button onClick={() => { setUploadedFileUrl(''); setUploadedFileName(''); }} className="text-slate-400 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
                    {uploadingFile ? <Loader2 size={20} className="animate-spin text-emerald-500" /> : <Upload size={20} className="text-slate-400" />}
                    <p className="text-xs text-slate-500 text-center">{uploadingFile ? 'Uploading…' : 'Click to upload receipt, invoice, or any document'}</p>
                    <p className="text-[10px] text-slate-400">PDF, JPG, PNG, DOCX — max 10MB</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,.xlsx,.xls,.csv,.txt" onChange={handleFileUpload} className="hidden" />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
              <button onClick={closeExpenseForm}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? (editingExpenseId ? 'Resubmitting…' : 'Submitting…') : (editingExpenseId ? 'Resubmit for Approval' : 'Submit Expense')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Detail Modal */}
      {selectedExpense && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Expense Details</h3>
              <button onClick={() => { setSelectedExpense(null); setRejectionReason(''); setManagerRemarks(''); setClarificationNotes(''); }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{selectedExpense.title}</p>
                <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${(statusConfig[selectedExpense.status] || statusConfig.pending).color}`}>
                  {selectedExpense.status.replace('_', ' ')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-slate-500 dark:text-slate-400">Amount</p><p className="font-bold text-slate-900 dark:text-slate-100">₹{selectedExpense.amount.toLocaleString('en-IN')}</p></div>
                <div><p className="text-xs text-slate-500 dark:text-slate-400">Category</p><p className="font-semibold text-slate-700 dark:text-slate-300">{selectedExpense.category}</p></div>
                <div><p className="text-xs text-slate-500 dark:text-slate-400">Date</p><p className="font-semibold text-slate-700 dark:text-slate-300">{selectedExpense.expense_date}</p></div>
                {selectedExpense.user_profiles && (
                  <div><p className="text-xs text-slate-500 dark:text-slate-400">Employee</p><p className="font-semibold text-slate-700 dark:text-slate-300">{selectedExpense.user_profiles.full_name}</p></div>
                )}
              </div>
              {selectedExpense.description && (
                <div><p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Description</p><p className="text-sm text-slate-700 dark:text-slate-300">{selectedExpense.description}</p></div>
              )}
              {selectedExpense.receipt_url && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                  <Paperclip size={14} className="text-blue-600 flex-shrink-0" />
                  <span className="text-sm text-blue-700 dark:text-blue-400 font-medium flex-1">Attached Document</span>
                  <a href={selectedExpense.receipt_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 font-semibold hover:underline">
                    View <ExternalLink size={11} />
                  </a>
                </div>
              )}
              {selectedExpense.rejection_reason && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <p className="text-xs text-red-700 dark:text-red-400 font-semibold mb-1">Rejection Reason</p>
                  <p className="text-sm text-red-600 dark:text-red-400">{selectedExpense.rejection_reason}</p>
                </div>
              )}
              {selectedExpense.manager_remarks && (
                <div className="p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl">
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold mb-1">Manager Remarks</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{selectedExpense.manager_remarks}</p>
                </div>
              )}
              {selectedExpense.clarification_notes && (
                <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl">
                  <p className="text-xs text-orange-700 dark:text-orange-400 font-semibold mb-1">Clarification Requested</p>
                  <p className="text-sm text-orange-600 dark:text-orange-400">{selectedExpense.clarification_notes}</p>
                </div>
              )}

              {/* Manager action fields */}
              {isDirectorOrManager && ['pending', 'under_review'].includes(selectedExpense.status) && (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Manager Remarks (optional)</label>
                    <input type="text" placeholder="Add remarks…" value={managerRemarks}
                      onChange={(e) => setManagerRemarks(e.target.value)}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
                  </div>
                  {selectedExpense.status === 'pending' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Rejection Reason (if rejecting)</label>
                      <input type="text" placeholder="Reason for rejection…" value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Clarification Notes (if requesting clarification)</label>
                    <input type="text" placeholder="What clarification is needed…" value={clarificationNotes}
                      onChange={(e) => setClarificationNotes(e.target.value)}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
              {isDirectorOrManager && selectedExpense.status === 'pending' && (
                <>
                  <button onClick={() => handleRequestClarification(selectedExpense.id)} disabled={!!processingId}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-600 text-xs font-semibold transition-colors disabled:opacity-50">
                    Request Clarification
                  </button>
                  <button onClick={() => handleReject(selectedExpense.id)} disabled={!!processingId}
                    className="flex-1 min-w-[80px] py-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-xs font-semibold transition-colors disabled:opacity-50">
                    Reject
                  </button>
                  <button onClick={() => handleApprove(selectedExpense.id)} disabled={!!processingId}
                    className="flex-1 min-w-[80px] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                    {processingId === selectedExpense.id ? <Loader2 size={12} className="animate-spin" /> : null}
                    Approve
                  </button>
                </>
              )}
              {isDirectorOrManager && selectedExpense.status === 'under_review' && (
                <>
                  <button onClick={() => handleReject(selectedExpense.id)} disabled={!!processingId}
                    className="flex-1 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-sm font-semibold transition-colors disabled:opacity-50">
                    Reject
                  </button>
                  <button onClick={() => handleApprove(selectedExpense.id)} disabled={!!processingId}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                    Approve
                  </button>
                </>
              )}
              {isDirectorOrManager && selectedExpense.status === 'approved' && (
                <button onClick={() => handleMarkReimbursed(selectedExpense.id)} disabled={!!processingId}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  Mark Reimbursed
                </button>
              )}
              <button onClick={() => { setSelectedExpense(null); setRejectionReason(''); setManagerRemarks(''); setClarificationNotes(''); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}