'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, ExternalLink, Check, X, Clock, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

interface RequestRow {
  id: string;
  document_name: string;
  document_type: string;
  instructions: string;
  due_date: string | null;
  status: 'pending' | 'submitted' | 'cancelled';
  created_at: string;
}

interface DocRow {
  id: string;
  document_name: string;
  document_type: string;
  file_path: string;
  file_size: number | null;
  doc_status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  uploaded_at: string;
  request_id: string | null;
}

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'id_proof', label: 'ID proof' },
  { value: 'address_proof', label: 'Address proof' },
  { value: 'education', label: 'Education certificate' },
  { value: 'experience', label: 'Experience letter' },
  { value: 'bank', label: 'Bank details' },
  { value: 'medical', label: 'Medical' },
  { value: 'other', label: 'Other' },
];

const typeLabel = (v: string) => DOC_TYPES.find(t => t.value === v)?.label || v;

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const fmtSize = (n: number | null) => {
  if (!n) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

interface Props {
  employeeId: string;
  employeeName: string;
  requesterId: string; // the director/manager using the page
}

export default function EmployeeDocumentsPanel({ employeeId, employeeName, requesterId }: Props) {
  const supabase = createClient();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ document_name: '', document_type: 'other', instructions: '', due_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, docRes] = await Promise.all([
        supabase
          .from('document_requests')
          .select('id, document_name, document_type, instructions, due_date, status, created_at')
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: false }),
        supabase
          .from('employee_documents')
          .select('id, document_name, document_type, file_path, file_size, doc_status, notes, uploaded_at, request_id')
          .eq('user_id', employeeId)
          .order('uploaded_at', { ascending: false }),
      ]);
      if (reqRes.error) throw reqRes.error;
      if (docRes.error) throw docRes.error;
      setRequests((reqRes.data || []) as RequestRow[]);
      setDocs((docRes.data || []) as DocRow[]);
    } catch (err: any) {
      toast.error('Could not load documents: ' + (err?.message || 'unknown error'));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.document_name.trim()) { toast.error('Enter the document name'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('document_requests').insert({
        employee_id: employeeId,
        requested_by: requesterId,
        document_name: form.document_name.trim(),
        document_type: form.document_type,
        instructions: form.instructions.trim(),
        due_date: form.due_date || null,
      });
      if (error) throw error;
      toast.success(`Requested from ${employeeName}`);
      setForm({ document_name: '', document_type: 'other', instructions: '', due_date: '' });
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not send request');
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (id: string) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('document_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not cancel');
    } finally {
      setBusyId(null);
    }
  };

  const openDoc = async (doc: DocRow) => {
    const { data, error } = await supabase.storage.from('employee-documents').createSignedUrl(doc.file_path, 300);
    if (error || !data?.signedUrl) { toast.error('Could not open file'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const review = async (doc: DocRow, status: 'approved' | 'rejected') => {
    setBusyId(doc.id);
    try {
      const { error } = await supabase.from('employee_documents').update({ doc_status: status }).eq('id', doc.id);
      if (error) throw error;
      toast.success(status === 'approved' ? 'Document approved' : 'Document rejected');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update');
    } finally {
      setBusyId(null);
    }
  };

  const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 bg-white';
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const otherRequests = requests.filter(r => r.status !== 'pending');

  const docStatusStyle: Record<string, { cls: string; icon: any; label: string }> = {
    pending: { cls: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending review' },
    approved: { cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Approved' },
    rejected: { cls: 'bg-red-100 text-red-700', icon: XCircle, label: 'Rejected' },
  };

  return (
    <div className="border-t border-slate-200 pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-700 text-slate-800 flex items-center gap-1.5"><FileText size={14} /> Documents</h4>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1 text-xs font-600 text-blue-600 hover:text-blue-700">
          <Plus size={13} /> Request document
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitRequest} className="bg-slate-50 rounded-xl p-3 space-y-2.5 border border-slate-200">
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Document name *</label>
            <input className={inputCls} value={form.document_name} placeholder="e.g. Aadhaar card (front & back)"
              onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Type</label>
              <select className={inputCls} value={form.document_type} onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Due date</label>
              <input type="date" className={inputCls} value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Instructions</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.instructions}
              onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs font-600 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs font-600 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60">
              {saving ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : (
        <>
          {/* Open requests */}
          {pendingRequests.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-600 uppercase tracking-wide text-slate-500">Waiting for upload</p>
              {pendingRequests.map(r => (
                <div key={r.id} className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <Clock size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-600 text-slate-800">{r.document_name}</p>
                    <p className="text-[11px] text-slate-500">
                      {typeLabel(r.document_type)}{r.due_date ? ` · due ${fmtDate(r.due_date)}` : ''}
                    </p>
                    {r.instructions && <p className="text-[11px] text-slate-500 mt-0.5">{r.instructions}</p>}
                  </div>
                  <button onClick={() => cancelRequest(r.id)} disabled={busyId === r.id} title="Cancel request"
                    className="text-slate-400 hover:text-red-600 disabled:opacity-40"><Ban size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Uploaded files */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-600 uppercase tracking-wide text-slate-500">Uploaded ({docs.length})</p>
            {docs.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing uploaded yet.</p>
            ) : docs.map(d => {
              const st = docStatusStyle[d.doc_status] || docStatusStyle.pending;
              const StIcon = st.icon;
              return (
                <div key={d.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-600 text-slate-800 truncate">{d.document_name}</p>
                      <p className="text-[11px] text-slate-400">
                        {typeLabel(d.document_type)}{fmtSize(d.file_size) ? ` · ${fmtSize(d.file_size)}` : ''} · {fmtDate(d.uploaded_at.slice(0, 10))}
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-600 px-1.5 py-0.5 rounded-full ${st.cls}`}>
                      <StIcon size={10} /> {st.label}
                    </span>
                    <button onClick={() => openDoc(d)} title="Open file" className="text-blue-600 hover:text-blue-700"><ExternalLink size={14} /></button>
                  </div>
                  {d.doc_status === 'pending' && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => review(d, 'approved')} disabled={busyId === d.id}
                        className="flex items-center gap-1 text-[11px] font-600 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
                        <Check size={11} /> Approve
                      </button>
                      <button onClick={() => review(d, 'rejected')} disabled={busyId === d.id}
                        className="flex items-center gap-1 text-[11px] font-600 px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60">
                        <X size={11} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {otherRequests.length > 0 && (
            <p className="text-[11px] text-slate-400">
              {otherRequests.filter(r => r.status === 'submitted').length} submitted · {otherRequests.filter(r => r.status === 'cancelled').length} cancelled
            </p>
          )}
        </>
      )}
    </div>
  );
}