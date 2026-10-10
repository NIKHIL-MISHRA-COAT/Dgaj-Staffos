'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Upload, Search, Download, Trash2, Eye, X, FileText, Image, File, Loader2, FolderOpen } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface CompanyDocument {
  id: string;
  title: string;
  description: string;
  document_type: string;
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  department: string | null;
  is_public: boolean;
  tags: string[];
  uploaded_by: string | null;
  created_at: string;
  uploader?: { full_name: string };
}

const DOC_TYPES = ['All', 'policy', 'form', 'template', 'report', 'general'];
const DOC_TYPE_LABELS: Record<string, string> = {
  policy: 'Policy', form: 'Form', template: 'Template', report: 'Report', general: 'General',
};
const DOC_TYPE_COLORS: Record<string, string> = {
  policy: 'bg-blue-100 text-blue-700',
  form: 'bg-emerald-100 text-emerald-700',
  template: 'bg-purple-100 text-purple-700',
  report: 'bg-amber-100 text-amber-700',
  general: 'bg-slate-100 text-slate-700',
};

function formatFileSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (!mimeType) return <File size={20} className="text-slate-400" />;
  if (mimeType.startsWith('image/')) return <Image size={20} className="text-blue-500" />;
  if (mimeType.includes('pdf')) return <FileText size={20} className="text-red-500" />;
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText size={20} className="text-blue-600" />;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return <FileText size={20} className="text-emerald-600" />;
  return <File size={20} className="text-slate-400" />;
}

export default function DocumentsPage() {
  const { effectiveUserId, pinSession } = useAuth();
  const supabase = createClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [userRole, setUserRole] = useState('employee');
  const [form, setForm] = useState({
    title: '',
    description: '',
    document_type: 'general',
    department: '',
    tags: '',
    file: null as File | null,
  });

  const isDirectorOrManager = userRole === 'director' || userRole === 'manager' || userRole === 'executive';

  useEffect(() => {
    if (!effectiveUserId) return;
    init();
  }, [effectiveUserId]);

  const init = async () => {
    try {
      const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', effectiveUserId!).single();
      setUserRole(profile?.role || 'employee');
      await fetchDocuments();
    } catch {}
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('company_documents')
        .select('*, uploader:user_profiles!company_documents_uploaded_by_fkey(full_name)')
        .eq('is_public', true)
        .order('created_at', { ascending: false });
      if (effectiveUserId) {
        const { data: visibleFirmIds } = await supabase.rpc('get_visible_firm_ids', { p_user_id: effectiveUserId, p_module: 'all' });
        if (visibleFirmIds) {
          const ids = (visibleFirmIds as string[]).filter(Boolean);
          // Company-wide documents (no firm set) are visible to everyone
          query = ids.length > 0
            ? query.or(`firm_id.is.null,firm_id.in.(${ids.join(',')})`)
            : query.is('firm_id', null);
        }
      }
      const { data, error } = await query;
      if (error) throw error;
      setDocuments(data || []);
    } catch (err: any) {
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  // Keep the stats and list current: refresh when the tab is back in view,
  // and when any company document is added, changed or removed
  useEffect(() => {
    if (!effectiveUserId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') fetchDocuments();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => fetchDocuments(), 600);
    };
    const channel = supabase
      .channel(`company-documents-${effectiveUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_documents' }, scheduleRefresh)
      .subscribe();

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [effectiveUserId]);

  const handleUpload = async () => {
    if (!form.title.trim() || !form.file) { toast.error('Title and file are required'); return; }
    if (!effectiveUserId) return;
    setUploading(true);
    try {
      const ext = form.file.name.split('.').pop();
      const filePath = `company-docs/${Date.now()}_${form.file.name.replace(/\s+/g, '_')}`;
      const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, form.file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const { data: uploaderProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', effectiveUserId).single();
      const { error } = await supabase.from('company_documents').insert({
        title: form.title.trim(),
        firm_id: uploaderProfile?.firm_id || null,
        description: form.description,
        document_type: form.document_type,
        file_url: urlData.publicUrl,
        file_path: filePath,
        file_name: form.file.name,
        file_size: form.file.size,
        mime_type: form.file.type,
        department: form.department || null,
        tags,
        uploaded_by: effectiveUserId,
        is_public: true,
      });
      if (error) throw error;
      toast.success('Document uploaded successfully');
      setShowUploadForm(false);
      setForm({ title: '', description: '', document_type: 'general', department: '', tags: '', file: null });
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: CompanyDocument) => {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    try {
      if (doc.file_url) {
        const path = doc.file_url.split('/documents/')[1];
        if (path) await supabase.storage.from('documents').remove([path]);
      }
      await supabase.from('company_documents').delete().eq('id', doc.id);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      toast.success('Document deleted');
    } catch {
      toast.error('Failed to delete document');
    }
  };

  const filtered = documents.filter(d => {
    const matchType = typeFilter === 'All' || d.document_type === typeFilter;
    const matchSearch = !searchQuery || d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchType && matchSearch;
  });

  return (
    <>
          <Toaster position="bottom-right" richColors />
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <BookOpen size={18} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-700 text-slate-900 dark:text-slate-100">Documents & Resources</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Company policies, forms, templates and reports</p>
            </div>
          </div>
          {isDirectorOrManager && (
            <button onClick={() => setShowUploadForm(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-600 px-4 py-2.5 rounded-xl transition-colors">
              <Upload size={15} /> Upload Document
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search documents…" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {DOC_TYPES.map(type => (
              <button key={type} onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-xs font-600 rounded-xl border transition-colors ${typeFilter === type ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:border-indigo-300'}`}>
                {type === 'All' ? 'All' : DOC_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {['policy', 'form', 'template', 'report'].map(type => {
            const count = documents.filter(d => d.document_type === type).length;
            return (
              <div key={type} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                <p className="text-lg font-700 text-slate-900 dark:text-slate-100">{count}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{DOC_TYPE_LABELS[type]}s</p>
              </div>
            );
          })}
        </div>

        {/* Document Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <FolderOpen size={48} className="mb-3 opacity-30" />
            <p className="text-sm font-500">No documents found</p>
            {isDirectorOrManager && (
              <button onClick={() => setShowUploadForm(true)} className="mt-3 text-sm text-indigo-600 font-600 hover:underline">
                Upload the first document
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(doc => (
              <div key={doc.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                    {getFileIcon(doc.mime_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-600 text-slate-900 dark:text-slate-100 truncate">{doc.title}</p>
                    {doc.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{doc.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${DOC_TYPE_COLORS[doc.document_type] || DOC_TYPE_COLORS.general}`}>
                    {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                  </span>
                  {doc.department && (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{doc.department}</span>
                  )}
                  {doc.file_size > 0 && (
                    <span className="text-[10px] text-slate-400">{formatFileSize(doc.file_size)}</span>
                  )}
                </div>
                {doc.tags && doc.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-3">
                    {doc.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded-full">#{tag}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400">
                    {doc.uploader?.full_name || 'Unknown'} · {new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex items-center gap-1">
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="View">
                      <Eye size={14} className="text-slate-500 dark:text-slate-400" />
                    </a>
                    <a href={doc.file_url} download={doc.file_name}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="Download">
                      <Download size={14} className="text-slate-500 dark:text-slate-400" />
                    </a>
                    {isDirectorOrManager && (
                      <button onClick={() => handleDelete(doc)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                        <Trash2 size={14} className="text-slate-400 hover:text-red-500" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Upload Document</h3>
              <button onClick={() => setShowUploadForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Title *</label>
                <input type="text" placeholder="Document title" value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea placeholder="Brief description…" value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2} className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Type</label>
                  <select value={form.document_type} onChange={e => setForm(p => ({ ...p, document_type: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Department</label>
                  <input type="text" placeholder="All departments" value={form.department}
                    onChange={e => setForm(p => ({ ...p, department: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Tags (comma-separated)</label>
                <input type="text" placeholder="e.g. hr, policy, 2024" value={form.tags}
                  onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">File *</label>
                <div onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors">
                  <Upload size={20} className="text-slate-400" />
                  <p className="text-xs text-slate-500">{form.file ? form.file.name : 'Click to select file'}</p>
                  <p className="text-[10px] text-slate-400">PDF, DOCX, XLSX, PNG, JPG — max 50MB</p>
                </div>
                <input ref={fileInputRef} type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.csv,.txt"
                  onChange={e => setForm(p => ({ ...p, file: e.target.files?.[0] || null }))}
                  className="hidden" />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setShowUploadForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleUpload} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-600 transition-colors flex items-center justify-center gap-2">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : null}
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}