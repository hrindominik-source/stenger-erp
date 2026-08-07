import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";

export function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = init. loading, null = odhlaseny
  const [profile, setProfile] = useState(null); // { full_name, role }
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileError("");
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    setProfileError("");
    supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfileLoading(false);
        if (error) {
          setProfileError("Tento ucet nema priradenu rolu v systeme. Kontaktujte administratora.");
          setProfile(null);
        } else {
          setProfile(data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return {
    loading: session === undefined || profileLoading,
    session,
    user: session ? session.user : null,
    profile,
    profileError,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
  };
}
