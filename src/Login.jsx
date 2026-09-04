import React, { useState } from "react";
import { Loader2, AlertCircle, LogIn } from "lucide-react";

export default function Login({ onSignIn, onSwitchApp }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: signInError } = await onSignIn(email.trim(), password);
    setBusy(false);
    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Nesprávný e-mail nebo heslo."
          : signInError.message
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <div className="text-center mb-6">
          <img src={`${import.meta.env.BASE_URL}stenger-logo.png`} alt="Stenger" className="h-16 w-auto mx-auto mb-3" />
          <div className="text-xs tracking-wider text-slate-400 mb-1">Stenger Czech s.r.o.</div>
          <h1 className="text-lg font-semibold text-slate-900">Přihlášení</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="block mb-3">
            <span className="block text-xs font-medium text-slate-500 mb-1">E-mail</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </label>
          <label className="block mb-4">
            <span className="block text-xs font-medium text-slate-500 mb-1">Heslo</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </label>
          {error && (
            <div className="mb-4 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-md"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            Přihlásit se
          </button>
        </form>
        {onSwitchApp && (
          <button onClick={onSwitchApp} className="block w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-4">
            &larr; Jiná aplikace
          </button>
        )}
      </div>
    </div>
  );
}
