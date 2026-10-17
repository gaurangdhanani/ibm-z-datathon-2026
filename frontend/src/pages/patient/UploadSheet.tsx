import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, FileUp } from "lucide-react";

import { patientApi } from "../../lib/data";
import { formatBytes } from "../../lib/format";
import { Banner, Button, Input, Modal } from "../../components/ui";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain";
const ALLOWED_TYPE = /^(application\/pdf|image\/png|image\/jpeg|text\/plain)$/;
const ALLOWED_EXT = /\.(pdf|png|jpe?g|txt)$/i;

/** Quick client-side check; the server repeats it on the file's magic bytes. */
function problemWith(file: File): string | null {
  if (!ALLOWED_TYPE.test(file.type) && !ALLOWED_EXT.test(file.name)) {
    return "Only PDF, JPG, PNG or TXT files can be uploaded.";
  }
  if (file.size > MAX_BYTES) return `That file is ${formatBytes(file.size)}. The limit is 10 MB.`;
  return null;
}

/** P3: pick a file or take a photo, optional title, then encrypt and upload. */
export function UploadSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setFile(null);
    setTitle("");
    setError(null);
    onClose();
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = ""; // allow picking the same file again after an error
    if (!chosen) return;
    setFile(chosen);
    setError(problemWith(chosen));
  }

  async function upload() {
    if (!file || problemWith(file) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await patientApi.uploadRecord(file, title);
      setBusy(false);
      setFile(null);
      setTitle("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} labelledBy="upload-title" sheet>
      <h2 id="upload-title" className="pr-8 font-serif text-2xl text-ink">
        Upload record
      </h2>
      <p className="mt-1 text-sm text-ink/70">
        PDF, photo or text file, up to 10 MB. It is encrypted before it is stored, then organized
        inside your vault.
      </p>

      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={pick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
          <FileUp size={18} /> Choose file
        </Button>
        <Button variant="secondary" onClick={() => cameraInput.current?.click()} disabled={busy}>
          <Camera size={18} /> Take a photo
        </Button>
      </div>

      {file && (
        <p className="mt-3 truncate rounded-lg bg-sage-100 px-3 py-2 text-sm text-ink">
          {file.name} · {formatBytes(file.size)}
        </p>
      )}

      <label className="mt-4 block text-sm font-medium text-ink" htmlFor="upload-name">
        Title <span className="font-normal text-ink/60">(optional)</span>
      </label>
      <Input
        id="upload-name"
        className="mt-1"
        placeholder="e.g. Knee MRI, Oct 2026"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />

      {error && (
        <div className="mt-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <Button size="lg" className="mt-5 w-full" onClick={upload} disabled={!file || !!error || busy}>
        {busy ? "Encrypting and uploading…" : "Upload"}
      </Button>
    </Modal>
  );
}
