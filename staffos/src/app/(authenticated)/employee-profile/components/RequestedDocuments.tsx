'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Upload, Clock, CheckCircle2 } from 'lucide-react';
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
  submitted_document_id: string | null;
}

const MAX_BYTES = 10 * 1024 * 1024;

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

interface Props {
  userId: string;
  onUploaded?: () => void; // lets the parent refresh its document list
}

export default function RequestedDocuments({ userId, onUploaded }: Props) {
  const supabase = createClient();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('document_requests')
        .select('id, document_name, document_type, instructions, due_date, status, created_at, submitted_document_id')
        .eq('employee_id', userId)
        .in('status', ['pending', 'submitted'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests((data || []) as RequestRow[]);
    } catch (err: any) {
      console.error('Requested documents load error:', err);
      setLoadError(err?.message || 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (req: RequestRow, file: File) => {
    if (file.size > MAX_BYTES) { toast.error('File must be under 10MB'); return; }
    setUploadingId(req.id);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const safeName = req.document_name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document';
      const filePath = `${userId}/${Date.now()}_${safeName}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('employee-documents')
        .upload(filePath, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: doc, error: insErr } = await supabase
        .from('employee_documents')
        .insert({
          user_id: userId,
          document_name: req.document_name,
          document_type: req.document_type,
          file_path: filePath,
          file_url: '',
          file_size: file.size,
          mime_type: file.type,
          request_id: req.id,
          doc_status: 'pending',
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      const { error: reqErr } = await supabase
        .from('document_requests')
        .update({ status: 'submitted', submitted_document_id: doc.id, updated_at: new Date().toISOString() })
        .eq('id', req.id);
      if (reqErr) throw reqErr;

      toast.success(`${req.document_name} uploaded`);
      await load();
      onUploaded?.();
    } catch (err: any) {
      toast.error('Upload failed' + (err?.message ? `: ${err.message}` : ''));
    } finally {
      setUploadingId(null);
      const input = inputRefs.current[req.id];
      if (input) input.value = '';
    }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const submitted = requests.filter(r => r.status === 'submitted');

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/60">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <FileText size={14} className="text-amber-600" /> Requested documents
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {pending.length > 0 ? `${pending.length} document${pending.length !== 1 ? 's' : ''} asked for by your manager` : 'All requested documents are uploaded'}
        </p>
      </div>

      {loadError && (
        <div className="px-5 py-3 text-xs text-red-700 bg-red-50 border-b border-red-100">
          Could not load requested documents: {loadError}
        </div>
      )}

      {loading ? (
        <p className="px-5 py-4 text-xs text-slate-400">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="px-5 py-4 text-xs text-slate-400">No documents requested by your manager.</p>
      ) : null}

      <div className="divide-y divide-slate-100">
        {pending.map(r => (
          <div key={r.id} className="flex items-start gap-3 px-5 py-3.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-600 text-slate-800">{r.document_name}</p>
              {(r.due_date || r.instructions) && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {r.due_date && <span className="font-600 text-amber-700">Due {fmtDate(r.due_date)}</span>}
                  {r.due_date && r.instructions && ' · '}
                  {r.instructions}
                </p>
              )}
            </div>
            <input
              ref={(el) => { inputRefs.current[r.id] = el; }}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              disabled={uploadingId !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(r, f); }}
            />
            <button
              onClick={() => inputRefs.current[r.id]?.click()}
              disabled={uploadingId !== null}
              className="flex items-center gap-1.5 text-xs font-600 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 whitespace-nowrap"
            >
              <Upload size={12} /> {uploadingId === r.id ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        ))}

        {submitted.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-5 py-3">
            <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
            <p className="flex-1 min-w-0 text-xs text-slate-600 truncate">{r.document_name}</p>
            <span className="flex items-center gap-1 text-[10px] font-600 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              <Clock size={9} /> Sent for review
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}