'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, Trash2, Save, X, Tag, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface TaskCategory {
  id: string;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
}

interface Props {
  onClose: () => void;
  onCategoriesChanged: () => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'];

export default function TaskCategoryManager({ onClose, onCategoriesChanged }: Props) {
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragItemRef = useRef<string | null>(null);
  const { user, effectiveUserId } = useAuth();
  const supabase = createClient();
  const channelRef = useRef<any>(null);

  useEffect(() => {
    fetchCategories();

    channelRef.current = supabase
      .channel('category-manager-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_categories' }, (payload) => {
        setCategories((prev) => {
          if (prev.find((c) => c.id === payload.new.id)) return prev;
          return [...prev, payload.new as TaskCategory].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'task_categories' }, (payload) => {
        setCategories((prev) =>
          prev.map((c) => c.id === payload.new.id ? { ...c, ...payload.new as TaskCategory } : c)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        );
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_categories' }, (payload) => {
        setCategories((prev) => prev.filter((c) => c.id !== payload.old.id));
      })
      .subscribe();

    return () => {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch {}
      }
    };
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_categories')
        .select('id, name, slug, color, sort_order')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setCategories((data || []).map((c) => ({ ...c, sort_order: c.sort_order ?? 0 })));
    } catch (err) {
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const slugify = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Try insert with created_by, fallback without it for PIN sessions
  const tryInsert = async (payload: Record<string, any>) => {
    const { data, error } = await supabase
      .from('task_categories')
      .insert(payload)
      .select()
      .single();
    if (error) {
      // Fallback: try without created_by (PIN session may not have auth.uid())
      const { created_by, ...rest } = payload;
      const { data: data2, error: error2 } = await supabase
        .from('task_categories')
        .insert(rest)
        .select()
        .single();
      if (error2) throw error2;
      return data2;
    }
    return data;
  };

  // Try update with fallback
  const tryUpdate = async (id: string, payload: Record<string, any>) => {
    const { error } = await supabase
      .from('task_categories')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  };

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('Category name is required'); return; }
    setSaving(true);
    try {
      const slug = slugify(newName);
      const maxOrder = categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order ?? 0)) : 0;
      const data = await tryInsert({
        name: newName.trim(),
        slug,
        color: newColor,
        sort_order: maxOrder + 1,
        created_by: effectiveUserId || user?.id,
      });
      setCategories((prev) => {
        if (prev.find((c) => c.id === data.id)) return prev;
        return [...prev, { ...data, sort_order: data.sort_order ?? maxOrder + 1 }].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      });
      setNewName('');
      setNewColor('#3b82f6');
      toast.success('Category created');
      onCategoriesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create category');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const slug = slugify(editName);
      await tryUpdate(id, { name: editName.trim(), slug, color: editColor, updated_at: new Date().toISOString() });
      setCategories((prev) =>
        prev.map((c) => c.id === id ? { ...c, name: editName.trim(), slug, color: editColor } : c)
      );
      setEditingId(null);
      toast.success('Category updated');
      onCategoriesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update category');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('task_categories').delete().eq('id', id);
      if (error) throw error;
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirmId(null);
      toast.success('Category deleted');
      onCategoriesChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete category');
    }
  };

  // Drag-to-reorder handlers
  const handleDragStart = (id: string) => {
    dragItemRef.current = id;
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };

  const handleDrop = async (targetId: string) => {
    const sourceId = dragItemRef.current;
    if (!sourceId || sourceId === targetId) {
      setDragOverId(null);
      return;
    }
    const sourceIdx = categories.findIndex((c) => c.id === sourceId);
    const targetIdx = categories.findIndex((c) => c.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) { setDragOverId(null); return; }

    const reordered = [...categories];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);

    // Assign new sort_order values
    const updated = reordered.map((c, i) => ({ ...c, sort_order: i }));
    setCategories(updated);
    setDragOverId(null);
    dragItemRef.current = null;

    // Persist new order
    try {
      for (const cat of updated) {
        await supabase.from('task_categories').update({ sort_order: cat.sort_order }).eq('id', cat.id);
      }
      onCategoriesChanged();
    } catch {
      toast.error('Failed to save order');
      fetchCategories(); // revert
    }
  };

  const handleDragEnd = () => {
    setDragOverId(null);
    dragItemRef.current = null;
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] sm:max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-violet-600" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Manage Categories</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        {/* Hint */}
        <div className="px-4 sm:px-6 pt-3 pb-1 flex-shrink-0">
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <GripVertical size={12} />
            Drag rows to reorder · tap <Edit2 size={11} className="inline" /> to edit · tap <Trash2 size={11} className="inline" /> to delete
          </p>
        </div>

        {/* Category List */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No categories yet. Add one below.</p>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                draggable
                onDragStart={() => handleDragStart(cat.id)}
                onDragOver={(e) => handleDragOver(e, cat.id)}
                onDrop={() => handleDrop(cat.id)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 sm:gap-3 p-3 rounded-xl border transition-all ${
                  dragOverId === cat.id
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]'
                    : 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600'
                }`}
              >
                {/* Drag handle */}
                <button
                  className="cursor-grab active:cursor-grabbing text-slate-300 dark:text-slate-600 hover:text-slate-500 flex-shrink-0 touch-none"
                  onTouchStart={() => handleDragStart(cat.id)}
                >
                  <GripVertical size={14} />
                </button>

                {editingId === cat.id ? (
                  <>
                    <div className="flex gap-1 flex-wrap flex-shrink-0">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${editColor === c ? 'border-slate-800 dark:border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(cat.id)}
                      className="flex-1 text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 min-w-0"
                      style={{ fontSize: '16px' }}
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveEdit(cat.id)}
                      disabled={saving}
                      className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    >
                      <Save size={13} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    >
                      <X size={13} className="text-slate-500" />
                    </button>
                  </>
                ) : deleteConfirmId === cat.id ? (
                  <>
                    <span className="flex-1 text-sm text-red-600 dark:text-red-400 font-medium">Delete "{cat.name}"?</span>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors min-h-[36px]"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-300 transition-colors min-h-[36px]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{cat.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono hidden sm:block flex-shrink-0">{cat.slug}</span>
                    <button
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditColor(cat.color); setDeleteConfirmId(null); }}
                      className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 hover:text-blue-600 transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label="Edit category"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => { setDeleteConfirmId(cat.id); setEditingId(null); }}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-600 transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label="Delete category"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add New */}
        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 flex-shrink-0">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">Add New Category</p>
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? 'border-slate-800 dark:border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Category name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="flex-1 text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 min-w-0"
              style={{ fontSize: '16px' }}
            />
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0 min-h-[44px]"
            >
              <Plus size={15} />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
