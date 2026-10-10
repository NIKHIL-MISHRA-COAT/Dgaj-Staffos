'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Plus, Hash, Users, Search, X, Smile, Paperclip, ChevronLeft, Loader2, Edit2, Trash2, Reply, Building2, UserPlus } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Channel {
  id: string;
  name: string;
  description: string;
  channel_type: string;
  department: string | null;
  created_by: string | null;
  scope?: 'company' | 'firm' | 'people';
  firm_id?: string | null;
  is_archived: boolean;
  created_at: string;
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
}

interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  file_url: string | null;
  file_name: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  created_at: string;
  sender?: { full_name: string; role: string; department: string };
  reply_to?: { content: string; sender?: { full_name: string } };
  reactions?: { emoji: string; count: number; reacted: boolean }[];
}

interface UserProfile {
  id: string;
  full_name: string;
  role: string;
  department: string;
  job_title?: string;
}

interface NewChannelForm {
  name: string;
  description: string;
  channel_type: string;
  department: string;
  scope: 'firm' | 'people';
  target_firm_ids: string[];
  member_ids: string[];
}

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '✅'];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function ChatPage() {
  const { user, pinSession, effectiveUserId } = useAuth();
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showMobileChannels, setShowMobileChannels] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const emptyChannelForm: NewChannelForm = { name: '', description: '', channel_type: 'general', department: '', scope: 'firm', target_firm_ids: [], member_ids: [] };
  const [newChannelForm, setNewChannelForm] = useState<NewChannelForm>(emptyChannelForm);
  const [memberSearch, setMemberSearch] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addFirmIds, setAddFirmIds] = useState<string[]>([]);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [existingMemberIds, setExistingMemberIds] = useState<string[]>([]);
  const [firmOptions, setFirmOptions] = useState<{ id: string; name: string; code: string }[]>([]);

  const uid = effectiveUserId;

  useEffect(() => {
    if (!uid) return;
    loadInitialData();
  }, [uid]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [profileRes, visibleRes] = await Promise.all([
        supabase.from('user_profiles').select('id, full_name, role, department, job_title, firm_id').eq('id', uid!).single(),
        supabase.rpc('get_visible_firm_ids', { p_user_id: uid, p_module: 'chat' }),
      ]);
      const role = profileRes.data?.role || '';
      const visibleFirmIds = (visibleRes.data as string[] | null) || null;
      const isDirectorUser = role === 'director';

      let usersQuery = supabase.from('user_profiles').select('id, full_name, role, department, job_title, firm_id').order('full_name');
      if (visibleFirmIds) usersQuery = usersQuery.in('firm_id', visibleFirmIds);

      // Channels: company-wide, channels of your firm, and channels you were added to.
      // Directors see every channel.
      let channelsQuery = supabase.from('chat_channels').select('*').eq('is_archived', false).order('created_at');
      if (!isDirectorUser) {
        const [memberRes] = await Promise.all([
          supabase.from('chat_channel_members').select('channel_id').eq('user_id', uid!),
        ]);
        const memberIds = (memberRes.data || []).map((r: any) => r.channel_id as string);
        const clauses = ['scope.eq.company', `created_by.eq.${uid}`];
        if (visibleFirmIds && visibleFirmIds.length > 0) {
          clauses.push(`and(scope.eq.firm,firm_id.in.(${visibleFirmIds.join(',')}))`);
        }
        if (memberIds.length > 0) clauses.push(`id.in.(${memberIds.join(',')})`);
        channelsQuery = channelsQuery.or(clauses.join(','));
      }

      const [usersRes, firmsRes, channelsRes] = await Promise.all([
        usersQuery,
        supabase.from('firms').select('id, name, code').eq('is_active', true).order('name'),
        channelsQuery,
      ]);

      if (profileRes.data) setCurrentUser(profileRes.data as UserProfile);
      if (usersRes.data) setUsers(usersRes.data);
      if (firmsRes.data) {
        setFirmOptions(firmsRes.data.filter((f: any) => !visibleFirmIds || visibleFirmIds.includes(f.id)));
      }
      if (channelsRes.error) {
        console.error('Channel load error:', channelsRes.error);
        toast.error(`Could not load channels: ${channelsRes.error.message}`);
      }
      if (channelsRes.data) {
        setChannels(channelsRes.data);
        if (channelsRes.data.length > 0) {
          setActiveChannel(channelsRes.data[0]);
        }
      }
    } catch (err) {
      console.error('Chat load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeChannel) return;
    loadMessages(activeChannel.id);

    // Real-time subscription
    const channel = supabase
      .channel(`chat-${activeChannel.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `channel_id=eq.${activeChannel.id}`,
      }, async (payload) => {
        const newMsg = payload.new as Message;
        // Fetch sender info
        const { data: senderData } = await supabase
          .from('user_profiles')
          .select('full_name, role, department')
          .eq('id', newMsg.sender_id)
          .single();
        setMessages(prev => {
          // Already have it — either our own optimistic message already got
          // swapped for the real row, or this is a duplicate delivery.
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, { ...newMsg, sender: senderData || undefined }];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `channel_id=eq.${activeChannel.id}`,
      }, (payload) => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_messages',
        filter: `channel_id=eq.${activeChannel.id}`,
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeChannel?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async (channelId: string) => {
    setLoadingMessages(true);
    try {
      // Load messages first. The reply lookup is separate, so the channel still
      // loads even if the reply relationship is missing from the API schema cache.
      const { data, error } = await supabase
        .from('chat_messages')
        .select(`
          *,
          sender:user_profiles!chat_messages_sender_id_fkey(full_name, role, department)
        `)
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;

      const rows = (data || []) as any[];
      const replyIds = Array.from(new Set(rows.map((r) => r.reply_to_id).filter(Boolean))) as string[];
      const replyMap = new Map<string, { content: string; sender?: { full_name: string } }>();
      if (replyIds.length > 0) {
        const { data: replies } = await supabase
          .from('chat_messages')
          .select('id, content, sender:user_profiles!chat_messages_sender_id_fkey(full_name)')
          .in('id', replyIds);
        (replies || []).forEach((r: any) => replyMap.set(r.id, { content: r.content, sender: r.sender }));
      }

      setMessages(rows.map((r) => ({
        ...r,
        reply_to: r.reply_to_id ? replyMap.get(r.reply_to_id) : undefined,
      })));
    } catch (err: any) {
      console.error('Load messages error:', err);
      toast.error(err.message || 'Failed to load messages for this channel');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSend = async () => {
    const text = editingMessage ? messageText : messageText.trim();
    if (!text || !activeChannel || !uid) return;
    setSending(true);
    try {
      if (editingMessage) {
        const { error } = await supabase.from('chat_messages').update({
          content: text,
          is_edited: true,
          edited_at: new Date().toISOString(),
        }).eq('id', editingMessage.id);
        if (error) throw error;
        // Realtime UPDATE handler will sync this, but update locally too in
        // case realtime is slow — never leave the UI showing stale content.
        setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, content: text, is_edited: true } : m));
        setEditingMessage(null);
      } else {
        const tempId = `temp-${Date.now()}`;
        const optimisticMsg: Message = {
          id: tempId,
          channel_id: activeChannel.id,
          sender_id: uid,
          content: text,
          message_type: 'text',
          file_url: null,
          file_name: null,
          reply_to_id: replyTo?.id || null,
          created_at: new Date().toISOString(),
          is_edited: false,
          sender: currentUser ? { full_name: currentUser.full_name, role: currentUser.role, department: currentUser.department } : undefined,
        } as Message;
        // Show it immediately — don't make the sender wait on a realtime
        // round-trip just to see their own message.
        setMessages(prev => [...prev, optimisticMsg]);
        setMessageText('');
        setReplyTo(null);

        const { data: inserted, error } = await supabase.from('chat_messages').insert({
          channel_id: activeChannel.id,
          sender_id: uid,
          content: text,
          message_type: 'text',
          reply_to_id: replyTo?.id || null,
        }).select().single();
        if (error) {
          // Roll back the optimistic message and restore what they typed.
          setMessages(prev => prev.filter(m => m.id !== tempId));
          setMessageText(text);
          throw error;
        }
        // Swap the temp message for the real one (real id, exact server
        // timestamp) — if the realtime event also arrives, the dedupe below
        // in the INSERT handler prevents a duplicate.
        if (inserted) {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...inserted, sender: optimisticMsg.sender } : m));
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await supabase.from('chat_messages').delete().eq('id', msgId);
    } catch (err: any) {
      toast.error('Failed to delete message');
    }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    if (!uid) return;
    try {
      const { error } = await supabase.from('chat_reactions').upsert({
        message_id: msgId,
        user_id: uid,
        emoji,
      }, { onConflict: 'message_id,user_id,emoji' });
      if (error) throw error;
      setShowEmojiPicker(null);
    } catch {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChannel || !uid) return;
    if (file.size > 20 * 1024 * 1024) { toast.error('File must be under 20MB'); return; }
    setUploadingFile(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `chat/${activeChannel.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
      await supabase.from('chat_messages').insert({
        channel_id: activeChannel.id,
        sender_id: uid,
        content: file.name,
        message_type: 'file',
        file_url: urlData.publicUrl,
        file_name: file.name,
      });
      toast.success('File shared');
    } catch (err: any) {
      toast.error('Failed to upload file');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateChannel = async () => {
    const f = newChannelForm;
    if (!f.name.trim() || !uid) return;
    if (f.scope === 'firm' && f.target_firm_ids.length === 0) { toast.error('Select at least one firm'); return; }
    if (f.scope === 'people' && f.member_ids.length === 0) { toast.error('Select at least one employee'); return; }
    try {
      const { data: creatorProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', uid).single();
      const base = {
        name: f.name.trim(),
        description: f.description,
        channel_type: f.channel_type,
        department: f.department || null,
        created_by: uid,
      };

      // One channel per firm, so each firm's employees see it in their own firm's list
      const rows = f.scope === 'firm'
        ? f.target_firm_ids.map((firmId) => ({ ...base, scope: 'firm', firm_id: firmId }))
        : [{ ...base, scope: 'people', firm_id: creatorProfile?.firm_id || null }];

      const { data, error } = await supabase.from('chat_channels').insert(rows).select();
      if (error) throw error;
      const created = (data || []) as Channel[];
      if (created.length === 0) throw new Error('Channel was not created');

      if (f.scope === 'people') {
        const memberRows = Array.from(new Set([uid, ...f.member_ids])).map((user_id) => ({
          channel_id: created[0].id,
          user_id,
          role: user_id === uid ? 'admin' : 'member',
        }));
        const { error: memberErr } = await supabase.from('chat_channel_members').insert(memberRows);
        if (memberErr) throw memberErr;
      }

      setChannels(prev => [...prev, ...created]);
      setActiveChannel(created[0]);
      setShowNewChannel(false);
      setNewChannelForm(emptyChannelForm);
      setMemberSearch('');
      toast.success(created.length > 1 ? `${created.length} channels created (one per firm)` : 'Channel created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create channel');
    }
  };

  const openAddMembers = async () => {
    if (!activeChannel) return;
    const { data } = await supabase.from('chat_channel_members').select('user_id').eq('channel_id', activeChannel.id);
    setExistingMemberIds((data || []).map((r: any) => r.user_id as string));
    setAddFirmIds([]);
    setAddMemberIds([]);
    setAddSearch('');
    setShowAddMembers(true);
  };

  const handleAddMembers = async () => {
    if (!activeChannel || !uid) return;
    const newMembers = addMemberIds.filter((id) => !existingMemberIds.includes(id) && id !== uid);
    if (addFirmIds.length === 0 && newMembers.length === 0) { toast.error('Pick a firm or an employee'); return; }
    setAddSaving(true);
    try {
      let createdChannels: Channel[] = [];
      if (addFirmIds.length > 0) {
        // Another firm gets its own copy of this channel, so its employees see it in their list
        const rows = addFirmIds.map((firmId) => ({
          name: activeChannel.name,
          description: activeChannel.description,
          channel_type: activeChannel.channel_type,
          department: activeChannel.department,
          scope: 'firm',
          firm_id: firmId,
          created_by: uid,
        }));
        const { data, error } = await supabase.from('chat_channels').insert(rows).select();
        if (error) throw error;
        createdChannels = (data || []) as Channel[];
      }
      if (newMembers.length > 0) {
        const { error } = await supabase.from('chat_channel_members').insert(
          newMembers.map((user_id) => ({ channel_id: activeChannel.id, user_id, role: 'member' }))
        );
        if (error) throw error;
      }
      if (createdChannels.length > 0) setChannels((prev) => [...prev, ...createdChannels]);
      setShowAddMembers(false);
      toast.success('Channel updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update channel');
    } finally {
      setAddSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Directors and managers create channels
  const canCreateChannel = ['director', 'manager'].includes(currentUser?.role || '');

  const filteredChannels = channels.filter(c =>
    !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const channelTypeIcon = (type: string) => {
    if (type === 'department') return <Building2 size={14} className="text-slate-400" />;
    if (type === 'direct') return <Users size={14} className="text-slate-400" />;
    return <Hash size={14} className="text-slate-400" />;
  };

  if (loading) {
    return (
              <div className="flex items-center justify-center h-full min-h-[60vh]">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
    );
  }

  return (
    <>
          <Toaster position="bottom-right" richColors />
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-white dark:bg-slate-900">
        {/* Sidebar: Channels */}
        <div className={`${showMobileChannels ? 'flex' : 'hidden'} lg:flex flex-col w-full lg:w-72 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-blue-600" />
              <h2 className="text-sm font-700 text-slate-900 dark:text-slate-100">Channels</h2>
            </div>
            {canCreateChannel && (
              <button onClick={() => setShowNewChannel(true)}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                <Plus size={16} className="text-slate-600 dark:text-slate-400" />
              </button>
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search channels…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Channel List */}
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {filteredChannels.map(channel => (
              <button
                key={channel.id}
                onClick={() => { setActiveChannel(channel); setShowMobileChannels(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-0.5 text-left transition-colors ${
                  activeChannel?.id === channel.id
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {channelTypeIcon(channel.channel_type)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-600 truncate">{channel.name}</p>
                  {channel.description && (
                    <p className="text-[10px] text-slate-400 truncate">{channel.description}</p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Current User */}
          {currentUser && (
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-700 text-white">{currentUser.full_name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-600 text-slate-900 dark:text-slate-100 truncate">{currentUser.full_name}</p>
                  <p className="text-[10px] text-slate-400 truncate capitalize">{currentUser.role}</p>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              </div>
            </div>
          )}
        </div>

        {/* Main Chat Area */}
        <div className={`${!showMobileChannels ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-w-0`}>
          {activeChannel ? (
            <>
              {/* Channel Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <button onClick={() => setShowMobileChannels(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                  <ChevronLeft size={18} className="text-slate-600 dark:text-slate-400" />
                </button>
                {channelTypeIcon(activeChannel.channel_type)}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-700 text-slate-900 dark:text-slate-100">{activeChannel.name}</h3>
                  {activeChannel.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{activeChannel.description}</p>
                  )}
                </div>
                {canCreateChannel && (
                  <button onClick={openAddMembers} title="Add firm or employees"
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <UserPlus size={15} className="text-slate-600 dark:text-slate-400" />
                  </button>
                )}
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Users size={13} />
                  <span>{users.length}</span>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={20} className="animate-spin text-blue-500" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                    <MessageSquare size={40} className="mb-3 opacity-30" />
                    <p className="text-sm font-500">No messages yet</p>
                    <p className="text-xs mt-1">Be the first to say something!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isOwn = msg.sender_id === uid;
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showSender = !prevMsg || prevMsg.sender_id !== msg.sender_id ||
                      (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) > 5 * 60 * 1000;

                    return (
                      <div key={msg.id} className={`group flex gap-2.5 ${isOwn ? 'flex-row-reverse' : ''} ${showSender ? 'mt-3' : 'mt-0.5'}`}>
                        {/* Avatar */}
                        {showSender && (
                          <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-700 text-white ${isOwn ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
                            {(msg.sender?.full_name || 'U').charAt(0)}
                          </div>
                        )}
                        {!showSender && <div className="w-8 flex-shrink-0" />}

                        <div className={`flex flex-col max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                          {showSender && (
                            <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                              <span className="text-xs font-600 text-slate-700 dark:text-slate-300">
                                {isOwn ? 'You' : (msg.sender?.full_name || 'Unknown')}
                              </span>
                              <span className="text-[10px] text-slate-400">{formatMessageTime(msg.created_at)}</span>
                            </div>
                          )}

                          {/* Reply preview */}
                          {msg.reply_to && (
                            <div className={`mb-1 px-2.5 py-1.5 rounded-lg border-l-2 border-blue-400 bg-slate-100 dark:bg-slate-700 text-xs text-slate-500 dark:text-slate-400 max-w-full ${isOwn ? 'text-right' : ''}`}>
                              <span className="font-600 text-blue-600 dark:text-blue-400">{(msg.reply_to as any).sender?.full_name || 'Unknown'}: </span>
                              <span className="truncate">{(msg.reply_to as any).content?.slice(0, 80)}</span>
                            </div>
                          )}

                          {/* Message bubble */}
                          <div className={`relative px-3 py-2 rounded-2xl text-sm ${
                            isOwn
                              ? 'bg-blue-600 text-white rounded-tr-sm' :'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm'
                          }`}>
                            {msg.message_type === 'file' ? (
                              <a href={msg.file_url || '#'} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-2 hover:underline">
                                <Paperclip size={13} />
                                <span className="text-xs">{msg.file_name || msg.content}</span>
                              </a>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            )}
                            {msg.is_edited && (
                              <span className={`text-[10px] ${isOwn ? 'text-blue-200' : 'text-slate-400'} ml-1`}>(edited)</span>
                            )}
                          </div>

                          {/* Time for non-sender-header messages */}
                          {!showSender && (
                            <span className="text-[10px] text-slate-400 mt-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {formatMessageTime(msg.created_at)}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-center ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <button onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
                            <Smile size={13} />
                          </button>
                          <button onClick={() => { setReplyTo(msg); messageInputRef.current?.focus(); }}
                            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
                            <Reply size={13} />
                          </button>
                          {isOwn && (
                            <>
                              <button onClick={() => { setEditingMessage(msg); setMessageText(msg.content); messageInputRef.current?.focus(); }}
                                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => handleDeleteMessage(msg.id)}
                                className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>

                        {/* Emoji picker */}
                        {showEmojiPicker === msg.id && (
                          <div className={`absolute z-20 flex gap-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg ${isOwn ? 'right-12' : 'left-12'}`}
                            style={{ top: '0' }}>
                            {EMOJIS.map(emoji => (
                              <button key={emoji} onClick={() => handleReaction(msg.id, emoji)}
                                className="text-lg hover:scale-125 transition-transform">
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply/Edit Banner */}
              {(replyTo || editingMessage) && (
                <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-600 text-blue-700 dark:text-blue-400">
                      {editingMessage ? '✏️ Editing message' : `↩️ Replying to ${replyTo?.sender?.full_name || 'message'}`}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {(editingMessage || replyTo)?.content?.slice(0, 80)}
                    </p>
                  </div>
                  <button onClick={() => { setReplyTo(null); setEditingMessage(null); setMessageText(''); }}
                    className="p-1 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                    <X size={14} className="text-blue-600 dark:text-blue-400" />
                  </button>
                </div>
              )}

              {/* Input Area */}
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <div className="flex items-end gap-2">
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0">
                    {uploadingFile ? <Loader2 size={18} className="animate-spin text-blue-500" /> : <Paperclip size={18} className="text-slate-400" />}
                  </button>
                  <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
                  <div className="flex-1 relative">
                    <textarea
                      ref={messageInputRef}
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Message #${activeChannel.name}…`}
                      rows={1}
                      className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none max-h-32 overflow-y-auto"
                      style={{ minHeight: '42px' }}
                    />
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sending}
                    className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
                  >
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 px-1">Press Enter to send · Shift+Enter for new line</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-400">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p className="text-sm font-500">Select a channel to start chatting</p>
            </div>
          )}
        </div>
      </div>

      {/* New Channel Modal */}
      {showNewChannel && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Create Channel</h3>
              <button onClick={() => setShowNewChannel(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Channel Name *</label>
                <input type="text" placeholder="e.g. project-updates" value={newChannelForm.name}
                  onChange={e => setNewChannelForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                <input type="text" placeholder="What is this channel about?" value={newChannelForm.description}
                  onChange={e => setNewChannelForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Type</label>
                <select value={newChannelForm.channel_type}
                  onChange={e => setNewChannelForm(p => ({ ...p, channel_type: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="general">General</option>
                  <option value="department">Department</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Visible to *</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: 'firm', label: 'A firm' },
                    { id: 'people', label: 'Selected employees' },
                  ] as const).map((o) => (
                    <button key={o.id} type="button"
                      onClick={() => setNewChannelForm(p => ({ ...p, scope: o.id }))}
                      className={`py-2 rounded-xl border text-xs font-600 transition-colors ${newChannelForm.scope === o.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {newChannelForm.scope === 'firm' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-600 text-slate-700 dark:text-slate-300">Firms * ({newChannelForm.target_firm_ids.length} selected)</label>
                    <button type="button"
                      onClick={() => setNewChannelForm(p => ({
                        ...p,
                        target_firm_ids: p.target_firm_ids.length === firmOptions.length ? [] : firmOptions.map((f) => f.id),
                      }))}
                      className="text-xs font-600 text-blue-600 hover:text-blue-700">
                      {newChannelForm.target_firm_ids.length === firmOptions.length && firmOptions.length > 0 ? 'Clear all' : 'Select all firms'}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-xl divide-y divide-slate-100 dark:divide-slate-700">
                    {firmOptions.length === 0 && (
                      <p className="px-3 py-3 text-sm text-slate-500">No firms available</p>
                    )}
                    {firmOptions.map((f) => {
                      const checked = newChannelForm.target_firm_ids.includes(f.id);
                      return (
                        <label key={f.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                          <input type="checkbox" checked={checked}
                            onChange={() => setNewChannelForm(p => ({
                              ...p,
                              target_firm_ids: checked ? p.target_firm_ids.filter((id) => id !== f.id) : [...p.target_firm_ids, f.id],
                            }))}
                            className="accent-blue-600" />
                          <span className="text-sm text-slate-800 dark:text-slate-200">{f.name}</span>
                          <span className="text-xs text-slate-500 ml-auto">{f.code}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Everyone in each selected firm will see the channel.</p>
                </div>
              )}
              {newChannelForm.scope === 'people' && (
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Employees * ({newChannelForm.member_ids.length} selected)</label>
                  <input type="text" placeholder="Search by name or firm…" value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-xl divide-y divide-slate-100 dark:divide-slate-700">
                    {users
                      .filter((u) => u.id !== uid)
                      .filter((u) => {
                        const q = memberSearch.trim().toLowerCase();
                        if (!q) return true;
                        const firm = firmOptions.find((f) => f.id === (u as any).firm_id)?.name || '';
                        return u.full_name.toLowerCase().includes(q) || firm.toLowerCase().includes(q);
                      })
                      .map((u) => {
                        const checked = newChannelForm.member_ids.includes(u.id);
                        const firm = firmOptions.find((f) => f.id === (u as any).firm_id)?.name;
                        return (
                          <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                            <input type="checkbox" checked={checked}
                              onChange={() => setNewChannelForm(p => ({
                                ...p,
                                member_ids: checked ? p.member_ids.filter((id) => id !== u.id) : [...p.member_ids, u.id],
                              }))}
                              className="accent-blue-600" />
                            <span className="text-sm text-slate-800 dark:text-slate-200">{u.full_name}</span>
                            {firm && <span className="text-xs text-slate-500 ml-auto">{firm}</span>}
                          </label>
                        );
                      })}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Only the people you pick (and you) will see this channel.</p>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setShowNewChannel(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateChannel}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-600 transition-colors">
                Create Channel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add firm / employees to this channel */}
      {showAddMembers && activeChannel && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Add to #{activeChannel.name}</h3>
              <button onClick={() => setShowAddMembers(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Add another firm ({addFirmIds.length} selected)</label>
                <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-xl divide-y divide-slate-100 dark:divide-slate-700">
                  {firmOptions
                    .filter((f) => !channels.some((c) => c.name === activeChannel.name && c.scope === 'firm' && c.firm_id === f.id))
                    .map((f) => {
                      const checked = addFirmIds.includes(f.id);
                      return (
                        <label key={f.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                          <input type="checkbox" checked={checked} className="accent-blue-600"
                            onChange={() => setAddFirmIds(p => checked ? p.filter((id) => id !== f.id) : [...p, f.id])} />
                          <span className="text-sm text-slate-800 dark:text-slate-200">{f.name}</span>
                          <span className="text-xs text-slate-500 ml-auto">{f.code}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Add employees ({addMemberIds.length} selected)</label>
                <input type="text" placeholder="Search by name or firm…" value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-2 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-xl divide-y divide-slate-100 dark:divide-slate-700">
                  {users
                    .filter((u) => u.id !== uid && !existingMemberIds.includes(u.id))
                    .filter((u) => {
                      const q = addSearch.trim().toLowerCase();
                      if (!q) return true;
                      const firm = firmOptions.find((f) => f.id === (u as any).firm_id)?.name || '';
                      return u.full_name.toLowerCase().includes(q) || firm.toLowerCase().includes(q);
                    })
                    .map((u) => {
                      const checked = addMemberIds.includes(u.id);
                      const firm = firmOptions.find((f) => f.id === (u as any).firm_id)?.name;
                      return (
                        <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                          <input type="checkbox" checked={checked} className="accent-blue-600"
                            onChange={() => setAddMemberIds(p => checked ? p.filter((id) => id !== u.id) : [...p, u.id])} />
                          <span className="text-sm text-slate-800 dark:text-slate-200">{u.full_name}</span>
                          {firm && <span className="text-xs text-slate-500 ml-auto">{firm}</span>}
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setShowAddMembers(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleAddMembers} disabled={addSaving}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-600 transition-colors">
                {addSaving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}