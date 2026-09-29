export type UploadError = {
  status: number;
  code: string | null;
  message: string;
};

/**
 * Sends the resume with XMLHttpRequest, because fetch can't report upload progress.
 * Resolves with the queued job's id (202); rejects with { status, code, message } (status 0 = network).
 */
export function uploadResume(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/onboarding/imports/resume");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.min(100, (event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as {
        jobId?: string;
        error?: { code?: string; message?: string };
      };
      if (xhr.status === 202 && typeof body.jobId === "string") {
        resolve({ jobId: body.jobId });
        return;
      }
      reject({
        status: xhr.status,
        code: body.error?.code ?? null,
        message: body.error?.message ?? "Couldn't upload the file.",
      } satisfies UploadError);
    };
    xhr.onerror = () =>
      reject({
        status: 0,
        code: null,
        message: "Can't reach Redlance. Check your connection and try again.",
      } satisfies UploadError);
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
