import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nuova password — Personal Finance" },
      {
        name: "description",
        content: "Imposta una nuova password per il tuo account Personal Finance.",
      },
      { property: "og:title", content: "Nuova password — Personal Finance" },
      {
        property: "og:description",
        content: "Imposta una nuova password per il tuo account Personal Finance.",
      },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("La password deve avere almeno 8 caratteri.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error)
      return setError("Link scaduto o non valido. Richiedine uno nuovo dalla pagina di accesso.");
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6">
        <h1 className="text-2xl">Imposta una nuova password</h1>
        <div className="space-y-1.5">
          <Label htmlFor="pw">Nuova password</Label>
          <Input
            id="pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          Salva password
        </Button>
      </form>
    </div>
  );
}
