"use client";

import { useState } from "react";

export default function CopyPostButton({ post }: { post: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPost() {
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyPost}
      className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
    >
      {copied ? "Copied ✓" : "Copy post"}
    </button>
  );
}
