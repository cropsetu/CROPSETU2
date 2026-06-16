import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Upload, FileCheck2 } from 'lucide-react';
import { apiPost, apiUploadFiles, errorMessage } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { KENDRA_ME_KEY } from '../lib/useKendra';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Layout } from '../components/Layout';
import { Button, Card, Field, Input, Select } from '../components/ui';
import type { KendraStatus } from '../lib/types';

const BUSINESS_TYPES = [
  { value: 'krushi_kendra', label: 'Krushi Seva Kendra' },
  { value: 'agri_input_shop', label: 'Agri-input shop' },
  { value: 'fertilizer_dealer', label: 'Fertilizer dealer' },
  { value: 'pesticide_dealer', label: 'Pesticide dealer' },
  { value: 'seed_supplier', label: 'Seed supplier' },
];

export default function RegisterPage({ status }: { status: KendraStatus }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { refreshSession } = useAuth();

  const isResubmit = status.stage === 'REJECTED';
  const loc = status.location;
  const lic = status.licence;

  const [name, setName] = useState(status.name || '');
  const [businessType, setBusinessType] = useState(status.businessType || 'krushi_kendra');
  const [district, setDistrict] = useState(loc.district || '');
  const [taluka, setTaluka] = useState(loc.taluka || '');
  const [village, setVillage] = useState(loc.village || '');
  const [pincode, setPincode] = useState(loc.pincode || '');
  const [stateName, setStateName] = useState(loc.state || 'Maharashtra');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);

  const [licenceNumber, setLicenceNumber] = useState(lic?.number || '');
  const [licenceType, setLicenceType] = useState(lic?.type || '');
  const [licenceIssuingState, setLicenceIssuingState] = useState(lic?.issuingState || '');
  const [licenceExpiry, setLicenceExpiry] = useState(lic?.expiry ? lic.expiry.slice(0, 10) : '');
  const [files, setFiles] = useState<File[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasExistingDocs = (lic?.documentCount || 0) > 0;
  const docsRequired = !hasExistingDocs; // first submission must include the licence scan

  const captureLocation = () => {
    if (!navigator.geolocation) { toast.error('Location is not available in this browser.'); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsBusy(false); toast.success('Location captured'); },
      () => { setGpsBusy(false); toast.error('Could not get your location. You can still submit; farmers will be matched by district.'); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (docsRequired && files.length === 0) {
      setErr('Please attach a photo/scan of your dealer licence.');
      return;
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        businessType,
        district: district.trim(),
        licenceNumber: licenceNumber.trim(),
      };
      if (taluka.trim()) payload.taluka = taluka.trim();
      if (village.trim()) payload.village = village.trim();
      if (stateName.trim()) payload.state = stateName.trim();
      if (pincode.trim()) payload.pincode = pincode.trim();
      if (coords) { payload.lat = coords.lat; payload.lng = coords.lng; }
      if (licenceType.trim()) payload.licenceType = licenceType.trim();
      if (licenceIssuingState.trim()) payload.licenceIssuingState = licenceIssuingState.trim();
      if (licenceExpiry) payload.licenceExpiry = new Date(licenceExpiry).toISOString();

      const res = await apiPost<{ rolePromoted?: boolean }>('/kendra/register', payload);
      // Picking up the new SELLER role keeps the access token in sync.
      if (res?.rolePromoted) { try { await refreshSession(); } catch { /* refreshed lazily on next 401 */ } }

      if (files.length > 0) {
        await apiUploadFiles('/users/me/licence-documents', files, 'images');
      }

      await queryClient.invalidateQueries({ queryKey: KENDRA_ME_KEY });
      toast.success('Submitted — your licence is now under review.');
      navigate('/pending');
    } catch (e2) {
      setErr(errorMessage(e2, 'Could not submit your registration. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout subtitle={isResubmit ? 'Resubmit your licence' : 'Register your Kendra'}>
      <form onSubmit={onSubmit} className="space-y-6">
        {isResubmit && lic?.rejectedReason && (
          <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium">Your previous submission was rejected</p>
            <p className="mt-1">{lic.rejectedReason}</p>
            <p className="mt-1 text-red-600/80">Please correct the details / documents below and resubmit.</p>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Business details</h2>
          <p className="mb-4 text-sm text-slate-500">Only verified Krushi Seva Kendras are shown to nearby farmers.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Kendra / shop name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jai Kisan Krushi Seva Kendra" required /></Field>
            </div>
            <Field label="Business type">
              <Select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                {BUSINESS_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </Select>
            </Field>
            <Field label="District"><Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="District" required /></Field>
            <Field label="Taluka"><Input value={taluka} onChange={(e) => setTaluka(e.target.value)} placeholder="Taluka" /></Field>
            <Field label="Village / town"><Input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Village or town" /></Field>
            <Field label="Pincode"><Input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" placeholder="6-digit" maxLength={6} /></Field>
            <Field label="State"><Input value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="State" /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" loading={gpsBusy} onClick={captureLocation}>
              <MapPin className="h-4 w-4" /> {coords ? 'Update shop location' : 'Use my shop location (GPS)'}
            </Button>
            {coords && <span className="text-xs text-slate-500">Lat {coords.lat.toFixed(4)}, Lng {coords.lng.toFixed(4)} — helps farmers find you by distance.</span>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Dealer licence</h2>
          <p className="mb-4 text-sm text-slate-500">An admin verifies your licence before your Kendra is approved.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Licence number"><Input value={licenceNumber} onChange={(e) => setLicenceNumber(e.target.value)} placeholder="As printed on the licence" required /></Field>
            <Field label="Licence type" hint="e.g. Pesticide / Fertilizer / Seed">
              <Input value={licenceType} onChange={(e) => setLicenceType(e.target.value)} placeholder="Pesticide / Fertilizer / Seed" />
            </Field>
            <Field label="Issuing state / authority"><Input value={licenceIssuingState} onChange={(e) => setLicenceIssuingState(e.target.value)} placeholder="Issuing authority / state" /></Field>
            <Field label="Expiry date"><Input type="date" value={licenceExpiry} onChange={(e) => setLicenceExpiry(e.target.value)} /></Field>
          </div>

          <div className="mt-4">
            <p className="mb-1 block text-sm font-medium text-slate-700">
              Licence document {docsRequired ? <span className="text-red-600">*</span> : <span className="text-slate-400">(optional — already on file)</span>}
            </p>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600 hover:bg-slate-100">
              <Upload className="h-4 w-4" />
              <span>{files.length ? `${files.length} file(s) selected` : 'Upload photo / scan of your licence (JPG/PNG)'}</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
            {hasExistingDocs && !files.length && (
              <p className="mt-1 flex items-center gap-1 text-xs text-brand-700"><FileCheck2 className="h-3.5 w-3.5" /> {lic?.documentCount} document(s) already uploaded.</p>
            )}
          </div>
        </Card>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            {isResubmit ? 'Resubmit for verification' : 'Submit for verification'}
          </Button>
        </div>
      </form>
    </Layout>
  );
}
