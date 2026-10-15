import { useState, type FormEvent } from "react";
import { Link, Redirect } from "wouter";
import { useAuth } from "@/_core/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Megaphone } from "lucide-react";

export default function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  // Declarative, not `navigate()` straight after the await: the auth query's
  // cache update and this render are not the same tick, so an imperative jump
  // reaches the guarded route while `user` is still null and bounces right back
  // here. Rendering a Redirect once `user` exists waits for the state.
  if (user) return <Redirect to="/" />;

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md place-items-center p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Megaphone className="size-5" />
          </span>
          <div className="space-y-1">
            <h1>Painel de Status</h1>
            <p className="text-body text-muted-foreground">
              Entre para publicar imagens e vídeos no Status do WhatsApp através da sua instância.
            </p>
          </div>
        </div>

        <div className="panel space-y-5 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <p className="border-t border-border/70 pt-4 text-center text-sm text-muted-foreground">
            Ainda não tem conta?{" "}
            <Link href="/signup" className="focus-ring rounded font-medium text-primary hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
