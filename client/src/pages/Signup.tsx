import { useState, type FormEvent } from "react";
import { Link, Redirect } from "wouter";
import { useAuth } from "@/_core/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, Megaphone } from "lucide-react";

export default function Signup() {
  const { signup, user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(email, password, name || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  // See Login.tsx: the redirect is declarative so it cannot race the auth query.
  if (user) return <Redirect to="/" />;

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md place-items-center p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Megaphone className="size-5" />
          </span>
          <div className="space-y-1">
            <h1>Criar conta</h1>
            <p className="text-body text-muted-foreground">
              Sua conta guarda as instâncias, as mídias e o histórico de status. Leva alguns segundos.
            </p>
          </div>
        </div>

        <div className="panel space-y-5 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                autoComplete="name"
                placeholder="Como devemos te chamar"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
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
                autoComplete="new-password"
                placeholder="mínimo de 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              <p className="text-caption text-muted-foreground">Use pelo menos 8 caracteres.</p>
            </div>
            {error && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Criando…" : "Criar conta"}
            </Button>
          </form>

          <p className="border-t border-border/70 pt-4 text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link href="/login" className="focus-ring rounded font-medium text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
