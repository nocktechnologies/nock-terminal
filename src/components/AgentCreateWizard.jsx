import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import {
  DEFAULT_MODEL,
  PERMISSION_PRESETS,
  validateResidentDraft,
} from '../utils/agentConsole.mjs';

const INITIAL_VALUES = {
  id: '',
  displayName: '',
  role: '',
  purpose: '',
  workDirectory: '',
  allowedRoots: '',
  deniedRoots: '',
  model: DEFAULT_MODEL,
  partner: 'Local operator',
  permissionPreset: 'supervised',
};

const INPUT_CLASS = 'w-full rounded border border-nock-border bg-nock-card/70 px-2.5 py-2 font-mono text-[11px] text-nock-text outline-none transition-colors placeholder:text-nock-text-muted focus:border-nock-accent-blue/60 disabled:cursor-not-allowed disabled:opacity-60';

export default function AgentCreateWizard({
  open,
  onClose,
  onCreate,
  blockedReason = '',
  mode = 'create',
  initialValues = INITIAL_VALUES,
  supportedModels = [DEFAULT_MODEL],
}) {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues({ ...INITIAL_VALUES, ...initialValues });
    setErrors({});
    setSubmitError('');
  }, [initialValues, open]);

  if (!open) return null;

  const update = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    setSubmitError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    const result = validateResidentDraft(values, supportedModels);
    setErrors(result.errors);
    if (!result.valid || submitting || blockedReason) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onCreate(result.draft);
      setValues(INITIAL_VALUES);
      onClose();
    } catch (error) {
      setSubmitError(error?.message || 'Resident creation did not complete.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Edit resident' : 'Create resident'}>
      <form onSubmit={submit} className="flex h-full w-full max-w-xl flex-col border-l border-nock-border bg-nock-bg shadow-2xl">
        <header className="flex items-center justify-between border-b border-nock-border px-5 py-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest text-nock-accent-cyan">// Managed residence</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-nock-text">{mode === 'edit' ? 'Edit Resident' : 'Create Resident'}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="inline-flex h-8 w-8 items-center justify-center rounded border border-nock-border text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text disabled:opacity-40" aria-label="Close create resident" title="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {blockedReason && <Notice tone="warning">{blockedReason}</Notice>}
          {submitError && <Notice tone="error">{submitError}</Notice>}

          <section className="border-b border-nock-border pb-5">
            <SectionLabel>Identity</SectionLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="ID" error={errors.id}>
                <input value={values.id} onChange={(event) => update('id', event.target.value)} className={INPUT_CLASS} placeholder="mira" autoComplete="off" disabled={mode === 'edit'} />
              </Field>
              <Field label="Display name" error={errors.displayName}>
                <input value={values.displayName} onChange={(event) => update('displayName', event.target.value)} className={INPUT_CLASS} placeholder="Mira" autoComplete="off" />
              </Field>
              <Field label="Role" error={errors.role}>
                <input value={values.role} onChange={(event) => update('role', event.target.value)} className={INPUT_CLASS} placeholder="Resident operator" autoComplete="off" />
              </Field>
              <Field label="Partner" error={errors.partner}>
                <input value={values.partner} onChange={(event) => update('partner', event.target.value)} className={INPUT_CLASS} autoComplete="off" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Purpose" error={errors.purpose}>
                <textarea value={values.purpose} onChange={(event) => update('purpose', event.target.value)} className={`${INPUT_CLASS} min-h-20 resize-y`} placeholder="What this resident is responsible for" />
              </Field>
            </div>
          </section>

          <section className="border-b border-nock-border py-5">
            <SectionLabel>Workspace</SectionLabel>
            <div className="mt-3 grid gap-3">
              <Field label="Work directory" error={errors.workDirectory}>
                <input value={values.workDirectory} onChange={(event) => update('workDirectory', event.target.value)} className={INPUT_CLASS} placeholder="/Users/name/Dev/project" autoComplete="off" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Allowed roots" error={errors.allowedRoots}>
                  <textarea value={values.allowedRoots} onChange={(event) => update('allowedRoots', event.target.value)} className={`${INPUT_CLASS} min-h-24 resize-y`} placeholder="/Users/name/Dev/project" />
                </Field>
                <Field label="Denied roots" error={errors.deniedRoots}>
                  <textarea value={values.deniedRoots} onChange={(event) => update('deniedRoots', event.target.value)} className={`${INPUT_CLASS} min-h-24 resize-y`} placeholder="/Users/name/.ssh" />
                </Field>
              </div>
            </div>
          </section>

          <section className="py-5">
            <SectionLabel>Runtime</SectionLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Model" error={errors.model}>
                <select value={values.model} onChange={(event) => update('model', event.target.value)} className={INPUT_CLASS}>
                  {supportedModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </Field>
              <Field label="Permission preset">
                <select value={values.permissionPreset} onChange={(event) => update('permissionPreset', event.target.value)} className={INPUT_CLASS}>
                  {Object.entries(PERMISSION_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3 border border-nock-border bg-nock-card/40 px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Claude default mode</p>
              <p className="mt-1 font-mono text-xs text-nock-text">{PERMISSION_PRESETS[values.permissionPreset].defaultMode}</p>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-nock-border px-5 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded border border-nock-border px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text disabled:opacity-40">Cancel</button>
          <button type="submit" disabled={submitting || Boolean(blockedReason)} className="inline-flex items-center gap-2 rounded bg-nock-accent-blue px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-nock-accent-blue/80 disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {submitting ? (mode === 'edit' ? 'Saving' : 'Creating') : (mode === 'edit' ? 'Save resident' : 'Create resident')}
          </button>
        </footer>
      </form>
    </div>
  );
}

function SectionLabel({ children }) {
  return <h3 className="font-mono text-[10px] font-medium uppercase tracking-widest text-nock-text-dim">{children}</h3>;
}

function Field({ label, detail, error, children }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-dim">{label}</span>
      {detail && <span className="mt-0.5 block text-[10px] text-nock-text-muted">{detail}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block font-mono text-[10px] text-nock-red">{error}</span>}
    </label>
  );
}

function Notice({ tone, children }) {
  const color = tone === 'error' ? 'border-nock-red/50 text-nock-red' : 'border-nock-accent-amber/50 text-nock-accent-amber';
  return <div className={`mb-4 flex items-start gap-2 border bg-nock-card/40 px-3 py-2.5 font-mono text-[10px] leading-relaxed ${color}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{children}</div>;
}
