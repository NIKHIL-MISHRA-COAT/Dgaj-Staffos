'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, X, Edit2, Save, Trash2, Phone, Mail, User, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ClientOrg {
  id: string;
  name: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
}

interface ClientOrganisationsProps {
  onClose: () => void;
  onOrgAdded?: () => void;
}

const emptyForm = {
  name: '',
  contact_person: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
};

export default function ClientOrganisations({ onClose, onOrgAdded }: ClientOrganisationsProps) {
  const [orgs, setOrgs] = useState<ClientOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<ClientOrg | null>(null);
  const [form, setForm] = useState(emptyForm);
  const { user } = useAuth();
  const supabase = createClient();

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('client_organisations')
        .select('id, name, contact_person, contact_email, contact_phone, notes, created_at')
        .order('name', { ascending: true });
      if (error) throw error;
      setOrgs(data || []);
    } catch (err) {
      toast.error('Failed to load client organisations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Organisation name is required'); return; }
    setSaving(true);
    try {
      if (editingOrg) {
        const { error } = await supabase
          .from('client_organisations')
          .update({
            name: form.name.trim(),
            contact_person: form.contact_person || null,
            contact_email: form.contact_email || null,
            contact_phone: form.contact_phone || null,
            notes: form.notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingOrg.id);
        if (error) throw error;
        toast.success('Organisation updated');
      } else {
        const insertData: Record<string, unknown> = {
          name: form.name.trim(),
          contact_person: form.contact_person || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          notes: form.notes || null,
        };
        if (user?.id) {
          insertData.created_by = user.id;
        }
        const { error } = await supabase
          .from('client_organisations')
          .insert(insertData);
        if (error) throw error;
        toast.success('Client organisation added');
        onOrgAdded?.();
      }
      setForm(emptyForm);
      setShowForm(false);
      setEditingOrg(null);
      fetchOrgs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save organisation');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (org: ClientOrg) => {
    setEditingOrg(org);
    setForm({
      name: org.name,
      contact_person: org.contact_person || '',
      contact_email: org.contact_email || '',
      contact_phone: org.contact_phone || '',
      notes: org.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('client_organisations').delete().eq('id', id);
      if (error) throw error;
      setOrgs((prev) => prev.filter((o) => o.id !== id));
      toast.success('Organisation removed');
    } catch (err) {
      toast.error('Failed to delete organisation');
    }
  };

  const handleCancel = () => {
    setForm(emptyForm);
    setEditingOrg(null);
    setShowForm(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-blue-600" />
            <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Client Organisations</h3>
          </div>
          <div className="flex items-center gap-2">
            {!showForm && (
              <button
                onClick={() => { setEditingOrg(null); setForm(emptyForm); setShowForm(true); }}
                className="flex items-center gap-1.5 text-xs font-600 text-blue-600 hover:text-blue-700 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus size={13} />Add Client
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X size={18} className="text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Add / Edit Form */}
          {showForm && (
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-blue-50/40 dark:bg-blue-900/10">
              <h4 className="text-xs font-700 text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                {editingOrg ? 'Edit Organisation' : 'New Client Organisation'}
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1">Organisation Name *</label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. Acme Petroleum Ltd."
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="input-field pl-8"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1">Contact Person</label>
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Name"
                        value={form.contact_person}
                        onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                        className="input-field pl-8"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1">Phone</label>
                    <div className="relative">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="+91 …"
                        value={form.contact_phone}
                        onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                        className="input-field pl-8"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1">Email</label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      placeholder="contact@organisation.com"
                      value={form.contact_email}
                      onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                      className="input-field pl-8"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <div className="relative">
                    <FileText size={14} className="absolute left-3 top-3 text-slate-400" />
                    <textarea
                      placeholder="Any additional notes…"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={2}
                      className="input-field pl-8 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={handleCancel} className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary py-2 disabled:opacity-50">
                    <Save size={14} />{saving ? 'Saving…' : editingOrg ? 'Update' : 'Add Organisation'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Organisations List */}
          <div className="px-6 py-4">
            {loading ? (
              <div className="py-10 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
              </div>
            ) : orgs.length === 0 ? (
              <div className="py-10 text-center">
                <Building2 size={32} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No client organisations yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Add your first client to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {orgs.map((org) => (
                  <div key={org.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-200 dark:border-slate-600">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                      <Building2 size={15} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-700 text-slate-900 dark:text-slate-100 truncate">{org.name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {org.contact_person && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <User size={10} />{org.contact_person}
                          </span>
                        )}
                        {org.contact_phone && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <Phone size={10} />{org.contact_phone}
                          </span>
                        )}
                        {org.contact_email && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <Mail size={10} />{org.contact_email}
                          </span>
                        )}
                      </div>
                      {org.notes && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{org.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(org)}
                        className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(org.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
