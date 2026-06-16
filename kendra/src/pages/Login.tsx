import { useState } from 'react';
import { Sprout } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';
import { useToast } from '../lib/toast';

export default function LoginPage() {
  const { sendOtp, verifyOtp } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await sendOtp(phone.trim());
      setStep('otp');
      if (res?.devOtp) {
        setDevOtp(res.devOtp);
        setOtp(res.devOtp);
        toast.success(`Dev OTP: ${res.devOtp}`);
      } else {
        setDevOtp(null);
        toast.success('OTP sent to your phone');
      }
    } catch (e2) {
      setErr(errorMessage(e2, 'Could not send OTP. Check the number and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await verifyOtp(phone.trim(), otp.trim());
    } catch (e2) {
      setErr(errorMessage(e2, 'Invalid OTP. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-white"><Sprout className="h-6 w-6" /></div>
          <h1 className="text-lg font-semibold text-slate-900">Krushi Seva Kendra</h1>
          <p className="text-sm text-slate-500">Partner portal — sign in to register your Kendra and respond to farmers' crop reports.</p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={onSend} className="space-y-4">
            <Field label="Phone number">
              <Input inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
            </Field>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={phone.trim().length < 10}>Send OTP</Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            {devOtp && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                Dev OTP: <span className="font-mono text-base font-semibold tracking-widest">{devOtp}</span> <span className="text-xs">(auto-filled)</span>
              </div>
            )}
            <Field label={`Enter the OTP sent to ${phone}`}>
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value)} autoFocus />
            </Field>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={otp.trim().length !== 6}>Verify & sign in</Button>
            <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-700" onClick={() => { setStep('phone'); setOtp(''); setErr(null); }}>
              Use a different number
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
