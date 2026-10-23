import { useEffect, useState } from "react";

/** Object URL for image bytes, revoked when the bytes change or the component unmounts. */
export function useObjectUrl(bytes: Uint8Array | undefined, type = "image/png"): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!bytes) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, type]);
  return url;
}
