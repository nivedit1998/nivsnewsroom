// components/SubscribeForm.tsx
"use client";

import { useState } from "react";

export default function SubscribeForm({
  variant = "inline", // 'inline' for navbar, 'panel' for mobile slide-down
}: { variant?: "inline" | "panel" }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong");
      setStatus("ok");
      setMsg("Check your inbox to confirm your subscription.");
      setEmail("");
    } catch (err: any) {
      setStatus("err");
      setMsg(err?.message || "Failed to subscribe.");
    }
  }

  const inputCls =
    variant === "inline"
      ? "w-56 rounded-lg border border-sky-200 bg-white/80 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
      : "flex-1 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

  const btnCls =
    variant === "inline"
      ? "rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700 text-sm hover:bg-sky-100"
      : "rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100";

  return (
    <div>
      <form onSubmit={onSubmit} className={`flex items-center gap-2 ${variant === "panel" ? "" : ""}`}>
        <label htmlFor={`email-${variant}`} className="sr-only">Email</label>
        <input
          id={`email-${variant}`}
          type="email"
          required
          placeholder="you@example.com"
          className={inputCls}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className={btnCls} disabled={status === "loading"}>
          {status === "loading" ? "…" : "Subscribe"}
        </button>
      </form>

      <p className="mt-1 text-[11px] text-gray-500">Double opt-in; unsubscribe anytime.</p>
      {msg && (
        <p className={`mt-2 text-sm ${status === "err" ? "text-red-600" : "text-green-700"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
