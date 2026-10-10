'use client';

import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import AppLogo from '@/components/ui/AppLogo';
import { Mail, Eye, EyeOff, Shield, Clock, ChevronRight, AlertCircle, Building2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

type Step = 'email' | 'pin';

const roleRoutes: Record<string, string> = {
  employee: '/employee-dashboard',
  manager: '/employee-dashboard',
  executive: '/employee-dashboard',
  director: '/director-control-panel',
};

export default function LoginForm() {
  const router = useRouter();
  const { savePinSession, getPinSession, clearPinSession } = useAuth();
  const supabase = createClient();

  const [step, setStep] = useState<Step>('email');
  const [emailValue, setEmailValue] = useState('');
  const [pinValues, setPinValues] = useState(['', '', '', '']);
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [hasPinSession, setHasPinSession] = useState(false);
  const [pinSessionData, setPinSessionData] = useState<any>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const existing = getPinSession();
    if (existing?.email && existing?.role) {
      setHasPinSession(true);
      setPinSessionData(existing);
      setEmailValue(existing.email);
      setStep('pin');
    }
    setCheckingSession(false);
  }, []);

  const handleEmailContinue = () => {
    if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setAuthError('Please enter a valid email address');
      return;
    }
    setAuthError(null);
    setStep('pin');
    setTimeout(() => pinRefs.current[0]?.focus(), 100);
  };

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pinValues];
    newPin[index] = value.slice(-1);
    setPinValues(newPin);
    if (value && index < 3) pinRefs.current[index + 1]?.focus();
    if (newPin.every((v) => v !== '') && newPin.join('').length === 4) {
      handleVerifyPin(newPin.join(''));
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinValues[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyPin = async (pin: string) => {
    setIsLoading(true);
    setAuthError(null);

    const fail = (message: string) => {
      setAuthError(message);
      setIsLoading(false);
      setPinValues(['', '', '', '']);
      pinRefs.current[0]?.focus();
    };

    try {
      const email = (emailValue || pinSessionData?.email || '').trim().toLowerCase();
      if (!email) {
        fail('Please enter your email address.');
        return;
      }

      // The PIN is checked on the server, which also returns a one-time login token
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pin-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email, pin }),
      });
      const result = await res.json().catch(() => ({} as any));
      if (!res.ok || !result.token_hash) {
        fail(result.error || 'Unable to sign in. Please try again.');
        return;
      }

      // Exchange the token for a normal Supabase session
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: result.token_hash,
        type: 'magiclink',
      });
      if (sessionError) {
        console.error('Session error:', sessionError);
        fail('Could not start your session. Please try again.');
        return;
      }

      // Keep the local PIN session so the rest of the app behaves as before
      savePinSession(result.role, result.department || '', '', email, result.user_id);

      toast.success(`Welcome back, ${result.full_name || email}!`, { duration: 2000 });

      const route = roleRoutes[result.role] || '/employee-dashboard';
      setTimeout(() => router.push(route), 800);
    } catch (err: any) {
      console.error('Login error:', err);
      fail('Something went wrong. Please try again.');
    }
  };

  const handleSwitchAccount = () => {
    clearPinSession();
    setHasPinSession(false);
    setPinSessionData(null);
    setStep('email');
    setEmailValue('');
    setPinValues(['', '', '', '']);
    setAuthError(null);
  };

  const goBackToEmail = () => {
    if (!hasPinSession) {
      setStep('email');
      setPinValues(['', '', '', '']);
      setAuthError(null);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <Toaster position="bottom-right" richColors />

      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] bg-gradient-to-br from-blue-700 via-blue-800 to-slate-900 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-blue-600/20" />
          <div className="absolute bottom-[-120px] left-[-60px] w-[500px] h-[500px] rounded-full bg-blue-900/40" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="bg-white rounded-xl p-1.5"><AppLogo size={32} /></div>
            <span className="text-white font-bold text-xl tracking-tight">DGaj Connect</span>
          </div>
          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-6">
            Your workforce,<br /><span className="text-blue-300">fully accountable.</span>
          </h1>
          <p className="text-blue-200 text-lg leading-relaxed max-w-md">
            Replace WhatsApp groups and Excel sheets with a structured, trackable system your entire team will actually use.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-2 gap-3">
          {[
            { icon: Clock, label: 'Attendance Tracking', desc: 'GPS + auto-detection' },
            { icon: CheckCircle2, label: 'Task Management', desc: 'Checklists & deadlines' },
            { icon: Shield, label: 'Role-Based Access', desc: 'Director / Manager / Staff' },
            { icon: Building2, label: 'Cross-Dept Tasks', desc: 'Assign across teams' },
          ].map((f) => {
            const FIcon = f.icon;
            return (
              <div key={`feature-${f.label}`} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <FIcon size={20} className="text-blue-300 mb-2" />
                <p className="text-white text-sm font-semibold">{f.label}</p>
                <p className="text-blue-300 text-xs mt-0.5">{f.desc}</p>
              </div>
            );
          })}
        </div>
        <p className="relative z-10 text-blue-400 text-xs mt-6">Trusted by 1,200+ companies across India</p>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 py-8 sm:py-12 bg-slate-50 overflow-y-auto min-h-screen lg:min-h-0">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8">
            <AppLogo size={36} />
            <span className="font-bold text-slate-900 text-lg">DGaj Connect</span>
          </div>

          {/* Returning user banner */}
          {hasPinSession && pinSessionData && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 bg-blue-600">
                {pinSessionData.email?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{pinSessionData.email}</p>
                <p className="text-xs text-slate-500 capitalize">{pinSessionData.role} · Enter PIN to continue</p>
              </div>
              <button onClick={handleSwitchAccount} className="text-xs text-blue-600 hover:underline font-medium flex-shrink-0">
                Switch
              </button>
            </div>
          )}

          {/* Step indicator */}
          {!hasPinSession && (
            <div className="flex items-center gap-2 mb-6">
              {step === 'pin' && (
                <button onClick={goBackToEmail} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-700 mr-1">
                  <ChevronRight size={18} className="rotate-180" />
                </button>
              )}
              <div className="flex items-center gap-1.5">
                {[1, 2].map((n) => (
                  <div key={`step-${n}`} className={`h-1.5 rounded-full transition-all duration-300 ${n <= (step === 'email' ? 1 : 2) ? 'bg-blue-600 w-6' : 'bg-slate-200 w-4'}`} />
                ))}
              </div>
              <span className="text-xs text-slate-500 ml-1">{step === 'email' ? 'Email Address' : 'Enter PIN'}</span>
            </div>
          )}

          {/* Step 1: Email */}
          {step === 'email' && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
              <p className="text-sm text-slate-500 mb-6">Enter your work email to continue</p>
              <div className="space-y-4">
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={emailValue}
                    onChange={(e) => { setEmailValue(e.target.value); setAuthError(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleEmailContinue()}
                    placeholder="you@company.com"
                    className="w-full text-sm pl-10 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 bg-white"
                    autoFocus
                  />
                </div>
                {authError && (
                  <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle size={13} /> {authError}
                  </div>
                )}
                <button
                  onClick={handleEmailContinue}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
              <p className="text-xs text-slate-400 text-center mt-6">
                Your role is assigned by your Director. Contact them if you need access.
              </p>
            </div>
          )}

          {/* Step 2: PIN */}
          {step === 'pin' && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Enter your PIN</h2>
              <p className="text-sm text-slate-500 mb-2">Your 4-digit PIN is assigned by your Director</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-6 flex items-start gap-2">
                <Shield size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  PINs are set and managed by the Director in User Management. Contact your Director if you need your PIN reset.
                </p>
              </div>
              <div className="flex gap-3 justify-center mb-4">
                {pinValues.map((val, i) => (
                  <input
                    key={`pin-${i}`}
                    ref={(el) => { pinRefs.current[i] = el; }}
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={1}
                    value={val}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    className="w-14 h-14 text-center text-xl font-bold border-2 border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white text-slate-900"
                  />
                ))}
              </div>
              <div className="flex items-center justify-center gap-2 mb-4">
                <button onClick={() => setShowPin(!showPin)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide PIN' : 'Show PIN'}
                </button>
              </div>
              {authError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  <AlertCircle size={13} /> {authError}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center justify-center gap-2 text-blue-600 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  Verifying…
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}