'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const AuthContext = createContext<any>({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

const PIN_SESSION_KEY = 'dgaj_pin_session';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pinSession, setPinSession] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Restore PIN session from localStorage
    try {
      const stored = localStorage.getItem(PIN_SESSION_KEY);
      if (stored) setPinSession(JSON.parse(stored));
    } catch {}

    return () => subscription.unsubscribe();
  }, []);

  // Send email OTP
  const sendEmailOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    });
    if (error) throw error;
  };

  // Verify email OTP
  const verifyEmailOtp = async (email: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw error;
    return data;
  };

  // Google Sign In
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    });
    if (error) throw error;
  };

  // Save PIN session — persists across browser sessions until explicit logout
  const savePinSession = (
    role: string,
    department: string,
    jobTitle: string,
    email: string,
    userId: string
  ) => {
    const sessionData = {
      role,
      department,
      jobTitle,
      email,
      userId,
      createdAt: Date.now(),
    };
    try {
      localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(sessionData));
    } catch {}
    setPinSession(sessionData);
  };

  // Get PIN session
  const getPinSession = () => {
    try {
      const stored = localStorage.getItem(PIN_SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  // Clear PIN session on logout
  const clearPinSession = () => {
    try {
      localStorage.removeItem(PIN_SESSION_KEY);
    } catch {}
    setPinSession(null);
  };

  // Sign Out — clears PIN session and Supabase session
  const signOut = async () => {
    clearPinSession();
    try {
      await supabase.auth.signOut();
    } catch {}
  };

  // Get Current User
  const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  };

  // Get User Profile from Database
  const getUserProfile = async () => {
    const uid = user?.id || pinSession?.userId;
    if (!uid) return null;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', uid)
      .single();
    if (error) throw error;
    return data;
  };

  // Update User Profile
  const updateUserProfile = async (updates: any) => {
    const uid = user?.id || pinSession?.userId;
    if (!uid) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', uid)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  // Upload employee document
  const uploadDocument = async (file: File, documentName: string, documentType: string) => {
    const uid = user?.id || pinSession?.userId;
    if (!uid) throw new Error('Not authenticated');
    const fileExt = file.name.split('.').pop();
    const filePath = `${uid}/${Date.now()}_${documentName.replace(/\s+/g, '_')}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('employee-documents')
      .upload(filePath, file, { upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('employee-documents')
      .getPublicUrl(filePath);

    const { data, error } = await supabase
      .from('employee_documents')
      .insert({
        user_id: uid,
        document_name: documentName,
        document_type: documentType,
        file_path: filePath,
        file_url: publicUrl,
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  // Get employee documents
  const getDocuments = async () => {
    const uid = user?.id || pinSession?.userId;
    if (!uid) return [];
    const { data, error } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('user_id', uid)
      .order('uploaded_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  const value = {
    user,
    session,
    loading,
    pinSession,
    sendEmailOtp,
    verifyEmailOtp,
    signInWithGoogle,
    savePinSession,
    getPinSession,
    clearPinSession,
    signOut,
    getCurrentUser,
    getUserProfile,
    updateUserProfile,
    uploadDocument,
    getDocuments,
    effectiveUserId: user?.id || (pinSession?.userId ?? null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
