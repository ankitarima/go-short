import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, ImagePlus, Trash2, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@go-short/ui/components/button';
import { Callout } from '@go-short/ui/components/callout';
import { Card, CardContent } from '@go-short/ui/components/card';
import { ConfirmDialog } from '@go-short/ui/components/dialog';
import { Field } from '@go-short/ui/components/field';
import { Input, NativeSelect } from '@go-short/ui/components/input';
import { Segmented } from '@go-short/ui/components/segmented';
import { Skeleton } from '@go-short/ui/components/skeleton';
import { ErrorState } from '@go-short/ui/components/states';
import { Slider } from '@go-short/ui/components/slider';
import { useCampaignOptions, useLinks } from '@/features/links/hooks';
import { useWorkspace, wsKey, wsPath } from '@/hooks/useAuth';
import { ApiError, api, apiBlob, apiUrl } from '@/lib/api';
import { isHex, scanProblem } from '@/lib/color';
import { displayUrl } from '@go-short/ui/lib/format';
import type { Qr } from '@/types/api';
import { useDeleteQr, useQr } from './hooks';

interface Settings {
  name: string;
  linkId: string;
  campaignId: string;
  format: 'svg' | 'png';
  size: number;
  margin: number;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  foregroundColor: string;
  backgroundColor: string;
  logoPath: string | null;
}
const DEFAULTS: Settings = {
  name: '',
  linkId: '',
  campaignId: '',
  format: 'svg',
  size: 512,
  margin: 2,
  errorCorrection: 'M',
  foregroundColor: '#000000',
  backgroundColor: '#FFFFFF',
  logoPath: null,
};

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHex(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-background p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          maxLength={7}
          spellCheck={false}
          className="mono-13 uppercase"
          aria-invalid={!isHex(value)}
        />
      </div>
    </Field>
  );
}

export function QrDesignerPage() {
  const { id } = useParams();
  const editing = !!id && id !== 'new';
  const [params] = useSearchParams();
  const { workspace, canWrite } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saved = useQr(editing ? id : undefined);
  const links = useLinks({});
  const campaigns = useCampaignOptions();
  const del = useDeleteQr();
  const [s, setS] = useState<Settings>({ ...DEFAULTS, linkId: params.get('linkId') ?? '' });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upd = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const linkItems = useMemo(() => links.data?.pages.flatMap((p) => p.data) ?? [], [links.data]);

  // Load a saved QR into the form once.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const q = saved.data;
    if (!q || loadedFor.current === q.id) return;
    loadedFor.current = q.id;
    setS({
      name: q.name,
      linkId: q.linkId,
      campaignId: q.campaignId ?? '',
      format: q.format,
      size: q.size,
      margin: q.margin,
      errorCorrection: q.errorCorrection,
      foregroundColor: q.foregroundColor,
      backgroundColor: q.backgroundColor,
      logoPath: q.hasLogo ? '(existing)' : null,
    });
    if (q.hasLogo) setLogoPreview(null);
  }, [saved.data]);
  useEffect(() => {
    if (!editing && !s.linkId && linkItems[0])
      setS((p) => ({ ...p, linkId: p.linkId || linkItems[0]!.id }));
  }, [editing, s.linkId, linkItems]);

  const problem = scanProblem(s.foregroundColor, s.backgroundColor);
  const hasLogo = !!s.logoPath;
  const logoIsExisting = s.logoPath === '(existing)';

  // Debounced settings drive the server-side preview.
  const [debounced, setDebounced] = useState(s);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(s), 250);
    return () => clearTimeout(t);
  }, [s]);
  const previewBody = {
    linkId: debounced.linkId || null,
    format: 'png' as const,
    size: Math.min(debounced.size, 640),
    margin: debounced.margin,
    errorCorrection: debounced.errorCorrection,
    foregroundColor: debounced.foregroundColor,
    backgroundColor: debounced.backgroundColor,
    // An uploaded logo is referenced by its path; a saved QR's own logo is reused by id (paths are never exposed).
    ...(debounced.logoPath && debounced.logoPath !== '(existing)'
      ? { logoPath: debounced.logoPath }
      : {}),
    ...(debounced.logoPath === '(existing)' && editing ? { logoFrom: id } : {}),
  };
  const previewEnabled = !scanProblem(debounced.foregroundColor, debounced.backgroundColor);
  const preview = useQuery({
    queryKey: wsKey(workspace.id, 'qr', 'preview', previewBody),
    enabled: previewEnabled,
    queryFn: async ({ signal }) =>
      URL.createObjectURL(
        await apiBlob(wsPath(workspace, '/qr/preview'), {
          method: 'POST',
          body: previewBody,
          signal,
        }),
      ),
    staleTime: Infinity,
    gcTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 512 * 1024)
        throw new ApiError(413, 'TOO_LARGE', 'Logos can be at most 512 KB.');
      if (!['image/png', 'image/jpeg'].includes(file.type))
        throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Use a PNG or JPEG image.');
      const r = await api<{ logoPath: string }>(wsPath(workspace, '/qr/logos'), {
        method: 'POST',
        raw: { data: file, contentType: file.type },
      });
      return { logoPath: r.logoPath, url: URL.createObjectURL(file) };
    },
    onSuccess: ({ logoPath, url }) => {
      setLogoPreview(url);
      setS((p) => ({ ...p, logoPath, errorCorrection: 'H' }));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not upload the logo'),
  });

  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: s.name.trim(),
        format: s.format,
        size: s.size,
        margin: s.margin,
        errorCorrection: s.errorCorrection,
        foregroundColor: s.foregroundColor,
        backgroundColor: s.backgroundColor,
      };
      if (editing) {
        return api<Qr>(wsPath(workspace, `/qr/${id}`), {
          method: 'PATCH',
          body: {
            ...common,
            campaignId: s.campaignId || null,
            ...(logoIsExisting ? {} : { logoPath: s.logoPath }),
          },
        });
      }
      return api<Qr>(wsPath(workspace, '/qr'), {
        method: 'POST',
        body: {
          ...common,
          linkId: s.linkId,
          campaignId: s.campaignId || null,
          ...(s.logoPath ? { logoPath: s.logoPath } : {}),
        },
      });
    },
    onSuccess: (q) => {
      toast.success(editing ? 'QR code updated' : 'QR code saved');
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'qr') });
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'overview') });
      void qc.invalidateQueries({ queryKey: wsKey(workspace.id, 'campaigns') });
      if (!editing) navigate(`/qr/${q.id}`, { replace: true });
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;

  async function downloadFormat(format: 'svg' | 'png') {
    if (editing) {
      window.open(
        apiUrl(wsPath(workspace, `/qr/${id}/image`), { format, size: s.size, download: 1 }),
        '_blank',
      );
      return;
    }
    // Not saved yet: render the current design in the requested format and save it as a file.
    try {
      const blob = await apiBlob(wsPath(workspace, '/qr/preview'), {
        method: 'POST',
        body: { ...previewBody, format, size: s.size },
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.name.trim() || 'qr-code'}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not generate the file');
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!problem) save.mutate();
  }

  if (editing && saved.isError)
    return <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />;
  const selectedLink = linkItems.find((l) => l.id === s.linkId);
  const readOnly = !canWrite;

  return (
    <div>
      <RouterLink
        to="/qr"
        className="copy-13 mb-3 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> QR codes
      </RouterLink>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="heading-32">
            {editing ? (saved.data?.name ?? 'QR code') : 'New QR code'}
          </h1>
          <p className="copy-14 mt-1.5 text-muted-foreground">
            Everything is generated on your server. Colours are checked so the code stays scannable.
          </p>
        </div>
        {editing && canWrite && (
          <Button variant="destructive-outline" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={submit} className="flex flex-col gap-6" aria-label="QR designer">
          {err && <Callout tone="danger">{err.message}</Callout>}
          <Card>
            <CardContent className="flex flex-col gap-5">
              <Field id="qr-name" label="Name" error={err?.field('name')}>
                <Input
                  id="qr-name"
                  required
                  maxLength={120}
                  value={s.name}
                  onChange={(e) => upd('name', e.target.value)}
                  placeholder="Registration poster"
                  disabled={readOnly}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="qr-link"
                  label="Link"
                  hint={editing ? 'The linked URL cannot be changed.' : undefined}
                  error={err?.code === 'LINK_NOT_FOUND' ? err.message : undefined}
                >
                  <NativeSelect
                    id="qr-link"
                    value={s.linkId}
                    onChange={(e) => upd('linkId', e.target.value)}
                    disabled={editing || readOnly}
                    required
                  >
                    {!linkItems.length && (
                      <option value="">
                        {links.isPending ? 'Loading…' : 'Create a link first'}
                      </option>
                    )}
                    {linkItems.map((l) => (
                      <option key={l.id} value={l.id}>
                        {displayUrl(l.shortUrl)}
                      </option>
                    ))}
                    {editing && !selectedLink && saved.data && (
                      <option value={saved.data.linkId}>
                        {displayUrl(saved.data.url.split('?')[0] ?? '')}
                      </option>
                    )}
                  </NativeSelect>
                </Field>
                <Field id="qr-campaign" label="Campaign" optional>
                  <NativeSelect
                    id="qr-campaign"
                    value={s.campaignId}
                    onChange={(e) => upd('campaignId', e.target.value)}
                    disabled={readOnly}
                  >
                    <option value="">No campaign</option>
                    {campaigns.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <ColorField
                  id="qr-fg"
                  label="Foreground"
                  value={s.foregroundColor}
                  onChange={(v) => upd('foregroundColor', v)}
                />
                <ColorField
                  id="qr-bg"
                  label="Background"
                  value={s.backgroundColor}
                  onChange={(v) => upd('backgroundColor', v)}
                />
              </div>
              {problem && (
                <Callout tone="warning" title="This colour pair may not scan">
                  {problem}
                </Callout>
              )}
              <Field id="qr-size" label={`Size · ${s.size}px`}>
                <Slider
                  id="qr-size"
                  min={128}
                  max={2048}
                  step={32}
                  value={[s.size]}
                  onValueChange={([v]) => upd('size', v ?? 512)}
                  aria-label="Size"
                />
              </Field>
              <Field id="qr-margin" label={`Margin · ${s.margin} modules`}>
                <Slider
                  id="qr-margin"
                  min={0}
                  max={10}
                  step={1}
                  value={[s.margin]}
                  onValueChange={([v]) => upd('margin', v ?? 2)}
                  aria-label="Margin"
                />
              </Field>
              <Field
                id="qr-ecc"
                label="Error correction"
                hint={
                  hasLogo
                    ? 'A logo requires the highest level (H).'
                    : 'Higher levels survive more damage but make denser codes.'
                }
              >
                <NativeSelect
                  id="qr-ecc"
                  value={hasLogo ? 'H' : s.errorCorrection}
                  onChange={(e) =>
                    upd('errorCorrection', e.target.value as Settings['errorCorrection'])
                  }
                  disabled={hasLogo || readOnly}
                >
                  <option value="L">L · Low (7%)</option>
                  <option value="M">M · Medium (15%)</option>
                  <option value="Q">Q · Quartile (25%)</option>
                  <option value="H">H · High (30%)</option>
                </NativeSelect>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="label-14">
                Logo <span className="font-normal text-subtle-foreground">· optional</span>
              </div>
              {hasLogo ? (
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="Uploaded logo"
                      className="size-10 rounded object-contain"
                    />
                  ) : (
                    <ImagePlus className="size-5 text-muted-foreground" />
                  )}
                  <span className="copy-14 flex-1 text-muted-foreground">
                    {logoIsExisting ? 'Using the saved logo' : 'Logo uploaded'}
                  </span>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        upd('logoPath', null);
                        setLogoPreview(null);
                      }}
                    >
                      <X /> Remove
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    aria-label="Upload logo"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.mutate(f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    loading={upload.isPending}
                    disabled={readOnly}
                    onClick={() => fileRef.current?.click()}
                    className="self-start"
                  >
                    <ImagePlus /> Upload logo
                  </Button>
                  <p className="copy-13 text-muted-foreground">
                    PNG or JPEG up to 512 KB. It is resized and re-encoded on the server, and shown
                    in the centre of the code.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {!readOnly && (
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                loading={save.isPending}
                disabled={!s.name.trim() || !s.linkId || !!problem}
              >
                {editing ? 'Save changes' : 'Save QR code'}
              </Button>
              {editing && (
                <RouterLink
                  to="/qr"
                  className="copy-14 text-muted-foreground hover:text-foreground"
                >
                  Done
                </RouterLink>
              )}
            </div>
          )}
        </form>

        <aside aria-label="Preview" className="lg:sticky lg:top-8 lg:self-start">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="label-14">Preview</span>
                <Segmented
                  label="Saved format"
                  value={s.format}
                  onChange={(v) => upd('format', v)}
                  options={[
                    { value: 'svg', label: 'SVG' },
                    { value: 'png', label: 'PNG' },
                  ]}
                />
              </div>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-3">
                {preview.data ? (
                  <img
                    src={preview.data}
                    alt="QR code preview"
                    className="h-full w-full object-contain"
                  />
                ) : preview.isError ? (
                  <p className="copy-13 px-6 text-center text-red">
                    {preview.error instanceof ApiError
                      ? preview.error.message
                      : 'Preview unavailable'}
                  </p>
                ) : problem ? (
                  <p className="copy-13 px-6 text-center text-muted-foreground">
                    Fix the colours to see a preview.
                  </p>
                ) : (
                  <Skeleton className="size-full" />
                )}
              </div>
              {selectedLink && (
                <div
                  className="mono-13 truncate text-center text-xs text-muted-foreground"
                  title={selectedLink.shortUrl}
                >
                  {displayUrl(selectedLink.shortUrl)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!!problem || !s.linkId}
                  onClick={() => void downloadFormat('svg')}
                >
                  <Download /> SVG
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!!problem || !s.linkId}
                  onClick={() => void downloadFormat('png')}
                >
                  <Download /> PNG
                </Button>
              </div>
              {!editing && (
                <p className="copy-13 text-center text-muted-foreground">
                  Save to keep this design and track its scans.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this QR code?"
        description="Printed copies keep working because they point to the short link, but you can no longer manage or download this design."
        confirmLabel="Delete QR code"
        loading={del.isPending}
        onConfirm={() =>
          saved.data &&
          del.mutate(saved.data, { onSuccess: () => navigate('/qr', { replace: true }) })
        }
      />
    </div>
  );
}
